// Vercel Function: every /api/* request is rewritten here (see vercel.json).
import handler from '../server/handler.js'

export const config = { maxDuration: 10 }

export default handler
