import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../public/data/archive.json')
const data = JSON.parse(await readFile(path, 'utf8'))
const ids = new Set()

if (data.version !== 1 || !Array.isArray(data.items) || !data.sources?.bocm || !data.sources?.contratos || !data.sources?.empleo) {
  throw new Error('Estructura de archivo no válida')
}

for (const [index, item] of data.items.entries()) {
  for (const field of ['id', 'source', 'title', 'publishedAt', 'firstSeenAt', 'url']) {
    if (!item[field]) throw new Error(`Registro ${index}: falta ${field}`)
  }
  if (!['bocm', 'contratos', 'empleo'].includes(item.source)) throw new Error(`Registro ${index}: fuente no válida`)
  if (ids.has(item.id)) throw new Error(`ID duplicado: ${item.id}`)
  ids.add(item.id)
  new URL(item.url)
}

console.log(`Archivo válido: ${data.items.length} registros únicos`)
