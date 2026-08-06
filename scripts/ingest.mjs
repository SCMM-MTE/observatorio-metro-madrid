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
  findNotificationItems,
  formatCoverage,
  formatItemCoverage,
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
const dataPath = resolve(process.env.ARCHIVE_PATH || resolve(root, 'public/data/archive.json'))
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
  const records = []
  const warnings = []
  let successfulPaths = 0

  try {
    const rss = await fetchText(BOCM_RSS, { attempts: 5, timeoutMs: 90_000 })
    const summaryUrls = parseBocmRss(rss)
    let summariesRead = 0
    const pages = await mapConcurrent(summaryUrls, 5, async (url) => {
      try {
        const page = parseBocmSummaryXml(await fetchText(url, { attempts: 5, timeoutMs: 90_000 }))
        summariesRead += 1
        return page
      } catch (error) {
        const document = new URL(url).pathname.split('/').at(-1)
        warnings.push(`${document}: ${error.message}`)
        console.warn(`BOCM: se omite temporalmente ${document}: ${error.message}`)
        return []
      }
    })
    if (summariesRead || !summaryUrls.length) successfulPaths += 1
    records.push(...pages.flat())
  } catch (error) {
    warnings.push(`RSS: ${error.message}`)
    console.warn(`BOCM: RSS no disponible: ${error.message}`)
  }

  const end = now.slice(0, 10)
  const startDate = new Date(`${end}T00:00:00Z`)
  startDate.setUTCDate(startDate.getUTCDate() - Number(process.env.BOCM_RECENT_DAYS || 14))
  try {
    records.push(...await collectBocmSearch(bocmDateRangeSearchUrl(startDate.toISOString().slice(0, 10), end), 'BOCM reciente'))
    successfulPaths += 1
  } catch (error) {
    warnings.push(`buscador reciente: ${error.message}`)
    console.warn(`BOCM: buscador reciente no disponible: ${error.message}`)
  }

  if (!successfulPaths) throw new Error(`fallaron RSS y buscador reciente: ${warnings.join(' | ')}`)
  return { records, warnings }
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

async function collectEmployment(bocmRecords) {
  try {
    return parseEmploymentPage(await fetchText(METRO_EMPLOYMENT_URL, { attempts: 2, timeoutMs: 45_000 }))
  } catch (error) {
    if (!archive.sources.bocm?.ok) throw error
    const officialJobs = bocmRecords.filter((item) => item.source === 'bocm' && item.tags?.includes('empleo'))
    console.warn(`Empleo Metro: acceso directo protegido; cobertura oficial mantenida mediante BOCM (${error.message})`)
    return {
      records: [],
      status: {
        checkedAt: now,
        ok: true,
        message: `Cobertura mediante BOCM: ${officialJobs.length} convocatoria(s) reciente(s) revisada(s); el portal directo protege el acceso automatizado`,
        recordsSeen: officialJobs.length,
      },
    }
  }
}

const archive = await readArchive()
const previousSources = structuredClone(archive.sources || {})
const existingById = new Map((archive.items || []).map((item) => [item.id, item]))
archive.version = 1
archive.sources ||= {}
archive.sources.empleo ||= { checkedAt: null, ok: false, message: 'Pendiente de primera consulta', recordsSeen: 0 }
let incoming = []

const collectors = [
  ['bocm', backfill ? collectBocmBackfill : bocmFrom ? collectBocmDateRange : collectRecentBocm],
  ['contratos', fullBackfill ? collectContractsBackfill : collectRecentContracts],
  ['empleo', () => collectEmployment(incoming)],
]

for (const [source, collect] of bocmBackfillOnly ? collectors.slice(0, 1) : collectors) {
  try {
    const collected = await collect()
    const records = Array.isArray(collected) ? collected : collected.records
    const warnings = Array.isArray(collected) ? [] : (collected.warnings || [])
    const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()]
    incoming.push(...uniqueRecords)
    archive.sources[source] = collected.status || {
      checkedAt: now,
      ok: true,
      message: uniqueRecords.length
        ? `${uniqueRecords.length.toLocaleString('es-ES')} registros relevantes comprobados${warnings.length ? `; ${warnings.length} documento(s) omitido(s) temporalmente` : ''}`
        : warnings.length
          ? `Consulta parcial sin registros; ${warnings.length} documento(s) omitido(s) temporalmente`
          : 'Consulta correcta, sin novedades relevantes',
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

const notificationItems = findNotificationItems([...existingById.values()], archive.items, incoming)
const newItems = notificationItems.filter((item) => item.notificationKind === 'new')
const updatedItems = notificationItems.filter((item) => item.notificationKind === 'updated')
archive.generatedAt = now
archive.coverage = {
  bocm: formatCoverage(archive.items, 'bocm'),
  contratos: formatCoverage(archive.items, 'contratos'),
  empleo: formatItemCoverage(archive.items.filter((item) => item.source === 'empleo' || item.tags?.includes('empleo'))),
}

const healthEvents = Object.entries(archive.sources).flatMap(([source, status]) => {
  const previous = previousSources[source]
  if (!previous || previous.ok === status.ok) return []
  return [{ source, kind: status.ok ? 'recovered' : 'failed', message: status.message }]
})

await mkdir(dirname(dataPath), { recursive: true })
await writeFile(dataPath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8')
console.log(`Archivo actualizado: ${archive.items.length} publicaciones en total`)
console.log(`Novedades detectadas: ${newItems.length} nuevas y ${updatedItems.length} actualizadas`)

if (notificationOutput) {
  const outputPath = resolve(notificationOutput)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: now, items: notificationItems, healthEvents }, null, 2)}\n`, 'utf8')
}
