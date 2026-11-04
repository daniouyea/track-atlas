import { userId } from '../../utils/auth'
import { syncStatus } from '../../utils/stravaSync'

export default defineEventHandler(event => syncStatus(userId(event)))
