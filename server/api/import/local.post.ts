import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from '../../utils/db'
import { importStravaExport } from '../../utils/importer'
import { userId } from '../../utils/auth'

// Importa lo que haya en DATA_DIR/import/<id de atleta>: ZIPs de exportación o carpetas ya descomprimidas.
export default defineEventHandler(async (event) => {
  const force = getQuery(event).force === '1'
  const uid = userId(event)
  const dir = join(dataDir(), 'import', String(uid))
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const targets = entries.filter(e => e.isDirectory() || e.name.toLowerCase().endsWith('.zip'))
  if (!targets.length)
    throw createError({ statusCode: 404, statusMessage: `No hay nada que importar en ${dir}` })
  const results = []
  for (const t of targets) results.push({ source: t.name, ...(await importStravaExport(uid, join(dir, t.name), { force })) })
  return results
})
