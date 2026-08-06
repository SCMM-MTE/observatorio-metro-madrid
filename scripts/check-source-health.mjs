import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const archivePath = resolve(process.env.ARCHIVE_PATH || resolve(import.meta.dirname, '../public/data/archive.json'))
const archive = JSON.parse(await readFile(archivePath, 'utf8'))
const failed = Object.entries(archive.sources || {}).filter(([, status]) => !status?.ok)

if (failed.length) {
  for (const [source, status] of failed) {
    console.error(`${source}: ${status?.message || 'consulta no disponible'}`)
  }
  throw new Error(`${failed.length} fuente(s) no se pudieron comprobar`)
}

console.log('Fuentes operativas: BOCM, Contratación pública y cobertura de Empleo')
