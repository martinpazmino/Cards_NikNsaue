// Small localStorage wrapper. Storage can be unavailable (private mode,
// in-app browsers), so every access is guarded and the app works without it.

const KEY = 'sinverguenzas:v1'
const ROOM_MAX_AGE = 12 * 60 * 60 * 1000

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

function update(fn) {
  const data = load()
  fn(data)
  save(data)
}

export const storage = {
  profile() {
    return load().profile || null
  },
  setProfile(profile) {
    update((d) => {
      d.profile = { ...d.profile, ...profile }
    })
  },
  session(code) {
    const s = load().rooms?.[code]
    return s && Date.now() - s.at < ROOM_MAX_AGE ? s : null
  },
  setSession(code, { playerId, token }) {
    update((d) => {
      d.rooms = { ...d.rooms, [code]: { playerId, token, at: Date.now() } }
      // Keep only recent rooms.
      for (const [c, s] of Object.entries(d.rooms)) if (Date.now() - s.at > ROOM_MAX_AGE) delete d.rooms[c]
    })
  },
  clearSession(code) {
    update((d) => {
      if (d.rooms) delete d.rooms[code]
    })
  },
  recentRooms() {
    return Object.entries(load().rooms || {})
      .filter(([, s]) => Date.now() - s.at < ROOM_MAX_AGE)
      .sort((a, b) => b[1].at - a[1].at)
      .map(([code, s]) => ({ code, ...s }))
  },
  decks() {
    return (load().decks || []).sort((a, b) => b.at - a.at)
  },
  rememberDeck({ id, name, count }) {
    if (!id) return
    update((d) => {
      const rest = (d.decks || []).filter((x) => x.id !== id)
      d.decks = [{ id, name, count, at: Date.now() }, ...rest].slice(0, 12)
    })
  },
  forgetDeck(id) {
    update((d) => {
      d.decks = (d.decks || []).filter((x) => x.id !== id)
    })
  },
}
