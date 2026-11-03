import { planImport } from '../../utils/importer'
import { startSession } from '../../utils/importSession'
import { userId } from '../../utils/auth'

// Recibe activities.csv y la lista de ficheros del ZIP; devuelve los ficheros que hay que subir
export default defineEventHandler(async (event) => {
  const uid = userId(event)
  const body = await readBody<{ csv?: string | null, files?: string[], force?: boolean }>(event)
  if (!Array.isArray(body?.files)) throw createError({ statusCode: 400, statusMessage: 'Falta la lista de ficheros' })
  const { todo, result } = planImport(uid, body.csv ?? null, body.files, { force: !!body.force })
  startSession(uid, todo, result)
  return { needed: [...todo.keys()], unchanged: result.unchanged, skipped: result.skipped.length }
})
