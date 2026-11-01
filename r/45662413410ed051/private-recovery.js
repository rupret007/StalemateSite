/* Atomic activity recovery. Inputs are already verified by the room protocol.
 * This module neither verifies signatures nor grants authority to peer controls. */
(function initPrivateRecovery(global) {
    'use strict';

    const LIMITS = Object.freeze({ ops: 512, points: 128000, bytes: 4 * 1024 * 1024 });
    const enc = new TextEncoder();
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
    const kinds = ['clear', 'video', 'lock', 'spot'];
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function byteLength(value) { return enc.encode(JSON.stringify(value)).byteLength; }
    // Compare semantic bodies without changing the key order that their signatures bind.
    function key(value) {
        if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
        if (object(value)) return '{' + Object.keys(value).sort().map(name => JSON.stringify(name) + ':' + key(value[name])).join(',') + '}';
        return JSON.stringify(value);
    }
    function sameBody(a, b) { return a && b && key(a.body) === key(b.body); }

    function createJournal({ H } = {}) {
        if (!H || !H.cleanStroke || !H.cleanSnapshotStroke || !H.strokeRangeStatus || !H.apply || !H.emptyState) {
            throw new TypeError('Drawing recovery core is required');
        }
        let error = null, points = 0, bytes = 0;
        const strokes = [], strokeKeys = new Set(), ranges = new Map(), hosts = new Map();
        const fail = code => { error ||= code; return false; };
        const status = () => ({ ok: error === null, error, ops: strokes.length + hosts.size, points, bytes });
        const failed = code => ({ ok: false, error: code });

        function cleanStroke(raw, limit) {
            if (!object(raw) || !Array.isArray(raw.pts) || !raw.pts.length || raw.pts.length > limit
                || raw.pts.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))
                || typeof raw.id !== 'string' || !raw.id || raw.id.length > 40 || /[\u0000-\u001f\u007f]/.test(raw.id)
                || !Number.isFinite(raw.size) || raw.size < 1 || raw.size > 48) return null;
            const clean = limit === H.LIMITS.strokePoints ? H.cleanStroke(raw) : H.cleanSnapshotStroke(raw);
            return clean && clean.id === raw.id && clean.pts.length === raw.pts.length ? clean : null;
        }

        function host(raw, t, expectedKind) {
            if (!object(raw) || raw.type !== 'host' || !object(raw.body) || !integer(raw.body.seq)
                || !kinds.includes(raw.body.kind) || expectedKind && raw.body.kind !== expectedKind
                || typeof raw.sig !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(raw.sig)) return null;
            const signed = copy(raw), body = signed.body;
            if (body.kind === 'video') {
                const time = body.t === undefined ? t : body.t;
                if (!H.cleanSource(body.source) || typeof body.playing !== 'boolean' || !Number.isFinite(body.pos)
                    || body.pos < 0 || body.pos > 86400 || !Number.isFinite(time) || time < 0) return null;
                return { signed, t: time };
            }
            if (body.kind === 'clear' && body.seq === 0) return null;
            if (body.kind === 'lock' && typeof body.on !== 'boolean') return null;
            if (body.kind === 'spot' && body.target !== null
                && (typeof body.target !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.target))) return null;
            return { signed };
        }

        function recordStroke(msg) {
            if (error) return false;
            if (!object(msg) || !Object.hasOwn(msg, 'offset') || !Object.hasOwn(msg, 'epoch')) return fail('legacy-stroke');
            const stroke = cleanStroke(msg.stroke, H.LIMITS.strokePoints);
            if (msg.type !== 'stroke' || !integer(msg.offset) || msg.offset >= H.LIMITS.strokeTotalPoints
                || !integer(msg.epoch) || !stroke || msg.offset + stroke.pts.length > H.LIMITS.strokeTotalPoints) return fail('invalid-stroke');
            const item = { type: 'stroke', offset: msg.offset, epoch: msg.epoch, stroke };
            const serialized = JSON.stringify(item);
            if (strokeKeys.has(serialized)) return true;
            const id = JSON.stringify([item.epoch, stroke.id]), known = ranges.get(id);
            if (known && (known.color !== stroke.color || known.size !== stroke.size)) return fail('stroke-conflict');
            for (let i = 0; i < stroke.pts.length; i += 1) {
                const prior = known?.points.get(item.offset + i);
                if (prior && !samePoint(prior, stroke.pts[i])) return fail('stroke-conflict');
            }
            const addedBytes = enc.encode(serialized).byteLength;
            if (strokes.length + hosts.size + 1 > LIMITS.ops) return fail('journal-limit-ops');
            if (points + stroke.pts.length > LIMITS.points) return fail('journal-limit-points');
            if (bytes + addedBytes > LIMITS.bytes) return fail('journal-limit-bytes');
            const merged = known || { color: stroke.color, size: stroke.size, points: new Map() };
            stroke.pts.forEach((point, i) => merged.points.set(item.offset + i, point));
            ranges.set(id, merged); strokes.push(item); strokeKeys.add(serialized);
            points += stroke.pts.length; bytes += addedBytes;
            return true;
        }

        function recordHost(signed, t) {
            if (error) return false;
            let item;
            try { item = host(signed, t); } catch (_) { return fail('invalid-host-action'); }
            if (!item) return fail('invalid-host-action');
            const kind = item.signed.body.kind, previous = hosts.get(kind);
            if (previous) {
                if (previous.signed.body.seq > item.signed.body.seq) return true;
                if (previous.signed.body.seq === item.signed.body.seq) {
                    return sameBody(previous.signed, item.signed) && previous.t === item.t || fail('host-conflict');
                }
            }
            const addedBytes = byteLength(item), oldBytes = previous ? byteLength(previous) : 0;
            if (strokes.length + hosts.size + (previous ? 0 : 1) > LIMITS.ops) return fail('journal-limit-ops');
            if (bytes - oldBytes + addedBytes > LIMITS.bytes) return fail('journal-limit-bytes');
            hosts.set(kind, item); bytes += addedBytes - oldBytes;
            return true;
        }

        function merge(snapshot, current) {
            if (error) return failed(error);
            try {
                if (!object(snapshot) || !integer(snapshot.seq) || !integer(snapshot.epoch) || snapshot.epoch > snapshot.seq
                    || !Array.isArray(snapshot.strokes) || snapshot.strokes.length > H.LIMITS.strokesKept
                    || !Array.isArray(snapshot.mods) || snapshot.mods.length > 2) return failed('invalid-snapshot');
                if (!object(current) || !object(current.state) || !Array.isArray(current.state.chat)
                    || !integer(current.lastHostSeq) || !integer(current.drawingEpoch)) return failed('invalid-current');
                const fresh = new Map(), accepted = new Map();
                function add(map, raw, t, kind) {
                    const item = host(raw, t, kind);
                    if (!item || map.has(item.signed.body.kind)) return false;
                    map.set(item.signed.body.kind, item); return true;
                }
                if (snapshot.video !== null && (!object(snapshot.video) || !add(fresh, snapshot.video.signed, snapshot.video.t, 'video'))) return failed('invalid-snapshot');
                for (const mod of snapshot.mods) {
                    if (!['lock', 'spot'].includes(mod?.body?.kind) || !add(fresh, mod, undefined, mod.body.kind)) return failed('invalid-snapshot');
                }
                if (snapshot.clear !== null && !add(fresh, snapshot.clear, undefined, 'clear')) return failed('invalid-snapshot');
                if (snapshot.epoch === 0 ? fresh.has('clear') : fresh.get('clear')?.signed.body.seq !== snapshot.epoch) return failed('invalid-snapshot');
                for (const item of fresh.values()) if (item.signed.body.seq > snapshot.seq) return failed('invalid-snapshot');
                if (current.lastVideoSigned != null && (!object(current.lastVideoSigned)
                    || !add(accepted, current.lastVideoSigned.signed, current.lastVideoSigned.t, 'video'))) return failed('invalid-current');
                if (current.lastClearSigned != null && !add(accepted, current.lastClearSigned, undefined, 'clear')) return failed('invalid-current');
                if (current.drawingEpoch === 0 ? accepted.has('clear') : accepted.get('clear')?.signed.body.seq !== current.drawingEpoch) return failed('invalid-current');
                if (current.mods != null && !object(current.mods)) return failed('invalid-current');
                for (const kind of ['lock', 'spot']) if (current.mods?.[kind] != null
                    && !add(accepted, current.mods[kind], undefined, kind)) return failed('invalid-current');

                const chosen = new Map();
                for (const kind of kinds) {
                    const a = accepted.get(kind), f = fresh.get(kind), j = hosts.get(kind);
                    // A journal is not an independent replay-authority channel. An
                    // older action must already be installed or freshly attested.
                    if (j && j.signed.body.seq <= current.lastHostSeq
                        && !sameBody(j.signed, a?.signed) && !sameBody(j.signed, f?.signed)) return failed('stale-journal-control');
                    for (const item of [f, a, j].filter(Boolean)) {
                        const previous = chosen.get(kind);
                        if (previous && item.signed.body.seq === previous.signed.body.seq
                            && (!sameBody(item.signed, previous.signed) || item.t !== previous.t)) return failed('host-conflict');
                        if (!previous || item.signed.body.seq > previous.signed.body.seq) chosen.set(kind, item);
                    }
                }
                const clear = chosen.get('clear')?.signed || null;
                const epoch = clear?.body.seq || 0;
                if (epoch < snapshot.epoch || epoch < current.drawingEpoch) return failed('unproved-epoch');
                const canonical = [], ids = new Set();
                for (const raw of snapshot.strokes) {
                    const clean = cleanStroke(raw, H.LIMITS.strokeTotalPoints);
                    if (!clean || ids.has(clean.id)) return failed('invalid-snapshot');
                    ids.add(clean.id); canonical.push(clean);
                }
                const state = H.emptyState();
                const preserveDrawing = current.preserveDrawing === true && current.drawingEpoch === epoch;
                const drawingIds = new Set();
                if (preserveDrawing) {
                    // A creator recovering from a peer retains its known canvas.
                    // Peers may have only a prefix, or no drawing yet. A newer
                    // verified clear still replaces the previous drawing epoch.
                    if (!Array.isArray(current.state.strokes) || current.state.strokes.length > H.LIMITS.strokesKept) return failed('invalid-current');
                    const retained = [];
                    for (const raw of current.state.strokes) {
                        const clean = cleanStroke(raw, H.LIMITS.strokeTotalPoints);
                        if (!clean || drawingIds.has(clean.id)) return failed('invalid-current');
                        drawingIds.add(clean.id); retained.push(clean);
                    }
                    H.apply(state, { type: 'snapshot', state: { strokes: retained } });
                    if (snapshot.epoch === epoch) for (const stroke of canonical) {
                        drawingIds.add(stroke.id);
                        if (drawingIds.size > H.LIMITS.strokesKept) return failed('drawing-exhausted');
                        // Full snapshot strokes exceed the delta point cap.
                        // Absolute ranges reconcile either prefix direction,
                        // detect conflicts and preserve existing layer slots.
                        for (let offset = 0; offset < stroke.pts.length; offset += H.LIMITS.strokePoints) {
                            H.apply(state, { type: 'stroke', epoch, offset,
                                stroke: { ...stroke, pts: stroke.pts.slice(offset, offset + H.LIMITS.strokePoints) } });
                        }
                    }
                } else {
                    H.apply(state, { type: 'snapshot', state: { strokes: snapshot.epoch === epoch ? canonical : [] } });
                }
                // Grouping ranges avoids artificial staging exhaustion when a
                // complete journal's prefix arrived after many later ranges.
                const matching = new Map();
                for (const item of strokes) {
                    if (item.epoch > epoch) return failed('unproved-epoch');
                    if (item.epoch !== epoch) continue;
                    if (!matching.has(item.stroke.id)) matching.set(item.stroke.id, []);
                    matching.get(item.stroke.id).push(item);
                }
                // A stroke first becomes visible when its offset-zero prefix
                // arrives. A tail seen earlier must not move it below another
                // stroke that was already visible in the live canvas.
                const groups = [...matching.values()].sort((a, b) => {
                    const prefix = items => {
                        const first = items.find(item => item.offset === 0);
                        return first ? strokes.indexOf(first) : Infinity;
                    };
                    return prefix(a) - prefix(b);
                });
                for (const items of groups) {
                    items.sort((a, b) => a.offset - b.offset);
                    for (const item of items) {
                        if (preserveDrawing) {
                            drawingIds.add(item.stroke.id);
                            if (drawingIds.size > H.LIMITS.strokesKept) return failed('drawing-exhausted');
                        }
                        H.apply(state, item);
                    }
                }
                const rangeStatus = H.strokeRangeStatus(state);
                if (rangeStatus.conflicted) return failed('drawing-conflict');
                if (rangeStatus.exhausted) return failed('drawing-exhausted');
                if (rangeStatus.pendingPoints) return failed('unresolved-stroke-gap');
                const video = chosen.get('video');
                if (video) {
                    const body = video.signed.body;
                    H.apply(state, { type: 'video', source: body.source, playing: body.playing, pos: body.pos }, { t: video.t });
                }
                state.chat = current.state.chat;
                const floor = Math.max(current.lastHostSeq, snapshot.seq,
                    ...[...chosen.values(), ...hosts.values()].map(item => item.signed.body.seq));
                return { ok: true, candidate: { state, lastVideoSigned: video ? copy(video) : null,
                    lastClearSigned: clear ? copy(clear) : null,
                    mods: { lock: chosen.has('lock') ? copy(chosen.get('lock').signed) : null,
                        spot: chosen.has('spot') ? copy(chosen.get('spot').signed) : null },
                    lastHostSeq: floor, drawingEpoch: epoch } };
            } catch (_) { return failed('invalid-recovery-input'); }
        }

        return { recordStroke, recordHost, status, merge };
    }

    const api = { LIMITS, createJournal };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else global.HangoutPrivateRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
