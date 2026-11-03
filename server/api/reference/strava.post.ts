import { useDb } from '../../utils/db'
import { parseTrackFile } from '../../utils/parsers'
import { toRefTrack } from '../../utils/reference'
import { parseStravaUrl, stravaApi } from '../../utils/strava'
import { userId } from '../../utils/auth'
import type { DetailPoint, RawPoint } from '../../utils/geo'

interface Streams { latlng?: { data: [number, number][] }, altitude?: { data: number[] }, time?: { data: number[] } }

const fromStreams = (s: Streams, t0?: number): RawPoint[] =>
  (s.latlng?.data ?? []).map(([lat, lng], i) => ({
    lat, lng, ele: s.altitude?.data[i],
    t: t0 != null && s.time ? t0 + s.time.data[i]! * 1000 : undefined,
  }))

// Track de referencia a partir de una URL de Strava (actividad, ruta o segmento)
export default defineEventHandler(async (event) => {
  const uid = userId(event)
  const { url } = await readBody<{ url?: string }>(event)
  const ref = url ? await parseStravaUrl(url) : null
  if (!ref) throw createError({ statusCode: 400, statusMessage: 'No reconozco la URL: usa un enlace a una actividad, ruta o segmento de Strava' })
  const canonical = `https://www.strava.com/${ref.kind}/${ref.id}`

  // si es una actividad mía ya importada, no hace falta la API
  if (ref.kind === 'activities') {
    const row = useDb().prepare(`SELECT a.name, t.detail FROM activities a JOIN tracks t ON t.user_id = a.user_id AND t.activity_id = a.id
      WHERE a.user_id = ? AND a.id = ?`).get(uid, ref.id) as { name: string, detail: string } | undefined
    if (row) {
      const detail = JSON.parse(row.detail) as DetailPoint[]
      return toRefTrack(detail.map(p => ({ lng: p[0], lat: p[1], ele: p[2] ?? undefined })), { name: row.name, source: 'mine', url: canonical, activityId: ref.id })
    }
  }

  if (ref.kind === 'routes') {
    const [route, gpx] = await Promise.all([
      stravaApi<{ name: string }>(uid, `/routes/${ref.id}`),
      stravaApi<string>(uid, `/routes/${ref.id}/export_gpx`, { responseType: 'text' }),
    ])
    const parsed = await parseTrackFile('route.gpx', Buffer.from(gpx))
    return toRefTrack(parsed.points, { name: route.name, source: 'strava-route', url: canonical })
  }

  if (ref.kind === 'segments') {
    const [seg, streams] = await Promise.all([
      stravaApi<{ name: string }>(uid, `/segments/${ref.id}`),
      stravaApi<Streams>(uid, `/segments/${ref.id}/streams`, { query: { keys: 'latlng,altitude', key_by_type: 'true' } }),
    ])
    return toRefTrack(fromStreams(streams), { name: seg.name, source: 'strava-segment', url: canonical })
  }

  try {
    const [act, streams] = await Promise.all([
      stravaApi<{ name: string, start_date: string, athlete: { id: number } }>(uid, `/activities/${ref.id}`),
      stravaApi<Streams>(uid, `/activities/${ref.id}/streams`, { query: { keys: 'latlng,altitude,time', key_by_type: 'true' } }),
    ])
    const mine = act.athlete?.id === uid
    return toRefTrack(fromStreams(streams, Date.parse(act.start_date)), {
      name: act.name, source: mine ? 'mine' : 'strava-activity', url: canonical, activityId: mine ? ref.id : undefined,
    })
  } catch (e: any) {
    // la API solo da acceso a actividades propias
    if ([403, 404].includes(e?.statusCode)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Strava no deja descargar actividades de otros por la API. Exporta el GPX y suéltalo en el mapa.',
        data: { exportUrl: `${canonical}/export_gpx` },
      })
    }
    throw e
  }
})
