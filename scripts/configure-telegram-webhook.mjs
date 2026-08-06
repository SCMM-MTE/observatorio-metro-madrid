const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const chatId = process.env.TELEGRAM_CHAT_ID
const appUrl = (process.env.APP_URL || 'https://bocm.vercel.app').replace(/\/$/, '')

if (!token || !secret) throw new Error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET')

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.ok) throw new Error(`${method}: ${result.description || response.status}`)
  return result.result
}

await telegram('setWebhook', {
  url: `${appUrl}/api/telegram`,
  secret_token: secret,
  allowed_updates: ['message', 'edited_message'],
  drop_pending_updates: true,
})

await telegram('setMyCommands', {
  commands: [
    { command: 'ultimas', description: 'Publicaciones más recientes' },
    { command: 'buscar', description: 'Buscar por palabras' },
    { command: 'empleo', description: 'Últimas ofertas de empleo' },
    { command: 'plazas', description: 'Plazas ofertadas por puesto' },
    { command: 'contratos', description: 'Contratación pública' },
    { command: 'bocm', description: 'Publicaciones del BOCM' },
    { command: 'expediente', description: 'Localizar un expediente' },
    { command: 'actualizar', description: 'Forzar una nueva recolección' },
    { command: 'ayuda', description: 'Mostrar todos los comandos' },
  ],
})

const webhook = await telegram('getWebhookInfo', {})
if (webhook.url !== `${appUrl}/api/telegram`) throw new Error('Telegram no confirmó la URL del webhook')

if (chatId) {
  await telegram('sendMessage', {
    chat_id: chatId,
    text: '🔎 Consultas activadas\n\nYa puedes escribir /ayuda o buscar directamente cualquier publicación de Metro de Madrid.',
  })
}

console.log(`Webhook de Telegram configurado: ${webhook.url}`)
