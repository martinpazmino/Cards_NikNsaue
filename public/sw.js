// Minimal service worker: makes the app installable on Chrome and shows a
// friendly page when there's no connection. It never caches the app, so a
// new deploy shows up on the next load.

const OFFLINE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión · Sinvergüenzas</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#120c22;color:#fff7ec;
font:600 18px system-ui,sans-serif;text-align:center}button{margin-top:18px;padding:14px 22px;border:0;border-radius:14px;
background:linear-gradient(135deg,#ff4d8d,#ff6b35);color:#fff;font:inherit}</style></head>
<body><div><div style="font-size:56px">📵</div><p>Sin conexión. Revisa tu internet.<br>No connection.</p>
<button onclick="location.reload()">Reintentar</button></div></body></html>`

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

// Only page loads go through here; API calls and assets go straight to the network.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request))
      } catch {
        return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
    })(),
  )
})
