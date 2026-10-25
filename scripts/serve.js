// Production-like local server: serves the built app (dist/) plus the API.
// Usage: npm run build && npm start   (PORT=3000 by default)
// VERCEL_REWRITE=1 mimics Vercel's rewrite of /api/* to /api?route=*.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import handler from '../server/handler.js'

const root = path.resolve('dist')
const port = Number(process.env.PORT) || 3000
const simulateRewrite = process.env.VERCEL_REWRITE === '1'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

async function serveStatic(req, res, pathname) {
  let file = path.join(root, decodeURIComponent(pathname))
  if (!file.startsWith(root)) {
    res.statusCode = 403
    return res.end()
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(root, 'index.html') // SPA fallback, like the Vercel rewrite
  }
  try {
    const body = await readFile(file)
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (/^\/api(\/|$)/.test(url.pathname)) {
      if (simulateRewrite && url.pathname.length > 5) {
        const extra = url.search ? `&${url.search.slice(1)}` : ''
        req.url = `/api?route=${encodeURIComponent(url.pathname.slice(5))}${extra}`
      }
      return handler(req, res)
    }
    return serveStatic(req, res, url.pathname)
  })
  .listen(port, () => console.log(`Sinvergüenzas en http://localhost:${port}`))
