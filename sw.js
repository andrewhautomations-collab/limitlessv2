// LIMITLESS service worker — app-shell offline cache + background rest-timer notifications.
// Bump CACHE_VERSION on every deploy so clients pick up the new shell instead of a stale cache.
const CACHE_VERSION = 'limitless-v6';
const CACHE_NAME = `${CACHE_VERSION}-shell`;

const APP_SHELL = [
  './',
  'limitless.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin app shell: cache-first for instant offline loads, re-fetching in the
// background isn't needed here since CACHE_VERSION is the update mechanism.
// Cross-origin calls (Anthropic AI coach, Supabase cloud sync) are left alone —
// they're dynamic/authenticated and must never be cached.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('limitless.html'));
    })
  );
});

/* ============ Rest-timer background notifications ============
   The page posts REST_START (with the absolute end timestamp) when a rest
   timer begins, and REST_STOP if it's cancelled or completes while the tab
   is open. That lets the notification fire here, in the SW, instead of the
   page — so it can still show up if the tab is backgrounded or the phone
   is locked.

   TODO: setTimeout inside a service worker is best-effort, not guaranteed.
   Mobile browsers (especially iOS Safari) can suspend or fully terminate a
   service worker after roughly 30s of inactivity, so long rests may not
   fire while the phone stays locked or the app has been backgrounded for a
   while. The only fully reliable fix is server-triggered Web Push (VAPID)
   that wakes the SW at the exact rest-end time — that needs a small backend
   to hold the push subscription and fire it, which this static, no-build
   single-file app intentionally doesn't have. This is the closest robust
   approach without standing up that server. */
let restTimer = null;
let remindTimer = null;

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'REST_START') {
    if (restTimer) clearTimeout(restTimer);
    const ms = Math.max(0, (data.endAt || 0) - Date.now());
    restTimer = setTimeout(() => {
      restTimer = null;
      self.registration.showNotification('LIMITLESS', {
        body: '⏱️ Rest complete — start your next set 💪',
        tag: 'rest-timer',
        renotify: true,
        vibrate: [300, 120, 300],
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png'
      });
    }, ms);
  } else if (data.type === 'REST_STOP') {
    if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  } else if (data.type === 'REMIND_START') {
    // Daily "don't break the streak" nudge — same best-effort timer mechanism
    // and OS-suspension caveat as the rest timer above.
    if (remindTimer) clearTimeout(remindTimer);
    const ms = Math.max(0, (data.endAt || 0) - Date.now());
    const n = data.count || 0;
    remindTimer = setTimeout(() => {
      remindTimer = null;
      self.registration.showNotification('LIMITLESS', {
        body: '🔥 Don’t break the streak — ' + (n === 1 ? '1 habit' : n + ' habits') + ' left to log today',
        tag: 'daily-reminder',
        vibrate: [300, 120, 300],
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png'
      });
    }, ms);
  } else if (data.type === 'REMIND_STOP') {
    if (remindTimer) { clearTimeout(remindTimer); remindTimer = null; }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
