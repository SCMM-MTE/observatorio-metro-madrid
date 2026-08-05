import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMetroRelated,
  extractPosition,
  extractJobPositions,
  extractVacancies,
  mergeItems,
  parseBocmSummaryXml,
  parseContractsFeed,
  parseContractsSearchPage,
  parseEmploymentPage,
  parseSpanishDate,
} from '../scripts/lib.mjs'
import { buildTelegramMessages, escapeTelegramHtml } from '../scripts/telegram.mjs'
import { buildBotReply, normalizeQuery } from '../scripts/bot-query.mjs'
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

test('normaliza fechas españolas y conserva firstSeen al fusionar', () => {
  assert.equal(parseSpanishDate('5 de agosto del 2026 08:25'), '2026-08-05T08:25:00+02:00')
  const old = [{ id: 'x', title: 'Anterior', source: 'bocm', publishedAt: '2026-01-01', firstSeenAt: 'old', url: 'https://example.com' }]
  const merged = mergeItems(old, [{ ...old[0], title: 'Nuevo' }], 'new')
  assert.equal(merged[0].title, 'Nuevo')
  assert.equal(merged[0].firstSeenAt, 'old')
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
  assert.match(buildBotReply(botItems, 'ampliacion linea'), /Obras de ampliación/)
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
  } finally {
    globalThis.fetch = previousFetch
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET
    else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret
  }
})
