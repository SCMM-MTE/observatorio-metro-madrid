export const REFRESH_MANUAL_URL = 'https://github.com/SCMM-MTE/observatorio-metro-madrid/actions/workflows/collect.yml'
export const MIN_REFRESH_AGE_MS = 5 * 60 * 1000

const ARCHIVE_URL = 'https://bocm.vercel.app/data/archive.json'
const RUNS_URL = 'https://api.github.com/repos/SCMM-MTE/observatorio-metro-madrid/actions/workflows/collect.yml/runs?per_page=10'
const DISPATCH_URL = 'https://api.github.com/repos/SCMM-MTE/observatorio-metro-madrid/actions/workflows/collect.yml/dispatches'

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  }
}

async function currentGeneratedAt(fetchImpl) {
  try {
    const response = await fetchImpl(`${ARCHIVE_URL}?refresh=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const archive = await response.json()
    return archive.generatedAt || null
  } catch {
    return null
  }
}

export async function requestCollection({
  fetchImpl = fetch,
  token = process.env.GITHUB_REFRESH_TOKEN,
  now = Date.now(),
  minAgeMs = MIN_REFRESH_AGE_MS,
} = {}) {
  const generatedAt = await currentGeneratedAt(fetchImpl)
  const generatedTime = Date.parse(generatedAt || '')
  if (Number.isFinite(generatedTime) && now - generatedTime < minAgeMs) {
    return { status: 'fresh', generatedAt, manualUrl: REFRESH_MANUAL_URL }
  }

  if (!token) {
    return { status: 'manual_required', generatedAt, manualUrl: REFRESH_MANUAL_URL }
  }

  const runsResponse = await fetchImpl(RUNS_URL, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(15_000),
  })
  if (!runsResponse.ok) throw new Error(`GitHub no permitió consultar el workflow (${runsResponse.status})`)
  const runs = await runsResponse.json()
  const active = (runs.workflow_runs || []).find((run) => run.status === 'queued' || run.status === 'in_progress')
  if (active) {
    return { status: 'already_running', generatedAt, runUrl: active.html_url, manualUrl: REFRESH_MANUAL_URL }
  }

  const dispatchResponse = await fetchImpl(DISPATCH_URL, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!dispatchResponse.ok) throw new Error(`GitHub rechazó la actualización (${dispatchResponse.status})`)
  return { status: 'requested', generatedAt, manualUrl: REFRESH_MANUAL_URL }
}

function formatGeneratedAt(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'hora no disponible'
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date(value))
}

export function buildRefreshReply(result) {
  switch (result.status) {
    case 'requested':
      return '🔄 <b>Actualización solicitada</b>\n\nLa consulta de las fuentes ya está en cola. El bot avisará si encuentra novedades.'
    case 'already_running':
      return `⏳ <b>Actualización en curso</b>\n\nYa hay una consulta ejecutándose.${result.runUrl ? `\n<a href="${result.runUrl}">Ver progreso</a>` : ''}`
    case 'fresh':
      return `✅ <b>La información ya está actualizada</b>\n\nÚltima recolección: ${formatGeneratedAt(result.generatedAt)}.`
    case 'manual_required':
      return `🔐 <b>Actualización manual protegida</b>\n\n<a href="${result.manualUrl}">Abrir GitHub Actions y pulsar Run workflow</a>.`
    default:
      return 'No he podido solicitar la actualización en este momento.'
  }
}

export function isRefreshCommand(input = '') {
  return /^\/actualizar(?:@[a-z0-9_]+)?(?:\s|$)/i.test(String(input).trim())
}
