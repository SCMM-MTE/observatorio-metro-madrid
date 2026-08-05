import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  BOCM_RSS,
  METRO_EMPLOYMENT_URL,
  bocmDateRangeSearchUrl,
  bocmSearchUrl,
  contractsFeedUrl,
  contractsSearchUrl,
  fetchText,
  extractJobPositions,
  formatCoverage,
  mapConcurrent,
  mergeItems,
  parseBocmRss,
  parseBocmSearchPage,
  parseBocmSummaryXml,
  parseContractsFeed,
  parseContractsSearchPage,
  parseEmploymentPage,
} from './lib.mjs'

const root = resolve(import.meta.dirname, '..')
const dataPath = resolve(root, 'public/data/archive.json')
const fullBackfill = process.argv.includes('--backfill')
const bocmBackfillOnly = process.argv.includes('--bocm-backfill')
const backfill = fullBackfill || bocmBackfillOnly
const now = new Date().toISOString()
const notificationOutput = process.env.NOTIFICATION_OUTPUT
const bocmFrom = process.env.BOCM_FROM
const bocmTo = process.env.BOCM_TO || bocmFrom

async function readArchive() {
  try {
    return JSON.parse(await readFile(dataPath, 'utf8'))
  } catch {
    return {
      version: 1,
      generatedAt: null,
      coverage: { bocm: '', contratos: '' },
      sources: {},
      items: [],
    }
  }
}

async function collectRecentBocm() {
  const rss = await fetchText(BOCM_RSS)
  const summaryUrls = parseBocmRss(rss)
  const pages = await mapConcurrent(summaryUrls, 5, async (url) => parseBocmSummaryXml(await fetchText(url)))
  const end = now.slice(0, 10)
  const startDate = new Date(`${end}T00:00:00Z`)
  startDate.setUTCDate(startDate.getUTCDate() - Number(process.env.BOCM_RECENT_DAYS || 14))
  const recentSearch = await collectBocmSearch(bocmDateRangeSearchUrl(startDate.toISOString().slice(0, 10), end), 'BOCM reciente')
  return pages.flat().concat(recentSearch)
}

async function collectBocmSearch(firstUrl, label = 'BOCM', pageLimit) {
  const firstHtml = await fetchText(firstUrl, { timeoutMs: 90_000 })
  const first = parseBocmSearchPage(firstHtml)
  const maxPages = Math.min(Number(pageLimit || Math.ceil(first.count / 10)), Math.ceil(first.count / 10))
  const pages = Array.from({ length: Math.max(0, maxPages - 1) }, (_, index) => index + 1)
  if (maxPages > 1 && !first.pageUrlTemplate) throw new Error('El BOCM no devolvió la URL de paginación esperada')
  console.log(`${label}: ${first.count} resultados candidatos, consultando ${maxPages} páginas`)
  const rest = await mapConcurrent(pages, 10, async (page) => {
    if (page % 100 === 0) console.log(`${label}: página ${page}/${maxPages - 1}`)
    const url = first.pageUrlTemplate.replace('{page}', String(page))
    return parseBocmSearchPage(await fetchText(url, { timeoutMs: 90_000 })).records
  })
  return first.records.concat(rest.flat())
}

async function collectBocmBackfill() {
  return collectBocmSearch(bocmSearchUrl(0), 'BOCM histórico', process.env.BOCM_BACKFILL_PAGES)
}

async function collectBocmDateRange() {
  return collectBocmSearch(bocmDateRangeSearchUrl(bocmFrom, bocmTo), `BOCM ${bocmFrom} a ${bocmTo}`)
}

async function collectRecentContracts() {
  const feedPages = Number(process.env.CONTRACTS_FEED_PAGES || 4)
  const pages = await mapConcurrent(Array.from({ length: feedPages }, (_, index) => index), 4, async (page) => {
    return parseContractsFeed(await fetchText(contractsFeedUrl(page), { timeoutMs: 90_000 }))
  })
  const searchPages = await mapConcurrent([0, 1, 2, 3, 4], 5, async (page) => {
    return parseContractsSearchPage(await fetchText(contractsSearchUrl(page), { timeoutMs: 90_000 })).records
  })
  return pages.flat().concat(searchPages.flat())
}

async function collectContractsBackfill() {
  const firstHtml = await fetchText(contractsSearchUrl(0), { timeoutMs: 90_000 })
  const first = parseContractsSearchPage(firstHtml)
  const maxPages = Number(process.env.CONTRACTS_BACKFILL_PAGES || Math.ceil(first.count / 10))
  const pages = Array.from({ length: Math.max(0, maxPages - 1) }, (_, index) => index + 1)
  console.log(`Contratos: ${first.count} resultados, consultando ${maxPages} páginas`)
  const rest = await mapConcurrent(pages, 10, async (page) => {
    if (page % 100 === 0) console.log(`Contratos: página ${page}/${maxPages - 1}`)
    return parseContractsSearchPage(await fetchText(contractsSearchUrl(page), { timeoutMs: 90_000 })).records
  })
  return first.records.concat(rest.flat())
}

async function collectEmployment() {
  return parseEmploymentPage(await fetchText(METRO_EMPLOYMENT_URL, { timeoutMs: 90_000 }))
}

const archive = await readArchive()
const existingIds = new Set((archive.items || []).map((item) => item.id))
archive.version = 1
archive.sources ||= {}
archive.sources.empleo ||= { checkedAt: null, ok: false, message: 'Pendiente de primera consulta', recordsSeen: 0 }
let incoming = []

const collectors = [
  ['bocm', backfill ? collectBocmBackfill : bocmFrom ? collectBocmDateRange : collectRecentBocm],
  ['contratos', fullBackfill ? collectContractsBackfill : collectRecentContracts],
  ['empleo', collectEmployment],
]

for (const [source, collect] of bocmBackfillOnly ? collectors.slice(0, 1) : collectors) {
  try {
    const records = await collect()
    const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()]
    incoming.push(...uniqueRecords)
    archive.sources[source] = {
      checkedAt: now,
      ok: true,
      message: uniqueRecords.length ? `${uniqueRecords.length.toLocaleString('es-ES')} registros relevantes comprobados` : 'Consulta correcta, sin novedades relevantes',
      recordsSeen: uniqueRecords.length,
    }
    console.log(`${source}: ${uniqueRecords.length} registros relevantes`)
  } catch (error) {
    archive.sources[source] = {
      checkedAt: now,
      ok: false,
      message: `Error de consulta: ${error.message}`.slice(0, 220),
      recordsSeen: 0,
    }
    console.error(`${source}: ${error.stack || error}`)
  }
}

archive.items = mergeItems(archive.items || [], incoming, now)
archive.items = archive.items.map((item) => {
  if (item.source !== 'bocm') return item
  const jobPositions = extractJobPositions(item.title)
  if (!jobPositions.length || !/proceso selectivo|plazas?|puestos? de trabajo|bolsa de (?:empleo|trabajo)/i.test(item.title)) return item
  return {
    ...item,
    vacancies: jobPositions.reduce((sum, job) => sum + job.vacancies, 0),
    position: jobPositions[0].position,
    jobPositions,
    tags: [...new Set([...(item.tags || []), 'empleo'])],
  }
})
const newItems = archive.items.filter((item) => !existingIds.has(item.id))
archive.generatedAt = now
archive.coverage = {
  bocm: formatCoverage(archive.items, 'bocm'),
  contratos: formatCoverage(archive.items, 'contratos'),
  empleo: formatCoverage(archive.items, 'empleo'),
}

await mkdir(dirname(dataPath), { recursive: true })
await writeFile(dataPath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8')
console.log(`Archivo actualizado: ${archive.items.length} publicaciones en total`)
console.log(`Novedades detectadas: ${newItems.length}`)

if (notificationOutput) {
  const outputPath = resolve(notificationOutput)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: now, items: newItems }, null, 2)}\n`, 'utf8')
}
