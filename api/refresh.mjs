import { REFRESH_MANUAL_URL, requestCollection } from '../scripts/refresh-request.mjs'

function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method === 'GET') {
    return response.status(200).json({
      ok: true,
      configured: Boolean(process.env.GITHUB_REFRESH_TOKEN),
      manualUrl: REFRESH_MANUAL_URL,
    })
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ ok: false })
  }
  if (!sameOrigin(request)) return response.status(403).json({ ok: false })

  try {
    const result = await requestCollection()
    return response.status(200).json({ ok: true, ...result })
  } catch (error) {
    console.error(`Refresh: ${error.message}`)
    return response.status(502).json({ ok: false, status: 'error', message: 'No se ha podido solicitar la actualización', manualUrl: REFRESH_MANUAL_URL })
  }
}
