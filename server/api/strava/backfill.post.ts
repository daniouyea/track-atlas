import { userId } from '../../utils/auth'
import { backfillTick, setBackfill, syncStatus } from '../../utils/stravaSync'

// Activa o para la descarga del historial completo en segundo plano
export default defineEventHandler(async (event) => {
  const uid = userId(event)
  const { enable } = await readBody<{ enable?: boolean }>(event)
  setBackfill(uid, !!enable)
  // empieza ya, sin esperar al siguiente minuto
  if (enable) backfillTick().catch(e => console.error('[backfill]', e))
  return syncStatus(uid)
})
