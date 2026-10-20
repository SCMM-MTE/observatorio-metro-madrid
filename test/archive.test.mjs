import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchArchive } from '../src/archive.ts'

const valid = { version: 1, items: [], sources: { bocm: {}, contratos: {}, empleo: {} } }
test('recupera una carga intermitente y rechaza una respuesta HTML o un JSON incompatible', async () => {
  let calls = 0
  const data = await fetchArchive(async () => {
    calls += 1
    if (calls === 1) throw new Error('corte de red')
    if (calls === 2) return { ok: true, json: async () => ({ items: null }) }
    return { ok: true, json: async () => valid }
  })
  assert.equal(calls, 3)
  assert.deepEqual(data, valid)
  await assert.rejects(fetchArchive(async () => ({ ok: true, json: async () => ({ version: 1, items: [{}], sources: valid.sources }) })), /no es válido/)
})
