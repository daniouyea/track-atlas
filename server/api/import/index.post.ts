import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { dataDir } from '../../utils/db'
import { importStravaExport } from '../../utils/importer'
import { userId } from '../../utils/auth'

// Recibe el ZIP de exportación de Strava como cuerpo binario (puede pesar cientos de MB:
// se vuelca a disco en streaming en vez de cargarlo en memoria).
export default defineEventHandler(async (event) => {
  const uid = userId(event)
  const dir = join(dataDir(), 'uploads')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `export-${Date.now()}.zip`)
  try {
    await pipeline(event.node.req, createWriteStream(file))
    return await importStravaExport(uid, file, { force: getQuery(event).force === '1' })
  } finally {
    await unlink(file).catch(() => {})
  }
})
