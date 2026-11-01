/* Hangout room sync core. Pure logic shared by the page and the unit tests.
 * Everything that crosses the relay is end-to-end encrypted with a key that only
 * lives in the invite link's #fragment. The relay sees ciphertext and timing only. */
(function initHangoutCore(global) {
    'use strict';

    const LIMITS = Object.freeze({
        chatChars: 400,
        nameChars: 24,
        strokePoints: 400,
        strokeTotalPoints: 3200,
        strokeRangeStrokes: 32,
        strokeRanges: 64,
        strokeRangePoints: 12800,
        strokesKept: 1500,
        chatKept: 200,
        driftSeconds: 1.0
    });
    const COLORS = Object.freeze(['#f4f0e6', '#171410', '#009ee8', '#b5dc08', '#ed2765', '#c98a24', '#7a4a2a', '#2f7d3a',
        // Bob Ross Paint-Along palette (see bob-ross.js)
        '#ffffff', '#0c0040', '#021e44', '#000000', '#5f2e1f', '#221b15', '#4e1500', '#0a3410', '#ffec00', '#c79b00', '#ffb800', '#db0000']);
    const FILE_SOURCES = Object.freeze({ manic: { src: '../../assets/manic.mp4', title: 'Stalemate - Manic' } });

    function parseYouTubeId(input) {
        const text = String(input || '').trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
        let url;
        try { url = new URL(text); } catch (error) { return null; }
        const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
        let id = null;
        if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
        else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            if (url.pathname === '/watch') id = url.searchParams.get('v');
            else {
                const match = url.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
                if (match) id = match[2];
            }
        }
        return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    function cleanSource(source) {
        if (!source || typeof source !== 'object') return null;
        if (source.kind === 'yt' && /^[A-Za-z0-9_-]{11}$/.test(String(source.id))) return { kind: 'yt', id: source.id };
        if (source.kind === 'file' && Object.prototype.hasOwnProperty.call(FILE_SOURCES, source.id)) return { kind: 'file', id: source.id };
        return null;
    }

    /* Video state: { source, playing, pos (seconds at t), t (relay ms) } */
    function expectedPosition(video, relayNow) {
        if (!video) return 0;
        if (!video.playing) return video.pos;
        return Math.max(0, video.pos + (relayNow - video.t) / 1000);
    }

    function needsCorrection(localSeconds, expectedSeconds, threshold = LIMITS.driftSeconds) {
        return Math.abs(localSeconds - expectedSeconds) > threshold;
    }

    /* Estimate relay clock minus local clock. Lowest observed (relayT - localReceive)
     * is the tightest bound, because network delay only ever makes it bigger. */
    function createClock(now = () => Date.now()) {
        let offset = null;
        return {
            sample(relayT) {
                const value = Number(relayT) - now();
                if (Number.isFinite(value) && (offset === null || value > offset)) offset = value;
                return offset;
            },
            relayNow() { return now() + (offset || 0); },
            get offset() { return offset; }
        };
    }

    function clampNumber(value, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.min(max, Math.max(min, n));
    }

    function cleanText(value, max) {
        return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    }

    function cleanStrokeLimit(stroke, limit) {
        if (!stroke || typeof stroke !== 'object') return null;
        const id = cleanText(stroke.id, 40);
        const color = COLORS.includes(stroke.color) ? stroke.color : null;
        const size = clampNumber(stroke.size, 1, 48);
        if (!id || !color || size === null || !Array.isArray(stroke.pts)) return null;
        const pts = [];
        for (const p of stroke.pts.slice(0, limit)) {
            const x = clampNumber(p && p[0], 0, 1);
            const y = clampNumber(p && p[1], 0, 1);
            if (x !== null && y !== null) pts.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
        }
        return pts.length ? { id, color, size, pts } : null;
    }
    function cleanStroke(stroke) { return cleanStrokeLimit(stroke, LIMITS.strokePoints); }
    function cleanSnapshotStroke(stroke) { return cleanStrokeLimit(stroke, LIMITS.strokeTotalPoints); }

    // Gaps belong to the current in-memory activity state, never its snapshot.
    // Only contiguous prefixes enter state.strokes and reach the canvas.
    const strokeRanges = new WeakMap();
    function rangesFor(state) {
        let ranges = strokeRanges.get(state);
        if (!ranges) {
            ranges = { strokes: new Map(), exhausted: false, conflicted: false };
            strokeRanges.set(state, ranges);
        }
        return ranges;
    }
    function rangeCounts(strokes) {
        let pendingRanges = 0, pendingPoints = 0;
        for (const stroke of strokes.values()) {
            let previous = -2;
            const positions = [...stroke.points.keys()].sort((a, b) => a - b);
            pendingPoints += positions.length;
            for (const position of positions) {
                if (position !== previous + 1) pendingRanges += 1;
                previous = position;
            }
        }
        return { pendingStrokes: strokes.size, pendingRanges, pendingPoints };
    }
    function strokeRangeStatus(state) {
        const ranges = strokeRanges.get(state);
        return { ...rangeCounts(ranges?.strokes || new Map()), exhausted: ranges?.exhausted || false, conflicted: ranges?.conflicted || false };
    }
    function resetStrokeRanges(state) { strokeRanges.delete(state); }
    const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
    const sameStroke = (a, b) => a.color === b.color && a.size === b.size;
    function trimStrokes(state) {
        if (state.strokes.length <= LIMITS.strokesKept) return;
        const removed = state.strokes.splice(0, state.strokes.length - LIMITS.strokesKept);
        const ranges = strokeRanges.get(state);
        if (ranges) for (const stroke of removed) {
            if (ranges.strokes.delete(stroke.id)) ranges.exhausted = true;
        }
    }
    function mergeStrokeRange(state, stroke, offset) {
        const ranges = rangesFor(state);
        const existing = state.strokes.find((item) => item.id === stroke.id);
        const staged = ranges.strokes.get(stroke.id);
        if (existing && !sameStroke(existing, stroke) || staged && !sameStroke(staged, stroke)) {
            ranges.conflicted = true; return null;
        }
        const prefix = existing?.pts || [];
        const points = new Map(staged?.points || []);
        // Legacy appends or an appended snapshot can supply the missing prefix.
        // Their already visible points must agree with every staged overlap.
        for (const [position, point] of points) if (position < prefix.length) {
            if (!samePoint(prefix[position], point)) { ranges.conflicted = true; return null; }
            points.delete(position);
        }
        for (let index = 0; index < stroke.pts.length; index += 1) {
            const position = offset + index, point = stroke.pts[index];
            const known = position < prefix.length ? prefix[position] : points.get(position);
            if (known && !samePoint(known, point)) { ranges.conflicted = true; return null; }
            if (position >= prefix.length) points.set(position, point);
        }
        const contiguous = prefix.slice();
        while (points.has(contiguous.length)) {
            const position = contiguous.length;
            contiguous.push(points.get(position)); points.delete(position);
        }
        const pending = new Map(ranges.strokes);
        if (points.size) pending.set(stroke.id, { id: stroke.id, color: stroke.color, size: stroke.size, points });
        else pending.delete(stroke.id);
        const counts = rangeCounts(pending);
        if (counts.pendingStrokes > LIMITS.strokeRangeStrokes || counts.pendingRanges > LIMITS.strokeRanges
            || counts.pendingPoints > LIMITS.strokeRangePoints) {
            // Retain accepted state atomically. A fresh sync is required because
            // this range was not kept; later gap filling does not erase the latch.
            ranges.exhausted = true; return null;
        }
        ranges.strokes = pending;
        if (contiguous.length === prefix.length) return null;
        if (existing) existing.pts = contiguous;
        else state.strokes.push({ id: stroke.id, color: stroke.color, size: stroke.size, pts: contiguous });
        trimStrokes(state);
        return 'draw';
    }

    function emptyState() { return { strokes: [], chat: [], video: null }; }

    /* Apply one decrypted message. Returns a short tag for what changed, or null if ignored. */
    function apply(state, msg, meta = {}) {
        if (!msg || typeof msg !== 'object') return null;
        switch (msg.type) {
        case 'stroke': {
            const stroke = cleanStroke(msg.stroke);
            if (!stroke) return null;
            if (Object.prototype.hasOwnProperty.call(msg, 'offset')) {
                if (!Number.isInteger(msg.offset) || msg.offset < 0 || msg.offset >= LIMITS.strokeTotalPoints
                    || msg.stroke.pts.length !== stroke.pts.length || msg.offset + stroke.pts.length > LIMITS.strokeTotalPoints) return null;
                return mergeStrokeRange(state, stroke, msg.offset);
            }
            const existing = state.strokes.find((s) => s.id === stroke.id);
            if (existing) {
                if (existing.color !== stroke.color) return null;
                existing.pts = existing.pts.concat(stroke.pts).slice(0, LIMITS.strokeTotalPoints);
            } else {
                state.strokes.push(stroke);
                trimStrokes(state);
            }
            if (strokeRanges.get(state)?.strokes.has(stroke.id)) mergeStrokeRange(state, existing || stroke, 0);
            return 'draw';
        }
        case 'clear':
            resetStrokeRanges(state);
            state.strokes = [];
            return 'draw';
        case 'chat': {
            const text = cleanText(msg.text, LIMITS.chatChars);
            if (!text) return null;
            state.chat.push({ name: cleanText(msg.name, LIMITS.nameChars) || 'Someone', text, t: Number(meta.t) || 0 });
            if (state.chat.length > LIMITS.chatKept) state.chat.shift();
            return 'chat';
        }
        case 'video': {
            const source = cleanSource(msg.source);
            const pos = clampNumber(msg.pos, 0, 60 * 60 * 24);
            if (!source || pos === null) return null;
            const t = Number(meta.t);
            if (!Number.isFinite(t)) return null;
            if (state.video && state.video.t > t) return null; // stale
            state.video = { source, playing: Boolean(msg.playing), pos, t };
            return 'video';
        }
        case 'snapshot': {
            const snap = msg.state || {};
            const newStrokes = (Array.isArray(snap.strokes) ? snap.strokes : []).map(cleanSnapshotStroke).filter(Boolean);
            if (snap.append) {
                for (const stroke of newStrokes) mergeStrokeRange(state, stroke, 0);
            } else {
                resetStrokeRanges(state);
                state.strokes = newStrokes.slice(-LIMITS.strokesKept);
            }
            // Activity snapshots never import or reset chat, including legacy
            // snapshots. Only live chat frames add to this connection's buffer.
            if (snap.video !== undefined || !snap.append) {
                const v = snap.video;
                const source = v && cleanSource(v.source);
                state.video = source && Number.isFinite(Number(v.t)) ? { source, playing: Boolean(v.playing), pos: clampNumber(v.pos, 0, 86400) || 0, t: Number(v.t) } : null;
            }
            return 'snapshot';
        }
        default:
            return null;
        }
    }

    /* ---- crypto: one random secret in the #fragment derives room id + AES key ---- */
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    function b64u(bytes) {
        let s = '';
        bytes.forEach((b) => { s += String.fromCharCode(b); });
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function unb64u(text) {
        const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(s, (c) => c.charCodeAt(0));
    }
    function newSecret(cryptoImpl = global.crypto) {
        return b64u(cryptoImpl.getRandomValues(new Uint8Array(18)));
    }
    function validSecret(secret) { return /^[A-Za-z0-9_-]{24}$/.test(String(secret || '')); }

    async function deriveRoom(secret, subtle = global.crypto.subtle) {
        if (!validSecret(secret)) throw new Error('bad invite');
        const base = await subtle.importKey('raw', unb64u(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
        const salt = enc.encode('stalemate-hangout-v1');
        const idBits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room-id') }, base, 256);
        const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room-key') }, base,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const roomId = Array.from(new Uint8Array(idBits), (b) => b.toString(16).padStart(2, '0')).join('');
        return { roomId, key };
    }

    async function roomRelayToken(roomId, previewKey, subtle = global.crypto.subtle) {
        if (!/^[0-9a-f]{64}$/.test(String(roomId || ''))) throw new Error('bad room');
        if (typeof previewKey !== 'string' || previewKey.length < 16) throw new Error('bad preview');
        const macKey = await subtle.importKey('raw', enc.encode(previewKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await subtle.sign('HMAC', macKey, enc.encode(`stalemate-hangout-relay-v1:${roomId}`));
        return b64u(new Uint8Array(sig));
    }
    async function seal(key, obj, cryptoImpl = global.crypto) {
        const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
        const data = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
        return { iv: b64u(iv), c: b64u(new Uint8Array(data)) };
    }
    async function open(key, frame, subtle = global.crypto.subtle) {
        const data = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(frame.iv) }, key, unb64u(frame.c));
        return JSON.parse(dec.decode(data));
    }

    const api = { LIMITS, COLORS, FILE_SOURCES, parseYouTubeId, cleanSource, expectedPosition, needsCorrection, createClock, cleanStroke, cleanSnapshotStroke, strokeRangeStatus, resetStrokeRanges, emptyState, apply, newSecret, validSecret, deriveRoom, roomRelayToken, seal, open };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.HangoutCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
