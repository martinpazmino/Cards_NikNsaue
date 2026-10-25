// Room and deck services: authentication, optimistic-concurrency writes and
// syncing a room's custom cards into the group's persistent deck.

import { randomBytes, randomInt } from 'node:crypto'
import {
  DECK_TTL_S, LIMITS, ONLINE_MS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_TTL_S,
} from '../shared/constants.js'
import {
  GameError, NO_CHANGE, addPlayer, applyAction, createRoomState, isDuplicateCard, joinPlayer,
  mergeDeckCards, randomId, validateAvatar, validateCardText, validateName,
} from '../shared/game.js'
import { cleanText, pickCount } from '../shared/text.js'
import { viewFor } from '../shared/view.js'

const roomKey = (code) => `room:${code}`
const seenKey = (code) => `seen:${code}`
const deckKey = (id) => `deck:${id}`

export const cryptoRng = () => randomInt(0, 2 ** 47) / 2 ** 47
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function normalizeCode(code) {
  const c = String(code ?? '').toUpperCase()
  if (c.length !== ROOM_CODE_LENGTH || [...c].some((ch) => !ROOM_CODE_ALPHABET.includes(ch))) {
    throw new GameError('ROOM_NOT_FOUND', 404)
  }
  return c
}

const isDeckId = (id) => typeof id === 'string' && /^[a-z2-9]{6,16}$/.test(id)

function authenticate(s, { pid, token } = {}) {
  const p = typeof pid === 'string' ? s.players.find((x) => x.id === pid && !x.bot) : null
  if (!p || typeof token !== 'string' || p.token !== token) throw new GameError('NOT_IN_ROOM', 403)
  return p
}

function deckView(d) {
  return {
    id: d.id,
    name: d.name,
    updatedAt: d.updatedAt,
    cards: d.cards.map((c) => (c.t === 'p' ? { ...c, pick: pickCount(c.text) } : { ...c })),
  }
}

export function createService({ store, rng = cryptoRng, clock = Date.now }) {
  const newToken = () => randomBytes(18).toString('base64url')
  const newPlayerId = () => `p${randomId(rng, 9)}`
  const newDeckId = () => randomId(rng, 10)
  const newCode = () =>
    Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)]).join('')

  // Read-modify-write with compare-and-swap; retries when someone else wrote first.
  async function mutateDoc(key, ttl, fn, { notFound = 'ROOM_NOT_FOUND', init } = {}) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const t = clock()
      const existing = await store.getDoc(key)
      if (!existing && !init) throw new GameError(notFound, 404)
      const doc = existing || init(t)
      const out = fn(doc, t)
      if (out === NO_CHANGE) return { doc, out, changed: false }
      doc.updatedAt = t
      const ok = existing ? await store.casDoc(key, existing.v, doc, ttl) : await store.createDoc(key, doc, ttl)
      if (ok) return { doc, out, changed: true }
      await sleep(10 + rng() * 25 * (attempt + 1))
    }
    throw new GameError('BUSY', 503)
  }

  async function applyDeckEffects(ref, effects) {
    await mutateDoc(
      deckKey(ref.id),
      DECK_TTL_S,
      (d) => {
        for (const e of effects) {
          if (e.type === 'deckAdd') {
            const { id, t, text, by, at } = e.card
            if (d.cards.length >= LIMITS.deckCards || d.cards.some((c) => c.id === id) || isDuplicateCard(d.cards, t, text)) continue
            d.cards.push({ id, t, text, by, at })
          } else if (e.type === 'deckRemove') {
            d.cards = d.cards.filter((c) => c.id !== e.id)
          } else if (e.type === 'deckRename') {
            d.name = e.name
          }
        }
      },
      { init: (t) => ({ id: ref.id, name: ref.name, createdAt: t, updatedAt: t, cards: [] }) },
    )
  }

  return {
    storeKind: store.kind,
    check: () => store.check(),

    async createRoom({ name, avatar, deckId } = {}) {
      const n = validateName(name)
      const av = validateAvatar(avatar)
      let deck = null
      if (deckId) {
        deck = isDeckId(deckId) ? await store.getDoc(deckKey(deckId)) : null
        if (!deck) throw new GameError('DECK_NOT_FOUND', 404)
        await store.touch(deckKey(deckId), DECK_TTL_S)
      }
      for (let i = 0; i < 10; i++) {
        const t = clock()
        const code = newCode()
        const s = createRoomState({ code, now: t })
        s.deck = deck ? { id: deck.id, name: deck.name } : { id: null, name: `Mazo de ${n}` }
        if (deck) mergeDeckCards(s, deck.cards)
        const player = addPlayer(s, { id: newPlayerId(), token: newToken(), name: n, avatar: av }, { now: t, rng })
        if (await store.createDoc(roomKey(code), s, ROOM_TTL_S)) {
          await store.ping(seenKey(code), player.id, t, ROOM_TTL_S)
          const state = viewFor(s, player.id, { now: t, presence: { [player.id]: t } })
          return { code, playerId: player.id, token: player.token, state }
        }
      }
      throw new GameError('TRY_AGAIN', 503)
    },

    async join(rawCode, { name, avatar } = {}) {
      const code = normalizeCode(rawCode)
      const presence = await store.getPresence(seenKey(code))
      let joined
      const { doc: s } = await mutateDoc(roomKey(code), ROOM_TTL_S, (s, t) => {
        const online = (p) => (presence[p.id] ? t - presence[p.id] < ONLINE_MS : t - p.joinedAt < 60_000)
        joined = joinPlayer(s, { id: newPlayerId(), token: newToken(), name, avatar }, { now: t, rng }, online)
      })
      const t = clock()
      await store.ping(seenKey(code), joined.player.id, t, ROOM_TTL_S)
      presence[joined.player.id] = t
      return {
        code,
        playerId: joined.player.id,
        token: joined.player.token,
        reclaimed: joined.reclaimed,
        state: viewFor(s, joined.player.id, { now: t, presence }),
      }
    },

    async version(rawCode) {
      const v = await store.getVersion(roomKey(normalizeCode(rawCode)))
      if (v == null) throw new GameError('ROOM_NOT_FOUND', 404)
      return { v }
    },

    async state(rawCode, auth, { ping = false } = {}) {
      const code = normalizeCode(rawCode)
      const t = clock()
      const p = ping && typeof auth?.pid === 'string' ? { field: auth.pid, ts: t, ttl: ROOM_TTL_S } : null
      const { doc: s, presence } = await store.getDocAndPresence(roomKey(code), seenKey(code), p)
      if (!s) throw new GameError('ROOM_NOT_FOUND', 404)
      authenticate(s, auth)
      return viewFor(s, auth.pid, { now: t, presence })
    },

    async act(rawCode, auth, action) {
      const code = normalizeCode(rawCode)
      if (!action || typeof action !== 'object') throw new GameError('BAD_REQUEST')
      let deckCards = null
      if (action.type === 'start') {
        const before = await store.getDoc(roomKey(code))
        if (before?.deck?.id) deckCards = (await store.getDoc(deckKey(before.deck.id)))?.cards ?? null
      }
      let result = {}
      const { doc: s, changed } = await mutateDoc(roomKey(code), ROOM_TTL_S, (s, t) => {
        result = {}
        const player = authenticate(s, auth)
        const res = applyAction(s, player.id, action, { now: t, rng, deckCards })
        if (res === NO_CHANGE) return NO_CHANGE
        result = res
        if (res.effects?.some((e) => e.type === 'deckAdd') && !s.deck.id) s.deck.id = newDeckId()
        return res
      })
      const tasks = [store.getPresence(seenKey(code)).catch(() => ({}))]
      if (changed && result.effects?.length && s.deck.id) {
        tasks.push(applyDeckEffects(s.deck, result.effects).catch((e) => console.error('deck sync failed:', e)))
      }
      const [presence] = await Promise.all(tasks)
      return {
        ok: true,
        changed,
        card: result.card ? { id: result.card.id } : undefined,
        state: viewFor(s, auth.pid, { now: clock(), presence }),
      }
    },

    async getDeck(id) {
      const d = isDeckId(id) ? await store.getDoc(deckKey(id)) : null
      if (!d) throw new GameError('DECK_NOT_FOUND', 404)
      return deckView(d)
    },

    async createDeck({ name } = {}) {
      const n = cleanText(name).slice(0, LIMITS.deckNameMax) || 'Mazo del grupo'
      for (let i = 0; i < 10; i++) {
        const t = clock()
        const d = { id: newDeckId(), name: n, createdAt: t, updatedAt: t, cards: [] }
        if (await store.createDoc(deckKey(d.id), d, DECK_TTL_S)) return deckView(d)
      }
      throw new GameError('TRY_AGAIN', 503)
    },

    async deckAction(id, action) {
      if (!isDeckId(id)) throw new GameError('DECK_NOT_FOUND', 404)
      const { doc } = await mutateDoc(
        deckKey(id),
        DECK_TTL_S,
        (d, t) => {
          switch (action?.type) {
            case 'add': {
              const { text } = validateCardText(action.t, action.text)
              if (d.cards.length >= LIMITS.deckCards) throw new GameError('TOO_MANY_CARDS', 409)
              if (isDuplicateCard(d.cards, action.t, text)) throw new GameError('DUPLICATE', 409)
              const by = Array.from(cleanText(action.by)).slice(0, LIMITS.nameMax).join('')
              d.cards.push({ id: `u.${randomId(rng, 9)}`, t: action.t, text, by, at: t })
              return undefined
            }
            case 'remove': {
              const before = d.cards.length
              d.cards = d.cards.filter((c) => c.id !== action.id)
              if (d.cards.length === before) throw new GameError('NOT_FOUND', 404)
              return undefined
            }
            case 'rename': {
              const n = cleanText(action.name).slice(0, LIMITS.deckNameMax)
              if (!n) throw new GameError('NAME_REQUIRED')
              d.name = n
              return undefined
            }
            default:
              throw new GameError('UNKNOWN_ACTION')
          }
        },
        { notFound: 'DECK_NOT_FOUND' },
      )
      return deckView(doc)
    },
  }
}
