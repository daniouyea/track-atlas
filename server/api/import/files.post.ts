import { importActivity } from '../../utils/importer'
import { getSession } from '../../utils/importSession'
import { userId } from '../../utils/auth'

// Una tanda de ficheros de actividades (multipart: nombre del campo = ruta dentro del ZIP;
// con «.gz» añadido si el navegador lo ha comprimido para subirlo)
export default defineEventHandler(async (event) => {
  const uid = userId(event)
  const session = getSession(uid)
  const parts = await readMultipartFormData(event) ?? []
  let processed = 0
  for (const part of parts) {
    const sent = part.name ?? ''
    const file = session.todo.has(sent) ? sent : sent.replace(/\.gz$/, '')
    const activity = session.todo.get(file)
    if (!activity) continue
    session.todo.delete(file) // un reintento de la misma tanda no la procesa dos veces
    // se parsea con el nombre enviado (que dice si va comprimido) y se guarda con el original
    await importActivity(uid, activity, file, part.data, session.result, sent)
    processed++
  }
  return { processed, remaining: session.todo.size }
})
