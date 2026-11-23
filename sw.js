/* Service Worker: legt die App beim ersten Aufruf komplett auf dem Gerät ab. */
const V = 'theos-projekte-v1';
const CORE = ['./', './index.html', './local.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './pdf-lib.min.js', './pdf.min.mjs', './pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    /* App-Dateien: erst Netz (damit Updates ankommen), sonst Gerätespeicher */
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.open(V).then(c => c.match(r).then(m => m || fetch(r).then(res => { c.put(r, res.clone()); return res; }).catch(() => Response.error()))));
  }
});
