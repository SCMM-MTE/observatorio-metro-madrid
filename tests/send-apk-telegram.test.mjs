import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverApk, validateApk } from '../scripts/send-apk-telegram.mjs'
const apk = { url: 'https://github.com/SCMM-MTE/consulta-convenio/releases/download/v0.5.28/Consulta-Convenio-0.5.28-SCMM.apk', sha256: 'a'.repeat(64) }
test('rechaza enlaces ajenos y hashes no válidos', () => {
  assert.throws(() => validateApk({ ...apk, url: 'https://example.org/file.apk' }))
  assert.throws(() => validateApk({ ...apk, sha256: 'unknown' }))
})
test('la comprobación no envía mensajes y bloquea destinos colectivos', async () => {
  const calls = []
  const fetchImpl = async (url) => { calls.push(url.split('/').pop()); return { ok: true, json: async () => ({ ok: true, result: { type: 'private', message_id: 1 } }) } }
  assert.equal((await deliverApk({ ...apk, token: 'fake', chatId: 'fake', fetchImpl })).sent, false)
  assert.deepEqual(calls, ['getChat'])
  await assert.rejects(deliverApk({ ...apk, token: 'fake', chatId: 'fake', dryRun: false, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: { type: 'channel' } }) }) }))
  calls.length = 0
  assert.equal((await deliverApk({ ...apk, token: 'fake', chatId: 'fake', dryRun: false, fetchImpl })).sent, true)
  assert.deepEqual(calls, ['getChat', 'sendMessage'])
})
