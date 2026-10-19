/* Fresh host snapshot attestations. No transport, timers, UI, chat or state mutation. */
(function initPrivateSnapshot(global) {
    'use strict';

    const LIMITS = Object.freeze({ partBytes: 192 * 1024, totalBytes: 8 * 1024 * 1024,
        parts: 128, strokes: 1500, strokesPerPart: 100, points: 3200, controlBytes: 16 * 1024 });
    const enc = new TextEncoder();
    const verified = new WeakMap();
    const fail = () => { throw new Error('Invalid private snapshot'); };
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const peer = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
    const validNonce = value => typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
    const bytes = value => enc.encode(JSON.stringify(value)).byteLength;

    function b64u(data) {
        let text = '';
        for (const value of data) text += String.fromCharCode(value);
        return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function nonce(cryptoImpl = global.crypto) {
        return b64u(cryptoImpl.getRandomValues(new Uint8Array(18)));
    }

    function freeze(value) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    }

    function copy(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fail(); }
    }

    function stroke(value) {
        if (!value || typeof value !== 'object' || typeof value.id !== 'string'
            || !value.id || value.id.length > 40 || /[\u0000-\u001f\u007f]/.test(value.id)
            || typeof value.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value.color)
            || !Number.isFinite(value.size) || value.size < 1 || value.size > 48
            || !Array.isArray(value.pts) || !value.pts.length || value.pts.length > LIMITS.points) return fail();
        const pts = value.pts.map(point => {
            if (!Array.isArray(point) || point.length !== 2
                || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return fail();
            return [point[0], point[1]];
        });
        return { id: value.id, color: value.color, size: value.size, pts };
    }

    function control(value, kind, seq) {
        if (!value || typeof value !== 'object' || bytes(value) > LIMITS.controlBytes) return fail();
        const out = copy(value);
        if (out.type !== 'host' || !out.body || typeof out.body !== 'object' || Array.isArray(out.body)
            || !integer(out.body.seq) || out.body.seq > seq || typeof out.sig !== 'string'
            || !/^[A-Za-z0-9_-]{1,256}$/.test(out.sig) || !kind.includes(out.body.kind)) return fail();
        return out;
    }

    function controls(value, seq) {
        if (!Array.isArray(value) || value.length > 2) return fail();
        const kinds = new Set();
        return value.map(item => {
            const out = control(item, ['lock', 'spot'], seq);
            if (kinds.has(out.body.kind)) return fail();
            kinds.add(out.body.kind);
            return out;
        });
    }

    function video(value, seq) {
        if (value === null) return null;
        if (!value || typeof value !== 'object' || bytes(value) > LIMITS.controlBytes) return fail();
        const out = copy(value);
        out.signed = control(out.signed, ['video'], seq);
        return out;
    }

    function cleanPayload(message, seq) {
        if (!message || typeof message !== 'object' || message.type !== 'snapshot'
            || !peer(message.to) || !validNonce(message.request) || !validNonce(message.batch)
            || !integer(seq) || message.seq !== seq || !integer(message.epoch) || message.epoch > seq
            || !integer(message.part) || !integer(message.parts) || !message.parts
            || message.parts > LIMITS.parts || message.part >= message.parts
            || message.chunk !== (message.parts > 1) || message.first !== (message.part === 0)
            || message.done !== (message.part === message.parts - 1)
            || Object.hasOwn(message, 'chat') || !Array.isArray(message.strokes)
            || message.strokes.length > LIMITS.strokesPerPart) return fail();
        const last = message.done;
        const out = { type: 'snapshot', to: message.to, request: message.request, batch: message.batch, seq,
            part: message.part, parts: message.parts, epoch: message.epoch,
            clear: message.clear === null ? null : control(message.clear, ['clear'], seq),
            strokes: message.strokes.map(stroke), video: video(message.video, seq),
            mods: controls(message.mods, seq), chunk: message.chunk, first: message.first, done: last };
        if (out.epoch === 0 ? out.clear !== null : out.clear?.body.seq !== out.epoch) return fail();
        if (!last && (out.video !== null || out.mods.length)) return fail();
        if (bytes(out) > LIMITS.partBytes) return fail();
        return out;
    }

    function makeChunks(input, { crypto: cryptoImpl = global.crypto } = {}) {
        if (!input || !peer(input.to) || !validNonce(input.request) || !integer(input.seq)
            || !integer(input.epoch) || input.epoch > input.seq || !Array.isArray(input.strokes)
            || input.strokes.length > LIMITS.strokes) return fail();
        const batch = nonce(cryptoImpl);
        const clear = input.clear === null ? null : control(input.clear, ['clear'], input.seq);
        if (input.epoch === 0 ? clear !== null : clear?.body.seq !== input.epoch) return fail();
        const lastVideo = video(input.video, input.seq);
        const mods = controls(input.mods, input.seq);
        const groups = [];
        let group = [], groupBytes = 0, strokeBytes = 0;
        const ids = new Set();
        // Reserve terminal controls and worst-case part-number width in every
        // part, so adding those fields can never exceed the wire payload cap.
        const base = { type: 'snapshot', to: input.to, request: input.request, batch, seq: input.seq,
            part: LIMITS.parts - 1, parts: LIMITS.parts, epoch: input.epoch, clear,
            strokes: [], video: lastVideo, mods, chunk: true, first: false, done: false };
        const budget = LIMITS.partBytes - bytes(base) - 16;
        for (const raw of input.strokes) {
            const item = stroke(raw);
            if (ids.has(item.id)) return fail();
            ids.add(item.id);
            const length = bytes(item) + 1;
            strokeBytes += length;
            if (length > budget || strokeBytes > LIMITS.totalBytes) return fail();
            if (group.length && (group.length >= LIMITS.strokesPerPart || groupBytes + length > budget)) {
                groups.push(group); group = []; groupBytes = 0;
            }
            group.push(item); groupBytes += length;
            if (groups.length >= LIMITS.parts) return fail();
        }
        if (group.length || !groups.length) groups.push(group);
        if (groups.length > LIMITS.parts) return fail();
        let total = 0;
        return freeze(groups.map((strokes, part) => {
            const last = part === groups.length - 1;
            const payload = cleanPayload({ type: 'snapshot', to: input.to, request: input.request, seq: input.seq,
                batch, part, parts: groups.length, epoch: input.epoch, clear, strokes,
                video: last ? lastVideo : null, mods: last ? mods : [],
                chunk: groups.length > 1, first: part === 0, done: last }, input.seq);
            total += bytes(payload);
            if (total > LIMITS.totalBytes) return fail();
            return payload;
        }));
    }

    async function digest(payload, subtle) {
        // cleanPayload fixes the outer field order. Preserve embedded signed
        // bodies exactly: their existing signatures bind JSON.stringify order.
        return b64u(new Uint8Array(await subtle.digest('SHA-256', enc.encode(JSON.stringify(payload)))));
    }

    async function proofBody(message, seq, subtle = global.crypto.subtle) {
        const payload = cleanPayload(message, seq);
        return { kind: 'snapshot', seq, to: payload.to, request: payload.request,
            batch: payload.batch, part: payload.part, parts: payload.parts,
            digest: await digest(payload, subtle) };
    }

    async function verifyPart(message, ctx, verifyHost, subtle = global.crypto.subtle) {
        const context = { to: ctx?.to, request: ctx?.request, seqFloor: ctx?.seqFloor, epochFloor: ctx?.epochFloor ?? 0 };
        if (!peer(context.to) || !validNonce(context.request) || !integer(context.seqFloor)
            || !integer(context.epochFloor)
            || typeof verifyHost !== 'function') return fail();
        const rawProof = message?.lastHostSeqSigned;
        const envelopeKeys = ['type', 'body', 'sig'];
        const bodyKeys = ['kind', 'seq', 'to', 'request', 'batch', 'part', 'parts', 'digest'];
        if (!rawProof || typeof rawProof !== 'object' || Array.isArray(rawProof)
            || Object.keys(rawProof).length !== envelopeKeys.length
            || Object.keys(rawProof).some(key => !envelopeKeys.includes(key))
            || rawProof.type !== 'host' || typeof rawProof.sig !== 'string'
            || !/^[A-Za-z0-9_-]{86}$/.test(rawProof.sig)
            || !rawProof.body || typeof rawProof.body !== 'object' || Array.isArray(rawProof.body)
            || Object.keys(rawProof.body).length !== bodyKeys.length
            || Object.keys(rawProof.body).some(key => !bodyKeys.includes(key))
            || bytes(rawProof) > LIMITS.controlBytes) return fail();
        const signed = copy(rawProof);
        const body = signed?.body;
        if (!body || body.kind !== 'snapshot' || !integer(body.seq) || body.seq < context.seqFloor
            || body.to !== context.to || body.request !== context.request
            || typeof body.digest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.digest)) return fail();
        const payload = cleanPayload(message, body.seq);
        if (payload.to !== context.to || payload.request !== context.request || payload.epoch < context.epochFloor
            || body.batch !== payload.batch
            || body.part !== payload.part || body.parts !== payload.parts) return fail();
        if (await digest(payload, subtle) !== body.digest || !await verifyHost(signed)) return fail();
        const result = freeze({ ...payload, lastHostSeqSigned: signed });
        verified.set(result, { mode: 'host', seq: body.seq, digest: body.digest, length: bytes(payload) });
        return result;
    }

    // This is shape/nonce validation only. The unsigned sequence and controls
    // confer no authority; callers must verify clear/legacy proofs separately.
    function parsePeerPart(message, ctx) {
        const context = { to: ctx?.to, request: ctx?.request, epochFloor: ctx?.epochFloor ?? 0 };
        if (!peer(context.to) || !validNonce(context.request) || !integer(context.epochFloor)) return fail();
        const payload = cleanPayload(message, message?.seq);
        if (payload.to !== context.to || payload.request !== context.request || payload.epoch < context.epochFloor) return fail();
        const result = freeze(payload);
        verified.set(result, { mode: 'peer', seq: payload.seq, digest: JSON.stringify(payload), length: bytes(payload) });
        return result;
    }

    function createAssembly(ctx) {
        const context = { to: ctx?.to, request: ctx?.request, seqFloor: ctx?.seqFloor ?? 0,
            epochFloor: ctx?.epochFloor ?? 0, peer: ctx?.peer === true };
        if (!peer(context.to) || !validNonce(context.request) || !integer(context.seqFloor)
            || !integer(context.epochFloor) || ctx?.peer !== undefined && typeof ctx.peer !== 'boolean') return fail();
        const parts = new Map();
        let common = null, total = 0, count = 0, failed = false, finished = null;
        const reject = () => { failed = true; parts.clear(); return fail(); };
        return {
            add(message) {
                if (failed) return fail();
                const proof = verified.get(message);
                if (!proof || proof.mode !== (context.peer ? 'peer' : 'host')
                    || message.to !== context.to || message.request !== context.request
                    || message.epoch < context.epochFloor || !context.peer && proof.seq < context.seqFloor) return reject();
                const identity = JSON.stringify({ batch: message.batch, parts: message.parts,
                    seq: proof.seq, epoch: message.epoch, clear: message.clear });
                if (common !== null && identity !== common) return reject();
                common = identity;
                const old = parts.get(message.part);
                if (old) {
                    if (verified.get(old).digest !== proof.digest) return reject();
                    return null;
                }
                if (finished) return reject();
                total += proof.length; count += message.strokes.length;
                if (total > LIMITS.totalBytes || count > LIMITS.strokes) return reject();
                parts.set(message.part, message);
                if (parts.size !== message.parts) return null;
                const strokes = [], ids = new Set();
                let last;
                for (let index = 0; index < message.parts; index += 1) {
                    const part = parts.get(index);
                    if (!part) return reject();
                    for (const item of part.strokes) {
                        if (ids.has(item.id)) return reject();
                        ids.add(item.id); strokes.push(item);
                    }
                    last = part;
                }
                finished = freeze({ trusted: !context.peer, to: context.to, request: context.request, batch: message.batch,
                    seq: proof.seq, epoch: message.epoch, clear: message.clear, strokes,
                    video: last.video, mods: last.mods });
                return finished;
            },
            finish() { return failed ? null : finished; }
        };
    }

    const api = { LIMITS, nonce, validNonce, makeChunks, proofBody, verifyPart, parsePeerPart, createAssembly };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.HangoutPrivateSnapshot = api;
}(typeof window !== 'undefined' ? window : globalThis));
