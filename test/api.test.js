import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import handler from '../server/handler.js'

// Runs the real HTTP handler (in-memory store) on a random port.
async function startServer({ vercelRewrite = false } = {}) {
  const server = http.createServer((req, res) => {
    if (vercelRewrite) {
      const url = new URL(req.url, 'http://x')
      if (url.pathname.startsWith('/api/')) {
        const extra = url.search ? `&${url.search.slice(1)}` : ''
        req.url = `/api?route=${encodeURIComponent(url.pathname.slice(5))}${extra}`
      }
    }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function call(method, path, { body, as, headers: extra } = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra }
    if (as) Object.assign(headers, { 'x-player-id': as.playerId, 'x-player-token': as.token })
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, headers: res.headers, json: await res.json() }
  }
  return { call, base, close: () => new Promise((resolve) => server.close(resolve)) }
}

for (const vercelRewrite of [false, true]) {
  test(`full round over HTTP (${vercelRewrite ? 'Vercel rewrite URLs' : 'direct URLs'})`, async () => {
    const { call, close } = await startServer({ vercelRewrite })
    try {
      assert.deepEqual((await call('GET', '/api/health')).json, { ok: true, store: 'memory' })

      const created = await call('POST', '/api/rooms', { body: { name: 'Ana', avatar: '🌮' } })
      assert.equal(created.status, 201)
      const { code } = created.json
      assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
      const ana = created.json

      const players = [ana]
      for (const name of ['Beto', 'Caro', 'Dani']) {
        const r = await call('POST', `/api/rooms/${code.toLowerCase()}/join`, { body: { name, avatar: '🦜' } })
        assert.equal(r.status, 200)
        players.push(r.json)
      }
      const dup = await call('POST', `/api/rooms/${code}/join`, { body: { name: 'ana', avatar: '🦜' } })
      assert.equal(dup.status, 409)
      assert.equal(dup.json.error, 'NAME_TAKEN')

      const v1 = await call('GET', `/api/rooms/${code}/v`)
      assert.equal(v1.status, 200)
      assert.equal(v1.headers.get('vercel-cdn-cache-control'), 'max-age=1')

      // Personal card added from the lobby creates the group deck.
      const added = await call('POST', `/api/rooms/${code}/action`, {
        as: players[1],
        body: { type: 'addCard', t: 'a', text: 'el carro de Ana' },
      })
      assert.equal(added.status, 200)
      assert.equal(added.json.state.custom.mine.length, 1)
      const deckId = added.json.state.deck.id
      assert.ok(deckId)

      const start = await call('POST', `/api/rooms/${code}/action`, { as: ana, body: { type: 'start' } })
      assert.equal(start.status, 200)
      assert.equal(start.json.state.phase, 'picking')

      // Everybody plays at the same time: CAS retries must keep every play.
      const states = await Promise.all(players.map((p) => call('GET', `/api/rooms/${code}`, { as: p, headers: { 'x-ping': '1' } })))
      const judgeId = states[0].json.round.judgeId
      const pick = states[0].json.round.prompt.pick
      const plays = await Promise.all(
        players
          .map((p, i) => ({ p, me: states[i].json.me }))
          .filter(({ me }) => me.id !== judgeId)
          .map(({ p, me }) =>
            call('POST', `/api/rooms/${code}/action`, {
              as: p,
              body: { type: 'submit', cards: me.hand.slice(0, pick).map((c) => c.id) },
            }),
          ),
      )
      for (const r of plays) assert.equal(r.status, 200, JSON.stringify(r.json))

      const judge = players.find((p) => p.playerId === judgeId)
      const judging = (await call('GET', `/api/rooms/${code}`, { as: judge })).json
      assert.equal(judging.phase, 'judging')
      assert.equal(judging.round.subs.length, 3)
      assert.ok(judging.players.every((p) => p.online === true))

      const notJudge = players.find((p) => p.playerId !== judgeId)
      const forbidden = await call('POST', `/api/rooms/${code}/action`, {
        as: notJudge,
        body: { type: 'reveal', subId: judging.round.subs[0].id },
      })
      assert.equal(forbidden.status, 403)

      const subId = judging.round.subs[1].id
      await call('POST', `/api/rooms/${code}/action`, { as: judge, body: { type: 'reveal', subId } })
      const picked = await call('POST', `/api/rooms/${code}/action`, { as: judge, body: { type: 'pick', subId } })
      assert.equal(picked.json.state.phase, 'result')
      assert.ok(picked.json.state.round.subs.every((s) => s.pid))

      const v2 = await call('GET', `/api/rooms/${code}/v`)
      assert.ok(v2.json.v > v1.json.v)

      // Bad credentials are rejected.
      const bad = await call('GET', `/api/rooms/${code}`, { as: { playerId: ana.playerId, token: 'nope' } })
      assert.equal(bad.status, 403)
      assert.equal((await call('GET', '/api/rooms/AAAA/v')).status, 404)
      assert.equal((await call('GET', '/api/rooms/ZZZZ/v')).status, 404)

      // The group deck keeps the card and seeds a new room.
      const deck = await call('GET', `/api/decks/${deckId}`)
      assert.equal(deck.status, 200)
      assert.deepEqual(deck.json.cards.map((c) => c.text), ['el carro de Ana'])
      const room2 = await call('POST', '/api/rooms', { body: { name: 'Beto', avatar: '🦜', deckId } })
      assert.equal(room2.json.state.custom.answers, 1)
      assert.equal(room2.json.state.custom.mine.length, 1, 'cards are matched to their author by name')
    } finally {
      await close()
    }
  })
}

test('group deck page API: create, add, remove, rename', async () => {
  const { call, close } = await startServer()
  try {
    const created = await call('POST', '/api/decks', { body: { name: 'Los Panas' } })
    assert.equal(created.status, 201)
    const id = created.json.id
    const add = await call('POST', `/api/decks/${id}`, { body: { type: 'add', t: 'p', text: '¿Por qué Luis nunca contesta?', by: 'Ana' } })
    assert.equal(add.json.cards.length, 1)
    assert.equal(add.json.cards[0].pick, 1)
    const dup = await call('POST', `/api/decks/${id}`, { body: { type: 'add', t: 'p', text: '¿por qué luis nunca contesta?', by: 'Beto' } })
    assert.equal(dup.status, 409)
    const renamed = await call('POST', `/api/decks/${id}`, { body: { type: 'rename', name: 'Los Panas 🇪🇨' } })
    assert.equal(renamed.json.name, 'Los Panas 🇪🇨')
    const removed = await call('POST', `/api/decks/${id}`, { body: { type: 'remove', id: add.json.cards[0].id } })
    assert.equal(removed.json.cards.length, 0)
    assert.equal((await call('GET', '/api/decks/nope!')).status, 404)
    assert.equal((await call('POST', '/api/rooms', { body: { name: 'X', deckId: 'zzzzzzzzzz' } })).status, 404)
  } finally {
    await close()
  }
})

test('bad requests get clean errors', async () => {
  const { call, base, close } = await startServer()
  try {
    assert.equal((await call('POST', '/api/rooms', { body: { name: '   ' } })).json.error, 'NAME_REQUIRED')
    assert.equal((await call('GET', '/api/nothing')).status, 404)
    const res = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error, 'BAD_JSON')
  } finally {
    await close()
  }
})
