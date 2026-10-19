// Bounded durable community state. Never includes chat, PM bodies, media or jam invites.
export const ROOM_TTL = 90 * 86400000;
export const LOG_TTL = 30 * 86400000;
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const ids = (v) => Array.isArray(v) && v.length <= 150 && v.every(id);
export function roomRecord(r) {
    const strokes = r.act.strokes.slice(-400);
    while (JSON.stringify(strokes).length > 250000) strokes.shift();
    return { name: r.name, kind: r.kind, title: r.title, topic: r.topic, founder: r.founder,
        created: r.created, modes: { ...r.modes }, ops: [...r.ops], voice: [...r.voice], bans: r.bans,
        invites: [...r.invites], kicks: r.kicks, emptySince: r.emptySince,
        owner: r.owner || '', cohostLabels: { ...(r.cohostLabels || {}) }, cohosts: [...(r.cohosts || [])], renewed: r.renewed || r.created,
        act: { strokes, video: r.act.video } };
}
export function validRoom(r, now) {
    return obj(r) && /^#[a-z0-9-]{2,30}$/.test(r.name) && r.name !== '#stalemate'
        && ['chat', 'art', 'bobross', 'watch', 'jam'].includes(r.kind)
        && typeof r.title === 'string' && r.title.length <= 40 && typeof r.topic === 'string' && r.topic.length <= 300
        && (r.cohostLabels === undefined || obj(r.cohostLabels) && Object.entries(r.cohostLabels).every(([key, label]) => id(key) && typeof label === 'string' && label.length <= 20))
        && id(r.founder) && (r.owner === '' || id(r.owner)) && ids(r.cohosts)
        && Number.isFinite(r.created) && r.created >= 0 && r.created <= now
        && Number.isFinite(r.renewed) && r.renewed >= r.created && r.renewed <= now
        && (r.emptySince === null || Number.isFinite(r.emptySince) && r.emptySince >= 0 && r.emptySince <= now)
        && obj(r.modes) && ['m', 'i', 't', 'C', 'Q', 'locked'].every((k) => typeof r.modes[k] === 'boolean')
        && typeof r.modes.k === 'string' && (r.modes.k === '' || /^[A-Za-z0-9]{3,20}$/.test(r.modes.k))
        && Number.isInteger(r.modes.l) && r.modes.l >= 1 && r.modes.l <= 8
        && Number.isInteger(r.modes.S) && r.modes.S >= 0 && r.modes.S <= 300
        && ids(r.ops) && ids(r.voice) && ids(r.invites)
        && Array.isArray(r.bans) && r.bans.length <= 500 && r.bans.every((b) => obj(b) && typeof b.mask === 'string' && /^(dev|iph|nick|account):[A-Za-z0-9_\-\[\]{}^`|]+$/.test(b.mask) && (b.until == null || Number.isFinite(b.until)))
        && obj(r.kicks) && Object.keys(r.kicks).length <= 150 && Object.entries(r.kicks).every(([k, v]) => id(k) && Number.isFinite(v))
        && obj(r.act) && Array.isArray(r.act.strokes) && r.act.strokes.length <= 400
        && JSON.stringify(r.act).length <= 1000000;
}

export function createRateLimits(now) {
    const buckets = new Map();
    function take(keys, kind, cap, refill) {
        if (buckets.size + keys.filter((key) => !buckets.has(`${kind}:${key}`)).length > 5000) return 60;
        const t = now();
        const rows = keys.map((key) => {
            const k = `${kind}:${key}`;
            const old = buckets.get(k);
            const tokens = old ? Math.min(cap, old.tokens + Math.max(0, t - old.at) * refill / 1000) : cap;
            return [k, { tokens, at: t }];
        });
        const wait = Math.max(...rows.map(([, b]) => Math.max(0, (1 - b.tokens) / refill)));
        for (const [k, b] of rows) buckets.set(k, { ...b, tokens: wait > 0 ? b.tokens : b.tokens - 1 });
        return Math.ceil(wait);
    }
    function prune() { for (const [k, b] of buckets) if (now() - b.at > 86400000) buckets.delete(k); }
    function snapshot() { return [...buckets]; }
    function restore(rows) {
        if (!Array.isArray(rows) || rows.length > 5000 || rows.some((r) => !Array.isArray(r) || typeof r[0] !== 'string' || r[0].length > 300 || !obj(r[1]) || !Number.isFinite(r[1].tokens) || r[1].tokens < 0 || !Number.isFinite(r[1].at))) throw new Error('invalid rate state');
        buckets.clear(); for (const [k, b] of rows) buckets.set(k, { ...b });
    }
    return { prune, take, snapshot, restore };
}
