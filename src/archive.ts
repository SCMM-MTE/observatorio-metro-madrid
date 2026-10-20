import type { ArchiveData } from './types'

export async function fetchArchive(fetchImpl: typeof fetch = fetch): Promise<ArchiveData> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(`/data/archive.json?t=${Date.now()}`, {
        cache: 'no-store', signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (data?.version !== 1 || !Array.isArray(data.items) ||
        !['bocm', 'contratos', 'empleo'].every((key) => data.sources?.[key]) ||
        !data.items.every((item: Record<string, unknown>) => typeof item.id === 'string' &&
          typeof item.title === 'string' && typeof item.publishedAt === 'string' &&
          ['bocm', 'contratos', 'empleo'].includes(String(item.source)))) {
        throw new Error('El archivo recibido no es válido')
      }
      return data
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error('Archivo no disponible')
}
