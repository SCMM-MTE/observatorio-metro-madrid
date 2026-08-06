import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  Download,
  FileSearch,
  Filter,
  RefreshCw,
  Search,
  TrainFront,
  UsersRound,
  X,
} from 'lucide-react'
import type { ArchiveData, ArchiveItem, SourceName } from './types'

const PAGE_SIZE = 24

const emptyArchive: ArchiveData = {
  version: 1,
  generatedAt: null,
  coverage: { bocm: 'Sin datos', contratos: 'Sin datos', empleo: 'Sin datos' },
  sources: {
    bocm: { checkedAt: null, ok: false, message: 'Sin datos', recordsSeen: 0 },
    contratos: { checkedAt: null, ok: false, message: 'Sin datos', recordsSeen: 0 },
    empleo: { checkedAt: null, ok: false, message: 'Sin datos', recordsSeen: 0 },
  },
  items: [],
}

const sourceLabels: Record<SourceName, string> = {
  bocm: 'BOCM',
  contratos: 'Contratación pública',
  empleo: 'Empleo Metro',
}

function normalize(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
}

function formatDate(value?: string, withTime = false) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Madrid',
  }).format(date)
}

function formatMoney(value?: number) {
  if (typeof value !== 'number') return null
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
}

function dateValue(item: ArchiveItem) {
  return new Date(item.updatedAt || item.publishedAt).getTime() || 0
}

function escapeCsv(value: string | number | undefined) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

async function fetchArchive(): Promise<ArchiveData> {
  const response = await fetch(`/data/archive.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export function App() {
  const [archive, setArchive] = useState<ArchiveData>(emptyArchive)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | SourceName>('all')
  const [year, setYear] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'amount'>('recent')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState('')
  const [manualRefreshUrl, setManualRefreshUrl] = useState('')

  useEffect(() => {
    fetchArchive()
      .then((data: ArchiveData) => setArchive(data))
      .catch(() => setLoadError('No se ha podido cargar el archivo. Inténtalo de nuevo en unos minutos.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => setVisible(PAGE_SIZE), [query, source, year, status, sort])

  const years = useMemo(() => {
    return [...new Set(archive.items.map((item) => item.publishedAt.slice(0, 4)).filter(Boolean))].sort().reverse()
  }, [archive.items])

  const statuses = useMemo(() => {
    return [...new Set(archive.items.map((item) => item.status).filter((value): value is string => Boolean(value)))].sort()
  }, [archive.items])

  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    return archive.items
      .filter((item) => source === 'all' || item.source === source)
      .filter((item) => year === 'all' || item.publishedAt.startsWith(year))
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => {
        if (!terms.length) return true
        const haystack = normalize([
          item.title,
          item.summary,
          item.issuer,
          item.expediente,
          item.publicationType,
          item.status,
          ...(item.tags || []),
        ].filter(Boolean).join(' '))
        return terms.every((term) => haystack.includes(term))
      })
      .sort((a, b) => {
        if (sort === 'oldest') return dateValue(a) - dateValue(b)
        if (sort === 'amount') return (b.amount || 0) - (a.amount || 0)
        return dateValue(b) - dateValue(a)
      })
  }, [archive.items, query, source, year, status, sort])

  const counts = useMemo(() => ({
    total: archive.items.length,
    bocm: archive.items.filter((item) => item.source === 'bocm').length,
    contratos: archive.items.filter((item) => item.source === 'contratos').length,
    amount: archive.items.reduce((sum, item) => sum + (item.amount || 0), 0),
    vacancies: archive.items.reduce((sum, item) => sum + (item.jobPositions?.reduce((jobSum, job) => jobSum + job.vacancies, 0) ?? item.vacancies ?? 0), 0),
  }), [archive.items])

  const jobs = useMemo(() => archive.items
    .filter((item) => item.source === 'empleo' || item.tags?.includes('empleo'))
    .flatMap((item) => item.jobPositions?.length
      ? item.jobPositions.map((job, index) => ({ ...item, ...job, id: `${item.id}:job-${index}` }))
      : [item])
    .sort((a, b) => dateValue(b) - dateValue(a)), [archive.items])

  const hasFilters = query || source !== 'all' || year !== 'all' || status !== 'all'

  function clearFilters() {
    setQuery('')
    setSource('all')
    setYear('all')
    setStatus('all')
  }

  function downloadCsv() {
    const headers = ['Fuente', 'Fecha', 'Título', 'Expediente', 'Organismo', 'Tipo', 'Estado', 'Importe', 'URL']
    const rows = filtered.map((item) => [
      sourceLabels[item.source], item.publishedAt, item.title, item.expediente, item.issuer,
      item.publicationType, item.status, item.amount, item.url,
    ].map(escapeCsv).join(','))
    const blob = new Blob([`\uFEFF${headers.map(escapeCsv).join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `observatorio-metro-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function forceRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage('Comprobando la información publicada…')
    setManualRefreshUrl('')

    try {
      const latest = await fetchArchive()
      setArchive(latest)
      const baseline = latest.generatedAt
      const response = await fetch('/api/refresh', { method: 'POST' })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`)

      if (result.status === 'manual_required') {
        setRefreshMessage('Los datos visibles se han recargado. Para consultar ahora las fuentes, abre la actualización protegida de GitHub.')
        setManualRefreshUrl(result.manualUrl)
        return
      }
      if (result.status === 'fresh') {
        setRefreshMessage(`La información ya estaba actualizada: ${formatDate(result.generatedAt, true)}.`)
        return
      }

      setRefreshMessage(result.status === 'already_running' ? 'Ya hay una actualización en curso…' : 'Actualización solicitada; esperando los nuevos datos…')
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await wait(5_000)
        const refreshed = await fetchArchive()
        setArchive(refreshed)
        if (refreshed.generatedAt && refreshed.generatedAt !== baseline) {
          setRefreshMessage(`Información actualizada: ${formatDate(refreshed.generatedAt, true)}.`)
          return
        }
      }
      setRefreshMessage('La actualización sigue ejecutándose. Puedes volver a comprobarla dentro de unos minutos.')
    } catch {
      setRefreshMessage('No se ha podido solicitar la actualización. Inténtalo de nuevo dentro de unos minutos.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Observatorio Metro, inicio">
          <span className="brand-mark"><TrainFront size={21} /></span>
          <span>OBSERVATORIO <strong>METRO</strong></span>
        </a>
        <nav aria-label="Navegación principal">
          <a href="#archivo">Archivo</a>
          <a href="#metodologia">Metodología</a>
          <span className="update-pill"><span /> Cada 30 min</span>
        </nav>
      </header>

      <main id="inicio">
        <section className="hero">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-line line-one" aria-hidden="true" />
          <div className="hero-line line-two" aria-hidden="true" />
          <div className="hero-content">
            <div className="eyebrow"><span /> Información pública, reunida y trazable</div>
            <h1>Todo lo publicado sobre<br /><em>Metro de Madrid.</em></h1>
            <p className="hero-copy">Un archivo independiente que rastrea el BOCM y el Portal de Contratación Pública para que encuentres licitaciones, anuncios y resoluciones en un solo lugar.</p>

            <div className="hero-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por título, expediente, empresa…"
                aria-label="Buscar en todas las publicaciones"
              />
              {query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Borrar búsqueda"><X size={18} /></button>}
              <a href="#archivo">Buscar</a>
            </div>
            <div className="search-hints"><span>Prueba con</span><button onClick={() => setQuery('mantenimiento')}>“mantenimiento”</button><button onClick={() => setQuery('60126')}>“60126”</button><button onClick={() => setQuery('Línea 6')}>“Línea 6”</button></div>
          </div>
        </section>

        <section className="dashboard" id="archivo">
          <div className="stats-grid">
            <article><span>Publicaciones archivadas</span><strong>{counts.total.toLocaleString('es-ES')}</strong><small><Database size={14} /> Histórico consolidado</small></article>
            <article><span>Anuncios en BOCM</span><strong>{counts.bocm.toLocaleString('es-ES')}</strong><small><FileSearch size={14} /> Fuente oficial</small></article>
            <article><span>Contratos localizados</span><strong>{counts.contratos.toLocaleString('es-ES')}</strong><small><Building2 size={14} /> Todas las situaciones</small></article>
            <article><span>Plazas de empleo</span><strong>{counts.vacancies.toLocaleString('es-ES')}</strong><small><UsersRound size={14} /> En ofertas monitorizadas</small></article>
          </div>

          <section className="jobs-section" aria-labelledby="jobs-title">
            <div className="jobs-heading">
              <div><span className="section-label">EMPLEO METRO</span><h2 id="jobs-title">Plazas ofertadas por puesto</h2><p>Convocatorias conservadas desde la primera detección.</p></div>
              <a href="https://www.metromadrid.es/es/empleo-metro" target="_blank" rel="noreferrer">Portal de empleo <ArrowUpRight /></a>
            </div>
            {jobs.length ? <div className="jobs-table">
              <div className="jobs-row jobs-header"><span>Puesto</span><span>Plazas</span><span>Publicación</span><span>Fuente</span><span /></div>
              {jobs.slice(0, 20).map((job) => <div className="jobs-row" key={`job-${job.id}`}>
                <span><BriefcaseBusiness /> <strong>{job.position || job.title}</strong></span>
                <span className="vacancy-count">{job.vacancies ?? '—'}</span>
                <span>{formatDate(job.publishedAt)}</span>
                <span>{sourceLabels[job.source]}</span>
                <a href={job.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${job.position || job.title}`}><ArrowUpRight /></a>
              </div>)}
            </div> : <div className="jobs-empty"><BriefcaseBusiness /><div><strong>Esperando la primera oferta</strong><p>El portal se comprueba automáticamente cada 30 minutos.</p></div></div>}
          </section>

          <div className="archive-heading">
            <div>
              <span className="section-label">ARCHIVO DOCUMENTAL</span>
              <h2>Publicaciones encontradas</h2>
              <p>{loading ? 'Cargando el repositorio…' : `${filtered.length.toLocaleString('es-ES')} resultados con los filtros actuales`}</p>
            </div>
            <div className="archive-actions">
              <button className="refresh-button" onClick={forceRefresh} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={17} /> {refreshing ? 'Actualizando…' : 'Actualizar ahora'}</button>
              <button className="export-button" onClick={downloadCsv} disabled={!filtered.length}><Download size={17} /> Exportar CSV</button>
            </div>
          </div>

          {refreshMessage && <div className="notice refresh"><RefreshCw size={17} /> <span>{refreshMessage}</span>{manualRefreshUrl && <a href={manualRefreshUrl} target="_blank" rel="noreferrer">Abrir actualización manual <ArrowUpRight size={14} /></a>}</div>}

          <div className="filter-panel">
            <label className="filter-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar resultados…" /></label>
            <label><span>Fuente</span><div className="select-wrap"><select value={source} onChange={(event) => setSource(event.target.value as 'all' | SourceName)}><option value="all">Todas las fuentes</option><option value="bocm">BOCM</option><option value="contratos">Contratación pública</option><option value="empleo">Empleo Metro</option></select><ChevronDown /></div></label>
            <label><span>Año</span><div className="select-wrap"><select value={year} onChange={(event) => setYear(event.target.value)}><option value="all">Todos los años</option>{years.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown /></div></label>
            <label><span>Estado</span><div className="select-wrap"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos los estados</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown /></div></label>
            <label><span>Ordenar</span><div className="select-wrap"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Más recientes</option><option value="oldest">Más antiguos</option><option value="amount">Mayor importe</option></select><ChevronDown /></div></label>
          </div>

          {loadError && <div className="notice error"><CircleAlert />{loadError}</div>}
          {!loading && !loadError && !filtered.length && <div className="empty-state"><Filter /><h3>No hay coincidencias</h3><p>Prueba a quitar algún filtro o usa una búsqueda más general.</p>{hasFilters && <button onClick={clearFilters}>Limpiar filtros</button>}</div>}

          <div className="results-list" aria-live="polite">
            {filtered.slice(0, visible).map((item) => <ResultCard item={item} key={item.id} />)}
          </div>
          {visible < filtered.length && <button className="load-more" onClick={() => setVisible((value) => value + PAGE_SIZE)}>Mostrar más <span>{Math.min(PAGE_SIZE, filtered.length - visible)}</span></button>}
        </section>

        <section className="methodology" id="metodologia">
          <div>
            <span className="section-label">CÓMO FUNCIONA</span>
            <h2>Fuentes oficiales.<br />Archivo verificable.</h2>
            <p>El recolector consulta cada 30 minutos las fuentes públicas, identifica las publicaciones relacionadas con Metro de Madrid y conserva sus metadatos en GitHub. Cada resultado enlaza al documento original.</p>
          </div>
          <div className="source-statuses">
            {(['bocm', 'contratos', 'empleo'] as SourceName[]).map((name) => {
              const sourceStatus = archive.sources[name]
              return <article key={name}>
                <div className={`status-icon ${sourceStatus.ok ? 'ok' : 'warn'}`}>{sourceStatus.ok ? <CheckCircle2 /> : <CircleAlert />}</div>
                <div><strong>{sourceLabels[name]}</strong><p>{sourceStatus.message}</p><small><Clock3 size={13} /> Última consulta: {formatDate(sourceStatus.checkedAt || undefined, true)}</small></div>
              </article>
            })}
          </div>
        </section>
      </main>

      <footer>
        <div className="brand"><span className="brand-mark"><TrainFront size={19} /></span><span>OBSERVATORIO <strong>METRO</strong></span></div>
        <p>Proyecto independiente de reutilización de información pública. No representa a Metro de Madrid ni a la Comunidad de Madrid.</p>
        <span>Datos actualizados: {formatDate(archive.generatedAt || undefined, true)}</span>
      </footer>
    </div>
  )
}

function ResultCard({ item }: { item: ArchiveItem }) {
  const money = formatMoney(item.amount)
  return <article className="result-card">
    <div className="result-meta">
      <span className={`source-badge ${item.source}`}>{item.source === 'bocm' ? <FileSearch /> : item.source === 'empleo' ? <BriefcaseBusiness /> : <Building2 />}{sourceLabels[item.source]}</span>
      <span><CalendarDays /> {formatDate(item.publishedAt)}</span>
      {item.status && <span className="status-badge">{item.status}</span>}
    </div>
    <div className="result-body">
      <div className="result-copy">
        <h3>{item.title}</h3>
        {item.summary && item.summary !== item.title && <p>{item.summary}</p>}
        <dl>
          {item.expediente && <div><dt>EXPEDIENTE</dt><dd>{item.expediente}</dd></div>}
          {item.issuer && <div><dt>ORGANISMO</dt><dd>{item.issuer}</dd></div>}
          {item.publicationType && <div><dt>TIPO</dt><dd>{item.publicationType}</dd></div>}
          {item.deadline && <div><dt>FIN DE PLAZO</dt><dd>{formatDate(item.deadline)}</dd></div>}
          {money && <div><dt>IMPORTE</dt><dd>{money}</dd></div>}
          {typeof item.vacancies === 'number' && <div><dt>PLAZAS</dt><dd>{item.vacancies}</dd></div>}
        </dl>
      </div>
      <div className="result-actions">
        {item.pdfUrl && <a href={item.pdfUrl} target="_blank" rel="noreferrer" className="secondary-link"><Download /> PDF</a>}
        <a href={item.url} target="_blank" rel="noreferrer" className="primary-link">Ver original <ArrowUpRight /></a>
      </div>
    </div>
  </article>
}
