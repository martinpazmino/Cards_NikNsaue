export class ApiError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

async function request(method, path, { body, session, cache = 'no-store', extraHeaders } = {}) {
  const headers = { ...extraHeaders }
  if (body) headers['Content-Type'] = 'application/json'
  if (session) {
    headers['x-player-id'] = session.playerId
    headers['x-player-token'] = session.token
  }
  let res
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache })
  } catch {
    throw new ApiError('NETWORK', 0)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(json.error || 'SERVER_ERROR', res.status)
  return json
}

export const api = {
  health: () => request('GET', '/health'),
  createRoom: (body) => request('POST', '/rooms', { body }),
  join: (code, body) => request('POST', `/rooms/${code}/join`, { body }),
  // Default cache mode on purpose: "no-store" makes browsers send
  // Cache-Control: no-cache, which could skip the 1s CDN cache.
  version: (code) => request('GET', `/rooms/${code}/v`, { cache: 'default' }),
  state: (code, session, { ping = false } = {}) =>
    request('GET', `/rooms/${code}`, { session, extraHeaders: ping ? { 'x-ping': '1' } : undefined }),
  action: (code, session, body) => request('POST', `/rooms/${code}/action`, { body, session }),
  deck: (id) => request('GET', `/decks/${id}`),
  createDeck: (body) => request('POST', '/decks', { body }),
  deckAction: (id, body) => request('POST', `/decks/${id}`, { body }),
}
