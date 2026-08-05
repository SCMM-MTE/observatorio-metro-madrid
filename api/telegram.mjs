import { timingSafeEqual } from 'node:crypto'
import { buildBotReply } from '../scripts/bot-query.mjs'

const ARCHIVE_URL = 'https://bocm.vercel.app/data/archive.json'
const CACHE_MS = 5 * 60 * 1000
let archiveCache = { loadedAt: 0, items: [] }

function secretsMatch(received, expected) {
  if (!received || !expected) return false
  const left = Buffer.from(String(received))
  const right = Buffer.from(String(expected))
  return left.length === right.length && timingSafeEqual(left, right)
}

async function loadItems() {
  if (archiveCache.items.length && Date.now() - archiveCache.loadedAt < CACHE_MS) return archiveCache.items
  const response = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`No se pudo consultar el archivo (${response.status})`)
  const archive = await response.json()
  archiveCache = { loadedAt: Date.now(), items: archive.items || [] }
  return archiveCache.items
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body
  if (typeof request.body === 'string') return JSON.parse(request.body)
  return {}
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    return response.status(200).json({ ok: true, service: 'telegram-webhook' })
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ ok: false })
  }

  const secret = request.headers['x-telegram-bot-api-secret-token']
  if (!secretsMatch(secret, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return response.status(403).json({ ok: false })
  }

  let update = {}
  try {
    update = readBody(request)
    const message = update.message || update.edited_message
    if (!message?.chat?.id || !message.text) return response.status(200).json({ ok: true })

    const items = await loadItems()
    const text = buildBotReply(items, message.text)
    return response.status(200).json({
      method: 'sendMessage',
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
  } catch (error) {
    console.error(`Telegram webhook: ${error.message}`)
    const chatId = update?.message?.chat?.id || update?.edited_message?.chat?.id
    if (!chatId) return response.status(200).json({ ok: true })
    return response.status(200).json({
      method: 'sendMessage',
      chat_id: chatId,
      text: 'No he podido consultar el archivo en este momento. Inténtalo de nuevo dentro de unos minutos.',
    })
  }
}
