import type { CsvActivity, ImportResult } from './importer'

/**
 * Importación por tandas desde el navegador: el cliente abre el ZIP, manda activities.csv y la lista
 * de ficheros (start), sube solo los ficheros de actividades en tandas pequeñas (files) y cierra (finish).
 * Así ninguna petición supera el límite de 100 MB de Cloudflare y las fotos del export no se suben.
 */
interface Session {
  todo: Map<string, CsvActivity>
  result: ImportResult
  touched: number
}

const sessions = new Map<number, Session>()
const TTL = 60 * 60 * 1000

export function startSession(userId: number, todo: Map<string, CsvActivity>, result: ImportResult) {
  for (const [id, s] of sessions) if (Date.now() - s.touched > TTL) sessions.delete(id)
  sessions.set(userId, { todo, result, touched: Date.now() })
}

export function getSession(userId: number) {
  const s = sessions.get(userId)
  if (!s) throw createError({ statusCode: 409, statusMessage: 'No hay ninguna importación en curso: vuelve a empezar' })
  s.touched = Date.now()
  return s
}

export const endSession = (userId: number) => sessions.delete(userId)
