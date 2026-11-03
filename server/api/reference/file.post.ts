import { parseTrackFile } from '../../utils/parsers'
import { toRefTrack } from '../../utils/reference'

// Track de referencia desde un fichero GPX/TCX/FIT (cuerpo binario, nombre en X-Filename)
export default defineEventHandler(async (event) => {
  const filename = decodeURIComponent(getRequestHeader(event, 'x-filename') ?? 'track.gpx')
  const body = await readRawBody(event, false)
  if (!body?.length) throw createError({ statusCode: 400, statusMessage: 'Fichero vacío' })
  let parsed
  try {
    parsed = await parseTrackFile(filename, Buffer.from(body))
  } catch (e) {
    throw createError({ statusCode: 422, statusMessage: e instanceof Error ? e.message : String(e) })
  }
  return toRefTrack(parsed.points, { name: parsed.name || filename.replace(/\.[^.]+(\.gz)?$/, ''), source: 'file' })
})
