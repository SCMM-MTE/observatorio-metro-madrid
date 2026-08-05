export type SourceName = 'bocm' | 'contratos' | 'empleo'

export interface ArchiveItem {
  id: string
  source: SourceName
  title: string
  summary?: string
  issuer?: string
  publicationType?: string
  status?: string
  expediente?: string
  amount?: number
  vacancies?: number
  position?: string
  jobPositions?: Array<{ position: string; vacancies: number }>
  deadline?: string
  publishedAt: string
  updatedAt?: string
  firstSeenAt: string
  url: string
  pdfUrl?: string
  xmlUrl?: string
  tags?: string[]
}

export interface SourceStatus {
  checkedAt: string | null
  ok: boolean
  message: string
  recordsSeen: number
}

export interface ArchiveData {
  version: number
  generatedAt: string | null
  coverage: {
    bocm: string
    contratos: string
    empleo: string
  }
  sources: Record<SourceName, SourceStatus>
  items: ArchiveItem[]
}
