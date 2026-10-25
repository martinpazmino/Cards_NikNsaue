import { addPlayer, applyAction, cardById, createRoomState } from '../shared/game.js'

// Deterministic PRNG (mulberry32).
export function seeded(seed = 42) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRoom(names = ['Ana', 'Beto', 'Caro', 'Dani'], { seed = 1, settings = {} } = {}) {
  const rng = seeded(seed)
  const clock = { now: 1_000_000 }
  const ctx = (extra = {}) => ({ now: clock.now, rng, ...extra })
  const s = createRoomState({ code: 'BCDF', now: clock.now })
  const ids = names.map((name, i) => addPlayer(s, { id: `p${i}`, token: `t${i}`, name, avatar: '🌮' }, ctx()).id)
  const act = (pid, action, extra) => applyAction(s, pid, action, ctx(extra))
  if (Object.keys(settings).length) act(ids[0], { type: 'settings', patch: settings })
  return { s, ids, act, clock, ctx, rng }
}

export const cardPick = (s) => cardById(s, s.round.prompt)?.pick || 1
export const nonJudges = (s) => s.players.filter((p) => !p.bot && p.id !== s.round.judgeId)

// Every non-judge plays the first cards of their hand.
export function everyonePlays({ s, act }) {
  const pick = cardPick(s)
  for (const p of nonJudges(s)) {
    if (s.phase !== 'picking') break
    if (s.round.subs.some((x) => x.pid === p.id)) continue
    act(p.id, { type: 'submit', cards: p.hand.slice(0, pick) })
  }
}

// Reveals every submission and picks the first one.
export function judgeFirst({ s, act }) {
  const judge = s.round.judgeId
  for (const sub of s.round.subs) act(judge, { type: 'reveal', subId: sub.id })
  act(judge, { type: 'pick', subId: s.round.subs[0].id })
}

// Counts answer-card ids wherever they currently live (piles, hands, table).
export function answerCardCount(s) {
  let n = s.piles.a.length + s.discard.a.length
  for (const p of s.players) n += p.hand.length
  if (s.round) for (const sub of s.round.subs) n += sub.cards.filter((c) => typeof c === 'string').length
  return n
}
