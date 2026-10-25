import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/* from the same handler the Vercel Function uses, backed by an
// in-memory store (or Upstash if its env vars are set), so `npm run dev`
// runs the whole game locally with no accounts.
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

export default defineConfig({
  plugins: [react(), devApi(), htmlSiteUrl()],
  server: { host: true },
  preview: { host: true },
  build: { target: 'es2020' },
})
