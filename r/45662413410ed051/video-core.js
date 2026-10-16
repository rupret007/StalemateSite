/* Hang Out room video: pure decisions shared by the page and the unit tests.
 * No DOM, no WebRTC objects. room.js feeds numbers in and applies what comes out. */
(function initVideoCore(global) {
    'use strict';

    const MAX_CAMS = 8; // matches the relay's 8-per-room cap
    const REACTIONS = Object.freeze(['👍', '👏', '😂', '🤘', '❤️', '😮', '🎨', '🔥']);
    const TIERS = Object.freeze(['good', 'ok', 'weak', 'bad']);

    /* What each sender sends to each receiver. In a mesh every receiver has its own
     * RTCRtpSender, so a person only gets our sharp feed if they're watching us big. */
    function encodingFor(o) {
        const opts = o || {};
        const tier = TIERS.includes(opts.tier) ? opts.tier : 'ok';
        const cams = Math.max(1, Math.min(MAX_CAMS, Number(opts.cams) || 1));
        if (opts.screen) {
            if (tier === 'bad') return { active: true, maxBitrate: 300000, maxFramerate: 2, scaleResolutionDownBy: 2 };
            return { active: true, maxBitrate: tier === 'weak' ? 600000 : 1200000, maxFramerate: 8, scaleResolutionDownBy: 1 };
        }
        if (tier === 'bad') return { active: false, maxBitrate: 0, maxFramerate: 0, scaleResolutionDownBy: 4 };
        const main = Boolean(opts.main) && !opts.jam;
        let enc;
        if (main) enc = { maxBitrate: 600000, maxFramerate: 24, scaleResolutionDownBy: 1 };
        else enc = { maxBitrate: cams > 4 ? 120000 : 180000, maxFramerate: cams > 4 ? 10 : 15, scaleResolutionDownBy: 2 };
        if (tier === 'weak' || opts.relayed) {
            enc = { maxBitrate: Math.min(enc.maxBitrate, main ? 250000 : 90000), maxFramerate: Math.min(enc.maxFramerate, 12), scaleResolutionDownBy: Math.max(enc.scaleResolutionDownBy, main ? 2 : 3) };
        }
        if (opts.jam) enc = { maxBitrate: Math.min(enc.maxBitrate, 120000), maxFramerate: 10, scaleResolutionDownBy: Math.max(2, enc.scaleResolutionDownBy) };
        return Object.assign({ active: true }, enc);
    }

    /* Whole-uplink plan for one sender. A mesh sends one copy per viewer, so cap the
     * total: at most 2 viewers get the sharp layer (earliest askers first), phones get a
     * lighter sharp layer, and if the sum still tops the budget every layer is scaled down.
     * viewers: [{ id, wantHi, hiSince, tier, relayed }]. Returns { [id]: encoding }. */
    const BUDGET = Object.freeze({ desktop: 2000000, phone: 1200000 });
    const PHONE_HQ_BPS = 280000;
    const MAX_HQ = 2;
    function planUplink(o) {
        const opts = o || {};
        const viewers = Array.isArray(opts.viewers) ? opts.viewers : [];
        const phone = Boolean(opts.phone);
        // Audio rides along to every viewer too; it comes off the top so voices never get squeezed.
        const audioBps = Number.isFinite(opts.audioBps) ? Math.max(0, opts.audioBps) : 0;
        const budget = Math.max(0, (phone ? BUDGET.phone : BUDGET.desktop) - audioBps * viewers.length);
        const hq = new Set(viewers.filter((v) => v.wantHi && !opts.jam && !opts.screen)
            .sort((a, b) => (a.hiSince || 0) - (b.hiSince || 0)).slice(0, MAX_HQ).map((v) => v.id));
        const plan = {};
        let total = 0;
        for (const v of viewers) {
            const enc = encodingFor({ main: hq.has(v.id), cams: opts.cams, tier: v.tier, relayed: v.relayed, screen: opts.screen, jam: opts.jam });
            if (phone && hq.has(v.id) && enc.maxBitrate > PHONE_HQ_BPS) { enc.maxBitrate = PHONE_HQ_BPS; enc.maxFramerate = Math.min(enc.maxFramerate, 20); }
            plan[v.id] = enc;
            if (enc.active) total += enc.maxBitrate;
        }
        if (total > budget) {
            const k = budget / total;
            for (const enc of Object.values(plan)) if (enc.active) enc.maxBitrate = Math.floor(enc.maxBitrate * k);
        }
        return plan;
    }
    function uplinkTotal(plan, audioBps) {
        const list = Object.values(plan || {});
        return list.reduce((a, e) => a + (e.active ? e.maxBitrate : 0), 0) + (Number(audioBps) || 0) * list.length;
    }

    /* Phone-class device? Catches iPadOS (reports a Mac UA but has multi-touch), touch-first
     * (coarse pointer) devices and low-core machines, so they get the lighter defaults. */
    function isPhoneDevice(d) {
        const dev = d || {};
        const ua = String(dev.ua || '');
        if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return true;
        if (/Macintosh/.test(ua) && Number(dev.maxTouchPoints) > 1) return true; // iPadOS desktop-mode UA
        if (dev.coarse && !dev.fine) return true;
        return Number.isFinite(dev.cores) && dev.cores < 4;
    }

    /* Grade a link from getStats numbers. Missing numbers never make it look worse. */
    function gradeLink(s) {
        const st = s || {};
        const rtt = Number.isFinite(st.rtt) ? st.rtt : 0; // seconds
        const loss = Number.isFinite(st.loss) ? st.loss : 0; // 0..1
        const out = Number.isFinite(st.outKbps) ? st.outKbps : Infinity;
        if (loss > 0.15 || rtt > 0.8 || out < 60) return 'bad';
        if (loss > 0.05 || rtt > 0.35 || out < 250) return 'weak';
        if (loss > 0.02 || rtt > 0.18 || out < 700) return 'ok';
        return 'good';
    }

    /* Smooth grades so one bad sample doesn't flap the video: need 3 bad samples in a
     * row to drop to audio-only, and 5 good-enough samples to come back. */
    function nextTier(history, current) {
        const h = Array.isArray(history) ? history.slice(-5) : [];
        const rank = (t) => TIERS.indexOf(t);
        const cur = TIERS.includes(current) ? current : 'ok';
        if (!h.length) return cur;
        const last3 = h.slice(-3);
        if (last3.length === 3 && last3.every((t) => t === 'bad')) return 'bad';
        if (cur === 'bad') return h.length === 5 && h.every((t) => rank(t) <= 2) ? 'weak' : 'bad';
        const worst = last3.reduce((a, t) => Math.max(a, rank(t)), 0);
        const latest = rank(h[h.length - 1]);
        return TIERS[Math.min(2, Math.max(latest, worst === 3 ? 2 : worst))];
    }

    /* Active speaker with hysteresis: a new voice must be clearly louder for a beat. */
    function pickSpeaker(levels, current, now, since) {
        const THRESH = 0.04;
        const HOLD_MS = 1200;
        let best = null;
        let bestLevel = THRESH;
        for (const [id, level] of Object.entries(levels || {})) {
            if (Number(level) > bestLevel) { best = id; bestLevel = Number(level); }
        }
        if (!best || best === current) return { id: current || best, since: current ? since : now };
        const curLevel = Number((levels || {})[current]) || 0;
        if (current && (now - since < HOLD_MS || bestLevel < curLevel * 1.5)) return { id: current, since };
        return { id: best, since: now };
    }

    /* Who fills the big tile: host spotlight beats my pin beats screen share beats the speaker. */
    function mainTile(o) {
        const opts = o || {};
        const present = new Set(opts.present || []);
        for (const id of [opts.spotlight, opts.pin, opts.screen, opts.speaker]) if (id && present.has(id)) return id;
        return null;
    }

    function gridColumns(n, wide) {
        const count = Math.max(1, Number(n) || 1);
        if (count === 1) return 1;
        if (count <= 4) return 2;
        return wide ? (count <= 6 ? 3 : 4) : 2;
    }

    function cleanReaction(r) { return REACTIONS.includes(r) ? r : null; }

    function rateLimit(lastTimes, now, max, windowMs) {
        const recent = (lastTimes || []).filter((t) => now - t < windowMs);
        if (recent.length >= max) return { ok: false, times: recent };
        recent.push(now);
        return { ok: true, times: recent };
    }

    /* Hands come down in the order they went up. */
    function handQueue(hands) {
        return Object.entries(hands || {}).filter(([, t]) => Number.isFinite(t)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    }

    /* Host moderation bodies are signed by the room creator's key. Only these shapes pass. */
    const HOST_KINDS = Object.freeze(['mute', 'camoff', 'remove', 'spot', 'lock']);
    function cleanHostAction(body) {
        if (!body || !HOST_KINDS.includes(body.kind) || !Number.isFinite(body.seq)) return null;
        const target = typeof body.target === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.target) ? body.target : null;
        if (body.kind === 'lock') return { kind: 'lock', seq: body.seq, on: Boolean(body.on) };
        if (body.kind === 'spot') return { kind: 'spot', seq: body.seq, target };
        if (body.kind === 'camoff' && body.target === '*') return { kind: 'camoff', seq: body.seq, target: '*' };
        return target ? { kind: body.kind, seq: body.seq, target } : null;
    }

    /* Backgrounds are opt-in and expensive. Say no up front when the device can't keep up. */
    function backgroundSupport(d) {
        const dev = d || {};
        if (!dev.wasm || !dev.webgl2) return 'no';
        if ((Number.isFinite(dev.memory) && dev.memory < 4) || (Number.isFinite(dev.cores) && dev.cores < 4)) return 'slow';
        return 'ok';
    }
    /* Runtime watchdog: average frame cost over the last ~2 s decides whether to keep going. */
    function backgroundVerdict(frameMs) {
        const xs = (frameMs || []).filter(Number.isFinite);
        if (xs.length < 20) return 'keep';
        const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
        if (avg > 80) return 'stop';
        if (avg > 45) return 'lighten';
        return 'keep';
    }

    /* Mic constraints. Jam rooms keep music in WebJam; this is for talking, or for
     * non-WebJam guests who flip on music mode. */
    function micConstraints(music, deviceId) {
        const base = music
            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (deviceId) base.deviceId = { exact: deviceId };
        return base;
    }
    /* Opus fmtp tweak for music mode: stereo, 128 kbps, no DTX. Leaves other codecs alone. */
    function musicSdp(sdp) {
        if (typeof sdp !== 'string') return sdp;
        const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
        if (!m) return sdp;
        const pt = m[1];
        const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
        const extra = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '128000', usedtx: '0', useinbandfec: '1' };
        if (!re.test(sdp)) return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(';')}`);
        return sdp.replace(re, (all, params) => {
            const kv = new Map(params.split(';').filter(Boolean).map((p) => p.trim().split('=')));
            Object.entries(extra).forEach(([k, v]) => kv.set(k, v));
            return `a=fmtp:${pt} ${Array.from(kv, ([k, v]) => `${k}=${v}`).join(';')}`;
        });
    }

    function qualityLabel(tier) {
        return { good: 'Great connection', ok: 'Good connection', weak: 'Shaky connection', bad: 'Very weak: video paused, audio kept' }[tier] || 'Checking…';
    }

    /* Bounded send queue: when full, shed ICE candidates first (oldest first); offers,
     * answers and everything else only go once no candidates are left to drop. */
    function enqueue(queue, item, max) {
        const q = (queue || []).concat([item]);
        while (q.length > max) {
            const i = q.findIndex((x) => x && x.ice);
            q.splice(i >= 0 ? i : 0, 1);
        }
        return q;
    }

    const api = { enqueue, isPhoneDevice, BUDGET, PHONE_HQ_BPS, MAX_HQ, planUplink, uplinkTotal, MAX_CAMS, REACTIONS, TIERS, HOST_KINDS, encodingFor, gradeLink, nextTier, pickSpeaker, mainTile, gridColumns, cleanReaction, rateLimit, handQueue, cleanHostAction, backgroundSupport, backgroundVerdict, micConstraints, musicSdp, qualityLabel };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.HangoutVideo = api;
}(typeof window !== 'undefined' ? window : globalThis));
