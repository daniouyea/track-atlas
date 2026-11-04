import { backfillTick } from '../utils/stravaSync'

// Descarga del historial en segundo plano, respetando el cupo de la API de Strava
export default defineNitroPlugin(() => {
  const g = globalThis as { __taBackfill?: ReturnType<typeof setInterval> }
  if (g.__taBackfill) clearInterval(g.__taBackfill) // recarga en caliente en desarrollo
  g.__taBackfill = setInterval(() => { backfillTick().catch(e => console.error('[backfill]', e)) }, 60_000)
})
