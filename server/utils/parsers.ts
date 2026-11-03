import { gunzipSync } from 'node:zlib'
import { DOMParser } from '@xmldom/xmldom'
import { gpx, tcx } from '@tmcw/togeojson'
import FitParser from 'fit-file-parser'
import type { RawPoint } from './geo'

export interface ParsedFile {
  points: RawPoint[]
  name?: string
}

/** Lee GPX / TCX / FIT (opcionalmente .gz) y devuelve la lista de puntos. */
export async function parseTrackFile(filename: string, buf: Buffer): Promise<ParsedFile> {
  let name = filename.toLowerCase()
  if (name.endsWith('.gz')) {
    buf = gunzipSync(buf)
    name = name.slice(0, -3)
  }
  if (name.endsWith('.fit')) return parseFit(buf)
  if (name.endsWith('.gpx') || name.endsWith('.tcx')) return parseXml(buf, name.endsWith('.gpx') ? 'gpx' : 'tcx')
  throw new Error(`Formato no soportado: ${filename}`)
}

function parseXml(buf: Buffer, kind: 'gpx' | 'tcx'): ParsedFile {
  // algunos ficheros de Strava traen espacios/BOM antes de la cabecera XML
  const text = buf.toString('utf8').replace(/^﻿?\s+/, '')
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  const fc = (kind === 'gpx' ? gpx : tcx)(doc as unknown as Document)
  const points: RawPoint[] = []
  let name: string | undefined
  for (const f of fc.features) {
    if (!f.geometry) continue
    name ??= (f.properties as Record<string, unknown> | null)?.name as string | undefined
    const times = (f.properties as any)?.coordinateProperties?.times
    const lines = f.geometry.type === 'LineString'
      ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []
    lines.forEach((line, li) => {
      // times es string[] para LineString y string[][] para MultiLineString
      const lineTimes: (string | null)[] | undefined = Array.isArray(times?.[0]) ? times[li] : times
      line.forEach((c, i) => {
        const t = lineTimes?.[i] ? Date.parse(lineTimes[i]!) : undefined
        points.push({ lng: c[0]!, lat: c[1]!, ele: c[2], t: Number.isFinite(t) ? t : undefined })
      })
    })
  }
  return { points, name }
}

async function parseFit(buf: Buffer): Promise<ParsedFile> {
  const parser = new FitParser({ force: true, lengthUnit: 'm', speedUnit: 'm/s', mode: 'list' })
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const data = await parser.parseAsync(ab)
  const points: RawPoint[] = []
  for (const r of data.records ?? []) {
    if (r.position_lat == null || r.position_long == null) continue
    points.push({
      lat: r.position_lat,
      lng: r.position_long,
      ele: r.enhanced_altitude ?? r.altitude,
      t: r.timestamp ? new Date(r.timestamp).getTime() : undefined,
    })
  }
  return { points }
}
