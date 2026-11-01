// Bounded delivery accounting, shared by the hibernating Worker and local relay.
// Retain lengths and sequence numbers only: this is not a transcript or replay queue.
export const DELIVERY_LIMITS = Object.freeze({
    // Existing room state may fill 8MiB. Preserve a valid activity snapshot plus
    // its bounded membership/protocol metadata instead of silently truncating it.
    frameBytes: 8 * 1024 * 1024 + 64 * 1024,
    pendingBytes: 16 * 1024 * 1024,
    pendingFrames: 128,
    totalPendingBytes: 32 * 1024 * 1024,
    totalPendingFrames: 8192,
    legacyFrames: 512,
    ackBurst: 32,
    ackPerSecond: 20,
    ackPerConnection: 4000,
    duplicateAcks: 8
});
const encoder = new TextEncoder();
const fresh = (now, limits) => ({ v: 1, negotiated: false, enabled: false, seq: 0, ack: 0, sizes: [], legacyCount: 0, legacyBytes: 0,
    legacyNoticeSent: false, control: { last: now, tokens: limits.ackBurst, count: 0, duplicates: 0 } });
const LEGACY_NOTICE = Object.freeze({ t: 'notice', from: 'Hang Out', kind: 'error',
    text: 'This page needs an update. Reload to keep chatting. Older tabs pause after a limited allowance; they will not automatically reconnect.' });

export function deliveryState(saved, limits = DELIVERY_LIMITS, now = Date.now()) {
    if (saved === undefined) return fresh(now, limits);
    if (!saved || saved.v !== 1 || typeof saved.negotiated !== 'boolean' || typeof saved.enabled !== 'boolean'
        || saved.enabled && !saved.negotiated || !Number.isSafeInteger(saved.seq) || saved.seq < 0
        || !Number.isSafeInteger(saved.ack) || saved.ack < 0 || saved.ack > saved.seq
        || !Array.isArray(saved.sizes) || saved.sizes.length !== saved.seq - saved.ack
        || saved.sizes.length > limits.pendingFrames || saved.sizes.some(n => !Number.isSafeInteger(n) || n <= 0 || n > limits.frameBytes)
        || saved.sizes.reduce((sum, n) => sum + n, 0) > limits.pendingBytes
        || !Number.isSafeInteger(saved.legacyCount) || saved.legacyCount < 0 || saved.legacyCount > limits.legacyFrames
        || !Number.isSafeInteger(saved.legacyBytes) || saved.legacyBytes < 0 || saved.legacyBytes > limits.pendingBytes
        || saved.legacyNoticeSent !== undefined && typeof saved.legacyNoticeSent !== 'boolean'
        || !saved.control || !Number.isFinite(saved.control.last) || saved.control.last < 0
        || !Number.isFinite(saved.control.tokens) || saved.control.tokens < 0 || saved.control.tokens > limits.ackBurst
        || !Number.isSafeInteger(saved.control.count) || saved.control.count < 0 || saved.control.count > limits.ackPerConnection
        || !Number.isSafeInteger(saved.control.duplicates) || saved.control.duplicates < 0 || saved.control.duplicates > limits.duplicateAcks
        || !saved.enabled && (saved.seq !== 0 || saved.ack !== 0 || saved.sizes.length)) throw new Error('invalid delivery state');
    return { v: 1, negotiated: saved.negotiated, enabled: saved.enabled, seq: saved.seq, ack: saved.ack,
        sizes: [...saved.sizes], legacyCount: saved.legacyCount, legacyBytes: saved.legacyBytes,
        legacyNoticeSent: saved.legacyNoticeSent === true,
        control: { last: saved.control.last, tokens: saved.control.tokens, count: saved.control.count, duplicates: saved.control.duplicates } };
}

export function acknowledgeDelivery(saved, seq) {
    if (!saved.enabled || !Number.isSafeInteger(seq) || seq <= 0 || seq > saved.seq) return null;
    if (seq <= saved.ack) return saved; // A duplicate cannot release additional credit.
    return { ...saved, ack: seq, sizes: saved.sizes.slice(seq - saved.ack) };
}

// send() exposes neither drain nor bufferedAmount in Cloudflare's documented API.
// New clients explicitly acknowledge handled frames. Legacy clients without an
// observable transport buffer get a finite lifetime allowance, then must update.
export function createSocketDelivery({ readState, writeState, onClosed = () => {}, closeSocket = (ws, code, reason) => ws.close(code, reason), limits: overrides = {}, now = () => Date.now() } = {}) {
    const limits = { ...DELIVERY_LIMITS, ...overrides };
    const states = new WeakMap(), closed = new WeakSet();
    const tracked = new Map(), observableLegacy = new Set();
    let pendingBytes = 0, pendingFrames = 0, peakPendingBytes = 0, peakPendingFrames = 0;
    const read = readState || (ws => states.get(ws));
    const write = writeState || ((ws, value) => states.set(ws, value));
    const stats = { sentFrames: 0, sentBytes: 0, acknowledged: 0, controlFrames: 0, pressureCloses: 0, failures: 0, legacyCloses: 0, controlCloses: 0 };
    const update = (ws, bytes, frames) => {
        const old = tracked.get(ws) || { bytes: 0, frames: 0 };
        pendingBytes += bytes - old.bytes; pendingFrames += frames - old.frames;
        tracked.set(ws, { bytes, frames });
        peakPendingBytes = Math.max(peakPendingBytes, pendingBytes); peakPendingFrames = Math.max(peakPendingFrames, pendingFrames);
    };
    const forget = ws => {
        const old = tracked.get(ws);
        if (old) { pendingBytes -= old.bytes; pendingFrames -= old.frames; tracked.delete(ws); }
        observableLegacy.delete(ws);
    };
    const buffered = ws => { try { const value = ws.bufferedAmount; return Number.isFinite(value) && value >= 0 ? value : null; } catch { return null; } };
    const track = (ws, state) => {
        const known = state.enabled ? null : buffered(ws);
        if (known !== null) {
            observableLegacy.add(ws); update(ws, known, known ? tracked.get(ws)?.frames || 1 : 0);
        } else {
            observableLegacy.delete(ws);
            update(ws, state.enabled ? state.sizes.reduce((sum, n) => sum + n, 0) : state.legacyBytes,
                state.enabled ? state.sizes.length : state.legacyCount);
        }
    };
    const refreshLegacy = () => {
        for (const ws of observableLegacy) {
            if (ws.readyState !== undefined && ws.readyState !== 1) { forget(ws); continue; }
            const bytes = buffered(ws);
            if (bytes !== null) update(ws, bytes, bytes ? tracked.get(ws)?.frames || 1 : 0);
        }
    };
    const stop = (ws, code, reason, kind = 'failures') => {
        if (closed.has(ws)) return false;
        closed.add(ws); forget(ws); stats[kind] += 1;
        try { closeSocket(ws, code, reason); } catch { /* Already gone; still retire its membership. */ }
        try { onClosed(ws); } catch { /* Transport cleanup must not interrupt other recipients. */ }
        return false;
    };
    const current = (ws) => {
        if (closed.has(ws) || ws.readyState !== undefined && ws.readyState !== 1) return null;
        try { const state = deliveryState(read(ws), limits, now()); track(ws, state); return state; }
        catch { stop(ws, 4413, 'connection state unavailable; reconnect'); return null; }
    };
    const save = (ws, value) => {
        try { write(ws, value); track(ws, value); return true; }
        catch { return stop(ws, 4413, 'connection state unavailable; reconnect'); }
    };
    const delivery = {
        // Rebuild aggregate accounting from every surviving attachment on wake,
        // before ordinary sends can consume another connection's credit.
        adopt(ws) {
            const state = current(ws);
            if (!state) return false;
            if (pendingBytes > limits.totalPendingBytes || pendingFrames > limits.totalPendingFrames) return stop(ws, state.enabled ? 4413 : 4001, 'community delivery is busy; reload', 'pressureCloses');
            if (!state.enabled && !state.legacyNoticeSent) {
                if (!save(ws, { ...state, legacyNoticeSent: true })) return false;
                return delivery.send(ws, LEGACY_NOTICE);
            }
            return true;
        },
        forget,
        negotiate(ws, version) {
            const state = current(ws);
            if (!state) return false;
            if (state.negotiated) return true; // Repeated hello never resets outstanding credit.
            return save(ws, { ...state, negotiated: true, enabled: version === 1, legacyCount: 0, legacyBytes: 0 });
        },
        acknowledge(ws, seq) {
            const state = current(ws);
            if (!state) return false;
            let next = acknowledgeDelivery(state, seq);
            if (!next) return stop(ws, 4400, 'invalid delivery acknowledgement');
            const time = now(), control = state.control;
            const tokens = Math.min(limits.ackBurst, control.tokens + Math.max(0, time - control.last) * limits.ackPerSecond / 1000);
            const duplicates = seq <= state.ack ? control.duplicates + 1 : 0;
            if (tokens < 1 || control.count >= limits.ackPerConnection || duplicates > limits.duplicateAcks) {
                return stop(ws, 4429, 'delivery control allowance reached; reconnect', 'controlCloses');
            }
            next = { ...next, control: { last: Math.max(time, control.last), tokens: tokens - 1, count: control.count + 1, duplicates } };
            if (!save(ws, next)) return false;
            stats.acknowledged += Math.max(0, seq - state.ack);
            stats.controlFrames += 1;
            return true;
        },
        send(ws, payload) {
            const state = current(ws);
            if (!state) return false;
            if (state.seq === Number.MAX_SAFE_INTEGER) return stop(ws, 4413, 'connection sequence exhausted; reconnect');
            let text, bytes;
            try { text = JSON.stringify(state.enabled ? { ...payload, transportSeq: state.seq + 1 } : payload); bytes = encoder.encode(text).byteLength; }
            catch { return stop(ws, 1011, 'connection unavailable'); }
            if (!bytes || bytes > limits.frameBytes) return stop(ws, 1009, 'message exceeds connection allowance');
            const bufferBytes = buffered(ws), observable = bufferBytes !== null;
            if (observable && bufferBytes + bytes > limits.pendingBytes) return stop(ws, state.enabled ? 4413 : 4001, 'connection fell behind; reload', 'pressureCloses');
            let next = state;
            if (state.enabled) {
                if (state.sizes.length >= limits.pendingFrames || state.sizes.reduce((sum, n) => sum + n, 0) + bytes > limits.pendingBytes) {
                    return stop(ws, 4413, 'connection fell behind; reconnect', 'pressureCloses');
                }
                next = { ...state, seq: state.seq + 1, sizes: [...state.sizes, bytes] };
            } else if (!observable) {
                if (state.legacyCount >= limits.legacyFrames || state.legacyBytes + bytes > limits.pendingBytes) {
                    return stop(ws, 4001, 'client update required; reload', 'legacyCloses');
                }
                next = { ...state, legacyCount: state.legacyCount + 1, legacyBytes: state.legacyBytes + bytes };
            }
            refreshLegacy();
            if (pendingBytes + bytes > limits.totalPendingBytes || pendingFrames + 1 > limits.totalPendingFrames) {
                return stop(ws, state.enabled ? 4413 : 4001, 'community delivery is busy; reload', 'pressureCloses');
            }
            const warnLegacy = !state.enabled && state.negotiated && !state.legacyNoticeSent && payload.t === 'join';
            if (warnLegacy) next = { ...next, legacyNoticeSent: true };
            if (!save(ws, next)) return false;
            try { ws.send(text); }
            catch { return stop(ws, 1011, 'connection unavailable'); }
            if (!state.enabled && observable) {
                const actual = buffered(ws);
                if (actual !== null) update(ws, actual, actual ? (tracked.get(ws)?.frames || 0) + 1 : 0);
            }
            stats.sentFrames += 1; stats.sentBytes += bytes;
            if (warnLegacy) return delivery.send(ws, LEGACY_NOTICE);
            return true;
        },
        snapshot: () => { refreshLegacy(); return { ...stats, pendingBytes, pendingFrames, peakPendingBytes, peakPendingFrames }; }
    };
    return delivery;
}

// Local adapters must not retain an unbounded promise chain while storage is slow.
export function createBoundedSerialQueue({ maxPending = 256, maxBytes = 4 * 1024 * 1024, maxCleanup = 256 } = {}) {
    let work = Promise.resolve(), pending = 0, cleanup = 0, bytes = 0, peakPending = 0, peakBytes = 0, rejected = 0;
    const enqueue = (fn, weight, retiring) => {
        if (!Number.isSafeInteger(weight) || weight < 0 || (retiring ? cleanup >= maxCleanup : pending >= maxPending) || bytes + weight > maxBytes) {
            rejected += 1; return Promise.reject(new Error('local work allowance exceeded'));
        }
        if (retiring) cleanup += 1; else pending += 1;
        bytes += weight;
        peakPending = Math.max(peakPending, pending + cleanup); peakBytes = Math.max(peakBytes, bytes);
        const task = work.then(fn).finally(() => { if (retiring) cleanup -= 1; else pending -= 1; bytes -= weight; });
        work = task.catch(() => {});
        return task;
    };
    return {
        enqueue: (fn, weight = 0) => enqueue(fn, weight, false),
        // One membership cleanup per closed socket can still run when ordinary
        // work is full; the separate allowance is bounded above the lobby cap.
        enqueueCleanup: fn => enqueue(fn, 0, true),
        settled: () => work,
        snapshot: () => ({ pending, cleanup, bytes, peakPending, peakBytes, rejected, maxPending, maxBytes, maxCleanup })
    };
}
