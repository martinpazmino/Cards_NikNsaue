// Builds the per-player view of a room. This is the only shape the client
// ever sees: no tokens, no other hands, and submissions stay anonymous until
// the judge picks a winner.

import { PACK_INFO } from './cards/index.js'
import { ONLINE_MS } from './constants.js'
import { cardById, isAuthor, isInGame, waitingFor } from './game.js'

function answerView(s, c) {
  if (typeof c !== 'string') return { text: c.w, w: true }
  const card = cardById(s, c)
  if (!card) return { id: c, text: '…' }
  return c.startsWith('u.') ? { id: c, text: card.text, by: card.by || null } : { id: c, text: card.text }
}

function promptView(s, id) {
  const card = cardById(s, id)
  if (!card) return { id, text: '…', pick: 1 }
  const v = { id, text: card.text, pick: card.pick || 1 }
  if (id.startsWith('u.')) v.by = card.by || null
  return v
}

export function viewFor(s, pid, { now = Date.now(), presence = {} } = {}) {
  const me = s.players.find((p) => p.id === pid) || null
  const inGame = isInGame(s.phase)
  const r = inGame ? s.round : null
  const waiting = new Set(waitingFor(s).map((p) => p.id))

  const players = s.players.map((p) => {
    const seen = presence[p.id]
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      score: p.score,
      bot: !!p.bot,
      host: p.id === s.hostId,
      judge: !!r && r.judgeId === p.id,
      played: !!r && s.phase === 'picking' && r.subs.some((x) => x.pid === p.id),
      waiting: waiting.has(p.id),
      online: p.bot ? true : seen ? now - seen < ONLINE_MS : null,
    }
  })

  let round = null
  if (r) {
    const open = s.phase !== 'picking'
    const mine = r.subs.find((x) => x.pid === pid)
    round = {
      n: r.n,
      judgeId: r.judgeId,
      prompt: promptView(s, r.prompt),
      deadline: r.deadline,
      nextAt: r.nextAt,
      played: r.subs.length,
      waiting: waiting.size,
      focus: open ? r.focus : null,
      winner: s.phase === 'result' ? r.winner : null,
      mine: mine ? { id: mine.id, cards: mine.cards.map((c) => answerView(s, c)) } : null,
      subs: open
        ? r.subs.map((x) => {
            const visible = x.shown || s.phase === 'result'
            return {
              id: x.id,
              shown: visible,
              count: x.cards.length,
              cards: visible ? x.cards.map((c) => answerView(s, c)) : null,
              pid: s.phase === 'result' ? x.pid : null,
            }
          })
        : null,
    }
  }

  const active = Object.values(s.custom).filter((c) => !c.gone)
  const authors = {}
  for (const c of active) {
    const key = c.by || '?'
    authors[key] = (authors[key] || 0) + 1
  }

  return {
    code: s.code,
    v: s.v,
    now,
    phase: s.phase,
    hostId: s.hostId,
    settings: s.settings,
    deck: s.deck,
    players,
    champion: s.phase === 'over' ? s.champion : null,
    round,
    me: me
      ? {
          id: me.id,
          name: me.name,
          avatar: me.avatar,
          color: me.color,
          host: me.id === s.hostId,
          judge: !!r && r.judgeId === me.id,
          hand: inGame ? me.hand.map((c) => answerView(s, c)) : [],
          blanks: me.blanks,
        }
      : null,
    custom: {
      prompts: active.filter((c) => c.t === 'p').length,
      answers: active.filter((c) => c.t === 'a').length,
      authors: Object.entries(authors).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
      mine: me
        ? active
            .filter((c) => isAuthor(c, me))
            .sort((a, b) => b.at - a.at)
            .map((c) => ({ id: c.id, t: c.t, text: c.text, pick: c.pick }))
        : [],
    },
    history: s.phase === 'over' ? s.history : s.history.slice(-1),
    rounds: s.history.length,
    packs: s.phase === 'lobby' ? PACK_INFO : null,
    events: s.events.slice(-12),
  }
}
