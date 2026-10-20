export function healthSummary(archive) {
  return {
    version: 1,
    generatedAt: archive.generatedAt,
    records: archive.items.length,
    sources: Object.fromEntries(['bocm', 'contratos', 'empleo'].map((id) => [id, archive.sources[id]])),
  }
}
