import { userId } from '../../utils/auth'
import { FIRST_SYNC, syncRecent } from '../../utils/stravaSync'

// Trae de Strava las actividades nuevas (la primera vez, las FIRST_SYNC más recientes)
export default defineEventHandler(async event => ({ ...(await syncRecent(userId(event))), firstSyncLimit: FIRST_SYNC }))
