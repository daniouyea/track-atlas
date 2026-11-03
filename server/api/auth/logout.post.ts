import { useAppSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await (await useAppSession(event)).clear()
  return { ok: true }
})
