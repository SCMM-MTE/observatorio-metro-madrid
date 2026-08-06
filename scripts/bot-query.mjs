const MAX_RESULTS = 5

const sourceNames = {
  bocm: 'BOCM',
  contratos: 'Contratación pública',
  empleo: 'Empleo Metro',
}

export function normalizeQuery(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function escapeBotHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function itemTimestamp(item) {
  return Date.parse(item.updatedAt || item.publishedAt || item.firstSeenAt || 0) || 0
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Fecha no disponible'
}

function employmentDetails(item) {
  const jobs = item.jobPositions?.length
    ? item.jobPositions
    : item.vacancies
      ? [{ position: item.position || 'Puesto no especificado', vacancies: item.vacancies }]
      : []
  if (!jobs.length) return ''
  return `\n👥 ${jobs.map((job) => `${job.vacancies} plazas · ${escapeBotHtml(job.position)}`).join(' | ')}`
}

function formatAmount(amount) {
  if (!Number.isFinite(Number(amount))) return ''
  return `\n💶 ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)}`
}

function formatResult(item) {
  const title = escapeBotHtml(String(item.title || 'Publicación sin título').slice(0, 320))
  const url = escapeBotHtml(item.url || item.pdfUrl || '')
  const source = escapeBotHtml(sourceNames[item.source] || item.source || 'Fuente oficial')
  const expediente = item.expediente ? ` · Exp. ${escapeBotHtml(item.expediente)}` : ''
  const link = url ? `<a href="${url}">${title}</a>` : title
  return `<b>${source} · ${formatDate(item.publishedAt)}${expediente}</b>\n${link}${employmentDetails(item)}${formatAmount(item.amount)}`
}

function sorted(items) {
  return [...items].sort((left, right) => itemTimestamp(right) - itemTimestamp(left))
}

function isEmployment(item) {
  return item.source === 'empleo' || Number(item.vacancies) > 0 || item.tags?.includes('empleo')
}

function searchableText(item) {
  return normalizeQuery([
    item.title,
    item.summary,
    item.issuer,
    item.expediente,
    item.position,
    ...(item.jobPositions || []).map((job) => job.position),
  ].filter(Boolean).join(' '))
}

function search(items, query) {
  const terms = normalizeQuery(query).split(' ').filter(Boolean)
  if (!terms.length) return []
  return sorted(items.filter((item) => {
    const haystack = searchableText(item)
    return terms.every((term) => haystack.includes(term))
  }))
}

function resultMessage(title, items) {
  if (!items.length) return `🔎 <b>${escapeBotHtml(title)}</b>\n\nNo he encontrado publicaciones coincidentes.`
  const visible = items.slice(0, MAX_RESULTS)
  return `🔎 <b>${escapeBotHtml(title)}</b>\n\n${visible.map(formatResult).join('\n\n')}${items.length > visible.length ? `\n\nHay ${items.length - visible.length} resultados más. Afina la búsqueda para reducirlos.` : ''}\n\n<a href="https://bocm.vercel.app">Abrir el observatorio completo</a>`
}

export function helpMessage() {
  return [
    '🚇 <b>Observatorio Metro de Madrid</b>',
    '',
    'Consulta publicaciones oficiales con estos comandos:',
    '',
    '/ultimas — publicaciones más recientes',
    '/buscar linea 11 — buscar por palabras',
    '/empleo — convocatorias de empleo',
    '/plazas — plazas ofertadas por puesto',
    '/contratos — contratación pública',
    '/bocm — anuncios del BOCM',
    '/expediente 6012600026 — localizar un expediente',
    '/actualizar — solicitar una nueva recolección',
    '',
    'También puedes escribir directamente lo que buscas.',
  ].join('\n')
}

export function buildBotReply(items = [], input = '') {
  const text = String(input || '').trim()
  if (!text) return helpMessage()

  const [first, ...rest] = text.split(/\s+/)
  const isCommand = first.startsWith('/')
  const command = isCommand ? first.split('@')[0].toLowerCase() : '/buscar'
  const argument = isCommand ? rest.join(' ').trim() : text

  switch (command) {
    case '/start':
    case '/ayuda':
    case '/help':
      return helpMessage()
    case '/ultimas': {
      const requested = Number.parseInt(argument, 10)
      const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_RESULTS) : MAX_RESULTS
      return resultMessage(`${limit} publicaciones más recientes`, sorted(items).slice(0, limit))
    }
    case '/bocm':
      return resultMessage('Últimas publicaciones del BOCM', sorted(items.filter((item) => item.source === 'bocm')).slice(0, MAX_RESULTS))
    case '/contratos':
      return resultMessage('Últimos contratos públicos', sorted(items.filter((item) => item.source === 'contratos')).slice(0, MAX_RESULTS))
    case '/empleo':
      return resultMessage('Últimas publicaciones de empleo', sorted(items.filter(isEmployment)).slice(0, MAX_RESULTS))
    case '/plazas':
      return resultMessage('Plazas ofertadas por puesto', sorted(items.filter((item) => isEmployment(item) && Number(item.vacancies) > 0)).slice(0, MAX_RESULTS))
    case '/expediente':
      return argument
        ? resultMessage(`Expediente ${argument}`, search(items, argument).filter((item) => item.expediente))
        : 'Escribe el número después del comando. Ejemplo: <code>/expediente 6012600026</code>'
    case '/buscar':
      return argument
        ? resultMessage(`Resultados para “${argument}”`, search(items, argument))
        : 'Escribe las palabras después del comando. Ejemplo: <code>/buscar linea 11</code>'
    default:
      return `No reconozco ese comando.\n\n${helpMessage()}`
  }
}
