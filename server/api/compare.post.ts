import { compareTrack } from '../utils/compare'
import type { DetailPoint } from '../utils/geo'

export default defineEventHandler(async (event) => {
  const { detail, toleranceM, excludeId } = await readBody<{ detail: DetailPoint[], toleranceM?: number, excludeId?: string }>(event)
  if (!Array.isArray(detail) || detail.length < 2) throw createError({ statusCode: 400, statusMessage: 'Track vacío' })
  return compareTrack(detail, Math.min(Math.max(Number(toleranceM) || 30, 5), 500), excludeId)
})
