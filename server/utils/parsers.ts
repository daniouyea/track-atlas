import { gunzipSync } from 'node:zlib'
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

// GPX y TCX tienen una estructura muy simple: se leen con expresiones regulares.
// Un DOM completo (xmldom + togeojson) tardaba ~0,9 s por actividad; esto, unos pocos ms.
const decode = (v: string) => v
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .trim()

const regexps = new Map<string, RegExp>()
const re = (key: string, src: () => string) => regexps.get(key) ?? regexps.set(key, new RegExp(src())).get(key)!

const tag = (xml: string, name: string) => {
  const m = xml.match(re(`t:${name}`, () => `<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`))
  return m ? decode(m[1]!) : undefined
}
const attr = (attrs: string, name: string) => attrs.match(re(`a:${name}`, () => `\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1]
const num = (v?: string) => (v == null || v === '' ? undefined : Number(v))
const time = (v?: string) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : undefined
}

function parseXml(buf: Buffer, kind: 'gpx' | 'tcx'): ParsedFile {
  const xml = buf.toString('utf8')
  const points: RawPoint[] = []
  if (kind === 'gpx') {
    // trkpt en actividades, rtept en rutas
    for (const m of xml.matchAll(/<(?:\w+:)?(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g)) {
      const inner = m[3] ?? ''
      points.push({
        lat: Number(attr(m[2]!, 'lat')),
        lng: Number(attr(m[2]!, 'lon')),
        ele: num(tag(inner, 'ele')),
        t: time(tag(inner, 'time')),
      })
    }
    const head = xml.match(/<(?:\w+:)?(?:trk|rte)\b[^>]*>([\s\S]*?)<(?:\w+:)?(?:trkseg|trkpt|rtept)\b/)?.[1]
    return { points, name: (head && tag(head, 'name')) || tag(xml.split(/<(?:\w+:)?(?:trk|rte)\b/)[0]!, 'name') }
  }
  for (const m of xml.matchAll(/<(?:\w+:)?Trackpoint\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Trackpoint>/g)) {
    const inner = m[1]!
    const lat = tag(inner, 'LatitudeDegrees')
    if (lat == null) continue // puntos sin posición (pausas, sensores)
    points.push({
      lat: Number(lat),
      lng: Number(tag(inner, 'LongitudeDegrees')),
      ele: num(tag(inner, 'AltitudeMeters')),
      t: time(tag(inner, 'Time')),
    })
  }
  return { points, name: tag(xml, 'Notes') }
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
