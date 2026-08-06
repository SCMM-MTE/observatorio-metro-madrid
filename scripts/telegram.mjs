const TELEGRAM_LIMIT = 4096
const SAFE_MESSAGE_LIMIT = 3800

const sourceNames = {
  bocm: 'BOCM',
  contratos: 'Contratación pública',
  empleo: 'Empleo Metro',
}

export function escapeTelegramHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function employmentSummary(item) {
  const jobs = item.jobPositions?.length
    ? item.jobPositions
    : item.vacancies
      ? [{ position: item.position || 'Puesto no especificado', vacancies: item.vacancies }]
      : []

  if (!jobs.length) return ''
  return `\n👥 ${jobs.map((job) => `${job.vacancies} plazas · ${escapeTelegramHtml(job.position)}`).join(' | ')}`
}

function formatItem(item) {
  const source = sourceNames[item.source] || item.source
  const title = escapeTelegramHtml(item.title || 'Publicación sin título')
  const url = escapeTelegramHtml(item.url || '')
  const date = item.publishedAt ? ` · ${escapeTelegramHtml(String(item.publishedAt).slice(0, 10))}` : ''
  const heading = url ? `<a href="${url}">${title}</a>` : title
  const change = item.notificationKind === 'updated' ? '🔄 Actualizada · ' : ''
  return `\n\n<b>${change}${escapeTelegramHtml(source)}${date}</b>\n${heading}${employmentSummary(item)}`
}

function buildHealthMessage(events, appUrl) {
  if (!events?.length) return null
  const labels = { bocm: 'BOCM', contratos: 'Contratación pública', empleo: 'Empleo Metro' }
  const lines = events.map((event) => {
    const icon = event.kind === 'recovered' ? '✅' : '⚠️'
    const state = event.kind === 'recovered' ? 'recuperada' : 'con errores'
    return `${icon} <b>${escapeTelegramHtml(labels[event.source] || event.source)} ${state}</b>\n${escapeTelegramHtml(event.message)}`
  })
  return `🚇 <b>Estado del recolector</b>\n\n${lines.join('\n\n')}\n\n<a href="${escapeTelegramHtml(appUrl)}">Consultar el observatorio</a>`
}

export function buildTelegramMessages(items = [], appUrl = 'https://bocm.vercel.app', healthEvents = []) {
  const messages = []
  const healthMessage = buildHealthMessage(healthEvents, appUrl)
  if (healthMessage) messages.push(healthMessage)
  if (!items.length) return messages

  const updated = items.filter((item) => item.notificationKind === 'updated').length
  const added = items.length - updated
  const header = updated
    ? `🚇 <b>${items.length} novedades sobre Metro de Madrid</b>\n${added} nuevas · ${updated} actualizadas`
    : `🚇 <b>${items.length} ${items.length === 1 ? 'nueva publicación' : 'nuevas publicaciones'} sobre Metro de Madrid</b>`
  const footer = `\n\n<a href="${escapeTelegramHtml(appUrl)}">Consultar el observatorio</a>`
  const chunks = []
  let current = header

  for (const item of items) {
    const block = formatItem(item)
    if (current.length + block.length + footer.length > SAFE_MESSAGE_LIMIT && current !== header) {
      chunks.push(`${current}\n\nContinúa en el siguiente mensaje…`)
      current = '<b>Más publicaciones nuevas</b>'
    }
    current += block
  }
  chunks.push(`${current}${footer}`)
  messages.push(...chunks.map((message) => message.slice(0, TELEGRAM_LIMIT)))
  return messages
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function sendTelegramMessages({ token, chatId, messages, fetchImpl = fetch }) {
  if (!token || !chatId) throw new Error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID')

  for (const message of messages) {
    let sent = false
    for (let attempt = 1; attempt <= 3 && !sent; attempt += 1) {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.ok !== false) {
        sent = true
        continue
      }
      if (attempt === 3) throw new Error(`Telegram rechazó el aviso: ${result.description || response.status}`)
      await wait(Math.min(Number(result.parameters?.retry_after || attempt * 2), 15) * 1000)
    }
  }
}
