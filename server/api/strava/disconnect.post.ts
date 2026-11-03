import { setSetting } from '../../utils/db'

export default defineEventHandler(() => {
  setSetting('strava_tokens', undefined)
  return { ok: true }
})
