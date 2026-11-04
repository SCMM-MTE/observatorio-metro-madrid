import { pathToFileURL } from 'node:url'

export function validateApk({ url, sha256 }) {
  const parsed = new URL(url)
  if (parsed.origin !== 'https://github.com' || parsed.search || parsed.hash ||
      !/^\/SCMM-MTE\/consulta-convenio\/releases\/download\/[^/]+\/Consulta-Convenio-[\d.]+-SCMM\.apk$/.test(parsed.pathname) ||
      !/^[a-f0-9]{64}$/i.test(sha256 || '')) throw new Error('Enlace de APK o SHA256 no válido')
  return parsed.href
}

export async function deliverApk({ token, chatId, url, sha256, dryRun = true, fetchImpl = fetch }) {
  url = validateApk({ url, sha256 })
  if (!token || !chatId) throw new Error('Falta la configuración del bot')
  async function call(method, body) {
    let response
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, ...body }), signal: AbortSignal.timeout(30000),
      })
    } catch { throw new Error(`No se pudo completar ${method}`) }
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok !== true) throw new Error(`Telegram rechazó ${method}`)
    return result.result
  }
  const chat = await call('getChat', {})
  if (chat.type !== 'private') throw new Error('El destino configurado no es un chat privado; no se ha enviado nada')
  if (dryRun) return { privateChat: true, sent: false }
  const result = await call('sendMessage', {
    text: `Nueva APK SCMM con acceso administrativo.\n\nDescarga (requiere iniciar sesión en GitHub):\n${url}\n\nSHA256: ${sha256.toLowerCase()}`,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Descargar APK SCMM', url }]] },
  })
  return { sent: true, messageId: result.message_id }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deliverApk({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID,
    url: process.env.APK_URL, sha256: process.env.APK_SHA256, dryRun: process.env.DRY_RUN !== 'false',
  }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
