// Pure game engine. Every function mutates the room state passed in; the
// server clones the stored state, applies an action and saves it atomically.
// Randomness and time come from ctx ({ now, rng }) so tests are deterministic.

import { PACKS, builtinCard } from './cards/index.js'
import {
  AVATARS, COLORS, DEFAULT_SETTINGS, LIMITS, RANDO, RANDO_ID, RESULT_MS, SETTING_OPTIONS,
} from './constants.js'
import { cleanText, countBlanks, normalizePrompt, pickCount } from './text.js'

export const NO_CHANGE = Symbol('no-change')

export class GameError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function fail(code, status) {
  throw new GameError(code, status)
}

const IN_GAME = new Set(['picking', 'judging', 'result'])
export const isInGame = (phase) => IN_GAME.has(phase)

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export function randomId(rng, len = 8) {
  let id = ''
  for (let i = 0; i < len; i++) id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)]
  return id
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export const humans = (s) => s.players.filter((p) => !p.bot)
export const playerById = (s, id) => s.players.find((p) => p.id === id) || null

const sameName = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')

export function findByName(s, name) {
  return s.players.find((p) => !p.bot && sameName(p.name, name)) || null
}

export function isAuthor(card, player) {
  return card.byId === player.id || (!!card.by && sameName(card.by, player.name))
}

function pushEvent(s, k, data, now) {
  s.evSeq += 1
  s.events.push({ id: s.evSeq, at: now, k, ...data })
  if (s.events.length > 20) s.events.shift()
}

// ---------------------------------------------------------------- cards

export function cardById(s, id) {
  if (typeof id !== 'string') return null
  return id.startsWith('u.') ? s.custom[id] || null : builtinCard(id)
}

const promptPick = (s, id) => cardById(s, id)?.pick || 1
const isGone = (s, id) => !!s.custom[id]?.gone

export function answerText(s, c) {
  return typeof c === 'string' ? cardById(s, c)?.text ?? '…' : c.w
}

function drawFrom(s, kind, ctx) {
  if (!s.piles[kind].length && s.discard[kind].length) {
    s.piles[kind] = shuffle(s.discard[kind].filter((id) => !isGone(s, id)), ctx.rng)
    s.discard[kind] = []
  }
  return s.piles[kind].shift() ?? null
}

// Custom cards go near the top of the pile when "boost" is on, mixed with
// `ratio` built-in cards per custom card, so inside jokes actually show up.
function mix(builtin, custom, ratio, rng) {
  const b = shuffle([...builtin], rng)
  const c = shuffle([...custom], rng)
  if (!ratio || !c.length) return shuffle([...b, ...c], rng)
  const front = b.splice(0, Math.ceil(c.length * ratio))
  return [...shuffle([...c, ...front], rng), ...b]
}

function buildPiles(s, ctx) {
  const packs = s.settings.packs.filter((id) => PACKS[id])
  const customs = s.settings.custom ? Object.values(s.custom).filter((c) => !c.gone) : []
  const boost = s.settings.boost
  s.piles = {
    p: mix(packs.flatMap((id) => PACKS[id].prompts.map((c) => c.id)), customs.filter((c) => c.t === 'p').map((c) => c.id), boost ? 1 : 0, ctx.rng),
    a: mix(packs.flatMap((id) => PACKS[id].answers.map((c) => c.id)), customs.filter((c) => c.t === 'a').map((c) => c.id), boost ? 1.5 : 0, ctx.rng),
  }
  s.discard = { p: [], a: [] }
}

function dealHand(s, p, ctx) {
  while (p.hand.length < s.settings.handSize) {
    const id = drawFrom(s, 'a', ctx)
    if (!id) break
    p.hand.push(id)
  }
}

// Validates and normalizes the text of a custom card ('p' prompt / 'a' answer).
export function validateCardText(t, rawText) {
  if (t === 'p') {
    const text = normalizePrompt(rawText)
    if (text.length < LIMITS.promptMin) fail('TOO_SHORT')
    if (text.length > LIMITS.promptMax) fail('TOO_LONG')
    if (countBlanks(text) > LIMITS.maxBlanks) fail('TOO_MANY_BLANKS')
    return { text, pick: pickCount(text) }
  }
  if (t === 'a') {
    const text = cleanText(rawText).replace(/\.$/, '')
    if (!text) fail('EMPTY_CARD')
    if (text.length > LIMITS.answerMax) fail('TOO_LONG')
    if (countBlanks(text)) fail('ANSWER_BLANK')
    return { text }
  }
  return fail('BAD_REQUEST')
}

export function isDuplicateCard(cards, t, text) {
  return cards.some((c) => !c.gone && c.t === t && sameName(c.text, text))
}

export function makeCustomCard(s, author, t, rawText, ctx) {
  const { text, pick } = validateCardText(t, rawText)
  const cards = Object.values(s.custom)
  if (cards.filter((c) => !c.gone).length >= LIMITS.customPerRoom) fail('TOO_MANY_CARDS', 409)
  if (isDuplicateCard(cards, t, text)) fail('DUPLICATE', 409)
  const card = { id: `u.${randomId(ctx.rng, 9)}`, t, text, by: author.name, byId: author.id, at: ctx.now }
  if (pick) card.pick = pick
  return card
}

function insertCustom(s, card, ctx) {
  s.custom[card.id] = card
  if (!s.piles || !s.settings.custom) return
  const pile = s.piles[card.t]
  const span = s.settings.boost ? Math.ceil(pile.length / 3) + 1 : pile.length + 1
  pile.splice(Math.floor(ctx.rng() * span), 0, card.id)
}

// Cards saved in the group's persistent deck (added from other rooms or the deck page).
export function mergeDeckCards(s, cards) {
  for (const c of cards || []) {
    if (!c || typeof c.id !== 'string' || !c.id.startsWith('u.') || s.custom[c.id]) continue
    if (c.t !== 'p' && c.t !== 'a') continue
    const card = { id: c.id, t: c.t, text: c.text, by: c.by || '', byId: null, at: c.at || 0 }
    if (c.t === 'p') card.pick = pickCount(c.text)
    s.custom[c.id] = card
  }
}

// ---------------------------------------------------------------- room & players

export function createRoomState({ code, now }) {
  return {
    code,
    v: 0,
    createdAt: now,
    updatedAt: now,
    hostId: null,
    settings: { ...DEFAULT_SETTINGS, packs: [...DEFAULT_SETTINGS.packs] },
    deck: { id: null, name: '' },
    players: [],
    custom: {},
    phase: 'lobby',
    round: null,
    piles: null,
    discard: null,
    history: [],
    champion: null,
    events: [],
    evSeq: 0,
  }
}

export function validateName(name) {
  const n = Array.from(cleanText(name)).slice(0, LIMITS.nameMax).join('').trim()
  if (!n) fail('NAME_REQUIRED')
  return n
}

export const validateAvatar = (a) => (AVATARS.includes(a) ? a : AVATARS[0])

function nextColor(s) {
  const used = new Set(s.players.map((p) => p.color))
  return COLORS.find((c) => !used.has(c)) || COLORS[s.players.length % COLORS.length]
}

export function addPlayer(s, { id, token, name, avatar }, ctx) {
  if (humans(s).length >= LIMITS.maxPlayers) fail('ROOM_FULL', 409)
  const player = {
    id, token, name, avatar, color: nextColor(s), score: 0, joinedAt: ctx.now, hand: [], blanks: s.settings.blanks,
  }
  const botIndex = s.players.findIndex((p) => p.bot)
  if (botIndex >= 0) s.players.splice(botIndex, 0, player)
  else s.players.push(player)
  if (!s.hostId) s.hostId = id
  if (isInGame(s.phase)) dealHand(s, player, ctx)
  pushEvent(s, 'join', { name, avatar }, ctx.now)
  return player
}

// Joining with the name of a player who went offline takes over their seat
// (same hand and score). Handy when someone reopens the link in another browser.
export function joinPlayer(s, { id, token, name, avatar }, ctx, isOnline) {
  const n = validateName(name)
  const av = validateAvatar(avatar)
  const existing = findByName(s, n)
  if (existing) {
    if (isOnline(existing)) fail('NAME_TAKEN', 409)
    existing.token = token
    existing.avatar = av
    pushEvent(s, 'back', { name: existing.name, avatar: av }, ctx.now)
    return { player: existing, reclaimed: true }
  }
  return { player: addPlayer(s, { id, token, name: n, avatar: av }, ctx), reclaimed: false }
}

function syncBot(s) {
  const bot = s.players.find((p) => p.bot)
  if (s.settings.rando && !bot) {
    s.players.push({
      id: RANDO_ID, name: RANDO.name, avatar: RANDO.avatar, color: '#9ca3af', score: 0, bot: true, hand: [], blanks: 0, joinedAt: 0,
    })
  } else if (!s.settings.rando && bot) {
    s.players = s.players.filter((p) => !p.bot)
  }
}

function removePlayer(s, pid, ctx) {
  const idx = s.players.findIndex((p) => p.id === pid)
  if (idx < 0) return
  const p = s.players[idx]
  const r = s.round
  const inGame = isInGame(s.phase)
  if (inGame && r) {
    const hIdx = humans(s).findIndex((h) => h.id === pid)
    if (hIdx >= 0 && hIdx < r.judgeIdx) r.judgeIdx -= 1
    if (s.phase !== 'result') {
      const si = r.subs.findIndex((x) => x.pid === pid)
      if (si >= 0) {
        const [sub] = r.subs.splice(si, 1)
        for (const c of sub.cards) if (typeof c === 'string') s.discard.a.push(c)
        if (r.focus === sub.id) r.focus = null
      }
    }
  }
  if (s.discard) s.discard.a.push(...p.hand)
  s.players.splice(idx, 1)
  if (s.hostId === pid) {
    s.hostId = humans(s)[0]?.id ?? null
    if (s.hostId) pushEvent(s, 'host', { name: playerById(s, s.hostId).name }, ctx.now)
  }
  if (!inGame) return
  if (humans(s).length < 2 || s.players.length < 3) return abortGame(s, ctx)
  if (r.judgeId === pid && s.phase !== 'result') return skipRound(s, ctx)
  if (s.phase === 'picking') maybeStartJudging(s, ctx)
  else if (s.phase === 'judging' && !r.subs.length) skipRound(s, ctx)
}

// ---------------------------------------------------------------- game flow

function startGame(s, ctx) {
  syncBot(s)
  const hs = humans(s)
  if (hs.length < 2 || s.players.length < 3) fail('NEED_PLAYERS', 409)
  buildPiles(s, ctx)
  if (!s.piles.p.length) fail('NO_PROMPTS', 409)
  if (s.piles.a.length < hs.length * s.settings.handSize + 2) fail('NOT_ENOUGH_CARDS', 409)
  for (const p of s.players) {
    p.score = 0
    p.hand = []
    p.blanks = p.bot ? 0 : s.settings.blanks
  }
  s.history = []
  s.champion = null
  s.round = null
  startRound(s, ctx, hs[Math.floor(ctx.rng() * hs.length)].id)
}

function startRound(s, ctx, judgeId) {
  const hs = humans(s)
  for (const p of hs) dealHand(s, p, ctx)
  const prompt = drawFrom(s, 'p', ctx)
  if (!prompt) return endGame(s, ctx)
  const n = (s.round?.n || 0) + 1
  s.round = {
    n,
    judgeId,
    judgeIdx: hs.findIndex((p) => p.id === judgeId),
    prompt,
    subs: [],
    focus: null,
    winner: null,
    startedAt: ctx.now,
    deadline: s.settings.timer ? ctx.now + s.settings.timer * 1000 : null,
    nextAt: null,
  }
  s.phase = 'picking'
  const bot = s.players.find((p) => p.bot)
  if (bot) {
    const pick = promptPick(s, prompt)
    const cards = []
    for (let i = 0; i < pick; i++) {
      const id = drawFrom(s, 'a', ctx)
      if (id) cards.push(id)
    }
    if (cards.length === pick) s.round.subs.push({ id: randomId(ctx.rng), pid: bot.id, cards, shown: false })
    else s.discard.a.push(...cards)
  }
  pushEvent(s, 'round', { n, judge: playerById(s, judgeId)?.name }, ctx.now)
}

export function waitingFor(s) {
  const r = s.round
  if (s.phase !== 'picking' || !r) return []
  const pick = promptPick(s, r.prompt)
  return humans(s).filter(
    (p) => p.id !== r.judgeId && !r.subs.some((x) => x.pid === p.id) && p.hand.length + p.blanks >= pick,
  )
}

function maybeStartJudging(s, ctx) {
  if (waitingFor(s).length === 0) startJudging(s, ctx)
}

function startJudging(s, ctx) {
  const r = s.round
  if (!r.subs.length) return skipRound(s, ctx)
  shuffle(r.subs, ctx.rng)
  r.focus = null
  r.deadline = null
  s.phase = 'judging'
  pushEvent(s, 'judging', {}, ctx.now)
}

export function nextJudgeId(s) {
  const hs = humans(s)
  if (!hs.length) return null
  const r = s.round
  const i = hs.findIndex((p) => p.id === r?.judgeId)
  if (i >= 0) return hs[(i + 1) % hs.length].id
  return hs[Math.max(0, r?.judgeIdx ?? 0) % hs.length].id
}

// Cancels the current round: played cards go back to their owners.
function skipRound(s, ctx) {
  const r = s.round
  for (const sub of r.subs) {
    const p = playerById(s, sub.pid)
    for (const c of sub.cards) {
      if (typeof c !== 'string') {
        if (p) p.blanks += 1
      } else if (p && !p.bot) p.hand.push(c)
      else s.discard.a.push(c)
    }
  }
  r.subs = []
  s.discard.p.push(r.prompt)
  pushEvent(s, 'skip', {}, ctx.now)
  startRound(s, ctx, nextJudgeId(s))
}

function finishRound(s) {
  const r = s.round
  for (const sub of r.subs) for (const c of sub.cards) if (typeof c === 'string') s.discard.a.push(c)
  s.discard.p.push(r.prompt)
}

function advance(s, ctx) {
  finishRound(s)
  if (s.champion) return endGame(s, ctx)
  startRound(s, ctx, nextJudgeId(s))
}

function endGame(s, ctx) {
  if (s.champion && !playerById(s, s.champion)) s.champion = null
  if (!s.champion) {
    const top = [...s.players].sort((a, b) => b.score - a.score)[0]
    s.champion = top && top.score > 0 ? top.id : null
  }
  s.phase = 'over'
  s.round = null
  pushEvent(s, 'over', { name: playerById(s, s.champion)?.name ?? null }, ctx.now)
}

function abortGame(s, ctx) {
  s.phase = 'lobby'
  s.round = null
  s.piles = null
  s.discard = null
  for (const p of s.players) {
    p.hand = []
    p.blanks = s.settings.blanks
  }
  pushEvent(s, 'aborted', {}, ctx.now)
}

// ---------------------------------------------------------------- actions

function requireHost(s, actor) {
  if (s.hostId !== actor.id) fail('HOST_ONLY', 403)
}

function requirePhase(s, ...phases) {
  if (!phases.includes(s.phase)) fail('WRONG_PHASE', 409)
}

function requireJudge(s, actor) {
  if (s.round?.judgeId !== actor.id) fail('JUDGE_ONLY', 403)
}

function findSub(s, subId) {
  return s.round.subs.find((x) => x.id === subId) || fail('NOT_FOUND', 404)
}

const ACTIONS = {
  settings(s, actor, { patch }) {
    requireHost(s, actor)
    requirePhase(s, 'lobby')
    if (!patch || typeof patch !== 'object') fail('BAD_REQUEST')
    const next = { ...s.settings }
    for (const [k, val] of Object.entries(patch)) {
      if (k === 'packs') {
        if (!Array.isArray(val)) fail('BAD_SETTING')
        next.packs = [...new Set(val)].filter((id) => typeof id === 'string' && PACKS[id])
      } else if (Object.hasOwn(SETTING_OPTIONS, k)) {
        if (!SETTING_OPTIONS[k].includes(val)) fail('BAD_SETTING')
        next[k] = val
      } else if (k === 'rando' || k === 'custom' || k === 'boost') {
        next[k] = !!val
      } else {
        fail('BAD_SETTING')
      }
    }
    s.settings = next
    syncBot(s)
    for (const p of humans(s)) p.blanks = next.blanks
  },

  start(s, actor, _a, ctx) {
    requireHost(s, actor)
    requirePhase(s, 'lobby', 'over')
    if (ctx.deckCards) mergeDeckCards(s, ctx.deckCards)
    startGame(s, ctx)
  },

  submit(s, actor, { cards }, ctx) {
    requirePhase(s, 'picking')
    const r = s.round
    if (r.judgeId === actor.id) fail('JUDGE_CANT_PLAY', 409)
    if (r.subs.some((x) => x.pid === actor.id)) fail('ALREADY_PLAYED', 409)
    const pick = promptPick(s, r.prompt)
    if (!Array.isArray(cards) || cards.length !== pick) fail('WRONG_COUNT')
    const used = new Set()
    let writeIns = 0
    const played = cards.map((c) => {
      if (typeof c === 'string') {
        if (!actor.hand.includes(c) || used.has(c)) fail('NOT_IN_HAND', 409)
        used.add(c)
        return c
      }
      if (c && typeof c === 'object' && typeof c.w === 'string') {
        const text = cleanText(c.w)
        if (!text) fail('EMPTY_CARD')
        if (text.length > LIMITS.answerMax) fail('TOO_LONG')
        writeIns += 1
        return { w: text }
      }
      return fail('BAD_CARD')
    })
    if (writeIns > actor.blanks) fail('NO_BLANKS', 409)
    actor.hand = actor.hand.filter((id) => !used.has(id))
    actor.blanks -= writeIns
    r.subs.push({ id: randomId(ctx.rng), pid: actor.id, cards: played, shown: false })
    maybeStartJudging(s, ctx)
  },

  retract(s, actor) {
    requirePhase(s, 'picking')
    const r = s.round
    const i = r.subs.findIndex((x) => x.pid === actor.id)
    if (i < 0) fail('NOT_PLAYED', 409)
    const [sub] = r.subs.splice(i, 1)
    for (const c of sub.cards) {
      if (typeof c === 'string') actor.hand.push(c)
      else actor.blanks += 1
    }
  },

  reveal(s, actor, { subId }) {
    requirePhase(s, 'judging')
    requireJudge(s, actor)
    const sub = findSub(s, subId)
    if (sub.shown && s.round.focus === sub.id) return NO_CHANGE
    sub.shown = true
    s.round.focus = sub.id
  },

  pick(s, actor, { subId }, ctx) {
    requirePhase(s, 'judging')
    requireJudge(s, actor)
    const r = s.round
    const sub = findSub(s, subId)
    if (!sub.shown) fail('NOT_REVEALED', 409)
    const winner = playerById(s, sub.pid)
    winner.score += 1
    r.winner = sub.id
    r.focus = sub.id
    const prompt = cardById(s, r.prompt)
    s.history.push({
      n: r.n,
      prompt: prompt?.text ?? '',
      promptBy: prompt?.by || null,
      cards: sub.cards.map((c) => answerText(s, c)),
      winnerId: winner.id,
      winnerName: winner.name,
      winnerAvatar: winner.avatar,
      winnerColor: winner.color,
      judgeName: actor.name,
    })
    if (s.history.length > 80) s.history.shift()
    s.phase = 'result'
    r.nextAt = ctx.now + RESULT_MS
    r.deadline = s.settings.timer ? r.nextAt : null
    if (winner.score >= s.settings.maxScore) s.champion = winner.id
    // Winning write-ins become part of the group's cards.
    const effects = []
    for (const c of sub.cards) {
      if (typeof c === 'string' || winner.bot) continue
      try {
        const card = makeCustomCard(s, winner, 'a', c.w, ctx)
        insertCustom(s, card, ctx)
        effects.push({ type: 'deckAdd', card })
      } catch {
        // Duplicate or invalid: the round still counts.
      }
    }
    pushEvent(s, 'win', { name: winner.name, avatar: winner.avatar }, ctx.now)
    return { effects }
  },

  next(s, actor, _a, ctx) {
    requirePhase(s, 'result')
    const r = s.round
    const boss = actor.id === r.judgeId || actor.id === s.hostId
    if (!boss && ctx.now < r.nextAt) fail('NOT_YET', 409)
    advance(s, ctx)
  },

  // Sent by any client when a deadline passes; idempotent.
  tick(s, _actor, _a, ctx) {
    const r = s.round
    if (s.phase === 'picking' && r.deadline && ctx.now >= r.deadline) return startJudging(s, ctx)
    if (s.phase === 'result' && r.deadline && ctx.now >= r.deadline) return advance(s, ctx)
    return NO_CHANGE
  },

  skip(s, actor, _a, ctx) {
    requireHost(s, actor)
    requirePhase(s, 'picking', 'judging')
    skipRound(s, ctx)
  },

  // Host or judge: stop waiting and judge what has been played so far.
  hurry(s, actor, _a, ctx) {
    requirePhase(s, 'picking')
    if (actor.id !== s.hostId && actor.id !== s.round.judgeId) fail('HOST_ONLY', 403)
    if (!s.round.subs.some((x) => !playerById(s, x.pid)?.bot)) fail('NOBODY_PLAYED', 409)
    startJudging(s, ctx)
  },

  kick(s, actor, { pid }, ctx) {
    requireHost(s, actor)
    if (pid === actor.id) fail('BAD_REQUEST')
    const target = playerById(s, pid) || fail('NOT_FOUND', 404)
    if (target.bot) s.settings.rando = false
    pushEvent(s, 'kick', { name: target.name }, ctx.now)
    removePlayer(s, pid, ctx)
  },

  leave(s, actor, _a, ctx) {
    pushEvent(s, 'leave', { name: actor.name }, ctx.now)
    removePlayer(s, actor.id, ctx)
  },

  makeHost(s, actor, { pid }, ctx) {
    requireHost(s, actor)
    const target = playerById(s, pid)
    if (!target || target.bot) fail('NOT_FOUND', 404)
    s.hostId = target.id
    pushEvent(s, 'host', { name: target.name }, ctx.now)
  },

  profile(s, actor, { name, avatar }) {
    if (name !== undefined) {
      const n = validateName(name)
      const other = findByName(s, n)
      if (other && other.id !== actor.id) fail('NAME_TAKEN', 409)
      actor.name = n
    }
    if (avatar !== undefined) actor.avatar = validateAvatar(avatar)
  },

  addCard(s, actor, { t, text }, ctx) {
    const card = makeCustomCard(s, actor, t, text, ctx)
    insertCustom(s, card, ctx)
    const last = s.events[s.events.length - 1]
    if (!(last && last.k === 'card' && last.name === actor.name && ctx.now - last.at < 60_000)) {
      pushEvent(s, 'card', { name: actor.name, avatar: actor.avatar }, ctx.now)
    }
    return { effects: [{ type: 'deckAdd', card }], card }
  },

  removeCard(s, actor, { id }) {
    const card = typeof id === 'string' ? s.custom[id] : null
    if (!card || card.gone) fail('NOT_FOUND', 404)
    if (!isAuthor(card, actor) && s.hostId !== actor.id) fail('FORBIDDEN', 403)
    card.gone = true
    if (s.piles) s.piles[card.t] = s.piles[card.t].filter((x) => x !== id)
    return { effects: [{ type: 'deckRemove', id }] }
  },

  renameDeck(s, actor, { name }) {
    requireHost(s, actor)
    const n = cleanText(name).slice(0, LIMITS.deckNameMax)
    if (!n) fail('NAME_REQUIRED')
    s.deck.name = n
    return { effects: [{ type: 'deckRename', name: n }] }
  },

  end(s, actor, _a, ctx) {
    requireHost(s, actor)
    requirePhase(s, 'picking', 'judging', 'result')
    endGame(s, ctx)
  },

  restart(s, actor, _a, ctx) {
    requireHost(s, actor)
    s.phase = 'lobby'
    s.round = null
    s.piles = null
    s.discard = null
    s.champion = null
    s.history = []
    for (const p of s.players) {
      p.score = 0
      p.hand = []
      p.blanks = p.bot ? 0 : s.settings.blanks
    }
    pushEvent(s, 'restart', {}, ctx.now)
  },
}

/**
 * Applies a player action to the room state (mutating it).
 * Returns NO_CHANGE when nothing happened, otherwise { effects?, ... }.
 */
export function applyAction(s, actorId, action, ctx) {
  const actor = playerById(s, actorId)
  if (!actor || actor.bot) fail('NOT_IN_ROOM', 403)
  const type = action?.type
  if (typeof type !== 'string' || !Object.hasOwn(ACTIONS, type)) fail('UNKNOWN_ACTION')
  const res = ACTIONS[type](s, actor, action, ctx)
  return res === NO_CHANGE ? NO_CHANGE : res || {}
}
