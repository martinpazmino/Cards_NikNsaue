// Renders the PNG icons and the link-preview image (og.png) with Playwright.
// Dev-only: run it after changing public/icons/icon.svg or the preview design.
//   node scripts/make-assets.js   (needs `playwright` + Chromium installed)

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const root = path.resolve('.')
const svg = readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf8')
const font = pathToFileURL(
  path.join(root, 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'),
).href

const iconPage = (size, pad, bg) => `<!doctype html><html><body style="margin:0;background:${bg}">
  <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`

const ogPage = `<!doctype html><html><head><style>
  @font-face { font-family: B; src: url(${font}) format('woff2'); font-weight: 200 800; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: B, sans-serif; color: #fff7ec;
    background: radial-gradient(700px 500px at 0% 0%, rgba(255,77,141,.35), transparent 60%),
      radial-gradient(600px 500px at 100% 100%, rgba(25,211,197,.25), transparent 60%), #120c22; }
  .flags { position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-around; }
  .flag { width: 110px; height: 120px; clip-path: polygon(0 0,100% 0,100% 82%,90% 100%,80% 82%,70% 100%,60% 82%,50% 100%,40% 82%,30% 100%,20% 82%,10% 100%,0 82%); }
  .logo { position: absolute; left: 70px; top: 205px; font-size: 80px; font-weight: 800; letter-spacing: -0.04em;
    background: linear-gradient(100deg,#ffd166,#ff4d8d 50%,#b9a2ff); -webkit-background-clip: text; color: transparent; }
  .tag { position: absolute; left: 76px; top: 320px; font-size: 38px; font-weight: 700; color: #d9cff5; width: 520px; line-height: 1.15 }
  .pill { position: absolute; left: 76px; top: 460px; font-size: 30px; font-weight: 800; padding: 14px 28px; border-radius: 99px;
    background: linear-gradient(135deg,#ff4d8d,#ff6b35); }
  .card { position: absolute; border-radius: 26px; padding: 30px; font-weight: 750; font-size: 28px; line-height: 1.2; box-shadow: 0 30px 60px rgba(0,0,0,.5) }
  .black { right: 215px; top: 175px; width: 290px; height: 380px; background: #0d0a14; transform: rotate(-7deg); outline: 2px solid rgba(255,255,255,.12) }
  .white { right: 50px; top: 250px; width: 260px; height: 310px; background: #fffaf0; color: #15111f; transform: rotate(8deg) }
  .blank { display: inline-block; width: 70px; border-bottom: 5px solid #fff; }
  .small { position: absolute; bottom: 26px; font-size: 16px; letter-spacing: .1em; text-transform: uppercase; opacity: .5 }
</style></head><body>
  <div class="flags">${['#ff4d8d', '#ffb627', '#19d3c5', '#8c5cff', '#a3e635', '#ff6b35', '#38bdf8', '#f472b6']
    .map((c) => `<div class="flag" style="background:${c}"></div>`)
    .join('')}</div>
  <div class="logo">Sinvergüenzas</div>
  <div class="tag">Cartas sin vergüenza para tus panas</div>
  <div class="pill">🌶️ ¡Vente a jugar!</div>
  <div class="card black">Mi abuela no confía en los bancos. Por eso guarda sus ahorros en <span class="blank"></span>.<div class="small">Sinvergüenzas</div></div>
  <div class="card white">Un Tupperware lleno de frijoles.<div class="small">Sinvergüenzas</div></div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
const shots = [
  ['public/icons/icon-192.png', 192, 0, 'transparent'],
  ['public/icons/icon-512.png', 512, 0, 'transparent'],
  ['public/icons/icon-maskable-512.png', 512, 64, '#120c22'],
  ['public/icons/apple-touch-icon.png', 180, 10, '#120c22'],
]
for (const [file, size, pad, bg] of shots) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(iconPage(size, pad, bg))
  await page.screenshot({ path: file, omitBackground: bg === 'transparent' })
  console.log('wrote', file)
}
await page.setViewportSize({ width: 1200, height: 630 })
await page.setContent(ogPage, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: 'public/og.png' })
console.log('wrote public/og.png')
await browser.close()
