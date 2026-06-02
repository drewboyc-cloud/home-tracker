const CACHE_NAME = 'tracker-v2';
const BASE = '/home-tracker';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/sw.js'
];

// ─── Install: cache all assets immediately ────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: delete old caches + claim all clients right away ───────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: App Shell strategy ────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests → always serve cached index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(BASE + '/index.html', { ignoreSearch: true })
        .then(r => r || fetch(e.request))
        .catch(() => caches.match(BASE + '/index.html'))
    );
    return;
  }

  // Everything else → cache first, network fallback
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true, ignoreVary: true })
      .then(cached => {
        if (cached) return cached;
        return fetch(e.request)
          .then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            }
            return response;
          })
          .catch(() => caches.match(BASE + '/index.html'));
      })
  );
});

// ─── Notification scheduling ──────────────────────────────────────────────

const scheduledTimers = new Map();

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleAll(e.data.notifications);
  }
  if (e.data?.type === 'CANCEL_ALL') {
    for (const [, timer] of scheduledTimers) clearTimeout(timer);
    scheduledTimers.clear();
  }
});

function scheduleAll(notifications) {
  for (const [, timer] of scheduledTimers) clearTimeout(timer);
  scheduledTimers.clear();

  const now = Date.now();

  for (const notif of notifications) {
    const fireAt = new Date(notif.fireAt).getTime();
    const delay = fireAt - now;
    if (delay < 0) continue;

    const safeDelay = Math.min(delay, 2073600000);

    const timer = setTimeout(() => {
      self.registration.showNotification(notif.title, {
        body: notif.body,
        tag: notif.id,
        data: { id: notif.id },
        requireInteraction: false,
        vibrate: [200, 100, 200]
      });
    }, safeDelay);

    scheduledTimers.set(notif.id, timer);
  }
}

// ─── Notification click → focus or open app ───────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(BASE + '/');
    })
  );
});

// ─── Push (server-side, future use) ──────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'Tracker Reminder', body: 'You have an item due soon.' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.id || 'push'
    })
  );
});
