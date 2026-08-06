import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMetroRelated,
  bocmDateRangeSearchUrl,
  extractPosition,
  extractJobPositions,
  extractVacancies,
  findNotificationItems,
  formatItemCoverage,
  mergeItems,
  parseBocmSummaryXml,
  parseBocmSearchPage,
  parseContractsFeed,
  parseContractsSearchPage,
  parseEmploymentPage,
  parseSpanishDate,
} from '../scripts/lib.mjs'
import { buildTelegramMessages, escapeTelegramHtml } from '../scripts/telegram.mjs'
import { buildBotReply, normalizeQuery } from '../scripts/bot-query.mjs'
import { buildRefreshReply, isRefreshCommand, requestCollection } from '../scripts/refresh-request.mjs'
import refreshHandler from '../api/refresh.mjs'
import telegramHandler from '../api/telegram.mjs'

test('detecta referencias concretas a Metro sin aceptar unidades métricas', () => {
  assert.equal(isMetroRelated('Metro de Madrid, S.A.'), true)
  assert.equal(isMetroRelated('Obras de ampliación de la línea 11 de Metro'), true)
  assert.equal(isMetroRelated('Una parcela de 500 metros cuadrados'), false)
})

test('extrae plazas y puesto de una convocatoria de empleo', () => {
  const text = 'Convocatoria de un proceso selectivo para cubrir dos puestos de trabajo de Técnico/a en el área de seguridad ferroviaria operacional de Metro de Madrid'
  assert.equal(extractVacancies(text), 2)
  assert.equal(extractPosition(text), 'Técnico/a')
  const html = `<main><article><h3>Proceso de selección</h3><p>${text}</p><a href="/sites/default/files/empleo/bases.pdf">Bases de la convocatoria</a></article></main>`
  const records = parseEmploymentPage(html)
  assert.equal(records.length, 1)
  assert.equal(records[0].vacancies, 2)
  assert.equal(records[0].position, 'Técnico/a')
  assert.deepEqual(extractJobPositions('30 plazas de Maquinista de Tracción Eléctrica y 30 plazas de Jefe/a de Sector en Metro de Madrid'), [
    { position: 'Maquinista de Tracción Eléctrica', vacancies: 30 },
    { position: 'Jefe/a de Sector', vacancies: 30 },
  ])
})

test('extrae disposiciones relevantes del XML del BOCM', () => {
  const xml = `<sumario><diario><secciones><seccion nombre="I"><organismo nombre="METRO DE MADRID, S. A."><disposicion><identificador>BOCM-20260805-19</identificador><rango>ANUNCIO</rango><titulo>Formalización de contrato de mantenimiento</titulo><url_html>https://www.bocm.es/bocm-20260805-19</url_html><url_pdf>https://www.bocm.es/test.pdf</url_pdf></disposicion></organismo></seccion></secciones></diario></sumario>`
  const records = parseBocmSummaryXml(xml)
  assert.equal(records.length, 1)
  assert.equal(records[0].publishedAt, '2026-08-05')
  assert.equal(records[0].publicationType, 'ANUNCIO')
})

test('extrae contratos de Metro del feed ATOM', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x1</id><link href="https://contratos-publicos.comunidad.madrid/contrato-publico/prueba"/><title>Mantenimiento de estaciones</title><updated>2026-08-05T09:00:00+02:00</updated><summary>Id licitación: 6012600001</summary><ContractFolderStatus><ContractFolderID>6012600001</ContractFolderID><ContractFolderStatusCode>PUB</ContractFolderStatusCode><LocatedContractingParty><Party><PartyName><Name>Metro de Madrid, S.A.</Name></PartyName></Party></LocatedContractingParty><ProcurementProject><BudgetAmount><EstimatedOverallContractAmount>125000</EstimatedOverallContractAmount></BudgetAmount></ProcurementProject></ContractFolderStatus></entry></feed>`
  const records = parseContractsFeed(xml)
  assert.equal(records.length, 1)
  assert.equal(records[0].expediente, '6012600001')
  assert.equal(records[0].amount, 125000)
  assert.equal(records[0].status, 'En plazo')
})

test('extrae resultados del buscador de contratación', () => {
  const html = `<div class="view-content"><div class="item-list"><ul><li><div class="views-field views-field-nothing"><span class="field-content"><a href="/contrato-publico/test">Servicio para Metro de Madrid</a></span></div><div class="views-field views-field-ds-changed"><span class="field-content">5 de agosto del 2026 08:25</span></div><div class="views-field views-field-numero-expediente"><span class="field-content">6012600180</span></div><div class="views-field views-field-ss-native-string-entidad-adjudicadora"><span class="field-content">Metro de Madrid, S.A.</span></div></li></ul></div></div><div class="summary">Mostrando 1 - 10 de 7119</div>`
  const parsed = parseContractsSearchPage(html)
  assert.equal(parsed.count, 7119)
  assert.equal(parsed.records[0].publishedAt, '2026-08-05')
})

test('el buscador BOCM conserva resultados cuyo organismo es Metro y pagina con filtros', () => {
  const html = `<div class="view-content">
    <div class="views-row"><article class="node-orden" about="/bocm-20260727-25?language=es">
      <div class="field-name-field-orden-organo-y-organismo-1"><div class="field-item">CONSEJERÍA DE VIVIENDA</div><div class="field-item">METRO DE MADRID, S. A.</div></div>
      <div class="field-name-field-short-description">Convocatoria contrato – Revisión general de equipos de producción de aire</div>
      <div class="field-name-field-pdf-file"><a href="/BOCM-20260727-25.PDF">PDF</a></div>
      <div class="field-name-orden-xml"><a href="/BOCM-20260727-25.xml">XML</a></div>
    </article></div>
    <div class="views-row"><article class="node-orden" about="/bocm-20260727-36"><div class="field-name-field-orden-organo-y-organismo-1"><div class="field-item">OTRO ORGANISMO</div></div><div class="field-name-field-short-description">Parcela de veinte metros cuadrados</div></article></div>
  </div><div class="view-footer">Mostrando 1 - 10 de 12</div>
  <a href="/advanced-search/p/field_bulletin_field_date/date__27-07-2026/field_bulletin_field_date_1/date__27-07-2026/language/es/page/1/busqueda/Metro">2</a>`
  const parsed = parseBocmSearchPage(html)
  assert.equal(parsed.records.length, 1)
  assert.equal(parsed.records[0].id, 'bocm:bocm-20260727-25')
  assert.match(parsed.records[0].issuer, /METRO DE MADRID/)
  assert.match(parsed.pageUrlTemplate, /page\/\{page\}\/busqueda\/Metro$/)

  const rangeUrl = new URL(bocmDateRangeSearchUrl('2026-07-27', '2026-07-28'))
  assert.equal(rangeUrl.searchParams.get('field_bulletin_field_date[date]'), '27-07-2026')
  assert.equal(rangeUrl.searchParams.get('field_bulletin_field_date_1[date]'), '28-07-2026')
})

test('normaliza fechas españolas y conserva firstSeen al fusionar', () => {
  assert.equal(parseSpanishDate('5 de agosto del 2026 08:25'), '2026-08-05T08:25:00+02:00')
  const old = [{ id: 'x', title: 'Anterior', source: 'bocm', publishedAt: '2026-01-01', firstSeenAt: 'old', url: 'https://example.com' }]
  const merged = mergeItems(old, [{ ...old[0], title: 'Nuevo' }], 'new')
  assert.equal(merged[0].title, 'Nuevo')
  assert.equal(merged[0].firstSeenAt, 'old')
  assert.equal(formatItemCoverage(merged), '2026-01-01 a 2026-01-01')
})

test('avisa de IDs nuevas y de cambios materiales sin repetir registros idénticos', () => {
  const existing = [
    { id: 'igual', title: 'Sin cambios', source: 'contratos', publishedAt: '2026-08-05', updatedAt: '2026-08-05T10:00:00Z', url: 'https://example.com/igual' },
    { id: 'actualizado', title: 'Contrato', source: 'contratos', status: 'En plazo', publishedAt: '2026-08-05', updatedAt: '2026-08-05T10:00:00Z', url: 'https://example.com/actualizado' },
  ]
  const incoming = [
    existing[0],
    { ...existing[1], status: 'Adjudicado', updatedAt: '2026-08-06T10:00:00Z' },
    { id: 'nuevo', title: 'Nueva convocatoria', source: 'bocm', publishedAt: '2026-08-06', url: 'https://example.com/nuevo' },
  ]
  const merged = mergeItems(existing, incoming, 'now')
  const notifications = findNotificationItems(existing, merged, incoming)
  assert.deepEqual(notifications.map(({ id, notificationKind }) => [id, notificationKind]).sort(), [
    ['actualizado', 'updated'],
    ['nuevo', 'new'],
  ])
})

test('crea avisos de Telegram con enlaces seguros y plazas por puesto', () => {
  const messages = buildTelegramMessages([{
    id: 'empleo-1',
    source: 'empleo',
    title: 'Convocatoria <urgente>',
    url: 'https://example.com/oferta?a=1&b=2',
    publishedAt: '2026-08-05',
    jobPositions: [
      { position: 'Maquinista & operador/a', vacancies: 30 },
      { position: 'Jefe/a de Sector', vacancies: 12 },
    ],
  }])

  assert.equal(messages.length, 1)
  assert.match(messages[0], /1 nueva publicación/)
  assert.match(messages[0], /30 plazas · Maquinista &amp; operador\/a/)
  assert.match(messages[0], /12 plazas · Jefe\/a de Sector/)
  assert.match(messages[0], /Convocatoria &lt;urgente&gt;/)
  assert.equal(escapeTelegramHtml('a&<b>"'), 'a&amp;&lt;b&gt;&quot;')
})

test('Telegram incluye todos los registros, reparte mensajes largos y avisa de recuperaciones', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    id: `registro-${index}`,
    source: 'bocm',
    title: `Registro completo ${index} ${'detalle '.repeat(12)}`,
    url: `https://example.com/${index}`,
    publishedAt: '2026-08-06',
    notificationKind: index === 0 ? 'updated' : 'new',
  }))
  const messages = buildTelegramMessages(items, 'https://bocm.vercel.app', [{
    source: 'bocm',
    kind: 'recovered',
    message: 'Consulta restablecida',
  }])
  const combined = messages.join('\n')
  assert.ok(messages.length > 2)
  assert.ok(messages.every((message) => message.length <= 4096))
  assert.match(combined, /BOCM recuperada/)
  assert.match(combined, /1 actualizadas/)
  for (let index = 0; index < items.length; index += 1) {
    assert.match(combined, new RegExp(`Registro completo ${index}\\b`))
  }
  assert.doesNotMatch(combined, /… y \d+ más/)
})

const botItems = [
  {
    id: 'contrato-1',
    source: 'contratos',
    title: 'Obras de ampliación de la línea 11',
    expediente: '6012600026',
    publishedAt: '2026-08-05',
    updatedAt: '2026-08-05T12:00:00+02:00',
    url: 'https://example.com/contrato',
    amount: 2500000,
  },
  {
    id: 'empleo-1',
    source: 'bocm',
    title: 'Proceso selectivo de Metro de Madrid',
    publishedAt: '2026-08-04',
    updatedAt: '2026-08-04T12:00:00+02:00',
    url: 'https://example.com/empleo',
    vacancies: 60,
    tags: ['empleo'],
    jobPositions: [
      { position: 'Maquinista de Tracción Eléctrica', vacancies: 30 },
      { position: 'Jefe/a de Sector', vacancies: 30 },
    ],
  },
]

test('el bot busca sin distinguir acentos y localiza expedientes', () => {
  assert.equal(normalizeQuery('Línea 11'), 'linea 11')
  const search = buildBotReply(botItems, '/buscar linea 11')
  assert.match(search, /Obras de ampliación de la línea 11/)
  assert.match(search, /2\.500\.000/)
  assert.match(buildBotReply(botItems, '/expediente 6012600026'), /Exp\. 6012600026/)
})

test('el bot muestra las plazas desglosadas y ofrece ayuda', () => {
  const jobs = buildBotReply(botItems, '/plazas')
  assert.match(jobs, /30 plazas · Maquinista de Tracción Eléctrica/)
  assert.match(jobs, /30 plazas · Jefe\/a de Sector/)
  assert.match(buildBotReply(botItems, '/ayuda'), /\/buscar linea 11/)
  assert.match(buildBotReply(botItems, '/ayuda'), /\/actualizar/)
  assert.match(buildBotReply(botItems, 'ampliacion linea'), /Obras de ampliación/)
})

test('solicita una recolección, respeta el enfriamiento y detecta el comando de Telegram', async () => {
  const calls = []
  const oldDate = '2026-08-06T10:00:00.000Z'
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/data/archive.json')) return { ok: true, json: async () => ({ generatedAt: oldDate }) }
    if (String(url).includes('/runs?')) return { ok: true, json: async () => ({ workflow_runs: [] }) }
    return { ok: true, status: 204 }
  }
  const requested = await requestCollection({ fetchImpl, token: 'token-de-prueba', now: Date.parse('2026-08-06T11:00:00.000Z') })
  assert.equal(requested.status, 'requested')
  assert.equal(calls.at(-1).options.method, 'POST')
  assert.equal(JSON.parse(calls.at(-1).options.body).ref, 'main')

  const fresh = await requestCollection({ fetchImpl, token: 'token-de-prueba', now: Date.parse(oldDate) + 60_000 })
  assert.equal(fresh.status, 'fresh')
  assert.equal(isRefreshCommand('/actualizar@ObservatorioMetroBot'), true)
  assert.match(buildRefreshReply(requested), /Actualización solicitada/)
})

test('ofrece el workflow manual sin guardar un token de GitHub en el cliente', async () => {
  const manual = await requestCollection({
    fetchImpl: async () => ({ ok: true, json: async () => ({ generatedAt: '2026-01-01T00:00:00.000Z' }) }),
    token: '',
    now: Date.parse('2026-08-06T11:00:00.000Z'),
  })
  assert.equal(manual.status, 'manual_required')
  assert.match(buildRefreshReply(manual), /GitHub Actions/)

  const getResponse = mockResponse()
  await refreshHandler({ method: 'GET', headers: {} }, getResponse)
  assert.equal(getResponse.statusCode, 200)
  assert.match(getResponse.body.manualUrl, /actions\/workflows\/collect\.yml/)

  const rejected = mockResponse()
  await refreshHandler({ method: 'POST', headers: { origin: 'https://example.com', host: 'bocm.vercel.app' } }, rejected)
  assert.equal(rejected.statusCode, 403)
})

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

test('el webhook rechaza peticiones sin firma y responde consultas autorizadas', async () => {
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const previousFetch = globalThis.fetch
  process.env.TELEGRAM_WEBHOOK_SECRET = 'firma-segura-de-prueba'
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items: botItems }),
  })

  try {
    const rejected = mockResponse()
    await telegramHandler({ method: 'POST', headers: {}, body: {} }, rejected)
    assert.equal(rejected.statusCode, 403)

    const accepted = mockResponse()
    await telegramHandler({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'firma-segura-de-prueba' },
      body: { message: { chat: { id: 12345 }, text: '/buscar linea 11' } },
    }, accepted)
    assert.equal(accepted.statusCode, 200)
    assert.equal(accepted.body.method, 'sendMessage')
    assert.equal(accepted.body.chat_id, 12345)
    assert.match(accepted.body.text, /Obras de ampliación/)

    const refresh = mockResponse()
    await telegramHandler({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'firma-segura-de-prueba' },
      body: { message: { chat: { id: 12345 }, text: '/actualizar' } },
    }, refresh)
    assert.equal(refresh.statusCode, 200)
    assert.match(refresh.body.text, /GitHub Actions/)
  } finally {
    globalThis.fetch = previousFetch
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET
    else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret
  }
})
