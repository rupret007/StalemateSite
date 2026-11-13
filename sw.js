import { CACHE_NAME, isSensitiveRequest, offlineUrl } from './hangout/sw-policy.mjs';

// Installability plus one offline page. Successful responses are not stored.
// Sensitive requests are not intercepted, so this worker cannot cache them.

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.add(offlineUrl(self.registration.scope));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith('hangout-offline-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (url.origin !== self.location.origin) return;
    if (isSensitiveRequest(url, request)) return;
    if (request.mode !== 'navigate' || request.method !== 'GET') return;

    event.respondWith((async () => {
        try {
            return await fetch(request);
        } catch {
            const cached = await caches.match(offlineUrl(self.registration.scope));
            if (cached) return cached;
            return new Response('You’re offline.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
    })());
});
