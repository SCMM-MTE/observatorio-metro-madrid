import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildTelegramMessages, sendTelegramMessages } from './telegram.mjs'

const inputPath = process.env.NOTIFICATION_OUTPUT
if (!inputPath) {
  console.log('Telegram: sin archivo de novedades configurado')
  process.exit(0)
}

let payload
try {
  payload = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('Telegram: no existe un archivo de novedades')
    process.exit(0)
  }
  throw error
}

const messages = process.env.TELEGRAM_TEST === 'true'
  ? ['🚇 <b>Prueba correcta</b>\n\nGitHub Actions puede enviar avisos del Observatorio Metro a este chat.']
  : buildTelegramMessages(payload.items, process.env.APP_URL)
if (!messages.length) {
  console.log('Telegram: no hay publicaciones nuevas')
  process.exit(0)
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.log('Telegram: secretos no configurados; se omite el aviso')
  process.exit(0)
}

await sendTelegramMessages({
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  messages,
})
console.log(`Telegram: ${messages.length} mensaje(s) enviado(s) con ${payload.items.length} novedades`)
