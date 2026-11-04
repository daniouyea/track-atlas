/** [oeste, sur, este, norte] */
export type Bounds = [number, number, number, number]

const inside = (x: number, y: number, r: Bounds) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]

/** ¿Cruza el segmento a-b el rectángulo? (recorte de Liang-Barsky) */
function segmentCrosses(ax: number, ay: number, bx: number, by: number, r: Bounds) {
  const dx = bx - ax, dy = by - ay
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, ax - r[0]], [dx, r[2] - ax], [-dy, ay - r[1]], [dy, r[3] - ay]] as const) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
      else { if (t < t0) return false; if (t < t1) t1 = t }
    }
  }
  return true
}

/**
 * ¿Pasa el recorrido por el rectángulo? Que su caja envolvente lo toque no basta: una vuelta
 * alrededor de un pueblo tiene una caja enorme aunque no pase por lo que se está mirando.
 */
export function lineCrosses(coords: number[][], bbox: Bounds | undefined, r: Bounds) {
  if (bbox && (bbox[2] < r[0] || bbox[0] > r[2] || bbox[3] < r[1] || bbox[1] > r[3])) return false
  for (const p of coords) if (inside(p[0]!, p[1]!, r)) return true
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!, b = coords[i]!
    if (segmentCrosses(a[0]!, a[1]!, b[0]!, b[1]!, r)) return true
  }
  return false
}
