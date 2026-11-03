import { gzipSync } from 'node:zlib'
import { useDb, dataVersion } from '../utils/db'

// Todas las trazas simplificadas en un FeatureCollection (para vista general y heatmap).
// Pesa varios MB, así que se cachea comprimido hasta que cambien los datos.
let cache: { version: string, gz: Buffer } | undefined

export default defineEventHandler((event) => {
  const version = dataVersion()
  if (cache?.version !== version) {
    const rows = useDb().prepare(`
      SELECT a.id, a.type, a.start_time AS startTime, t.overview
      FROM activities a JOIN tracks t ON t.activity_id = a.id
    `).all() as { id: string, type: string | null, startTime: string | null, overview: string }[]
    const features = rows.map(r => `{"type":"Feature","properties":${JSON.stringify({ id: r.id, type: r.type, year: r.startTime?.slice(0, 4) ?? null })},"geometry":{"type":"LineString","coordinates":${r.overview}}}`)
    cache = { version, gz: gzipSync(`{"type":"FeatureCollection","features":[${features.join(',')}]}`) }
  }
  const etag = `"${cache.version}"`
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Cache-Control', 'no-cache')
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }
  setHeader(event, 'Content-Type', 'application/geo+json')
  setHeader(event, 'Content-Encoding', 'gzip')
  return cache.gz
})
