/** Runtime ICE for Hang Out video. Credentials live only in Worker env, never in assets. */
export const HANGOUT_STUN = Object.freeze([{ urls: 'stun:stun.cloudflare.com:3478' }]);

const URL_RE = /^(stun|turn|turns):[^\s]+$/;

function parseTurnUrls(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const urls = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (!urls.length || urls.length > 16) return null;
    if (urls.some((url) => !URL_RE.test(url))) return null;
    return urls;
}

/**
 * True only when the static relay config is complete: valid URLs plus the
 * credentials those URLs need. URLs without credentials are not advertised.
 */
export function runtimeTurnConfigured(env) {
    return !!buildRuntimeTurnEntries(env);
}

/** Hang Out may mint relay ICE when Cloudflare TURN or static URLs are configured. */
export function hangoutTurnServiceEnabled(env) {
    return env?.HANGOUT_TURN_ENABLED === '1' || runtimeTurnConfigured(env);
}

/** TURN relay entries only (client prepends STUN). Null when unset or invalid. */
export function buildRuntimeTurnEntries(env) {
    const urls = parseTurnUrls(env?.HANGOUT_TURN_URLS);
    if (!urls) return null;
    const needsCreds = urls.some((url) => /^turns?:/.test(url));
    const username = typeof env?.HANGOUT_TURN_USERNAME === 'string' ? env.HANGOUT_TURN_USERNAME.trim() : '';
    const credential = typeof env?.HANGOUT_TURN_CREDENTIAL === 'string' ? env.HANGOUT_TURN_CREDENTIAL : '';
    if (needsCreds && (!username || !credential)) return null;
    return [{ urls, ...(needsCreds ? { username, credential } : {}) }];
}

/** Full iceServers list for RTCPeerConnection when only env is available (no fetch). */
export function clientIceServersFromEnv(env) {
    const turn = buildRuntimeTurnEntries(env);
    if (!turn) return HANGOUT_STUN.map((server) => ({ ...server }));
    return HANGOUT_STUN.map((server) => ({ ...server })).concat(turn);
}