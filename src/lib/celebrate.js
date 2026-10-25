import { prefersReducedMotion } from './device.js'

const COLORS = ['#ff4d8d', '#ffb627', '#19d3c5', '#8c5cff', '#a3e635', '#ff6b35']

export async function celebrate(big = false) {
  if (prefersReducedMotion()) return
  const { default: confetti } = await import('canvas-confetti')
  confetti({ particleCount: big ? 150 : 60, spread: big ? 95 : 65, startVelocity: big ? 45 : 32, origin: { y: 0.3 }, colors: COLORS, scalar: 0.9 })
  if (!big) return
  setTimeout(() => {
    confetti({ particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors: COLORS })
    confetti({ particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors: COLORS })
  }, 300)
}
