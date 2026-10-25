// End-to-end smoke test: four phones play a full game against a running
// server, saving a screenshot of every screen.
//   npm run build && npm start            (in one terminal)
//   node scripts/e2e.js [baseUrl] [outDir] (in another; needs playwright)

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('Playwright is not installed: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const BASE = process.argv[2] || 'http://localhost:3000'
const OUT = process.argv[3] || 'e2e-shots'
mkdirSync(OUT, { recursive: true })

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-MX' }
const SMALL_PHONE = { ...PHONE, viewport: { width: 375, height: 667 } }
const NAMES = [
  ['Martín', 0],
  ['Sofi', 3],
  ['Beto', 7],
  ['Caro', 12],
]

let shot = 0
async function snap(page, name, { full = false } = {}) {
  shot += 1
  const file = path.join(OUT, `${String(shot).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('📸', file)
}

const step = (msg) => console.log(`\n▶ ${msg}`)
const browser = await chromium.launch()
const errors = []

async function phone(name, device = PHONE) {
  const ctx = await browser.newContext(device)
  // HIDE_TOASTS=1 gives clean screenshots for docs.
  if (process.env.HIDE_TOASTS) {
    await ctx.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = '.toasts{display:none!important}'
        document.head.appendChild(style)
      }),
    )
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
  return page
}

async function waitPhase(page, selector, timeout = 15_000) {
  await page.waitForSelector(selector, { timeout })
}

try {
  step('Host creates a room')
  const host = await phone('host')
  await host.goto(BASE)
  await host.waitForSelector('.hero')
  await snap(host, 'home', { full: true })
  await host.fill('#nick', NAMES[0][0])
  await host.click('button:has-text("Crear sala")')
  await waitPhase(host, '.lobby .room-code')
  const code = (await host.textContent('.lobby .room-code')).trim()
  console.log('room', code)
  await snap(host, 'lobby-host-alone')

  step('Friends join through the link')
  const guests = []
  for (const [name, avatarIndex] of NAMES.slice(1)) {
    const p = await phone(name, name === 'Caro' ? SMALL_PHONE : PHONE)
    await p.goto(`${BASE}/${code}`)
    await p.waitForSelector('.join .room-code')
    if (!guests.length) await snap(p, 'join-screen', { full: true })
    await p.fill('#nick', name)
    await p.locator('.avatar-opt').nth(avatarIndex).click()
    await p.click('button:has-text("Entrar a la sala")')
    await waitPhase(p, '.lobby')
    guests.push(p)
  }
  const all = [host, ...guests]
  await host.waitForFunction(() => document.querySelectorAll('.player-chip').length >= 4)
  await snap(host, 'lobby-host', { full: true })
  await snap(guests[0], 'lobby-guest')

  step('Everyone writes personalized cards')
  await guests[0].click('button:has-text("Escribir cartas")')
  await guests[0].waitForSelector('.writer')
  await guests[0].fill('.writer textarea', 'Lo que Beto nunca admitirá:')
  await guests[0].click('button:has-text("espacio ___")')
  await snap(guests[0], 'writer-prompt')
  await guests[0].click('.writer-form button[type=submit]')
  await guests[0].waitForSelector('.mine-card')
  await guests[0].click('.writer-type .seg:nth-child(2)')
  await guests[0].fill('.writer textarea', 'el carro sin frenos de Beto')
  await guests[0].click('.writer-form button[type=submit]')
  await guests[0].waitForFunction(() => document.querySelectorAll('.mine-card').length === 2)
  await snap(guests[0], 'writer-mine')
  await guests[0].click('.sheet-head .icon-btn')
  for (const [i, text] of [[1, 'la playlist de reguetón de Sofi'], [2, 'Martín bailando la Macarena']]) {
    const g = guests[i]
    await g.click('button:has-text("Escribir cartas")')
    await g.click('.writer-type .seg:nth-child(2)')
    await g.fill('.writer textarea', text)
    await g.click('.writer-form button[type=submit]')
    await g.waitForSelector('.mine-card')
    await g.click('.sheet-head .icon-btn')
  }
  await host.waitForFunction(() => document.querySelector('.group-stats strong')?.textContent === '1')
  await snap(host, 'lobby-group-cards')

  step('Host tweaks the rules and starts')
  await host.click('.segmented[aria-label] .seg:has-text("3"), .field:has-text("Puntos para ganar") .seg:has-text("3")')
  await host.waitForFunction(() => [...document.querySelectorAll('.field')].some((f) => f.textContent.includes('Puntos') && f.querySelector('.seg.is-on')?.textContent === '3'))
  await host.click('.field:has-text("Tiempo para elegir") .seg:has-text("60 s")')
  await host.waitForFunction(() => [...document.querySelectorAll('.field')].some((f) => f.textContent.includes('Tiempo') && f.querySelector('.seg.is-on')?.textContent === '60 s'))
  await host.click('button:has-text("¡A jugar!")')
  for (const p of all) await waitPhase(p, '.game')

  let round = 0
  while (round < 12) {
    round += 1
    step(`Round ${round}`)
    for (const p of all) await waitPhase(p, '.game.phase-picking, .over')
    if (await host.$('.over')) break
    const roles = await Promise.all(all.map((p) => p.$('.role-judge')))
    const judge = all[roles.findIndex(Boolean)]
    const players = all.filter((p) => p !== judge)
    if (round === 1) {
      await judge.waitForSelector('.topbar .countdown')
      await snap(judge, 'judge-waiting')
    }
    if (round === 2) {
      // Phones lock and refresh: the session must survive a reload.
      await players[0].reload()
      await players[0].waitForSelector('.game.phase-picking .hand .card.answer', { timeout: 15_000 })
      console.log('reload kept the seat ✓')
    }

    for (const [i, p] of players.entries()) {
      await p.waitForSelector('.hand .card.answer')
      const pick = (await p.$('.pick-badge')) ? 2 : 1
      if (round === 1 && p === guests[2]) await snap(p, 'picking-small-phone')
      if (round === 1 && i === 1) {
        // Use a wildcard: write your own answer.
        await snap(p, 'picking-hand-full', { full: true })
        await p.click('.blank-card')
        await p.waitForSelector('.writein textarea')
        await p.fill('.writein textarea', 'el ex de Sofi en la boda')
        await snap(p, 'writein-sheet')
        await p.click('button:has-text("Usar esta respuesta")')
        if (pick === 2) await p.locator('.hand .card.answer:not(.blank-card):not(.is-written)').first().click()
      } else {
        const cards = p.locator('.hand .card.answer:not(.blank-card)')
        for (let k = 0; k < pick; k++) await cards.nth(k + i).click()
      }
      if (round === 1 && i === 0) await snap(p, 'picking-selected')
      await p.click('button:has-text("¡Enviar!")')
      if (round === 1 && i === 0) {
        await p.waitForSelector('.role-done')
        await snap(p, 'submitted-waiting')
      }
    }

    await waitPhase(judge, '.phase-judging .sub')
    await waitPhase(players[0], '.phase-judging')
    if (round === 1) await snap(judge, 'judging-facedown')
    const subs = judge.locator('.sub')
    const n = await subs.count()
    for (let k = 0; k < n; k++) {
      await subs.nth(k).click()
      await judge.waitForSelector(`.sub:nth-child(${k + 1}).is-shown`)
    }
    await judge.waitForTimeout(700)
    if (round === 1) {
      await snap(judge, 'judging-revealed')
      await players[0].waitForFunction(() => document.querySelectorAll('.sub.is-shown').length > 0)
      await players[0].waitForTimeout(800)
      await snap(players[0], 'judging-spectator')
    }
    await subs.nth(n - 1).click()
    await judge.click('button:has-text("¡Esta gana!")')
    for (const p of all) await waitPhase(p, '.phase-result .winner-banner')
    await judge.waitForTimeout(900)
    if (round === 1) {
      await snap(judge, 'result-judge')
      await snap(players[0], 'result-player', { full: true })
    }
    await judge.click('.bottom-bar .btn-primary')
    await Promise.all(all.map((p) => p.waitForSelector('.game.phase-picking, .over', { timeout: 15_000 })))
    if (await host.$('.over')) break
  }

  step('Game over')
  for (const p of all) await waitPhase(p, '.over')
  await host.waitForTimeout(1200)
  await snap(host, 'podium')
  await snap(host, 'podium-full', { full: true })
  await snap(guests[1], 'podium-guest')

  step('Menu + scoreboard sheet')
  await guests[2].click('.lobby-head .icon-btn')
  await guests[2].waitForSelector('.scoreboard')
  await snap(guests[2], 'menu-sheet')

  step('Group deck page keeps the personalized cards')
  const deckId = await host.evaluate(() => JSON.parse(localStorage.getItem('sinverguenzas:v1')).decks?.[0]?.id)
  await host.goto(`${BASE}/m/${deckId}`)
  await host.waitForSelector('.deck-name')
  await snap(host, 'deck-page', { full: true })
  await host.click('button:has-text("Ver todas")')
  const deckCards = await host.locator('.mine-list .mine-card').count()
  console.log('deck cards:', deckCards)
  if (deckCards < 4) throw new Error(`expected the 4 group cards in the deck, got ${deckCards}`)
  await snap(host, 'deck-spoilers', { full: true })

  step('English UI')
  await host.goto(BASE)
  await host.click('.lang-toggle button:has-text("EN")')
  await snap(host, 'home-english')

  console.log(errors.length ? `\n⚠️ ${errors.length} browser error(s):\n${errors.join('\n')}` : '\n✅ no browser errors')
  console.log(`✅ played ${round} round(s) with code ${code}`)
} catch (e) {
  console.error('\n❌ E2E failed:', e)
  if (errors.length) console.error(errors.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
