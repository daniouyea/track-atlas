// Teselas públicas del heatmap global de Strava (ciclismo). Strava no manda cabeceras CORS y
// MapLibre las necesita, así que pasan por aquí. Sin login en Strava solo hay hasta zoom 12.
const MAX_ZOOM = 12

export default defineEventHandler(async (event) => {
  const [z, x, y] = ['z', 'x', 'y'].map(k => Number(getRouterParam(event, k))) as [number, number, number]
  const n = 2 ** z
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_ZOOM || x < 0 || y < 0 || x >= n || y >= n)
    throw createError({ statusCode: 404, statusMessage: 'Tesela fuera de rango' })
  const host = `heatmap-external-${'abc'[(x + y) % 3]}.strava.com`
  const res = await fetch(`https://${host}/tiles/ride/hot/${z}/${x}/${y}.png?px=256`)
  // sin datos (zonas vacías, 403/404 de Strava): «no hay tesela» y el mapa la deja en blanco, sin ensuciar el log
  if (!res.ok) {
    setResponseStatus(event, 404)
    return ''
  }
  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'private, max-age=604800')
  return Buffer.from(await res.arrayBuffer())
})
