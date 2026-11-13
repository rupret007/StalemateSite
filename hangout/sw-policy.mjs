// What the home-screen worker is allowed to touch.
// API, Worker, invite, and grant responses are never intercepted or stored.

export const CACHE_NAME = 'hangout-offline-v1';
export const OFFLINE_PATH = 'hangout/offline.html';

export function offlineUrl(scope) {
    return new URL(OFFLINE_PATH, scope).href;
}

export function isSensitiveRequest(url, request = {}) {
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return true;

    let parsed;
    try {
        parsed = url instanceof URL ? url : new URL(String(url));
    } catch {
        return true;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const host = parsed.hostname.toLowerCase();
    if (host === 'workers.dev' || host.endsWith('.workers.dev')) return true;
    if (request.destination === 'worker') return true;

    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (/(^|\/)beta(\/|$)/.test(path)) return true;
    if (/(^|\/)api(\/|$)/.test(path)) return true;
    if (path.includes('/hangout-worker/') || path.includes('/__')) return true;
    if (path.includes('invite') || query.includes('invite')) return true;
    if (path.includes('grant') || query.includes('grant')) return true;
    return false;
}
