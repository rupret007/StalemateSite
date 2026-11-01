// Server-only, review-only classifier. Never logs input, credentials or provider responses.
// Only the text of an eligible new public line leaves the Worker; no user/room identifiers.
export const AI_MODERATION_MODEL = 'omni-moderation-latest';
export const AI_CATEGORIES = Object.freeze([
    'harassment', 'harassment/threatening', 'hate', 'hate/threatening',
    'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent',
    'self-harm/instructions', 'sexual', 'sexual/minors', 'violence', 'violence/graphic'
]);
const ENDPOINT = 'https://api.openai.com/v1/moderations';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const positive = (v, fallback, max) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Math.min(Number(v), max) : fallback;

async function boundedBody(response, signal) {
    if (Number(response.headers.get('content-length')) > 32768 || !response.body) throw new Error('invalid-response');
    const reader = response.body.getReader();
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
        while (true) {
            if (signal.aborted) throw new Error('timeout');
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 32768) { cancel(); throw new Error('invalid-response'); }
            body += decoder.decode(value, { stream: true });
        }
        return body + decoder.decode();
    } finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}

export function parseModerationResult(body) {
    if (!object(body) || typeof body.model !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(body.model)
        || !Array.isArray(body.results) || body.results.length !== 1) return null;
    const r = body.results[0];
    if (!object(r) || typeof r.flagged !== 'boolean' || !object(r.categories) || !object(r.category_scores)) return null;
    for (const key of AI_CATEGORIES) {
        if (typeof r.categories[key] !== 'boolean' || !Number.isFinite(r.category_scores[key])
            || r.category_scores[key] < 0 || r.category_scores[key] > 1) return null;
    }
    const categories = AI_CATEGORIES.filter((key) => r.categories[key]);
    if (r.flagged !== (categories.length > 0)) return null;
    return { status: 'reviewed', flagged: r.flagged, model: body.model, categories,
        scores: Object.fromEntries(AI_CATEGORIES.map((key) => [key, r.category_scores[key]])) };
}

export function createAiModerator({ enabled = false, apiKey = '', fetchImpl = globalThis.fetch, now = () => Date.now(),
    usage, saveUsage = async () => {}, onChange = () => {}, dailyLimit = 1000, maxConcurrent = 3, timeoutMs = 4000 } = {}) {
    const limit = positive(dailyLimit, 1000, 10000);
    const concurrency = positive(maxConcurrent, 3, 5);
    const timeout = positive(timeoutMs, 4000, 10000);
    const configured = typeof apiKey === 'string' && apiKey.trim().length > 0 && typeof fetchImpl === 'function';
    // A malformed saved budget is spent, rather than silently granting another day's quota.
    let day = dayOf(now());
    let used = usage === undefined ? 0 : object(usage) && /^\d{4}-\d{2}-\d{2}$/.test(usage.day)
        && usage.day <= day && Number.isSafeInteger(usage.used) && usage.used >= 0
        ? (usage.day === day ? usage.used : 0) : limit;
    let pending = 0;
    let checked = 0;
    let flagged = 0;
    let failed = 0;
    let skipped = 0;
    let degraded = false;
    let retryAfter = 0;
    let failureGeneration = 0;
    const changed = () => { try { onChange(); } catch { /* status display cannot break chat */ } };
    function resetDay() { const today = dayOf(now()); if (today > day) { day = today; used = 0; } }
    function status() {
        resetDay();
        return { enabled, mode: 'review-only', state: !enabled ? 'disabled' : !configured ? 'misconfigured'
            : used >= limit ? 'capped' : degraded ? 'degraded' : 'ready',
        checked, flagged, failed, skipped, used, limit, pending };
    }
    function skip(reason) { skipped += 1; changed(); return { status: 'unavailable', reason }; }
    async function review({ text, beforeDispatch, startDispatch } = {}) {
        resetDay();
        if (!enabled) return { status: 'unavailable', reason: 'disabled' };
        if (!configured) return skip('not-configured');
        if (typeof text !== 'string' || !text.trim() || text.length > 300) return skip('invalid-input');
        if (used >= limit) return skip('daily-limit');
        if (pending >= concurrency) return skip('busy');
        if (now() < retryAfter) return skip('backoff');
        pending += 1;
        used += 1;
        changed();
        const controller = new AbortController();
        const startedGeneration = failureGeneration;
        let timer;
        try {
            const reservation = { day, used };
            const request = (async () => {
                // The deadline includes storage. A late reservation must never start a late API call.
                await saveUsage(reservation);
                if (controller.signal.aborted) throw new Error('timeout');
                if (beforeDispatch !== undefined && (typeof beforeDispatch !== 'function' || await beforeDispatch() !== true)) throw new Error('participation-denied');
                if (controller.signal.aborted) throw new Error('timeout');
                const start = () => {
                if (controller.signal.aborted) throw new Error('timeout');
                return fetchImpl(ENDPOINT, {
                    method: 'POST', redirect: 'manual', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: AI_MODERATION_MODEL, input: text })
                }); };
                if (startDispatch !== undefined && typeof startDispatch !== 'function') throw new Error('participation-denied');
                const response = await (startDispatch ? startDispatch(start) : start());
                if (!response.ok) throw new Error('provider-unavailable');
                const body = await boundedBody(response, controller.signal);
                const result = parseModerationResult(JSON.parse(body));
                if (!result) throw new Error('invalid-response');
                return result;
            })();
            const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeout); });
            const result = await Promise.race([request, deadline]);
            checked += 1;
            if (result.flagged) flagged += 1;
            if (startedGeneration === failureGeneration) { degraded = false; retryAfter = 0; }
            return result;
        } catch {
            failed += 1;
            failureGeneration += 1;
            degraded = true;
            retryAfter = now() + 30000;
            return { status: 'unavailable', reason: 'review-failed' };
        } finally {
            clearTimeout(timer);
            pending -= 1;
            changed();
        }
    }
    return { review, status };
}
