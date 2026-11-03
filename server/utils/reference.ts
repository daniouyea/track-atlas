import { processTrack, type DetailPoint, type RawPoint } from './geo'

export interface RefTrack {
  name: string
  source: 'file' | 'mine' | 'strava-activity' | 'strava-route' | 'strava-segment'
  url?: string
  /** si es una de mis actividades: para no compararla consigo misma */
  activityId?: string
  detail: DetailPoint[]
  distanceM: number
  elevationGainM: number
  bbox: [number, number, number, number]
}

export function toRefTrack(points: RawPoint[], meta: Pick<RefTrack, 'name' | 'source' | 'url' | 'activityId'>): RefTrack {
  const t = processTrack(points)
  if (!t) throw createError({ statusCode: 422, statusMessage: 'El track no tiene puntos GPS' })
  return { ...meta, detail: t.detail, distanceM: Math.round(t.distanceM), elevationGainM: t.elevationGainM, bbox: t.bbox }
}
