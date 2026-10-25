// Integration test for the Upstash adapter against a real redis-server,
// through a tiny shim that speaks the Upstash REST protocol. Skipped when
// redis-server is not installed.

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { StoreConfigError, createTcpStore, createUpstashStore, storeFromEnv } from '../server/store.js'
import { createService } from '../server/rooms.js'

const hasRedis = spawnSync('redis-server', ['--version']).status === 0

class RespError extends Error {}

function resp(port) {
  const sock = net.connect(port, '127.0.0.1')
  let buf = Buffer.alloc(0)
  const queue = []
  const parse = (b, i) => {
    if (i >= b.length) return null
    const nl = b.indexOf('\r\n', i)
    if (nl < 0) return null
    const type = String.fromCharCode(b[i])
    const line = b.toString('utf8', i + 1, nl)
    const next = nl + 2
    if (type === '+') return { value: line, end: next }
    if (type === '-') return { value: new RespError(line), end: next }
    if (type === ':') return { value: Number(line), end: next }
    if (type === '$') {
      const len = Number(line)
      if (len < 0) return { value: null, end: next }
      if (b.length < next + len + 2) return null
      return { value: b.toString('utf8', next, next + len), end: next + len + 2 }
    }
    const n = Number(line)
    if (n < 0) return { value: null, end: next }
    const arr = []
    let j = next
    for (let k = 0; k < n; k++) {
      const r = parse(b, j)
      if (!r) return null
      arr.push(r.value)
      j = r.end
    }
    return { value: arr, end: j }
  }
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    while (queue.length) {
      const r = parse(buf, 0)
      if (!r) break
      buf = buf.subarray(r.end)
      queue.shift()(r.value)
    }
  })
  return {
    ready: new Promise((resolve, reject) => {
      sock.once('connect', resolve)
      sock.once('error', reject)
    }),
    send(args) {
      return new Promise((resolve) => {
        queue.push(resolve)
        let out = `*${args.length}\r\n`
        for (const a of args) {
          const s = String(a)
          out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`
        }
        sock.write(out)
      })
    },
    close: () => sock.destroy(),
  }
}

async function freePort() {
  const srv = net.createServer()
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address()
  await new Promise((resolve) => srv.close(resolve))
  return port
}

async function startRedis() {
  const port = await freePort()
  const proc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      const c = resp(port)
      await c.ready
      return { port, proc, client: c }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  proc.kill()
  throw new Error('redis-server did not start')
}

// Minimal Upstash REST: POST / (one command) and POST /pipeline.
async function startShim(client, token) {
  const toResult = (v) => (v instanceof RespError ? { error: v.message } : { result: v })
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }
    if (req.url === '/pipeline') {
      const out = []
      for (const cmd of body) out.push(toResult(await client.send(cmd)))
      return res.end(JSON.stringify(out))
    }
    const r = toResult(await client.send(body))
    if (r.error) res.statusCode = 400
    return res.end(JSON.stringify(r))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

// The same checks for every transport; `k` namespaces keys per transport.
async function storeSuite(t, store, redis, k) {
  await t.test('create is atomic and versioned', async () => {
    assert.equal(await store.createDoc(`room:${k}`, { a: 1 }, 60), true)
    assert.equal(await store.createDoc(`room:${k}`, { a: 2 }, 60), false)
    assert.equal(await store.getVersion(`room:${k}`), 1)
    assert.deepEqual(await store.getDoc(`room:${k}`), { a: 1, v: 1 })
    assert.equal(await store.getVersion(`room:${k}NOPE`), null)
    assert.equal(await store.getDoc(`room:${k}NOPE`), null)
  })

  await t.test('compare-and-swap rejects stale writes and sets the TTL', async () => {
    assert.equal(await store.casDoc(`room:${k}`, 7, { a: 3 }, 60), false)
    assert.equal(await store.casDoc(`room:${k}`, 1, { a: 3 }, 120), true)
    assert.equal(await store.casDoc(`room:${k}`, 1, { a: 4 }, 120), false)
    assert.deepEqual(await store.getDoc(`room:${k}`), { a: 3, v: 2 })
    const ttl = await redis.client.send(['TTL', `room:${k}`])
    assert.ok(ttl > 100 && ttl <= 120)
  })

  await t.test('presence pings and combined reads', async () => {
    await store.ping(`seen:${k}`, 'p1', 1234, 60)
    const { doc, presence } = await store.getDocAndPresence(`room:${k}`, `seen:${k}`, { field: 'p2', ts: 5678, ttl: 60 })
    assert.equal(doc.a, 3)
    assert.deepEqual(presence, { p1: 1234, p2: 5678 })
    assert.deepEqual(await store.getPresence(`seen:${k}`), { p1: 1234, p2: 5678 })
    await store.touch(`room:${k}`, 30)
    assert.ok((await redis.client.send(['TTL', `room:${k}`])) <= 30)
  })

  await t.test('eight players submitting at once all land', async () => {
    const svc = createService({ store })
    const host = await svc.createRoom({ name: 'P0', avatar: '🌮' })
    const players = [host]
    for (let i = 1; i < 8; i++) players.push(await svc.join(host.code, { name: `P${i}`, avatar: '🦜' }))
    const auth = (p) => ({ pid: p.playerId, token: p.token })
    await svc.act(host.code, auth(host), { type: 'start' })
    const views = await Promise.all(players.map((p) => svc.state(host.code, auth(p), { ping: true })))
    const judgeId = views[0].round.judgeId
    const pick = views[0].round.prompt.pick
    await Promise.all(
      players
        .map((p, i) => [p, views[i]])
        .filter(([, v]) => v.me.id !== judgeId)
        .map(([p, v]) => svc.act(host.code, auth(p), { type: 'submit', cards: v.me.hand.slice(0, pick).map((c) => c.id) })),
    )
    const after = await svc.state(host.code, auth(host))
    assert.equal(after.phase, 'judging')
    assert.equal(after.round.subs.length, 7)
  })
}

test('Redis stores against a real redis-server', { skip: !hasRedis && 'redis-server not installed' }, async (t) => {
  const redis = await startRedis()
  const shim = await startShim(redis.client, 'secret')
  const upstash = createUpstashStore({ url: shim.url, token: 'secret' })
  const tcp = createTcpStore({ url: `redis://127.0.0.1:${redis.port}` })
  try {
    await t.test('Upstash REST transport', (t) => storeSuite(t, upstash, redis, 'U'))
    await t.test('REDIS_URL (TCP) transport', (t) => storeSuite(t, tcp, redis, 'T'))

    await t.test('wrong token is rejected by the REST layer', async () => {
      const bad = createUpstashStore({ url: shim.url, token: 'wrong' })
      await assert.rejects(bad.getVersion('room:U'), /401/)
    })

    await t.test('TCP store recovers when the server drops the connection', async () => {
      assert.equal(await tcp.getVersion('room:T'), 2)
      // Kill every client connection except the harness's own.
      await redis.client.send(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes'])
      let v = null
      for (let i = 0; i < 5 && v === null; i++) {
        v = await tcp.getVersion('room:T').catch(() => null)
        if (v === null) await new Promise((r) => setTimeout(r, 100))
      }
      assert.equal(v, 2)
    })
  } finally {
    await tcp.close()
    await shim.close()
    redis.client.close()
    redis.proc.kill()
  }
})

test('the store is chosen from environment variables', () => {
  const rest = { KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 't' }
  assert.equal(storeFromEnv({ ...rest, REDIS_URL: 'redis://localhost:1' }).kind, 'upstash')
  assert.equal(storeFromEnv({ REDIS_URL: 'redis://localhost:1' }).kind, 'redis')
  assert.equal(storeFromEnv({ KV_URL: 'rediss://localhost:1' }).kind, 'redis')
  assert.equal(storeFromEnv({}).kind, 'memory')
  assert.throws(() => storeFromEnv({ VERCEL: '1' }), StoreConfigError)
})
