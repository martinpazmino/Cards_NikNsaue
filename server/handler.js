// Single HTTP entry point for the whole API (Node req/res). Used by the Vercel
// Function in api/index.js and by the local dev/preview servers.
//
//   GET  /api/health                 database configured and reachable?
//   POST /api/rooms                  create a room   {name, avatar, deckId?}
//   POST /api/rooms/:code/join       join a room     {name, avatar}
//   GET  /api/rooms/:code/v          room version (CDN-cached for 1s, polled)
//   GET  /api/rooms/:code            personalized state (auth headers, x-ping: 1)
//   POST /api/rooms/:code/action     game action     {type, ...}
//   POST /api/decks                  create a group deck
//   GET  /api/decks/:id              read a group deck
//   POST /api/decks/:id              edit a group deck {type: add|remove|rename}

import { GameError } from '../shared/game.js'
import { createService } from './rooms.js'
import { StoreConfigError, storeFromEnv } from './store.js'

const MAX_BODY = 32 * 1024

function getService() {
  if (!globalThis.__sinverguenzas) globalThis.__sinverguenzas = createService({ store: storeFromEnv() })
  return globalThis.__sinverguenzas
}

function send(res, status, body, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  // Vercel's Node runtime pre-parses JSON bodies; plain Node gives us a stream.
  if (req.body !== undefined) {
    if (req.body === null || req.body === '') return {}
    if (typeof req.body === 'string') return JSON.parse(req.body)
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {}
    return req.body
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new GameError('TOO_LARGE', 413)
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

// Vercel rewrites /api/* to /api?route=*; locally we get the original path.
function routeOf(req) {
  const url = new URL(req.url, 'http://localhost')
  let path = url.pathname
  const rewritten = url.searchParams.get('route')
  if (rewritten !== null && /^\/api\/?$/.test(path)) path = `/api/${rewritten}`
  return { segments: path.replace(/^\/api\/?/, '').split('/').filter(Boolean), url }
}

function auth(req) {
  return { pid: req.headers['x-player-id'], token: req.headers['x-player-token'] }
}

export default async function handler(req, res) {
  try {
    const { segments: seg, url } = routeOf(req)
    const m = req.method
    const [a, b, c] = seg

    if (a === 'health' && seg.length === 1 && m === 'GET') {
      const svc = getService()
      try {
        await svc.check()
      } catch (err) {
        console.error('Database check failed:', err.message)
        return send(res, 503, { error: 'STORE_UNREACHABLE' })
      }
      return send(res, 200, { ok: true, store: svc.storeKind })
    }

    if (a === 'rooms') {
      const svc = getService()
      if (seg.length === 1 && m === 'POST') return send(res, 201, await svc.createRoom(await readJson(req)))
      if (seg.length === 2 && m === 'GET') {
        // Presence ping as a header: always survives the Vercel rewrite.
        const ping = req.headers['x-ping'] === '1' || url.searchParams.get('ping') === '1'
        return send(res, 200, await svc.state(b, auth(req), { ping }))
      }
      if (seg.length === 3 && c === 'v' && m === 'GET') {
        // Everyone in a room polls this URL; the CDN serves it for 1s so a
        // full room costs about one function call per second.
        return send(res, 200, await svc.version(b), { 'Vercel-CDN-Cache-Control': 'max-age=1' })
      }
      if (seg.length === 3 && c === 'join' && m === 'POST') return send(res, 200, await svc.join(b, await readJson(req)))
      if (seg.length === 3 && c === 'action' && m === 'POST') {
        return send(res, 200, await svc.act(b, auth(req), await readJson(req)))
      }
    }

    if (a === 'decks') {
      const svc = getService()
      if (seg.length === 1 && m === 'POST') return send(res, 201, await svc.createDeck(await readJson(req)))
      if (seg.length === 2 && m === 'GET') return send(res, 200, await svc.getDeck(b))
      if (seg.length === 2 && m === 'POST') return send(res, 200, await svc.deckAction(b, await readJson(req)))
    }

    return send(res, 404, { error: 'NOT_FOUND' })
  } catch (err) {
    if (err instanceof GameError) return send(res, err.status, { error: err.code })
    if (err instanceof SyntaxError) return send(res, 400, { error: 'BAD_JSON' })
    if (err instanceof StoreConfigError) return send(res, 500, { error: 'STORE_NOT_CONFIGURED' })
    console.error(err)
    return send(res, 500, { error: 'SERVER_ERROR' })
  }
}
