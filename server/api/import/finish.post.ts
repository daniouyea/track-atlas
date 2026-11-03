import { endSession, getSession } from '../../utils/importSession'
import { userId } from '../../utils/auth'

export default defineEventHandler((event) => {
  const uid = userId(event)
  const { result, todo } = getSession(uid)
  for (const [file, a] of todo) result.skipped.push({ id: a.id, reason: `no se recibió ${file}` })
  endSession(uid)
  return result
})
