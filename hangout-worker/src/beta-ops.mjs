// Separate read-only operations credential. It never admits a guest or grants a moderation role.
import { equalInvite } from './beta-auth.mjs';

export const INTERNAL_HEALTH_PATH = '/__beta/health';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const counter = (value) => Number.isFinite(value) && value >= 0;
const headers = { 'Cache-Control': 'no-store', 'Vary': 'Authorization', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export const healthJson = (body, status = 200) => Response.json(body, { status, headers });

// Read the current period without resetting the actual allowance or writing to storage.
export function dailyUsage(stored, field, now = Date.now()) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (stored === undefined) return { day: today, used: 0 };
    if (!stored || !counter(stored[field]) || typeof stored.day !== 'string' ||
        stored.day !== '' && !DAY.test(stored.day) || stored.day > today || stored.day === '' && stored[field] !== 0) return null;
    return { day: today, used: stored.day === today ? stored[field] : 0 };
}
export function aiHealth(env, stored) {
    const enabled = env.HANGOUT_AI_MODERATION === 'review';
    const configured = typeof env.OPENAI_API_KEY === 'string' && !!env.OPENAI_API_KEY.trim();
    const rawLimit = Number(env.HANGOUT_AI_DAILY_LIMIT);
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10000) : 1000;
    const daily = stored !== undefined && !Number.isSafeInteger(stored?.used) ? null : dailyUsage(stored, 'used');
    return { enabled, configured, state: !enabled ? 'disabled' : !configured ? 'misconfigured' : !daily ? 'unknown' : daily.used >= limit ? 'capped' : 'unknown',
        quota: daily && { ...daily, limit } };
}

async function internalRead(binding, name) {
    if (!binding) return null;
    let timer, reader;
    const controller = new AbortController();
    try {
        const request = (async () => {
            const response = await binding.get(binding.idFromName(name)).fetch(new Request(`https://ops${INTERNAL_HEALTH_PATH}`, { method: 'GET', signal: controller.signal }));
            if (!response.ok || !response.body) return null;
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let size = 0, text = '';
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 8192) { await reader.cancel(); return null; }
                text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
            const value = JSON.parse(text);
            return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        })();
        const deadline = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); reader?.cancel().catch(() => {}); resolve(null); }, 5000); });
        return await Promise.race([request, deadline]);
    } catch { return null; }
    finally { clearTimeout(timer); }
}
const inSet = (value, values) => values.includes(value) ? value : 'unknown';
const bool = (value) => typeof value === 'boolean' ? value : null;

export async function betaHealth(request, env, { betaConfigured = false, accessConfigured = false } = {}) {
    const key = env.HANGOUT_BETA_OPS_KEY;
    if (env.HANGOUT_BETA_MODE !== 'protected' || typeof key !== 'string' || key.length < 32 || key.length > 256 || /\s/.test(key)) return healthJson({ error: 'ops-not-configured' }, 503);
    const bearer = /^Bearer ([^\s]{32,256})$/i.exec(request.headers.get('Authorization') || '')?.[1];
    if (!equalInvite(bearer, key)) {
        const response = healthJson({ error: 'unauthorized' }, 401);
        response.headers.set('WWW-Authenticate', 'Bearer realm="stalemate-beta-ops"'); return response;
    }
    if (request.method !== 'GET') { const response = healthJson({ error: 'method-not-allowed' }, 405); response.headers.set('Allow', 'GET'); return response; }
    const [lobby, quota, registry] = await Promise.all([
        internalRead(env.LOBBY, 'stalemate'), internalRead(env.QUOTA, 'global'), internalRead(env.BETA_SESSIONS, 'global')
    ]);
    const storage = { lobby: lobby?.storage === 'ok' ? 'ok' : 'unavailable', quota: quota?.storage === 'ok' ? 'ok' : 'unavailable', registry: registry?.storage === 'ok' ? 'ok' : 'unavailable' };
    const reasons = [];
    if (!betaConfigured) reasons.push('beta-unconfigured');
    for (const name of ['lobby', 'quota', 'registry']) if (storage[name] !== 'ok') reasons.push(`${name}-unavailable`);
    const admission = { state: !betaConfigured ? 'unconfigured' : env.HANGOUT_OPEN === '0' ? 'paused' : 'open',
        lock: inSet(lobby?.lock, ['off', 'readonly', 'closed']), shield: bool(lobby?.shield), lockAuto: bool(lobby?.lockAuto) };
    if (admission.state === 'paused') reasons.push('admission-paused');
    if (admission.lock !== 'off') reasons.push(admission.lock === 'unknown' ? 'lobby-state-unknown' : `lobby-${admission.lock}`);
    if (admission.shield) reasons.push('shield-on');
    if (lobby?.evidenceStorage === 'degraded') reasons.push('storage-degraded');
    if (!accessConfigured) reasons.push('identity-unconfigured');
    const staffConfigured = accessConfigured && [env.HANGOUT_OWNER_EMAIL, env.HANGOUT_BAND_EMAILS, env.HANGOUT_MODERATOR_EMAILS].some((list) =>
        String(list || '').split(',').some((email) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(email.trim())));
    if (!staffConfigured) reasons.push('staff-unconfigured');
    const contactConfigured = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(String(env.HANGOUT_MODERATION_CONTACT || '').trim());
    if (!contactConfigured) reasons.push('contact-unconfigured');
    const ai = { enabled: env.HANGOUT_AI_MODERATION === 'review', configured: typeof env.OPENAI_API_KEY === 'string' && !!env.OPENAI_API_KEY.trim(),
        state: inSet(lobby?.ai?.state, ['disabled', 'misconfigured', 'ready', 'capped', 'unknown']) };
    if (ai.enabled && !ai.configured) reasons.push('ai-misconfigured');
    if (ai.state === 'capped') reasons.push('ai-capped');
    const turnBudget = Number(env.HANGOUT_TURN_MONTHLY_GB);
    const turnConfigured = !!(env.TURN_BUDGET && env.HANGOUT_TURN_KEY_ID && env.HANGOUT_TURN_API_TOKEN && env.HANGOUT_TURN_ANALYTICS_TOKEN &&
        /^[a-f0-9]{32}$/.test(env.HANGOUT_CF_ACCOUNT_ID || '') && Number.isFinite(turnBudget) && turnBudget > 0 && turnBudget <= 800);
    if (env.HANGOUT_TURN_ENABLED === '1' && !turnConfigured) reasons.push('turn-misconfigured');
    const usage = [];
    function add(name, item, unit, period) {
        if (!item || !counter(item.used) || !counter(item.limit) || item.limit <= 0 || period === 'day' && item.day !== new Date().toISOString().slice(0, 10)) return false;
        usage.push({ name, used: item.used, limit: item.limit, unit, scope: 'application', period }); return true;
    }
    const known = [add('connections', quota?.quota, 'connections', 'day'), add('lobbyRequests', lobby?.quota, 'requests', 'day'),
        add('aiReviews', lobby?.ai?.quota, 'reviews', 'day'), add('betaSessions', registry?.quota, 'sessions', 'active')];
    if (known.some((value) => !value)) reasons.push('usage-unknown');
    for (const item of usage) {
        if (item.name === 'connections' && item.used >= item.limit) reasons.push('connections-capped');
        if (item.name === 'betaSessions' && item.used >= item.limit) reasons.push('sessions-capped');
        if (item.name === 'lobbyRequests' && item.used >= item.limit * .85) reasons.push(item.used >= item.limit * .95 ? 'lobby-budget-closed' : 'lobby-budget-readonly');
    }
    const unavailable = !betaConfigured || Object.values(storage).includes('unavailable');
    return healthJson({ version: 1, checkedAt: new Date().toISOString(), service: { state: unavailable ? 'unavailable' : reasons.length ? 'degraded' : 'ready', reasons },
        admission, storage, storageCheck: 'read-only', providerChecks: 'not-performed',
        features: { email: { configured: !!accessConfigured, provider: 'not-probed' }, staffAuth: { configured: !!staffConfigured }, moderationContact: { configured: contactConfigured }, ai,
            turn: { enabled: env.HANGOUT_TURN_ENABLED === '1', configured: turnConfigured, providerUsage: 'unknown' } }, usage }, unavailable ? 503 : 200);
}
