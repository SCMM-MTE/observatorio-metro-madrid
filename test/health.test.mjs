import test from 'node:test'
import assert from 'node:assert/strict'
import { healthSummary } from '../scripts/health-summary.mjs'
test('el resumen conserva fecha y fallos de fuentes sin descargar publicaciones', () => {
  const input = { generatedAt: '2026-10-20T00:00:00Z', items: [{ title: 'Un anuncio' }], sources: {
    bocm: { ok: false }, contratos: { ok: true }, empleo: { ok: true, partial: true },
  } }
  const summary = healthSummary(input)
  assert.equal(summary.generatedAt, input.generatedAt)
  assert.equal(summary.records, 1)
  assert.deepEqual(summary.sources, input.sources)
  assert.equal(summary.items, undefined)
})
