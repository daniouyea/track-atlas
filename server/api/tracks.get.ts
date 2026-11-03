import { gzipSync } from 'node:zlib'
import { useDb, dataVersion } from '../utils/db'
import { userId } from '../utils/auth'

// Todas las trazas simplificadas del usuario en un FeatureCollection (vista general y heatmap).
// Pesa varios MB, así que se cachea comprimido hasta que cambien sus datos.
const caches = new Map<number, { version: string, gz: Buffer }>()

export default defineEventHandler((event) => {
  const uid = userId(event)
  const version = dataVersion(uid)
  let cache = caches.get(uid)
  if (cache?.version !== version) {
    const rows = useDb().prepare(`
      SELECT a.id, a.type, a.start_time AS startTime, t.overview
      FROM activities a JOIN tracks t ON t.user_id = a.user_id AND t.activity_id = a.id
      WHERE a.user_id = ?
    `).all(uid) as { id: string, type: string | null, startTime: string | null, overview: string }[]
    const features = rows.map(r => `{"type":"Feature","properties":${JSON.stringify({ id: r.id, type: r.type, year: r.startTime?.slice(0, 4) ?? null })},"geometry":{"type":"LineString","coordinates":${r.overview}}}`)
    caches.set(uid, cache = { version, gz: gzipSync(`{"type":"FeatureCollection","features":[${features.join(',')}]}`) })
  }
  const etag = `"${cache.version}"`
  setHeader(event, 'ETag', etag)
  // privada: es distinta para cada usuario
  setHeader(event, 'Cache-Control', 'private, no-cache')
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }
  setHeader(event, 'Content-Type', 'application/geo+json')
  setHeader(event, 'Content-Encoding', 'gzip')
  return cache.gz
})
