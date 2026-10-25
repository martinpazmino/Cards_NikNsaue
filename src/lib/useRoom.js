import { useCallback, useEffect, useRef, useState } from 'react'
import { PING_MS } from '../../shared/constants.js'
import { api } from './api.js'

const POLL_MS = 1000

/**
 * Keeps a room view in sync:
 * - polls the tiny version endpoint (~1s, CDN-cached) and only downloads the
 *   full personalized state when the version changes;
 * - every PING_MS fetches the state with ?ping=1 so others see us online;
 * - pauses while the tab is hidden and resyncs immediately on return;
 * - actions return the new state, so the actor sees changes instantly.
 */
export function useRoom(code, session, initial = null) {
  const [view, setView] = useState(initial)
  const [fatal, setFatal] = useState(null)
  const [offline, setOffline] = useState(false)
  const version = useRef(initial?.v ?? 0)
  const clockOffset = useRef(initial ? initial.now - Date.now() : 0)
  const kick = useRef(() => {})

  const apply = useCallback((next) => {
    if (!next || next.v < version.current) return
    version.current = next.v
    clockOffset.current = next.now - Date.now()
    setView(next)
  }, [])

  useEffect(() => {
    if (!session) return undefined
    let alive = true
    let timer = null
    let inflight = false
    let failures = 0
    let lastPing = 0

    const schedule = (ms) => {
      clearTimeout(timer)
      timer = setTimeout(tick, ms)
    }

    async function tick() {
      if (!alive || inflight || document.hidden) return
      inflight = true
      try {
        if (Date.now() - lastPing >= PING_MS) {
          lastPing = Date.now()
          apply(await api.state(code, session, { ping: true }))
        } else {
          const { v } = await api.version(code)
          if (v > version.current) apply(await api.state(code, session))
        }
        failures = 0
        setOffline(false)
      } catch (e) {
        if (e.status === 403 || e.status === 404) {
          alive = false
          setFatal(e.code)
          return
        }
        failures += 1
        if (failures >= 3) setOffline(true)
      } finally {
        inflight = false
      }
      if (alive) schedule(failures ? Math.min(1000 * 2 ** failures, 8000) : POLL_MS)
    }

    const resume = () => {
      if (document.hidden) return
      lastPing = 0
      schedule(0)
    }
    kick.current = () => schedule(0)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('focus', resume)
    schedule(0)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('focus', resume)
    }
  }, [code, session, apply])

  const act = useCallback(
    async (type, payload = {}) => {
      try {
        const res = await api.action(code, session, { type, ...payload })
        apply(res.state)
        return res
      } catch (e) {
        if (e.status === 403 && e.code === 'NOT_IN_ROOM') setFatal(e.code)
        // Someone else may have moved the game on: resync right away.
        if (e.status === 409) kick.current()
        throw e
      }
    },
    [code, session, apply],
  )

  // Server time in ms (corrects for a phone clock that is off).
  const serverNow = useCallback(() => Date.now() + clockOffset.current, [])

  // Deadlines (round timer, result screen) are enforced by whoever notices first.
  const deadline = view?.round?.deadline
  const phase = view?.phase
  useEffect(() => {
    if (!deadline || (phase !== 'picking' && phase !== 'result')) return undefined
    const wait = Math.max(0, deadline - serverNow()) + 300 + Math.random() * 900
    const t = setTimeout(() => act('tick').catch(() => {}), wait)
    return () => clearTimeout(t)
  }, [deadline, phase, act, serverNow])

  return { view, act, fatal, offline, serverNow }
}
