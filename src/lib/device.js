// Phone niceties: haptics, sharing, clipboard, screen wake lock.

import { useEffect } from 'react'

export function buzz(pattern = 8) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // not supported (iOS)
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    el.remove()
    return ok
  }
}

// Native share sheet when available; otherwise copies the link.
export async function share({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  return (await copyText(url ? `${text} ${url}` : text)) ? 'copied' : 'failed'
}

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Keeps the screen on while `active` (phones sleep while you wait for the judge).
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined
    let lock = null
    let pending = false
    let alive = true
    const acquire = async () => {
      if (document.hidden || lock || pending) return
      pending = true
      try {
        lock = await navigator.wakeLock.request('screen')
        lock.addEventListener('release', () => {
          lock = null
        })
        if (!alive) lock.release()
      } catch {
        // Not allowed (battery saver, iframe): the game works without it.
      } finally {
        pending = false
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [active])
}
