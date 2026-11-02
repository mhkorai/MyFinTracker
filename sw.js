const CACHE = 'expense-tracker-v50';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'io.js', 'sync.js', 'icons.js', 'xlsx.mini.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (so updates show up on the next open), saved copy when offline or slow.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  const u0 = new URL(e.request.url);
  if (u0.pathname.endsWith('/reminder.ics')) {
    const q = u0.searchParams, z = ms => new Date(+ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const s = +q.get('s') || Date.now(), esc = x => String(x || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyFinTracker//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + (q.get('u') || s) + '@myfintracker', 'DTSTAMP:' + z(Date.now()), 'DTSTART:' + z(s), 'DTEND:' + z(s + 36e5),
      'SUMMARY:' + esc(q.get('t') || 'Debt reminder'), 'DESCRIPTION:' + esc(q.get('d')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Debt reminder', 'TRIGGER:PT0M', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Debt reminder', 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    e.respondWith(new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="debt-reminder.ics"' } }));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(e.request, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit; throw err;
    }
  })());
});

self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('./'))); });
