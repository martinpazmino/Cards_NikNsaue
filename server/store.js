// Storage adapters. Rooms and decks are stored as Redis hashes:
//   v = version number (cheap to poll), s = JSON snapshot of the document.
// Writes use compare-and-swap on `v` (a Lua script on Redis) so two players
// acting at the same time can never overwrite each other.
//
// - Redis in production, through either transport:
//   - Upstash REST API: the Vercel Marketplace integration (KV_REST_API_*) or a
//     plain Upstash database (UPSTASH_REDIS_REST_*).
//   - A regular Redis connection string (REDIS_URL), e.g. Redis Cloud.
// - In-memory store for local development and tests.

export class StoreConfigError extends Error {
  constructor() {
    super('STORE_NOT_CONFIGURED')
    this.code = 'STORE_NOT_CONFIGURED'
  }
}

const CREATE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'v', ARGV[1], 's', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`

const CAS_LUA = `
if redis.call('HGET', KEYS[1], 'v') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'v', ARGV[2], 's', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`

function pairsToObject(arr) {
  const out = {}
  if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) out[arr[i]] = Number(arr[i + 1])
  return out
}

// Upstash REST: one HTTP request per command (or per pipeline).
function upstashTransport({ url, token, fetchImpl = globalThis.fetch }) {
  const base = url.replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  async function post(path, body) {
    const res = await fetchImpl(base + path, { method: 'POST', headers, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json) throw new Error(`Redis HTTP ${res.status}: ${json?.error ?? 'bad response'}`)
    return json
  }

  return {
    async call(cmd) {
      const json = await post('/', cmd)
      if (json.error) throw new Error(`Redis: ${json.error}`)
      return json.result
    },
    async pipeline(cmds) {
      const json = await post('/pipeline', cmds)
      return json.map((r) => {
        if (r.error) throw new Error(`Redis: ${r.error}`)
        return r.result
      })
    },
  }
}

// Regular Redis protocol over TCP (redis:// or rediss://). Each function
// instance keeps one connection and reuses it across requests; if the
// connection breaks or a command times out, the next request reconnects.
function tcpTransport({ url, timeout = 4000 }) {
  let connecting = null
  let ErrorReply = null

  function client() {
    connecting ??= (async () => {
      const lib = await import('@redis/client')
      ErrorReply = lib.ErrorReply
      const c = lib.createClient({
        url,
        RESP: 2,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => (retries > 3 ? false : 200 * retries),
        },
      })
      c.on('error', (err) => console.error('Redis connection error:', err.message))
      await c.connect()
      return c
    })().catch((err) => {
      connecting = null
      throw err
    })
    return connecting
  }

  async function call(cmd, retried = false) {
    const pending = client()
    const c = await pending
    if (!c.isOpen && !retried) {
      // The client gave up reconnecting and closed itself: start over once.
      if (connecting === pending) connecting = null
      return call(cmd, true)
    }
    try {
      return await c.sendCommand(cmd.map(String), { timeout })
    } catch (err) {
      // An error reply means Redis ran the command; anything else is the
      // connection. Drop it, unless another request already replaced it.
      if (!(err instanceof ErrorReply) && connecting === pending) {
        connecting = null
        c.destroy()
      }
      throw err
    }
  }

  // Commands sent in the same tick are pipelined by the client.
  return {
    call: (cmd) => call(cmd),
    pipeline: (cmds) => Promise.all(cmds.map((cmd) => call(cmd))),
    async close() {
      const c = await connecting?.catch(() => null)
      connecting = null
      c?.destroy()
    },
  }
}

export function createUpstashStore(options) {
  return redisStore('upstash', upstashTransport(options))
}

export function createTcpStore(options) {
  return redisStore('redis', tcpTransport(options))
}

function redisStore(kind, transport) {
  const { call, pipeline } = transport
  return {
    kind,
    close: () => transport.close?.(),
    async check() {
      await call(['PING'])
    },
    async getVersion(key) {
      const v = await call(['HGET', key, 'v'])
      return v == null ? null : Number(v)
    },
    async getDoc(key) {
      const s = await call(['HGET', key, 's'])
      return s == null ? null : JSON.parse(s)
    },
    async createDoc(key, doc, ttl) {
      doc.v = 1
      return (await call(['EVAL', CREATE_LUA, '1', key, '1', JSON.stringify(doc), String(ttl)])) === 1
    },
    async casDoc(key, expected, doc, ttl) {
      doc.v = expected + 1
      const args = [String(expected), String(doc.v), JSON.stringify(doc), String(ttl)]
      return (await call(['EVAL', CAS_LUA, '1', key, ...args])) === 1
    },
    async getPresence(key) {
      return pairsToObject(await call(['HGETALL', key]))
    },
    // Reads a document plus the presence hash in one round trip, optionally
    // recording that `ping.field` was seen.
    async getDocAndPresence(key, presKey, ping) {
      const cmds = []
      if (ping) cmds.push(['HSET', presKey, ping.field, String(ping.ts)], ['EXPIRE', presKey, String(ping.ttl)])
      cmds.push(['HGET', key, 's'], ['HGETALL', presKey])
      const out = await pipeline(cmds)
      const [s, pres] = out.slice(-2)
      return { doc: s == null ? null : JSON.parse(s), presence: pairsToObject(pres) }
    },
    async ping(presKey, field, ts, ttl) {
      await pipeline([['HSET', presKey, field, String(ts)], ['EXPIRE', presKey, String(ttl)]])
    },
    async touch(key, ttl) {
      await call(['EXPIRE', key, String(ttl)])
    },
  }
}

export function createMemoryStore({ clock = Date.now } = {}) {
  const data = new Map()

  function entry(key) {
    const e = data.get(key)
    if (!e) return null
    if (e.exp && e.exp <= clock()) {
      data.delete(key)
      return null
    }
    return e
  }

  function hash(key, ttl) {
    let e = entry(key)
    if (!e) {
      e = { h: new Map(), exp: null }
      data.set(key, e)
    }
    if (ttl) e.exp = clock() + ttl * 1000
    return e.h
  }

  const read = (key) => {
    const s = entry(key)?.h.get('s')
    return s == null ? null : JSON.parse(s)
  }

  return {
    kind: 'memory',
    async close() {},
    async check() {},
    async getVersion(key) {
      const v = entry(key)?.h.get('v')
      return v == null ? null : Number(v)
    },
    async getDoc(key) {
      return read(key)
    },
    async createDoc(key, doc, ttl) {
      if (entry(key)) return false
      doc.v = 1
      const h = hash(key, ttl)
      h.set('v', '1')
      h.set('s', JSON.stringify(doc))
      return true
    },
    async casDoc(key, expected, doc, ttl) {
      const e = entry(key)
      if (!e || e.h.get('v') !== String(expected)) return false
      doc.v = expected + 1
      const h = hash(key, ttl)
      h.set('v', String(doc.v))
      h.set('s', JSON.stringify(doc))
      return true
    },
    async getPresence(key) {
      return Object.fromEntries([...(entry(key)?.h ?? new Map())].map(([k, v]) => [k, Number(v)]))
    },
    async getDocAndPresence(key, presKey, ping) {
      if (ping) hash(presKey, ping.ttl).set(ping.field, String(ping.ts))
      return { doc: read(key), presence: await this.getPresence(presKey) }
    },
    async ping(presKey, field, ts, ttl) {
      hash(presKey, ttl).set(field, String(ts))
    },
    async touch(key, ttl) {
      const e = entry(key)
      if (e) e.exp = clock() + ttl * 1000
    },
  }
}

export function storeFromEnv(env = process.env) {
  const restUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const restToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  if (restUrl && restToken) return createUpstashStore({ url: restUrl, token: restToken })
  const redisUrl = env.REDIS_URL || env.KV_URL
  if (redisUrl) return createTcpStore({ url: redisUrl })
  // On Vercel every request may hit a different instance, so memory won't do.
  if (env.VERCEL) throw new StoreConfigError()
  return createMemoryStore()
}
