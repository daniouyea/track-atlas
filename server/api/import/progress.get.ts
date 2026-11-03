import { importProgress } from '../../utils/importer'
import { userId } from '../../utils/auth'

export default defineEventHandler(event => importProgress(userId(event)))
