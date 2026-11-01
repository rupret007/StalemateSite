// Open-room paint + synced video: pure validation shared by lobby-core and unit tests.
import H from '../../r/45662413410ed051/sync-core.js';

export const PAINT_KINDS = new Set(['art', 'bobross']);
export const VIDEO_KINDS = new Set(['bobross', 'watch']);
export const ACT_KINDS = new Set(['stroke', 'clear', 'video', 'rtc']);

const STROKES_KEPT = 400;
const RTC_SDP_MAX = 16000;
const RTC_ICE_MAX = 1200;

export function actSnapshot(chan) {
    if (!chan || !chan.act) return null;
    if (!PAINT_KINDS.has(chan.kind) && !VIDEO_KINDS.has(chan.kind)) return null;
    const snap = { strokes: chan.act.strokes.slice(-STROKES_KEPT), video: chan.act.video };
    return snap;
}

export function applyStroke(chan, stroke) {
    const clean = H.cleanStroke(stroke);
    if (!clean || !PAINT_KINDS.has(chan.kind)) return null;
    const existing = chan.act.strokes.find((s) => s.id === clean.id);
    if (existing) {
        if (existing.color !== clean.color) return null;
        existing.pts = existing.pts.concat(clean.pts).slice(0, H.LIMITS.strokePoints * 8);
    } else {
        chan.act.strokes.push(clean);
        if (chan.act.strokes.length > STROKES_KEPT) chan.act.strokes.splice(0, chan.act.strokes.length - STROKES_KEPT);
    }
    return clean;
}

export function applyClear(chan) {
    if (!PAINT_KINDS.has(chan.kind)) return false;
    chan.act.strokes = [];
    return true;
}

export function applyVideo(chan, body, relayNow) {
    if (!VIDEO_KINDS.has(chan.kind)) return null;
    const state = { strokes: [], chat: [], video: chan.act.video };
    if (H.apply(state, { type: 'video', source: body && body.source, playing: body && body.playing, pos: body && body.pos }, { t: relayNow }) !== 'video') return null;
    chan.act.video = state.video;
    return chan.act.video;
}

export function cleanRtc(body) {
    if (!body || typeof body !== 'object') return null;
    const to = body.to;
    if (typeof to !== 'string' || !to.length || to.length > 128 || /[^A-Za-z0-9_-]/.test(to)) return null;
    if (body.sdp) {
        const type = body.sdp && body.sdp.type;
        const sdp = body.sdp && body.sdp.sdp;
        if (type !== 'offer' && type !== 'answer') return null;
        if (typeof sdp !== 'string' || sdp.length > RTC_SDP_MAX) return null;
        return { to, sdp: { type, sdp } };
    }
    if (body.ice) {
        const ice = body.ice;
        if (!ice || typeof ice !== 'object') return null;
        const raw = JSON.stringify(ice);
        if (raw.length > RTC_ICE_MAX) return null;
        return { to, ice };
    }
    return null;
}

export function parseActFrame(f) {
    if (!f || f.t !== 'act' || typeof f.ch !== 'string' || typeof f.kind !== 'string') return null;
    if (!ACT_KINDS.has(f.kind)) return null;
    return f;
}
