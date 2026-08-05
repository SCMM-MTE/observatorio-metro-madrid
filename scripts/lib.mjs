import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { XMLParser } from 'fast-xml-parser'

export const BOCM_RSS = 'https://www.bocm.es/sumarios.rss'
export const BOCM_SEARCH = 'https://www.bocm.es/advanced-search/p/language/es'
export const CONTRACTS_FEED = 'https://contratos-publicos.comunidad.madrid/feed/licitaciones2'
export const CONTRACTS_SEARCH = 'https://contratos-publicos.comunidad.madrid/contratos'
export const METRO_EMPLOYMENT_URL = 'https://www.metromadrid.es/es/empleo-metro'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
})

const statusCodes = {
  PUB: 'En plazo',
  EV: 'Pendiente de adjudicación',
  ADJ: 'Adjudicada',
  RES: 'Resuelta / Finalizada',
  ANUL: 'Anulada',
  PRE: 'Anuncio previo',
}

export function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim()
}

export function normalize(value = '') {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function isMetroRelated(...values) {
  const text = normalize(values.filter(Boolean).join(' '))
  return [
    /\bmetro de madrid\b/,
    /\bmetro madrid\b/,
    /\bred de metro\b/,
    /\bampliacion.{0,45}\bmetro\b/,
    /\blinea\s+(?:[1-9]|1[0-2]|r|ramal)\b.{0,55}\bmetro\b/,
    /\bestacion(?:es)?\b.{0,65}\bmetro\b/,
    /\bmetro\b.{0,65}\bestacion(?:es)?\b/,
    /\bferrocarril metropolitano\b/,
  ].some((pattern) => pattern.test(text))
}

const numberWords = new Map([
  ['un', 1], ['una', 1], ['uno', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5],
  ['seis', 6], ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10], ['once', 11], ['doce', 12],
  ['trece', 13], ['catorce', 14], ['quince', 15], ['dieciseis', 16], ['diecisiete', 17],
  ['dieciocho', 18], ['diecinueve', 19], ['veinte', 20], ['treinta', 30], ['cuarenta', 40],
  ['cincuenta', 50], ['cien', 100],
])

export function extractVacancies(value = '') {
  const text = normalize(value)
  const patterns = [
    /(?:cubrir|cobertura de|provision de|convoca(?:toria)?(?: de)?|oferta(?:n)?)(?:\s+(?:un total de|hasta))?\s+(\d+|[a-z]+)\s+(?:plazas|puestos(?: de trabajo)?)/,
    /(\d+|[a-z]+)\s+(?:plazas|puestos de trabajo)\b/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const numeric = Number(match[1])
    const valueNumber = Number.isFinite(numeric) && numeric > 0 ? numeric : numberWords.get(match[1])
    if (valueNumber) return valueNumber
  }
  return undefined
}

export function extractPosition(value = '') {
  const text = cleanText(value)
  const patterns = [
    /puestos? (?:de trabajo )?de\s+(.+?)(?=\s+(?:adscrit|en el|en la|en Metro|para el|para la|de Metro de Madrid)|[,.;(]|$)/i,
    /plazas? (?:de|para)\s+(.+?)(?=\s+(?:adscrit|en el|en la|en Metro|para el|para la|de Metro de Madrid)|[,.;(]|$)/i,
    /proceso selectivo (?:para|de)\s+(?:la cobertura de\s+)?(?:\d+|un|una|dos|tres|cuatro|cinco)?\s*(?:plazas?|puestos?)?\s*(?:de trabajo)?\s*(?:de|para)?\s+(.+?)(?=[,.;(]|$)/i,
  ]
  return cleanText(patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean) || '')
}

export function extractJobPositions(value = '') {
  const text = cleanText(value)
  const normalized = normalize(text)
  const results = []
  const pattern = /(\d+|[a-z]+)\s+plazas?\s+(?:de|para)\s+(.+?)(?=\s+y\s+(?:\d+|[a-z]+)\s+plazas?|\s+en\s+Metro de Madrid|[,.;(]|$)/gi
  for (const match of normalized.matchAll(pattern)) {
    const vacancies = Number(match[1]) || numberWords.get(match[1])
    if (!vacancies) continue
    const originalPosition = text.slice(match.index + match[0].indexOf(match[2]), match.index + match[0].indexOf(match[2]) + match[2].length)
    results.push({ position: cleanText(originalPosition), vacancies })
  }
  if (results.length) return results
  const vacancies = extractVacancies(text)
  if (!vacancies) return []
  return [{ position: extractPosition(text) || 'Puesto no especificado', vacancies }]
}

export async function fetchText(url, { attempts = 3, timeoutMs = 45_000 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'ObservatorioMetroMadrid/1.0 (+https://github.com/SCMM-MTE)',
          accept: 'text/html,application/xml,application/atom+xml,application/rss+xml;q=0.9,*/*;q=0.8',
        },
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 700))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`No se pudo consultar ${url}: ${lastError?.message || lastError}`)
}

export async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

export function canonicalId(source, url, fallback = '') {
  const cleanUrl = String(url || '').split('?')[0].replace(/\/$/, '')
  const slug = cleanUrl.split('/').pop() || fallback
  if (slug) return `${source}:${slug}`
  return `${source}:${createHash('sha1').update(fallback).digest('hex').slice(0, 16)}`
}

function extractBocmDate(id) {
  const match = String(id).match(/BOCM-(\d{4})(\d{2})(\d{2})-/i)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function walkBocm(node, context, records) {
  if (!node || typeof node !== 'object') return
  for (const [key, rawValue] of Object.entries(node)) {
    for (const value of asArray(rawValue)) {
      if (!value || typeof value !== 'object') continue
      const nextContext = { ...context }
      if (key === 'seccion' && value['@_nombre']) nextContext.section = cleanText(value['@_nombre'])
      if (key === 'apartado' && value['@_nombre']) nextContext.section = [nextContext.section, cleanText(value['@_nombre'])].filter(Boolean).join(' · ')
      if (key === 'organismo' && value['@_nombre']) nextContext.issuer = cleanText(value['@_nombre'])
      if (key === 'disposicion') {
        const id = cleanText(value.identificador)
        const title = cleanText(value.titulo)
        if (id && title && isMetroRelated(nextContext.issuer, title)) {
          const url = cleanText(value.url_html) || `https://www.bocm.es/${id.toLowerCase()}`
          const jobPositions = extractJobPositions(title)
          const vacancies = jobPositions.reduce((sum, job) => sum + job.vacancies, 0) || undefined
          const employment = /\b(proceso selectivo|plazas?|puestos? de trabajo|bolsa de (?:empleo|trabajo))\b/i.test(normalize(title)) && vacancies
          records.push({
            id: canonicalId('bocm', url, id),
            source: 'bocm',
            title,
            summary: title,
            issuer: nextContext.issuer,
            publicationType: cleanText(value.rango) || 'Anuncio oficial',
            publishedAt: extractBocmDate(id),
            url,
            pdfUrl: cleanText(value.url_pdf),
            xmlUrl: cleanText(value.url_xml),
            vacancies: employment ? vacancies : undefined,
            position: employment ? extractPosition(title) : undefined,
            jobPositions: employment ? jobPositions : undefined,
            tags: [nextContext.section, employment ? 'empleo' : ''].filter(Boolean),
          })
        }
      }
      walkBocm(value, nextContext, records)
    }
  }
}

export function parseBocmSummaryXml(xml) {
  const parsed = xmlParser.parse(xml)
  const records = []
  walkBocm(parsed, {}, records)
  return records
}

export function parseBocmRss(xml) {
  const parsed = xmlParser.parse(xml)
  return asArray(parsed?.rss?.channel?.item).map((item) => {
    const link = cleanText(item.link)
    const match = link.match(/BOCM-(\d{4})(\d{2})(\d{2})\/(\d+)/i)
    if (!match) return null
    const [, year, month, day, number] = match
    return `https://www.bocm.es/boletin/CM_Boletin_BOCM/${year}/${month}/${day}/BOCM-${year}${month}${day}${number}.xml?language=es`
  }).filter(Boolean)
}

export function parseBocmSearchPage(html) {
  const $ = cheerio.load(html)
  const records = []
  $('.views-row article.node-orden').each((_, element) => {
    const article = $(element)
    const title = cleanText(article.find('.field-name-field-short-description').text())
    const issuer = article.find('.field-name-field-orden-organo-y-organismo-1 .field-item').map((__, field) => cleanText($(field).text())).get().join(' · ')
    if (!isMetroRelated(issuer, title)) return
    const path = article.attr('about')?.split('?')[0] || ''
    const url = path ? new URL(path, 'https://www.bocm.es').href : ''
    const pdfUrl = article.find('.field-name-field-pdf-file a').attr('href') || ''
    const xmlPath = article.find('.field-name-orden-xml a').attr('href') || ''
    const id = (url.match(/bocm-\d{8}-\d+/i) || pdfUrl.match(/BOCM-\d{8}-\d+/i) || [])[0] || ''
    if (!id) return
    const jobPositions = extractJobPositions(title)
    const vacancies = jobPositions.reduce((sum, job) => sum + job.vacancies, 0) || undefined
    const employment = /\b(proceso selectivo|plazas?|puestos? de trabajo|bolsa de (?:empleo|trabajo))\b/i.test(normalize(title)) && vacancies
    records.push({
      id: canonicalId('bocm', url, id),
      source: 'bocm',
      title,
      summary: title,
      issuer,
      publicationType: title.split(/[\n–-]/)[0] || 'Anuncio oficial',
      publishedAt: extractBocmDate(id),
      url: url || `https://www.bocm.es/${id.toLowerCase()}`,
      pdfUrl,
      xmlUrl: xmlPath ? new URL(xmlPath, 'https://www.bocm.es').href : '',
      vacancies: employment ? vacancies : undefined,
      position: employment ? extractPosition(title) : undefined,
      jobPositions: employment ? jobPositions : undefined,
      tags: employment ? ['empleo'] : undefined,
    })
  })
  const countText = cleanText($('.view-footer').text())
  const count = Number((countText.match(/de\s+([\d.]+)/i)?.[1] || '0').replaceAll('.', ''))
  return { records, count }
}

export function bocmSearchUrl(page = 0) {
  if (page) return `${BOCM_SEARCH}/page/${page}/busqueda/Metro`
  const url = new URL(BOCM_SEARCH)
  url.searchParams.set('search_api_views_fulltext_1', 'Metro')
  return url.href
}

function findFirst(node, wantedKey) {
  if (!node || typeof node !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(node, wantedKey)) return node[wantedKey]
  for (const value of Object.values(node)) {
    for (const candidate of asArray(value)) {
      const found = findFirst(candidate, wantedKey)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function scalar(value) {
  if (value == null) return ''
  if (typeof value === 'object') return scalar(value['#text'] ?? value['@_value'] ?? '')
  return cleanText(value)
}

function linkHref(link) {
  const links = asArray(link)
  const primary = links.find((item) => item?.['@_href'] && (!item['@_rel'] || item['@_rel'] === 'alternate')) || links.find((item) => item?.['@_href'])
  return scalar(primary?.['@_href'] || primary)
}

export function parseContractsFeed(xml) {
  const parsed = xmlParser.parse(xml)
  const entries = asArray(parsed?.feed?.entry)
  return entries.flatMap((entry) => {
    const folder = findFirst(entry, 'ContractFolderStatus') || entry
    const issuer = scalar(findFirst(folder, 'PartyName')?.Name || findFirst(folder, 'Name'))
    const title = scalar(entry.title) || scalar(findFirst(folder, 'ProcurementProject')?.Name)
    if (!isMetroRelated(issuer, title, scalar(entry.summary))) return []
    const url = linkHref(entry.link)
    const expediente = scalar(findFirst(folder, 'ContractFolderID'))
    const statusCode = scalar(findFirst(folder, 'ContractFolderStatusCode'))
    const amountValue = Number(scalar(findFirst(folder, 'EstimatedOverallContractAmount') || findFirst(folder, 'TaxExclusiveAmount')))
    const endDate = scalar(findFirst(folder, 'EndDate'))
    const updatedAt = scalar(entry.updated)
    const documents = asArray(findFirst(folder, 'TechnicalDocumentReference')).concat(asArray(findFirst(folder, 'LegalDocumentReference')))
    const pdfUrl = documents.map((doc) => scalar(findFirst(doc, 'URI'))).find((uri) => /\.pdf(?:$|\?)/i.test(uri)) || ''
    return [{
      id: canonicalId('contratos', url, expediente || scalar(entry.id)),
      source: 'contratos',
      title,
      summary: scalar(entry.summary),
      issuer: issuer || 'Metro de Madrid, S.A.',
      publicationType: statusCodes[statusCode] || statusCode || 'Contrato público',
      status: statusCodes[statusCode] || statusCode,
      expediente,
      amount: Number.isFinite(amountValue) && amountValue > 0 ? amountValue : undefined,
      deadline: /^\d{4}-\d{2}-\d{2}/.test(endDate) ? endDate.slice(0, 10) : undefined,
      publishedAt: updatedAt.slice(0, 10),
      updatedAt,
      url,
      pdfUrl,
    }]
  })
}

const spanishMonths = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
}

export function parseSpanishDate(value) {
  const text = normalize(value)
  const numeric = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`
  const words = text.match(/(\d{1,2})\s+de\s+([a-z]+)(?:\s+del?)?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!words || !spanishMonths[words[2]]) return ''
  return `${words[3]}-${spanishMonths[words[2]]}-${words[1].padStart(2, '0')}${words[4] ? `T${words[4].padStart(2, '0')}:${words[5]}:00+02:00` : ''}`
}

function contractField(item, className) {
  return cleanText(item.find(`.views-field-${className} .field-content`).text())
}

export function parseContractsSearchPage(html) {
  const $ = cheerio.load(html)
  const records = []
  $('.view-content li').each((_, element) => {
    const item = $(element)
    const anchor = item.find('.views-field-nothing a').first()
    const href = anchor.attr('href')
    const title = cleanText(anchor.text())
    if (!href || !title) return
    const issuer = contractField(item, 'ss-native-string-entidad-adjudicadora')
    if (!isMetroRelated(issuer, title)) return
    const url = new URL(href, 'https://contratos-publicos.comunidad.madrid').href
    const changed = parseSpanishDate(contractField(item, 'ds-changed'))
    const deadline = parseSpanishDate(contractField(item, 'fin-presentacion'))
    records.push({
      id: canonicalId('contratos', url),
      source: 'contratos',
      title,
      issuer,
      publicationType: contractField(item, 'tipo-publicacion'),
      status: contractField(item, 'ss-buscador-estado-situacion'),
      expediente: contractField(item, 'numero-expediente'),
      publishedAt: changed.slice(0, 10),
      updatedAt: changed,
      deadline: deadline.slice(0, 10),
      url,
    })
  })
  const count = Number((cleanText($('.summary').text()).match(/de\s+([\d.]+)/i)?.[1] || '0').replaceAll('.', ''))
  return { records, count }
}

export function contractsSearchUrl(page = 0) {
  const url = new URL(CONTRACTS_SEARCH)
  url.searchParams.set('entidad_adjudicadora', '26')
  url.searchParams.set('page', String(page))
  return url.href
}

export function contractsFeedUrl(page = 0) {
  return page ? `${CONTRACTS_FEED}/${page}` : CONTRACTS_FEED
}

export function parseEmploymentPage(html, pageUrl = METRO_EMPLOYMENT_URL) {
  if (/requested url was rejected|support id is/i.test(html)) {
    throw new Error('El portal de Empleo Metro ha rechazado temporalmente la consulta automatizada')
  }
  const $ = cheerio.load(html)
  const records = new Map()
  $('a[href]').each((_, element) => {
    const anchor = $(element)
    const href = anchor.attr('href') || ''
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return
    let url
    try { url = new URL(href, pageUrl).href } catch { return }
    const parent = anchor.closest('li, article, .accordion-item, .card, .field__item, section')
    const context = cleanText(parent.length ? parent.text() : anchor.parent().text())
    const linkText = cleanText(anchor.text())
    const combined = cleanText(`${linkText} ${context}`)
    const vacancies = extractVacancies(combined)
    if (!vacancies || !/convocatoria|proceso selectivo|cobertura|oferta de empleo|plazas?/i.test(combined)) return
    if (/listado (?:provisional|definitivo)|puntuaciones|admitidos|excluidos|resultado/i.test(linkText) && !/bases|convocatoria/i.test(linkText)) return
    const heading = cleanText(parent.find('h2, h3, h4, .title').first().text())
    const title = heading || linkText || extractPosition(combined) || `Oferta de empleo de ${vacancies} plazas`
    const jobPositions = extractJobPositions(combined)
    const position = extractPosition(combined) || extractPosition(title) || title
    const dateText = combined.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/)?.[0] || ''
    const publishedAt = parseSpanishDate(dateText) || new Date().toISOString().slice(0, 10)
    const record = {
      id: canonicalId('empleo', url, `${position}-${vacancies}`),
      source: 'empleo',
      title,
      summary: combined.slice(0, 700),
      issuer: 'Metro de Madrid, S.A.',
      publicationType: 'Oferta de empleo',
      status: /plazo (?:abierto|de presentacion)|inscripcion/i.test(normalize(combined)) ? 'Inscripción abierta' : 'Publicada',
      vacancies,
      position,
      jobPositions: jobPositions.length ? jobPositions : [{ position, vacancies }],
      publishedAt,
      updatedAt: new Date().toISOString(),
      url,
      pdfUrl: /\.pdf(?:$|\?)/i.test(url) ? url : undefined,
      tags: ['empleo'],
    }
    records.set(record.id, record)
  })
  return [...records.values()]
}

export function mergeItems(existing, incoming, seenAt) {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const raw of incoming) {
    if (!raw?.id || !raw?.title || !raw?.url || !raw?.publishedAt) continue
    const previous = map.get(raw.id)
    const clean = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''))
    map.set(raw.id, {
      ...previous,
      ...clean,
      firstSeenAt: previous?.firstSeenAt || seenAt,
    })
  }
  return [...map.values()].sort((a, b) => String(b.updatedAt || b.publishedAt).localeCompare(String(a.updatedAt || a.publishedAt)))
}

export function formatCoverage(items, source) {
  const dates = items.filter((item) => item.source === source).map((item) => item.publishedAt).filter(Boolean).sort()
  if (!dates.length) return 'Sin publicaciones localizadas'
  return `${dates[0].slice(0, 10)} a ${dates.at(-1).slice(0, 10)}`
}
