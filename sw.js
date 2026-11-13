import { injectJoinGuide, isJoinNavigation } from './hangout/join-guide.mjs';
import { CACHE_NAME, isOfflineAsset, isSensitiveRequest, offlineAssetUrls, offlineDocument, offlineUrl } from './hangout/sw-policy.mjs';

// Installability, one offline page, and its retry script. Successful responses
// are not stored. Sensitive requests are not intercepted.

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        for (const href of offlineAssetUrls(self.registration.scope)) {
            await cache.add(href);
        }
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

async function offlineFallback(scope) {
    const cached = await caches.match(offlineUrl(scope));
    if (!cached) {
        return new Response('You’re offline, we’ll reconnect.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
    return new Response(offlineDocument(await cached.text(), scope), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

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
    if (isOfflineAsset(url, self.registration.scope)) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            return fetch(request);
        })());
        return;
    }
    if (request.mode !== 'navigate' || request.method !== 'GET') return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (!isJoinNavigation(url)) return response;
            const type = response.headers.get('content-type') || '';
            if (!response.ok || !type.includes('text/html')) return response;
            const headers = new Headers(response.headers);
            headers.delete('content-length');
            headers.delete('content-encoding');
            headers.set('cache-control', 'no-store');
            const assetBase = new URL('hangout/', self.registration.scope).href;
            return new Response(injectJoinGuide(await response.text(), assetBase, url), {
                status: response.status,
                headers
            });
        } catch {
            return offlineFallback(self.registration.scope);
        }
    })());
});
