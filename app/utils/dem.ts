import { haversine, type Coord } from './route'

/**
 * Altitud desde un modelo digital del terreno: teselas «Terrarium» (datos abiertos en AWS,
 * https://registry.opendata.aws/terrain-tiles/), sin clave y con CORS. Cada píxel codifica la
 * altitud: (R·256 + G + B/256) − 32768 metros. Zoom 13 ≈ 15 m por píxel en la península.
 */
const ZOOM = 13
const URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const tiles = new Map<string, Promise<Uint8ClampedArray | null>>()

function loadTile(x: number, y: number) {
  const key = `${x}/${y}`
  let t = tiles.get(key)
  if (!t) {
    t = fetch(`${URL}/${ZOOM}/${x}/${y}.png`)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(b => createImageBitmap(b))
      .then((img) => {
        const c = new OffscreenCanvas(256, 256)
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, 256, 256).data
      })
      .catch(() => null)
    tiles.set(key, t)
  }
  return t
}

/** Coordenadas de píxel globales (a ZOOM) de un punto */
function pixel(lng: number, lat: number) {
  const n = 2 ** ZOOM * 256
  const s = Math.sin(lat * Math.PI / 180)
  return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n] as const
}

async function heightAt(px: number, py: number): Promise<number | null> {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256)
  const data = await loadTile(tx, ty)
  if (!data) return null
  const x = Math.min(255, Math.max(0, Math.floor(px - tx * 256)))
  const y = Math.min(255, Math.max(0, Math.floor(py - ty * 256)))
  const i = (y * 256 + x) * 4
  return data[i]! * 256 + data[i + 1]! + data[i + 2]! / 256 - 32768
}

/** Altitud con interpolación bilineal entre los 4 píxeles vecinos */
async function elevation(lng: number, lat: number) {
  const [px, py] = pixel(lng, lat)
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5)
  const fx = px - 0.5 - x0, fy = py - 0.5 - y0
  const [a, b, c, d] = await Promise.all([heightAt(x0, y0), heightAt(x0 + 1, y0), heightAt(x0, y0 + 1), heightAt(x0 + 1, y0 + 1)])
  if (a == null || b == null || c == null || d == null) return a ?? b ?? c ?? d
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

/** Añade puntos intermedios para que no haya huecos de más de `stepM` (los tramos rectos tienen 2 puntos) */
export function densify(coords: Coord[], stepM = 25): Coord[] {
  const out: Coord[] = []
  coords.forEach((c, i) => {
    if (i) {
      const p = coords[i - 1]!
      const n = Math.floor(haversine(p, c) / stepM)
      for (let k = 1; k < n; k++) out.push([p[0] + (c[0] - p[0]) * k / n, p[1] + (c[1] - p[1]) * k / n, null])
    }
    out.push(c)
  })
  return out
}

/** Coordenadas con la altitud del modelo del terreno (densificadas cada 25 m) */
export async function withDemElevation(coords: Coord[]): Promise<Coord[]> {
  const dense = densify(coords)
  const ele = await Promise.all(dense.map(c => elevation(c[0], c[1])))
  return dense.map((c, i) => [c[0], c[1], ele[i] != null ? Math.round(ele[i]! * 10) / 10 : null])
}
