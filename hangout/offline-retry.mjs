// Reconnect a failed navigation. The probe is the path only, never the query or hash.

export const RETRY_MS = 1500;
export const RETRY_MAX_MS = 15000;
export const RECONNECT_COPY = 'You’re offline, we’ll reconnect.';

export function probeUrl(pathname) {
    const path = String(pathname || '/');
    if (!path.startsWith('/') || path.startsWith('//') || /[?#\\\s]/.test(path)) return '/';
    return path;
}

export function shouldReconnect(pathname) {
    return !probeUrl(pathname).endsWith('/offline.html');
}

export function startOfflineRetry(env) {
    let delay = RETRY_MS;
    let timer = 0;
    let stopped = false;

    const schedule = () => {
        if (stopped) return;
        if (timer) {
            try { env.clearTimeout(timer); } catch { /* already cleared */ }
        }
        timer = env.setTimeout(attempt, delay);
    };

    const attempt = async () => {
        if (stopped) return;
        if (!shouldReconnect(env.location.pathname)) return;
        env.setStatus?.('Trying again…');
        try {
            const response = await env.fetch(probeUrl(env.location.pathname), {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                redirect: 'manual'
            });
            try { await response?.body?.cancel?.(); } catch { /* unread */ }
            stopped = true;
            try { env.clearTimeout(timer); } catch { /* already cleared */ }
            env.reload();
        } catch {
            env.setStatus?.(RECONNECT_COPY);
            delay = Math.min(RETRY_MAX_MS, delay + 2000);
            schedule();
        }
    };

    if (!shouldReconnect(env.location.pathname)) {
        env.setStatus?.(RECONNECT_COPY);
        return () => {};
    }
    env.addEventListener('online', () => {
        if (stopped) return;
        delay = RETRY_MS;
        attempt();
    });
    schedule();
    return () => {
        stopped = true;
        env.clearTimeout(timer);
    };
}
