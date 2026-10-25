import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/* from the same handler the Vercel Function uses, backed by an
// in-memory store (or your Redis, if configured), so `npm run dev` runs the
// whole game locally with no accounts.
function devApi() {
  const handlerUrl = pathToFileURL(path.resolve('server/handler.js')).href
  const mount = (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (!/^\/api(\/|\?|$)/.test(req.url)) return next()
      const { default: handler } = await import(handlerUrl)
      handler(req, res)
    })
  }
  return { name: 'sinverguenzas-api', configureServer: mount, configurePreviewServer: mount }
}

// Absolute URLs for link previews (WhatsApp needs an absolute og:image).
function siteUrl() {
  const host = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
  if (!host) return ''
  return host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host}`
}

function htmlSiteUrl() {
  return {
    name: 'sinverguenzas-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl()),
  }
}

// Vite only exposes VITE_* variables to the browser; the API reads its
// database settings from process.env, so copy them over from .env files.
const SERVER_ENV = ['REDIS_URL', 'KV_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of SERVER_ENV) if (env[key] && !process.env[key]) process.env[key] = env[key]
  return {
    plugins: [react(), devApi(), htmlSiteUrl()],
    server: { host: true },
    preview: { host: true },
    build: { target: 'es2020' },
  }
})
