import { useEffect, useState } from 'react'

// Routes: "/" home, "/K7QX" room, "/m/<deckId>" group deck page.
export function parseRoute(pathname) {
  const deck = pathname.match(/^\/m\/([a-z2-9]{6,16})\/?$/)
  if (deck) return { name: 'deck', id: deck[1] }
  const room = pathname.match(/^\/([A-Za-z]{4})\/?$/)
  if (room) return { name: 'room', code: room[1].toUpperCase() }
  return { name: 'home' }
}

export function navigate(path, { replace = false } = {}) {
  if (path === window.location.pathname) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
  window.dispatchEvent(new Event('app:navigate'))
  window.scrollTo(0, 0)
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onChange)
    window.addEventListener('app:navigate', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('app:navigate', onChange)
    }
  }, [])
  return route
}

// Invite links always use the public production domain (set at build time),
// even when the host has the app open on a login-protected deployment URL.
export const shareOrigin = () => __SITE_URL__ || window.location.origin
export const roomUrl = (code) => `${shareOrigin()}/${code}`
export const deckUrl = (id) => `${shareOrigin()}/m/${id}`
