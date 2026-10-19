// Hang Out lobby engine: an old-school IRC network in one authoritative place (one Durable Object, one writer,
// so no netsplits and no "first in gets @"). Pure logic, no I/O: the Worker DO and the local dev relay both
// drive it, and unit tests drive it directly. Every permission is checked here, never in the browser.
import { ROOM_TTL, LOG_TTL, roomRecord, validRoom, createRateLimits } from './community-state.mjs';
import { checkNick, checkText, defaultLists, normalize } from './filter.mjs';
import { actSnapshot, applyClear, applyStroke, applyVideo, cleanRtc, parseActFrame, PAINT_KINDS, VIDEO_KINDS } from './lobby-act.mjs';
import { messageReceipt, receiptDigest } from './message-receipts.mjs';

export const BOT = 'StaleBot';
export const LOBBY = '#stalemate';
export const KINDS = Object.freeze({ chat: '💬 Chat', bobross: '🎨 Bob Ross paint-along', watch: '📺 Watch together', art: '🖌️ Draw together', jam: '🎸 Jam' });
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const AI_REVIEW_CATEGORIES = Object.freeze([
    'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent',
    'self-harm', 'self-harm/intent', 'self-harm/instructions', 'sexual', 'sexual/minors', 'violence', 'violence/graphic'
]);
const AI_CATEGORY_SET = new Set(AI_REVIEW_CATEGORIES);
const AI_REVIEW_MAX = 100;
const AI_REVIEW_TTL = DAY;
const MODERATION_QUEUE_MAX = 100;
const MODERATION_QUEUE_TTL = DAY;
const ROOM_STATE_MAX_BYTES = 8 * 1024 * 1024;
const ROOM_GROWTH_RESERVE = 16 * 1024;
const SESSION_STATE_BYTES = 2 * 1024 * 1024;
const SESSION_CONNECTIONS = 200;
const SESSION_PREFERENCES = 50;
const SESSION_PM_PAIRS = 2000;
const SESSION_PM_PENDING = 1000;
const PM_PENDING_TTL = 10 * MIN;
const RECEIPT_MAX = 1000;
const RECEIPT_STATE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export const LOBBY_LIMITS = Object.freeze({
    lobbyMax: 150,
    roomMax: 8,
    roomsListed: 30,
    roomPerDevice: 10 * MIN,
    roomsPerIpHour: 3,
    burst: 5,
    perSecond: 1,
    maxChars: 300,
    perDeviceDay: 200,
    frameBytes: 2048,
    actFrameBytes: 16384,
    actBurst: 24,
    actPerSecond: 10,
    framesPerConnection: 4000,
    defaultSlow: 3,
    nickEvery: 60 * 1000,
    kickCooldown: 10 * MIN,
    ipBan: DAY,
    reportsToHide: 3,
    listMax: 2000,                    // words per filter list
    banMax: 5000,                     // stored bans
    roomBanMax: 500,                  // bans per room
    reportsCamOff: 2,
    pmMinLobbyMs: 2 * MIN,
    pmPendingMax: 5,
    moderationContext: 50, // in-memory report context; never replayed to visitors
    emptyRoomClose: 10 * MIN,
    requestBudget: 40000, // the lobby's share of the free 100k DO requests/day
    modlogKeep: 2000,
    roomStateBytes: ROOM_STATE_MAX_BYTES,
    webJoinOrigins: [] // WebJam Web Join (#388) page origin(s); empty = browser join hook stays off
});

export const HELP = [
    'Everyone: /join #room  /part  /quit  /nick NewNick  /me does a thing  /msg nick text  /query nick  /whois nick',
    '          /away [reason]  /ignore nick  /unignore nick  /list  /names  /topic  /slap nick  /report nick  /help',
    'PMs:      /accept nick  /decline nick  /block nick  /unblock nick  /pm on|off   (a PM opens only after they accept)',
    'Jam @:    /jamlink webjam://…  (from the WebJam desktop app)  /jamlink clear',
    'Room @:   /topic text  /kick nick [why]  /ban nick [why]  /unban mask  /invite nick  /op /deop /voice /devoice nick',
    '          /mode +m|-m +i|-i +k key|-k +l N|-l +S secs|-S +C|-C +Q|-Q   /close',
    'Owners: /register  /cohost add|remove nick  /transfer nick  /acceptowner  /unregister',
    'Site MOD: /mute nick 10m  /gban nick why  /purge nick  /camoff all  /close #room',
    '          /approve id  /dismiss id  /aidismiss id  /delete id  /log',
    'Band @:   /shield  /shieldoff  /lobby lock|readonly|unlock  /filter block|hold|allow|del word'
];

// Exact shape checks only: we never fetch, parse or rewrite WebJam's invite (WebJam's invitation_ingress owns that).
export function validWebjamInvite(link) {
    const s = String(link || '');
    return /^webjam:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{8,1800}$/.test(s) && !/[\s<>"`]/.test(s) ? s : '';
}
// WebJam's Copy Invite includes prose and, for direct-STUN sessions, a sealed
// webjam-signal line. Its paste boundary accepts at most 8,192 characters. Keep
// that complete message opaque; the desktop app validates its protocol.
export function validWebjamInvitation(message) {
    if (typeof message !== 'string' || !message || message.length > 8192 || encoder.encode(message).byteLength > 8192
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) return '';
    const links = message.split(/\s+/).filter((token) => token.startsWith('webjam://'));
    return links.length === 1 && validWebjamInvite(links[0]) ? message : '';
}
export function validWebJoin(link, origins = []) {
    let u;
    try { u = new URL(String(link || '')); } catch (e) { return ''; }
    if (u.protocol !== 'https:' || !origins.includes(u.origin) || !u.hash || u.search) return '';
    return u.href.length <= 2000 ? u.href : '';
}
const lc = (s) => String(s || '').toLowerCase();
const parseDuration = (s, fallback) => {
    const m = /^(\d{1,4})(s|m|h|d)?$/.exec(String(s || ''));
    if (!m) return fallback;
    return Number(m[1]) * ({ s: 1000, m: MIN, h: HOUR, d: DAY }[m[2] || 'm']);
};

// Role x command matrix (exported for the permission tests). scope: who may run it.
//   any = everyone, chanop = @ in that channel (founder/op/band), band = band or owner only.
export const COMMANDS = Object.freeze({
    register: 'any', cohost: 'any', transfer: 'any', acceptowner: 'any', unregister: 'any', join: 'any', part: 'any', quit: 'any', nick: 'any', me: 'any', msg: 'any', query: 'any', whois: 'any', away: 'any',
    ignore: 'any', unignore: 'any', list: 'any', names: 'any', topic: 'any', slap: 'any', help: 'any', report: 'any',
    accept: 'any', decline: 'any', block: 'any', unblock: 'any', pm: 'any', cam: 'any',
    kick: 'chanop', ban: 'chanop', unban: 'chanop', invite: 'chanop', op: 'chanop', deop: 'chanop', voice: 'chanop',
    devoice: 'chanop', jamlink: 'chanop', mode: 'chanop', close: 'chanop', lock: 'chanop',
    mute: 'moderator', gban: 'moderator', purge: 'moderator', shield: 'band', shieldoff: 'band', lobby: 'band', filter: 'band',
    camoff: 'moderator', approve: 'moderator', dismiss: 'moderator', aidismiss: 'moderator', log: 'moderator', delete: 'moderator', slow: 'band'
});

export function createLobby({ now = () => Date.now(), send = () => {}, close = () => {}, persist: persistImpl = () => {}, reviewPublicText = null, aiModerationStatus = () => ({ enabled: false, mode: 'review-only', state: 'disabled' }), limits = LOBBY_LIMITS } = {}) {
    const L = { ...LOBBY_LIMITS, ...limits };
    const roomStateLimit = Math.max(32768, Math.min(ROOM_STATE_MAX_BYTES, Number(L.roomStateBytes) || ROOM_STATE_MAX_BYTES));
    const conns = new Map();          // connId -> conn
    const channels = new Map();       // lc(name) -> channel
    const pm = new Map();             // exact connection pair -> consent; device IDs are rate limits, never consent grants
    const devStats = new Map();       // dev -> {day, msgs, lastRoom}
    const ipRooms = new Map();        // iph -> [timestamps]
    let seq = 0;
    const rates = createRateLimits(now);
    let roomsBroken = false;
    let outputBatch = null;
    let closeBatch = null;
    let evidenceWrites = null;
    let pendingCommits = 0;
    let deferredAdmin = false;
    const persist = (kind, value) => {
        const required = kind === 'moderation-queue' || kind === 'net';
        let task;
        try { task = persistImpl(kind, value); }
        catch (error) { if (!required) throw error; task = Promise.reject(error); }
        if (required && evidenceWrites) evidenceWrites.push(task);
        // Outside a durable command, keep the original promise available to an
        // awaiting caller while handling a connection/heartbeat write rejection.
        else if (required && task && typeof task.catch === 'function') task.catch(storageUnavailable);
        return task;
    };
    const net = {
        bans: [],                     // {mask, reason, by, at, until}
        kicks: {},                    // dev -> until
        mutes: {},                    // dev -> until
        lock: 'off',                  // off | readonly | closed
        shield: false,
        shieldAuto: false,
        lockAuto: false,              // saved safety state (including legacy locks/corruption): explicit band recovery only
        lists: defaultLists(),
        modlog: [],
        lastBand: now(),
        budget: { day: '', requests: 0 },
        reportsToHide: L.reportsToHide,
        // Privacy-safe aggregates only: counts per UTC hour / kind / action. No nicks, devices or IPs.
        stats: { hours: {}, kinds: {}, rooms: {}, mod: {}, reports: { made: 0, autoHidden: 0, dismissed: 0, actioned: 0 } }
    };
    const hourKey = () => new Date(now()).toISOString().slice(0, 13);
    const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
    function statHour() {
        const k = hourKey();
        const h = net.stats.hours[k] || (net.stats.hours[k] = { joins: 0, peak: 0, lines: 0 });
        const keys = Object.keys(net.stats.hours);
        if (keys.length > 24 * 30) for (const old of keys.sort().slice(0, keys.length - 24 * 30)) delete net.stats.hours[old];
        return h;
    }
    function statPeak() { const h = statHour(); h.peak = Math.max(h.peak, [...conns.values()].filter((c) => c.nick).length); }
    const reports = new Map();        // msgId -> {devs:Set, iphs:Set, ch, from, text, hidden, at}
    const held = new Map();           // msgId -> pending line
    const lines = new Map();          // msgId -> line (recent, for reports/purge)
    const lineMeta = new Map();       // immutable author device + actual recipient connections; never sent to visitors
    const receipts = new Map();       // bounded text digests + delivery metadata; no ordinary chat or PM bodies
    const receiptSizes = new Map();   // exact UTF-8 record sizes; avoid re-encoding the whole queue per line
    let receiptBytes = 2;             // serialized [] plus records and commas
    let receiptRevision = 0;
    const heldChannels = new Map();   // original channel object for live held-message approval; never restored
    const aiPending = new Map();      // current message + channel object identities; never persisted
    const aiReviews = new Map();      // bounded admin-only evidence, separate from chat and network snapshots

    const mkChannel = (name, kind, title, founder) => ({
        name, kind, title, founder, created: now(), topic: kind === 'lobby' ? 'Welcome to #stalemate. Pull up a nick, say hello, make something together. /help for commands.' : '',
        modes: { m: false, i: false, k: '', l: kind === 'lobby' ? L.lobbyMax : L.roomMax, t: true, S: kind === 'lobby' ? L.defaultSlow : 0, C: kind !== 'lobby' && kind !== 'chat', Q: false, locked: false },
        jam: kind === 'jam' ? { desktop: '', web: '' } : null, ops: new Set(founder ? [founder] : []), opAccounts: new Map(), voice: new Set(), bans: [], invites: new Set(), kicks: {},
        owner: '', cohostLabels: {}, cohosts: new Set(), renewed: now(), transfer: null, members: new Set(), moderationContext: [], emptySince: null,
        act: { strokes: [], video: null }
    });
    channels.set(LOBBY, mkChannel(LOBBY, 'lobby', 'The lobby', null));

    // ---------- helpers ----------
    const out = (c, msg) => { try { if (outputBatch) outputBatch.push([c.id, msg]); else send(c.id, msg); } catch (e) { /* gone */ } };
    const isBand = (c) => c && (c.role === 'band' || c.role === 'owner');
    const isStaff = (c) => isBand(c) || c?.role === 'moderator';
    const owns = (c, room) => !!c?.account && room?.owner === c.account;
    const hosts = (c, room) => !!room && (owns(c, room) || room.ops.has(c.dev) || !!c.account && room.cohosts.has(c.account));
    const capabilities = (c) => ({ moderate: isStaff(c), configure: isBand(c), register: !!c.account });
    const ch = (name) => channels.get(lc(name));
    const byNick = (nick) => [...conns.values()].find((c) => c.nick && lc(c.nick) === lc(String(nick || '').replace(/^[@+]/, '')));
    const isOp = (c, chan) => isStaff(c) || hosts(c, chan);
    const prefix = (c, chan) => (isOp(c, chan) ? '@' : chan && chan.voice.has(c.dev) ? '+' : '');
    const bot = (c, text, kind = 'info') => out(c, { t: 'notice', from: BOT, text, kind, ts: now() });
    const log = (by, action, target = '', reason = '', where = '') => {
        const e = { at: now(), by, action, target, reason, ch: where };
        bump(net.stats.mod, action === 'filter-block' || action === 'pm-filter' ? `filter:${String(reason).split(':')[0]}` : action);
        if (action === 'auto-hide') net.stats.reports.autoHidden += 1;
        if (action === 'dismiss-report') net.stats.reports.dismissed += 1;
        net.modlog.push(e);
        if (net.modlog.length > L.modlogKeep) net.modlog.splice(0, net.modlog.length - L.modlogKeep);
        persist('modlog', e);
        if (['kick', 'ban', 'mute', 'delete', 'purge'].includes(action)) {
            let changed = false;
            const targetDev = action === 'delete' ? null : byNick(target)?.dev;
            for (const [id, r] of reports) if (!r.done && (action === 'delete' ? id === target : targetDev && r.authorDev === targetDev)) { r.done = true; changed = true; net.stats.reports.actioned += 1; }
            if (changed) saveModerationQueue();
        }
        pushAdmin();
        return e;
    };
    const saveNet = () => persist('net', snapshot());
    const nickOf = (c) => (c ? c.nick || '(no nick)' : BOT);
    const membersOf = (chan) => [...chan.members].map((id) => conns.get(id)).filter(Boolean);
    const cast = (chan, msg, filterFn) => {
        for (const m of membersOf(chan)) if (!filterFn || filterFn(m)) out(m, msg);
    };
    const event = (chan, text) => {
        const msg = { t: 'event', ch: chan.name, text, ts: now() };
        chan.moderationContext.push(msg);
        if (chan.moderationContext.length > L.moderationContext) chan.moderationContext.shift();
        cast(chan, msg);
    };
    const names = (chan) => membersOf(chan).filter((m) => m.nick).map((m) => ({ id: m.id, nick: m.nick, prefix: prefix(m, chan), band: isBand(m), moderator: m.role === 'moderator', verified: !!m.account, owner: owns(m, chan), away: !!m.away, cam: !!(m.cams && m.cams.has(lc(chan.name))) }))
        .sort((a, b) => (a.prefix === b.prefix ? lc(a.nick).localeCompare(lc(b.nick)) : a.prefix === '@' ? -1 : b.prefix === '@' ? 1 : a.prefix === '+' ? -1 : 1));
    const chanView = (chan) => ({ name: chan.name, kind: chan.kind, title: chan.title, topic: chan.topic, modes: { ...chan.modes, k: chan.modes.k ? true : false }, count: chan.members.size, persistent: !!chan.owner, expiresAt: chan.owner ? chan.renewed + ROOM_TTL : null, names: names(chan), jam: chan.jam ? { desktop: chan.jam.desktop, invitation: chan.jam.invitation || chan.jam.desktop, web: chan.jam.web, webReady: !!chan.jam.web } : null });
    const sendChan = (chan) => {
        cast(chan, { t: 'chan', ch: chanView(chan) });
        for (const c of membersOf(chan)) if (owns(c, chan)) out(c, { t: 'ownership', ch: chan.name,
            cohosts: [...chan.cohosts].map((id) => ({ id, label: chan.cohostLabels[id] || 'Verified co-host' })) });
    };
    const visibleRoom = (viewer, room) => publicChannel(room) || isStaff(viewer) || !!viewer && (hosts(viewer, room) || room.members.has(viewer.id));
    const directory = (viewer) => [...channels.values()].filter((r) => r.kind !== 'lobby' && visibleRoom(viewer, r))
        .map((r) => ({ name: r.name, kind: r.kind, title: r.title, count: r.members.size, max: r.modes.l, locked: r.modes.locked || r.modes.i, key: !!r.modes.k, cams: r.modes.C, persistent: !!r.owner, mine: !!viewer && owns(viewer, r), hostPresent: membersOf(r).some((m) => hosts(m, r)) }));
    const pushList = () => { for (const c of conns.values()) if (c.nick) out(c, { t: 'list', rooms: directory(c) }); pushAdmin(); };
    const banned = (list, c) => list.some((b) => (!b.until || b.until > now()) && (b.mask === `dev:${c.dev}` || c.account && b.mask === `account:${c.account}` || b.mask === `iph:${c.iph}` || (c.nick && b.mask === `nick:${lc(c.nick)}`)));
    const pairKey = (a, b) => [a, b].sort().join('|');

    function adminState() {
        return {
            lock: net.lock, shield: net.shield, shieldAuto: net.shieldAuto, lockAuto: net.lockAuto, lastBand: net.lastBand,
            slow: ch(LOBBY).modes.S, lists: net.lists, reportsToHide: net.reportsToHide,
            budget: { ...net.budget, cap: L.requestBudget, level: budgetLevel() },
            users: [...conns.values()].filter((c) => c.nick).map((c) => ({ nick: c.nick, role: c.role, dev: c.dev.slice(0, 6), away: !!c.away, muted: Math.max(net.mutes[c.dev] || 0, net.mutes[c.account] || 0) > now(), channels: [...c.channels] })),
            rooms: [...channels.values()].map((c) => ({ name: c.name, kind: c.kind, title: c.title, count: c.members.size, modes: { ...c.modes, k: !!c.modes.k } })),
            reports: [...reports.entries()].filter(([, r]) => !r.done && now() - r.at < MODERATION_QUEUE_TTL).map(([id, r]) => ({ id, ch: r.ch, from: r.from, text: r.text, count: r.devs.size, hidden: r.hidden, context: [...r.context] })),
            held: [...held.values()].filter((h) => now() - h.ts < MODERATION_QUEUE_TTL).map((h) => ({ id: h.id, ch: h.ch, from: h.from, text: h.text, reason: h.reason })),
            aiReviews: aiReviewList(),
            aiModeration: aiStatus(),
            bans: net.bans.filter((b) => !b.until || b.until > now()),
            stats: statsView(),
            modlog: net.modlog.slice(-200)
        };
    }
    let adminDirty = false;
    function pushAdmin() {
        if (adminDirty) return;
        adminDirty = true;
        queueMicrotask(() => {
            adminDirty = false;
            if (pendingCommits) { deferredAdmin = true; return; }
            const state = adminState();
            for (const c of conns.values()) if (isStaff(c) && c.admin) out(c, { t: 'admin', state: { ...state, capabilities: capabilities(c) } });
        });
    }

    function aiStatus() {
        try { return aiModerationStatus(); } catch (e) { return { enabled: false, mode: 'review-only', state: 'unavailable' }; }
    }
    function moderationQueue() {
        return {
            reports: [...reports].filter(([, r]) => !r.done && now() - r.at < MODERATION_QUEUE_TTL).map(([id, r]) => ({
                id, ch: r.ch, from: r.from, text: r.text, at: r.at, hidden: r.hidden,
                context: [...r.context], devs: [...r.devs], iphs: [...r.iphs], authorDev: r.authorDev
            })),
            held: [...held.values()].filter((h) => now() - h.ts < MODERATION_QUEUE_TTL).map((h) => ({
                id: h.id, ch: h.ch, from: h.from, text: h.text, ts: h.ts, prefix: h.prefix,
                band: h.band, me: h.me, reason: h.reason, dev: h.dev
            }))
        };
    }
    function saveModerationQueue() { const task = persist('moderation-queue', moderationQueue()); pushAdmin(); return task; }
    function pruneModerationQueue() {
        let changed = false;
        for (const [id, r] of reports) if (now() - r.at >= MODERATION_QUEUE_TTL) { reports.delete(id); changed = true; }
        for (const [id, h] of held) if (now() - h.ts >= MODERATION_QUEUE_TTL) { held.delete(id); heldChannels.delete(id); changed = true; }
        if (changed) return saveModerationQueue();
    }
    const moderationId = (id) => typeof id === 'string' && /^[mp][a-z0-9]{1,80}$/i.test(id);
    const moderationNick = (nick) => typeof nick === 'string' && /^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(nick);
    const moderationIdentity = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
    const moderationText = (text, max = 300) => typeof text === 'string' && text.length > 0 && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text);
    const moderationTime = (at) => Number.isFinite(at) && at >= 0 && at <= now() && now() - at < MODERATION_QUEUE_TTL;
    const moderationChannel = (name) => typeof name === 'string' && (/^#[a-z0-9-]{2,30}$/.test(name)
        || (name.startsWith('pm:') && name.slice(3).split('>').length === 2 && name.slice(3).split('>').every(moderationNick)));
    function restoreModerationQueue(stored = {}) {
        reports.clear(); held.clear(); heldChannels.clear();
        const entries = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        const common = (item) => item && typeof item === 'object' && !Array.isArray(item)
            && moderationId(item.id) && moderationNick(item.from) && moderationChannel(item.ch) && moderationText(item.text, L.maxChars);
        const goodReports = (Array.isArray(entries.reports) ? entries.reports : []).filter((r) => common(r) && moderationTime(r.at)
            && typeof r.hidden === 'boolean' && moderationIdentity(r.authorDev)
            && Array.isArray(r.context) && r.context.length >= 1 && r.context.length <= 11 && r.context.every((line) => moderationText(line, 400))
            && [r.devs, r.iphs].every((list) => Array.isArray(list) && list.length > 0 && list.length <= L.lobbyMax && list.every(moderationIdentity)))
            .sort((a, b) => a.at - b.at).slice(-MODERATION_QUEUE_MAX);
        for (const r of goodReports) reports.set(r.id, {
            ch: r.ch, from: r.from, text: r.text, at: r.at, hidden: r.hidden, context: [...r.context],
            devs: new Set(r.devs), iphs: new Set(r.iphs), authorDev: r.authorDev, done: false
        });
        const goodHeld = (Array.isArray(entries.held) ? entries.held : []).filter((h) => common(h) && h.id.startsWith('m') && h.ch.startsWith('#')
            && moderationTime(h.ts) && moderationIdentity(h.dev) && moderationText(h.reason, 160)
            && ['', '@', '+'].includes(h.prefix) && typeof h.band === 'boolean' && typeof h.me === 'boolean')
            .sort((a, b) => a.ts - b.ts).slice(-MODERATION_QUEUE_MAX);
        for (const h of goodHeld) held.set(h.id, { t: 'line', id: h.id, ch: h.ch, from: h.from, text: h.text, ts: h.ts,
            prefix: h.prefix, band: h.band, me: h.me, reason: h.reason, dev: h.dev });
        let changed = true;
        try { changed = JSON.stringify(stored) !== JSON.stringify(moderationQueue()); } catch (e) { /* replace malformed storage */ }
        if (changed) return saveModerationQueue();
    }
    function aiReviewList() {
        return [...aiReviews.values()].filter((entry) => now() - entry.at < AI_REVIEW_TTL)
            .map((entry) => ({ ...entry, categories: [...entry.categories] }));
    }
    function saveAiReviews() {
        persist('ai-reviews', aiReviewList());
        pushAdmin();
    }
    function pruneAiReviews() {
        let changed = false;
        for (const [id, entry] of aiReviews) if (now() - entry.at >= AI_REVIEW_TTL) { aiReviews.delete(id); changed = true; }
        for (const [id, pending] of aiPending) if (now() - pending.line.ts >= AI_REVIEW_TTL) aiPending.delete(id);
        if (changed) saveAiReviews();
    }
    const publicChannel = (chan) => !!chan && (chan.kind === 'lobby' || (!chan.modes.i && !chan.modes.k && !chan.modes.locked));
    const aiCategories = (categories) => Array.isArray(categories) && categories.length <= AI_REVIEW_CATEGORIES.length
        && categories.every((category) => typeof category === 'string' && AI_CATEGORY_SET.has(category));
    const aiModel = (model) => typeof model === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(model);
    function requestAiReview(chan, line) {
        if (typeof reviewPublicText !== 'function' || !publicChannel(chan)) return;
        aiPending.set(line.id, { line, chan });
        if (aiPending.size > 1000) aiPending.delete(aiPending.keys().next().value);
        try {
            // Only the fresh public text and its opaque id leave this engine. No nicks,
            // room names, device data, history, activity state or PM content are supplied.
            const result = reviewPublicText({ id: line.id, text: line.text });
            if (result && typeof result.catch === 'function') result.catch(() => aiPending.delete(line.id));
        } catch (e) { aiPending.delete(line.id); } // Review availability never blocks chat.
    }
    function applyAiReview(id, result) {
        pruneAiReviews();
        const pending = aiPending.get(id);
        aiPending.delete(id); // A review result is consumed at most once, including unavailable results.
        if (!pending || lines.get(id) !== pending.line || ch(pending.line.ch) !== pending.chan || !publicChannel(pending.chan)) return false;
        if (!result || result.status !== 'reviewed' || typeof result.flagged !== 'boolean'
            || !aiModel(result.model) || !aiCategories(result.categories)
            || (result.flagged && !result.categories.length)) return false;
        if (result.scores !== undefined && (!result.scores || typeof result.scores !== 'object' || Array.isArray(result.scores)
            || !Object.entries(result.scores).every(([category, score]) => AI_CATEGORY_SET.has(category) && Number.isFinite(score) && score >= 0 && score <= 1))) return false;
        if (!result.flagged) return true;
        const line = pending.line;
        aiReviews.set(id, { id, from: line.from, ch: line.ch, text: line.text, at: now(), model: result.model, categories: [...new Set(result.categories)] });
        while (aiReviews.size > AI_REVIEW_MAX) aiReviews.delete(aiReviews.keys().next().value);
        saveAiReviews();
        return true;
    }
    function restoreAiReviews(stored = []) {
        const valid = (entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
            && typeof entry.id === 'string' && /^m[a-z0-9]{1,80}$/i.test(entry.id)
            && typeof entry.from === 'string' && /^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(entry.from)
            && typeof entry.ch === 'string' && /^#[a-z0-9-]{2,30}$/.test(entry.ch)
            && typeof entry.text === 'string' && entry.text.length > 0 && entry.text.length <= L.maxChars
            && !/[\u0000-\u001f\u007f]/.test(entry.text)
            && Number.isFinite(entry.at) && entry.at >= 0 && entry.at <= now() && now() - entry.at < AI_REVIEW_TTL
            && aiModel(entry.model) && aiCategories(entry.categories) && entry.categories.length > 0;
        aiReviews.clear();
        for (const entry of (Array.isArray(stored) ? stored : []).filter(valid).sort((a, b) => a.at - b.at)) {
            aiReviews.set(entry.id, { id: entry.id, from: entry.from, ch: entry.ch, text: entry.text, at: entry.at, model: entry.model, categories: [...new Set(entry.categories)] });
        }
        while (aiReviews.size > AI_REVIEW_MAX) aiReviews.delete(aiReviews.keys().next().value);
        let changed = true;
        try { changed = JSON.stringify(stored) !== JSON.stringify(aiReviewList()); } catch (e) { /* malformed storage is replaced */ }
        if (changed) saveAiReviews();
    }

    function statsView() {
        const hours = Object.entries(net.stats.hours).sort(([a], [b]) => a.localeCompare(b));
        const byHourOfDay = Array.from({ length: 24 }, () => 0);
        for (const [k, h] of hours) byHourOfDay[Number(k.slice(11, 13))] += h.joins;
        const days = {};
        for (const [k, h] of hours) { const d = days[k.slice(0, 10)] || (days[k.slice(0, 10)] = { joins: 0, peak: 0, lines: 0 }); d.joins += h.joins; d.lines += h.lines; d.peak = Math.max(d.peak, h.peak); }
        const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
        return { days, byHourOfDayUTC: byHourOfDay, last24: hours.slice(-24), kinds: net.stats.kinds, busiestRooms: top(net.stats.rooms, 8), mod: net.stats.mod, reports: net.stats.reports, online: [...conns.values()].filter((c) => c.nick).length };
    }
    function budgetLevel() {
        const day = new Date(now()).toISOString().slice(0, 10);
        if (net.budget.day !== day) net.budget = { day, requests: 0 };
        const used = net.budget.requests / L.requestBudget;
        return used >= 0.95 ? 'closed' : used >= 0.85 ? 'readonly' : 'ok';
    }
    function spend(n) { budgetLevel(); net.budget.requests += n; }

    // ---------- connection lifecycle ----------
    function connect({ id, dev, iph, role = 'fan', email = '', account = '', admin = false }) {
        if (conns.size >= SESSION_CONNECTIONS) return { ok: false, status: 429, reason: 'full' };
        spend(1);
        const lvl = budgetLevel();
        const band = role === 'band' || role === 'owner' || role === 'moderator';
        if (lvl === 'closed' && !band) return { ok: false, status: 503, reason: 'budget' };
        if (!band) {
            if (net.lock === 'closed') return { ok: false, status: 503, reason: 'locked' };
            if (banned(net.bans, { dev, iph, account })) return { ok: false, status: 403, reason: 'banned' };
            if ((net.kicks[dev] || 0) > now()) return { ok: false, status: 403, reason: 'kicked' };
            const inLobby = [...conns.values()].filter((c) => !isBand(c)).length;
            if (inLobby >= L.lobbyMax) return { ok: false, status: 429, reason: 'full' };
        }
        const c = { id, dev, iph, role, email, account, admin: band && admin, nick: '', channels: new Set(), away: '', ignores: new Set(), blocks: new Set(), pmOff: false,
            cams: new Set(), since: now(), lastNick: 0, tokens: L.burst, last: now(), frames: 0, lastSaid: {}, actTokens: L.actBurst, actLast: now() };
        conns.set(id, c);
        if (band) { net.lastBand = now(); if (net.shieldAuto || net.lockAuto) bot(c, 'A saved safety state needs review: fans can read but not talk while the lobby is read-only. Check the band panel; /lobby unlock and /shieldoff when you are ready.'); saveNet(); }
        out(c, { t: 'hello', role, lock: net.lock, shield: net.shield, budget: lvl, needNick: true, verified: !!account, capabilities: capabilities(c) });
        return { ok: true };
    }

    function disconnect(id, why = 'Quit') {
        const c = conns.get(id);
        if (!c) return;
        for (const name of [...c.channels]) leave(c, ch(name), why, true);
        for (const [k, v] of pm) if (v.fromId === id || v.toId === id) {
            if (v.state === 'pending') endPendingPm(k, v, 'The other visitor disconnected.');
            else pm.delete(k);
        }
        conns.delete(id);
        pruneReceipts(); // A later connection must never inherit a departed socket's delivery witness.
        if (isBand(c)) { net.lastBand = now(); saveNet(); }
        pushAdmin();
    }

    function leave(c, chan, why = '', quitting = false) {
        if (!chan || !chan.members.has(c.id)) return;
        chan.members.delete(c.id);
        c.channels.delete(chan.name);
        c.cams.delete(lc(chan.name));
        event(chan, quitting ? `${nickOf(c)} has quit (${why || 'Quit'})` : `${nickOf(c)} has left ${chan.name}${why ? ` (${why})` : ''}`);
        sendChan(chan);
        if (chan.kind !== 'lobby' && chan.members.size === 0) chan.emptySince = now();
        if (!quitting) out(c, { t: 'part', ch: chan.name });
        pushList();
    }

    function enter(c, chan, { key = '' } = {}) {
        if (chan.members.has(c.id)) return true;
        if (chan.kind !== 'lobby' && !chan.members.size && [...channels.values()].filter((r) => r.kind !== 'lobby' && r.members.size).length >= L.roomsListed) return bot(c, 'All 30 active room slots are busy. Try again shortly.', 'error');
        if (!isBand(c)) {
            if (!owns(c, chan) && banned(chan.bans, c)) return bot(c, `You're banned from ${chan.name}.`, 'error'), false;
            if (!owns(c, chan) && (chan.kicks[c.dev] || 0) > now()) return bot(c, `Kicked from ${chan.name} recently. Give it a few minutes.`, 'error'), false;
            if (chan.modes.locked && !hosts(c, chan)) return bot(c, `${chan.name} is locked right now.`, 'error'), false;
            if (chan.modes.i && !chan.invites.has(c.dev) && !hosts(c, chan)) return bot(c, `${chan.name} is invite-only (+i). Ask an @ to /invite you.`, 'error'), false;
            if (chan.modes.k && key !== chan.modes.k && !hosts(c, chan)) return bot(c, `${chan.name} needs a key (+k): /join ${chan.name} key`, 'error'), false;
            if (chan.members.size >= chan.modes.l - (chan.owner && !owns(c, chan) && !membersOf(chan).some((m) => owns(m, chan)) ? 1 : 0)) return bot(c, `${chan.name} is full (+l ${chan.modes.l}).`, 'error'), false;
        }
        if (owns(c, chan) || c.account && chan.cohosts.has(c.account)) chan.renewed = now();
        chan.members.add(c.id);
        chan.emptySince = null;
        if (chan.kind !== 'lobby') bump(net.stats.rooms, (KINDS[chan.kind].endsWith(chan.title) ? KINDS[chan.kind] : `${KINDS[chan.kind]} · ${chan.title}`).slice(0, 60));
        c.channels.add(chan.name);
        const act = actSnapshot(chan);
        // Classic IRC: channel metadata/current activity may synchronize, but chat begins now.
        // The bounded moderation context above is not a visitor backlog.
        out(c, { t: 'join', ch: chanView(chan), act });
        event(chan, `${nickOf(c)} has joined ${chan.name}`);
        if (chan.kind === 'lobby') bot(c, `welcome to #stalemate, ${c.nick}. One rule: Don’t be a dick. Swear all you want; no hate, threats, creepy stuff or personal info. 🚩 anything gross. /help for commands.`);
        else if (chan.kind === 'jam') bot(c, `welcome to ${chan.name}. Music runs in the WebJam desktop app (Jamulus) for tight timing. Plug in Ethernet: Wi-Fi adds lag and dropouts.`);
        else if (chan.kind === 'chat') bot(c, `welcome to ${chan.name}. The room host runs this conversation; site moderators handle abuse. Chat starts when you join. Start an activity room to draw, watch or use optional cameras.`);
        else bot(c, `welcome to ${chan.name}. The room host runs this activity; site moderators handle abuse. Cameras stay off unless you turn yours on (18+).`);
        sendChan(chan);
        pushList();
        return true;
    }

    // ---------- inbound ----------
    function message(id, raw) {
        const c = conns.get(id);
        if (!c) return;
        c.frames += 1;
        spend(1 / 20);
        if (typeof raw !== 'string' || raw.length > L.actFrameBytes) return kill(c, 4400, 'bad frame');
        let f;
        try { f = JSON.parse(raw); } catch (e) { return kill(c, 4400, 'bad frame'); }
        if (!f || typeof f !== 'object' || typeof f.t !== 'string') return kill(c, 4400, 'bad frame');
        const jamEnvelope = f.t === 'cmd' && f.name === 'jamlink' && Array.isArray(f.args) && f.args.length === 2 && f.args[0] === 'invitation';
        const maxBytes = f.t === 'act' || jamEnvelope ? L.actFrameBytes : L.frameBytes;
        if (raw.length > maxBytes) return kill(c, 4400, 'bad frame');
        if (c.frames > L.framesPerConnection) return kill(c, 4429, 'frame cap');
        if (!c.nick && f.t !== 'hello') return bot(c, 'Pick a nickname first.', 'error');
        if (f.t !== 'act' && f.t !== 'say' && f.t !== 'cmd' && !limited(c, 'command', 10, 1, true)) return;
        switch (f.t) {
        case 'hello': return hello(c, f);
        case 'say': {
            const text = typeof f.text === 'string' ? f.text : '';
            if (text.startsWith('/') && !text.startsWith('//')) return runLine(c, f.ch, text);
            return say(c, f.ch, text.replace(/^\/\//, '/'), false);
        }
        case 'cmd': {
            const name = lc(f.name);
            const args = jamEnvelope ? ['invitation', typeof f.args[1] === 'string' ? f.args[1] : '']
                : Array.isArray(f.args) ? f.args.slice(0, 8).map((a) => String(a).slice(0, 300)) : [];
            return command(c, f.ch, name, args);
        }
        case 'report': return report(c, String(f.id || ''), f.text);
        case 'cam': return cam(c, f.ch, !!f.on, f.adult18 === true);
        case 'act': return roomAct(c, f);
        case 'admin-refresh': if (isStaff(c) && c.admin) out(c, { t: 'admin', state: { ...adminState(), capabilities: capabilities(c) } }); return undefined;
        default: return kill(c, 4400, 'bad frame');
        }
    }

    function kill(c, code, reason) { if (closeBatch) closeBatch.push([c.id, code, reason]); else close(c.id, code, reason); disconnect(c.id, reason); }

    function hello(c, f) {
        if (c.nick) return bot(c, 'Already here. Use /nick to change.', 'error');
        if (!isStaff(c) && f.age13 !== true) return bot(c, 'Tick "I\'m 13+ and will be cool" to chat.', 'error');
        const v = checkNick(f.nick, net.lists, { band: isBand(c) });
        if (!v.ok) return out(c, { t: 'nick-error', text: v.reason });
        if (byNick(v.nick)) return out(c, { t: 'nick-error', text: 'That nick is taken right now.' });
        if (!isBand(c) && banned(net.bans, { ...c, nick: v.nick })) { kill(c, 4403, 'banned'); return undefined; }
        c.nick = v.nick;
        c.lastNick = now();
        statHour().joins += 1; statPeak();
        out(c, { t: 'welcome', nick: c.nick, role: c.role, band: isBand(c), moderator: c.role === 'moderator', verified: !!c.account, capabilities: capabilities(c) });
        out(c, { t: 'list', rooms: directory(c) });
        enter(c, ch(LOBBY));
        if (c.admin) out(c, { t: 'admin', state: { ...adminState(), capabilities: capabilities(c) } });
        return undefined;
    }

    // Every typed line funnels through here; tap buttons send {t:'cmd'} which lands in command() the same way.
    function runLine(c, where, text) {
        const parts = normalize(text, 400).slice(1).split(' ');
        const name = lc(parts.shift());
        return command(c, where, name, parts);
    }

    function allowed(c, scope, chan) {
        if (scope === 'any') return true;
        if (scope === 'moderator') return isStaff(c);
        if (scope === 'band') return isBand(c);
        if (scope === 'chanop') return !!chan && chan.kind !== 'lobby' ? isOp(c, chan) : isStaff(c); // lobby ops = band only
        return false;
    }

    function command(c, where, name, args) {
        if (!limited(c, 'command', 10, 1, true)) return;
        if (roomsBroken && !['help', 'list', 'names', 'whois', 'part', 'quit', 'lobby', 'log'].includes(name)) return bot(c, 'Storage needs administrator recovery before changes can continue.', 'error');
        const alias = { j: 'join', leave: 'part', m: 'msg', q: 'query', w: 'whois', who: 'names', exit: 'quit', bye: 'quit', h: 'help', '?': 'help', deny: 'decline', approveheld: 'approve' };
        name = alias[name] || name;
        const scope = COMMANDS[name];
        if (!scope) return bot(c, `Unknown command /${String(name).slice(0, 20)}. Try /help.`, 'error');
        // Channel-scoped op commands may name the channel as the first argument (/mode #room +m, /close #room).
        let chan = ch(where) || ch(LOBBY);
        if (['mode', 'close', 'lock', 'invite'].includes(name) && /^#/.test(args[0] || '') && ch(args[0])) {
            if (name !== 'invite') chan = ch(args.shift());
        }
        if (name === 'invite' && args[1] && ch(args[1])) chan = ch(args[1]);
        if (!allowed(c, scope, chan)) {
            log(nickOf(c), 'denied', `/${name}`, 'not permitted', chan ? chan.name : '');
            return out(c, { t: 'denied', cmd: name, text: `* /${name}: permission denied. ${scope === 'band' ? 'Band administrators only.' : scope === 'moderator' ? 'Site moderators only.' : `You need @ in ${chan ? chan.name : 'that room'}.`}` });
        }
        if (c.role === 'moderator' && chan.kind === 'lobby' && ['mode', 'lock', 'op', 'deop', 'voice', 'devoice', 'topic'].includes(name)) return bot(c, 'Site configuration is restricted to band administrators.', 'error');
        // Leave room for bounded metadata changes and disconnect bookkeeping. Cleanup
        // remains available when storage is full; refuse growth before side effects.
        const growsRoom = chan.kind !== 'lobby' && (
            ['register', 'acceptowner', 'invite', 'op', 'voice', 'ban'].includes(name)
            || name === 'topic' && args.length > 0
            || name === 'lock' && lc(args[0]) !== 'off'
            || name === 'cohost' && args[0] === 'add'
            || name === 'mode' && String(args[0] || '').startsWith('+'));
        if (growsRoom && !roomCapacity()) return bot(c, 'Room storage is full. Clear an idle canvas or remove unused room grants before adding more.', 'error');
        const fn = handlers[name];
        return fn(c, chan, args);
    }

    const target = (c, nick) => {
        const t = byNick(nick);
        if (!t) bot(c, `No such nick: ${String(nick || '').slice(0, 20)}`, 'error');
        return t;
    };

    function consumeDaily(c) {
        const day = new Date(now()).toISOString().slice(0, 10);
        const keys = [c.dev, ...(c.account ? [c.account] : [])];
        if (devStats.size + keys.filter((key) => !devStats.has(key)).length > 5000) { bot(c, 'Daily allowance storage is busy. Try again later.', 'error'); return false; }
        const rows = keys.map((key) => { const old = devStats.get(key) || {}; return [key, old.day === day ? old : { ...old, day, msgs: 0 }]; });
        if (rows.some(([, st]) => st.msgs >= L.perDeviceDay)) { bot(c, 'That’s 200 lines today. Come back tomorrow.', 'error'); return false; }
        for (const [key, st] of rows) devStats.set(key, { ...st, msgs: (st.msgs || 0) + 1 });
        return true;
    }
    function limited(c, kind, cap, refill, ip = false) {
        if (isBand(c)) return true;
        const keys = [`dev:${c.dev}`, ...(c.account ? [`account:${c.account}`] : [])];
        let retry = rates.take(keys, kind, cap, refill);
        if (ip) retry = Math.max(retry, rates.take([c.iph], 'ip-command', 120, 2));
        if (!retry) return true;
        if (!c.rateNotice || now() - c.rateNotice >= 5000) {
            c.rateNotice = now(); out(c, { t: 'rate-limit', scope: kind, retryAfter: retry, text: `Please wait ${retry}s before trying again.` });
        }
        return false;
    }
    function ownerOnly(c, room) {
        if (room.kind === 'lobby' || !owns(c, room)) { bot(c, 'Only the registered room owner can do that.', 'error'); return false; }
        return true;
    }
    function removeDeviceOp(room, dev) { room.ops.delete(dev); room.opAccounts.delete(dev); }
    function removeCohost(room, account) {
        room.cohosts.delete(account); delete room.cohostLabels[account];
        if (room.transfer?.to === account) room.transfer = null;
        // Grant-time bindings survive disconnect/restart. Legacy unmapped grants
        // can also be identified by an exact admitted account/device binding,
        // but never by a retained label or a subsequently reused nickname.
        for (const [dev, grantedAccount] of room.opAccounts) if (grantedAccount === account) removeDeviceOp(room, dev);
        for (const person of conns.values()) if (person.account === account && !room.opAccounts.has(person.dev)) removeDeviceOp(room, person.dev);
    }
    const roomMetadata = (room) => ({ ...roomRecord(room), opAccounts: [...room.opAccounts] });
    function roomSnapshot() { return { version: 1, rooms: [...channels.values()].filter((r) => r.kind !== 'lobby').map(roomMetadata) }; }
    function validOpAccounts(room) {
        // The optional field keeps existing ops arrays readable without inventing
        // historical identity associations. Each current grant adds at most one.
        const rows = room.opAccounts;
        return rows === undefined || Array.isArray(rows) && rows.length <= room.ops.length
            && rows.every((row) => Array.isArray(row) && row.length === 2 && row.every(moderationIdentity) && room.ops.includes(row[0]))
            && new Set(rows.map(([dev]) => dev)).size === rows.length;
    }
    // Metadata belongs to an already admitted WebSocket, never to a returning nickname.
    // The adapter supplies the exact live socket identities again after hibernation.
    function sessionMetadata() {
        const live = [...conns.values()].filter((c) => c.nick);
        return { version: 1, connections: live.map((c) => ({
            id: c.id, dev: c.dev, iph: c.iph, account: c.account || '', role: c.role, admin: c.admin,
            nick: c.nick, channels: [...c.channels], away: c.away, ignores: [...c.ignores], blocks: [...c.blocks], pmOff: c.pmOff,
            cams: [...c.cams], since: c.since, lastNick: c.lastNick, tokens: c.tokens, last: c.last, frames: c.frames,
            lastSaid: Object.fromEntries(Object.entries(c.lastSaid).filter(([name]) => c.channels.has(name))),
            actTokens: c.actTokens, actLast: c.actLast, camReports: c.camReports || 0
        })), pm: [...pm].filter(([, p]) => p.state === 'open' && conns.has(p.fromId) && conns.has(p.toId))
            .map(([key, p]) => ({ key, from: p.from, fromId: p.fromId, toId: p.toId, state: 'open' })),
        pendingPm: [...pm].filter(([, p]) => p.state === 'pending' && conns.has(p.fromId) && conns.has(p.toId))
            .map(([key, p]) => ({ key, from: p.from, fromId: p.fromId, toId: p.toId, at: p.at, hadFirst: !!p.first || !!p.lostFirst })) };
    }
    function sessionSnapshot() {
        return { ...sessionMetadata(), receipts: [...receipts.values()].map((r) => ({ ...r, recipients: [...r.recipients] })) };
    }
    function restoreSessions(saved, liveIdentities = []) {
        const rejected = [], resumed = [];
        const rejectAll = (reason) => ({ resumed, rejected: liveIdentities.map((a) => ({ id: a.id, reason })) });
        if (!saved) return rejectAll('session-missing');
        const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
        const time = (v) => Number.isFinite(v) && v >= 0 && v <= now();
        const namesList = (list, max, valid) => Array.isArray(list) && list.length <= max && new Set(list).size === list.length && list.every(valid);
        const chanName = (v) => typeof v === 'string' && /^#[a-z0-9-]{2,30}$/.test(v);
        const nick = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(v);
        const numeric = (v, max) => Number.isFinite(v) && v >= 0 && v <= max;
        const valid = (s) => obj(s) && ['id', 'dev', 'iph'].every((k) => moderationIdentity(s[k]))
            && (s.account === '' || moderationIdentity(s.account)) && ['fan', 'moderator', 'band', 'owner'].includes(s.role)
            && typeof s.admin === 'boolean' && nick(s.nick) && namesList(s.channels, 31, chanName)
            && typeof s.away === 'string' && s.away.length <= 80
            && namesList(s.ignores, SESSION_PREFERENCES, nick) && namesList(s.blocks, SESSION_PREFERENCES, moderationIdentity)
            && typeof s.pmOff === 'boolean' && namesList(s.cams, 30, chanName) && s.cams.every((name) => s.channels.includes(name))
            && time(s.since) && time(s.lastNick) && time(s.last) && time(s.actLast)
            && numeric(s.tokens, L.burst) && numeric(s.actTokens, L.actBurst)
            && Number.isInteger(s.frames) && numeric(s.frames, L.framesPerConnection)
            && Number.isInteger(s.camReports) && numeric(s.camReports, L.lobbyMax)
            && obj(s.lastSaid) && Object.keys(s.lastSaid).length <= 31 && Object.entries(s.lastSaid).every(([name, at]) => s.channels.includes(name) && time(at));
        try {
            if (conns.size || saved.version !== 1 || !Array.isArray(saved.connections) || saved.connections.length > SESSION_CONNECTIONS
                || encoder.encode(JSON.stringify(saved)).byteLength > SESSION_STATE_BYTES || saved.connections.some((s) => !valid(s))
                || new Set(saved.connections.map((s) => s.id)).size !== saved.connections.length
                || new Set(saved.connections.map((s) => lc(s.nick))).size !== saved.connections.length
                || !Array.isArray(saved.pm) || saved.pm.length > SESSION_PM_PAIRS || saved.pm.some((p) => !obj(p) || p.state !== 'open' || typeof p.key !== 'string'
                    || p.key.split('|').length !== 2 || !p.key.split('|').every(moderationIdentity) || pairKey(...p.key.split('|')) !== p.key
                    || !moderationIdentity(p.from) || (p.fromId === undefined && p.toId === undefined ? !p.key.split('|').includes(p.from)
                        : !moderationIdentity(p.fromId) || !moderationIdentity(p.toId) || p.fromId === p.toId || pairKey(p.fromId, p.toId) !== p.key))) return rejectAll('session-invalid');
        } catch { return rejectAll('session-invalid'); }
        const records = new Map(saved.connections.map((s) => [s.id, s]));
        for (const identity of liveIdentities) {
            const s = records.get(identity.id);
            const deny = (reason) => rejected.push({ id: identity.id, reason });
            if (!s || s.dev !== identity.dev || s.iph !== identity.iph || s.account !== (identity.account || '')
                || s.role !== (identity.role || 'fan') || s.admin !== !!identity.admin) { deny('session-identity'); continue; }
            if (identity.expiresAt !== undefined && (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= now())) { deny('session-expired'); continue; }
            if (!checkNick(s.nick, net.lists, { band: isBand(identity) }).ok) { deny('session-nickname'); continue; }
            if (!isStaff(identity) && (net.lock === 'closed' || budgetLevel() === 'closed' || banned(net.bans, s) || (net.kicks[s.dev] || 0) > now())) { deny('session-admission'); continue; }
            if (s.channels.some((name) => {
                const room = ch(name);
                return !room || !isStaff(identity) && !owns(identity, room) && (banned(room.bans, s) || (room.kicks[s.dev] || 0) > now());
            })) { deny('session-room'); continue; }
            const active = new Set([...channels.values()].filter((room) => room.kind !== 'lobby' && room.members.size).map((room) => room.name));
            for (const name of s.channels) if (name !== LOBBY) active.add(name);
            if (active.size > L.roomsListed) { deny('session-capacity'); continue; }
            const c = { ...s, email: identity.email || '', channels: new Set(s.channels), ignores: new Set(s.ignores), blocks: new Set(s.blocks),
                cams: new Set(s.cams.filter((name) => !net.shield && ch(name)?.modes.C)), lastSaid: { ...s.lastSaid } };
            conns.set(c.id, c);
            for (const name of c.channels) { const room = ch(name); room.members.add(c.id); room.emptySince = null; }
            resumed.push(c.id);
        }
        for (const p of saved.pm) {
            const from = conns.get(p.fromId), to = conns.get(p.toId);
            if (from && to && from.dev === p.from && !from.blocks.has(to.dev) && !to.blocks.has(from.dev)) pm.set(p.key, { state: 'open', from: p.from, fromId: p.fromId, toId: p.toId });
        }
        restorePendingPm(saved.pendingPm, records);
        restoreReceipts(saved.receipts);
        for (const id of resumed) {
            const c = conns.get(id), s = records.get(id);
            for (const name of s.cams) if (!c.cams.has(name)) out(c, { t: 'cam', ch: name, on: false, by: BOT });
        }
        return { resumed, rejected };
    }
    function roomCapacity(extraRoom) {
        const snapshot = roomSnapshot();
        if (extraRoom) snapshot.rooms.push(roomMetadata(extraRoom));
        return encoder.encode(JSON.stringify(snapshot)).byteLength <= roomStateLimit - ROOM_GROWTH_RESERVE;
    }
    function restoreRooms(saved) {
        if (saved === undefined) return;
        if (!saved || saved.version !== 1 || !Array.isArray(saved.rooms) || saved.rooms.length > 1030 || encoder.encode(JSON.stringify(saved)).byteLength > roomStateLimit || saved.rooms.some((r) => !validRoom(r, now()) || !validOpAccounts(r)) || new Set(saved.rooms.map((r) => r.name)).size !== saved.rooms.length) {
            roomsBroken = true; net.lock = 'readonly'; net.lockAuto = true; return;
        }
        for (const r of saved.rooms) {
            const room = mkChannel(r.name, r.kind, r.title, r.founder);
            Object.assign(room, r, { ops: new Set(r.ops), opAccounts: new Map(r.opAccounts || []), voice: new Set(r.voice), invites: new Set(r.invites), cohosts: new Set(r.cohosts), emptySince: r.emptySince ?? now() });
            // Decode through the activity validators; malformed media state cannot become a frame.
            room.act = { strokes: [], video: null };
            for (const stroke of r.act.strokes) applyStroke(room, stroke);
            if (r.act.video) applyVideo(room, { kind: 'video', ...r.act.video }, now());
            channels.set(room.name, room);
        }
        // Record the first observed empty instant so repeated hibernation cannot reset cleanup.
        if (JSON.stringify(saved) !== JSON.stringify(roomSnapshot())) return persist('rooms', roomSnapshot());
    }
    function abuseSnapshot() { return { version: 1, buckets: rates.snapshot(), devices: [...devStats], ips: [...ipRooms] }; }
    function restoreAbuse(saved) {
        if (saved === undefined) return;
        try {
            if (saved?.version !== 1 || !Array.isArray(saved.devices) || saved.devices.length > 5000 || !Array.isArray(saved.ips) || saved.ips.length > 5000) throw new Error('invalid abuse state');
            rates.restore(saved.buckets);
            for (const [k, v] of saved.devices) {
                if (!moderationIdentity(k) || !v || !Number.isFinite(v.msgs ?? 0) || !Number.isFinite(v.lastRoom ?? 0) || typeof (v.day ?? '') !== 'string') throw new Error('invalid device allowance');
                devStats.set(k, v);
            }
            for (const [k, v] of saved.ips) {
                if (!moderationIdentity(k) || !Array.isArray(v) || v.length > L.roomsPerIpHour || !v.every(Number.isFinite)) throw new Error('invalid IP allowance');
                ipRooms.set(k, v);
            }
        } catch { net.lock = 'readonly'; net.lockAuto = true; roomsBroken = true; }
    }
    // Buffer success frames until durable writes finish. The DO serializes these operations.
    function durable(fn, args) {
        const before = JSON.stringify(roomSnapshot());
        const rateBefore = JSON.stringify(abuseSnapshot());
        const sessionsBefore = JSON.stringify(sessionMetadata());
        const receiptsBefore = receiptRevision;
        outputBatch = []; closeBatch = []; evidenceWrites = [];
        let result;
        try { result = fn(...args); } catch (error) { outputBatch = null; closeBatch = null; evidenceWrites = null; throw error; }
        const frames = outputBatch; const closing = closeBatch; const writes = evidenceWrites;
        outputBatch = null; closeBatch = null; evidenceWrites = null;
        const after = roomSnapshot();
        if (!roomsBroken && JSON.stringify(after) !== before) writes.push(persist('rooms', after));
        const abuse = abuseSnapshot();
        if (JSON.stringify(abuse) !== rateBefore) writes.push(persist('abuse', abuse));
        const metadata = sessionMetadata();
        const metadataJson = JSON.stringify(metadata);
        if (receiptRevision !== receiptsBefore || metadataJson !== sessionsBefore) {
            // Receipt mutations are tracked separately. Serialize their full bounded
            // state only for the required commit, not for both change comparisons.
            // Replacing metadata's closing brace with ,"receipts":<array>} adds
            // exactly this ASCII property and the incrementally measured array.
            const bytes = encoder.encode(metadataJson).byteLength + ',"receipts":'.length + receiptBytes;
            if (bytes > SESSION_STATE_BYTES) writes.push(Promise.reject(new Error('session allowance exceeded')));
            // Stored receipt records are immutable; replacement/pruning creates
            // new records, so an outstanding storage write keeps its exact snapshot.
            else writes.push(persist('sessions', { ...metadata, receipts: [...receipts.values()] }));
        }
        const flush = () => {
            for (const [id, frame] of frames) try { send(id, frame); } catch { /* one gone socket must not stop delivery to everyone else */ }
            for (const args of closing) try { close(...args); } catch { /* already gone */ }
            return result;
        };
        if (writes.some((w) => w && typeof w.then === 'function')) {
            pendingCommits += 1;
            const finished = () => { pendingCommits -= 1; if (!pendingCommits && deferredAdmin) { deferredAdmin = false; pushAdmin(); } };
            return Promise.all(writes).then(() => { finished(); return flush(); }).catch(() => {
                finished(); storageUnavailable();
                // A failed ban/kick commit may already have removed an endpoint
                // from engine memory. End its actual socket with a service error
                // rather than leaving an admitted connection that can never act.
                for (const [id] of closing) {
                    try { send(id, { t: 'notice', from: BOT, kind: 'error', text: 'Storage is unavailable. Changes are not confirmed; reconnect after administrator recovery.', ts: now() }); } catch { /* gone */ }
                    try { close(id, 1011, 'storage unavailable'); } catch { /* gone */ }
                }
            });
        }
        return flush();
    }

    function storageUnavailable() {
        net.lock = 'readonly'; net.lockAuto = true; roomsBroken = true;
        for (const c of conns.values()) {
            out(c, { t: 'net', lock: 'readonly', shield: net.shield });
            // A failed write discards buffered success frames, including camera
            // revocation frames. Stop captures explicitly even if state changed.
            for (const name of c.channels) {
                const room = ch(name);
                if (room && room.kind !== 'chat' && room.kind !== 'lobby') out(c, { t: 'cam', ch: name, on: false, by: BOT });
            }
            c.cams.clear();
            bot(c, 'Storage is unavailable. Changes are not confirmed; reconnect after administrator recovery.', 'error');
        }
        pushAdmin();
    }

    const handlers = {
        register(c, room) {
            if (roomsBroken || net.lock !== 'off' || net.shield) return bot(c, 'Registration is paused while the community is restricted.', 'error');
            if (!c.account) return bot(c, 'Sign in with email to keep a room across visits.', 'error');
            if (room.kind === 'lobby' || room.owner || room.founder !== c.dev || !room.members.has(c.id)) return bot(c, 'Only this temporary room’s founder can register it.', 'error');
            if ([...channels.values()].filter((r) => r.owner === c.account).length >= 3 || [...channels.values()].filter((r) => r.owner).length >= 1000) return bot(c, 'Registered room allowance reached (3 per account; 1,000 sitewide).', 'error');
            room.owner = c.account; removeDeviceOp(room, c.dev); room.renewed = now();
            log(c.nick, 'room-register', room.name); sendChan(room); pushList();
            bot(c, 'Room registered. Ownership expires after 90 days without an owner or verified co-host visit.');
        },
        cohost(c, room, [action, nick]) {
            if (!ownerOnly(c, room)) return;
            if (!['add', 'remove'].includes(action)) return bot(c, '/cohost add|remove nick', 'error');
            if (action === 'remove' && room.cohosts.has(nick)) {
                removeCohost(room, nick);
                log(c.nick, 'cohost-remove', 'verified co-host', '', room.name); sendChan(room); pushList(); return;
            }
            const t = target(c, nick); if (!t || !t.account || !room.members.has(t.id)) return bot(c, 'Choose an email-verified member of this room.', 'error');
            if (owns(t, room)) return bot(c, 'The owner already has host access.', 'error');
            if (action === 'add' && room.cohosts.size >= 20) return bot(c, 'This room already has 20 verified co-hosts.', 'error');
            if (action === 'add') { room.cohosts.add(t.account); room.cohostLabels[t.account] = t.nick; } else removeCohost(room, t.account);
            if (room.transfer?.to === t.account) room.transfer = null;
            log(c.nick, `cohost-${action}`, t.nick, '', room.name); sendChan(room); pushList();
        },
        transfer(c, room, [nick]) {
            if (!ownerOnly(c, room)) return;
            const t = target(c, nick); if (!t?.account || !room.cohosts.has(t.account) || !room.members.has(t.id)) return bot(c, 'Choose a verified co-host in this room.', 'error');
            room.transfer = { from: c.account, to: t.account, until: now() + 10 * MIN };
            out(t, { t: 'owner-offer', ch: room.name, by: c.nick });
            bot(c, 'Ownership offered for 10 minutes. The co-host must accept.');
        },
        acceptowner(c, room) {
            const offer = room.transfer;
            if (!c.account || !offer || offer.to !== c.account || offer.from !== room.owner || offer.until <= now() || !room.cohosts.has(c.account) || !room.members.has(c.id)) return bot(c, 'No valid ownership offer.', 'error');
            if ([...channels.values()].filter((r) => r.owner === c.account).length >= 3) return bot(c, 'You already own three rooms.', 'error');
            room.cohosts.add(room.owner); room.cohostLabels[room.owner] = membersOf(room).find((m) => owns(m, room))?.nick || 'Previous owner'; room.cohosts.delete(c.account); delete room.cohostLabels[c.account]; room.owner = c.account; room.renewed = now(); room.transfer = null;
            // The original guest identity must not retain ownership privileges after transfer.
            removeDeviceOp(room, room.founder); room.founder = c.dev;
            log(c.nick, 'room-transfer', room.name); sendChan(room); pushList();
        },
        unregister(c, room) {
            if (!ownerOnly(c, room)) return;
            return closeRoom(room, c.nick, 'registration removed by owner');
        },
        help(c) { HELP.forEach((h) => bot(c, h)); },
        join(c, _chan, [rawName, key = '', ...titleWords]) {
            let name = String(rawName || '');
            if (!name.startsWith('#')) name = `#${name}`;
            name = name.toLowerCase();
            if (name.startsWith('&')) return bot(c, 'Private rooms live outside the lobby and are end-to-end encrypted. Use “Start a private room”.', 'error');
            if (!/^#[a-z0-9-]{2,30}$/.test(name)) return bot(c, 'Room names look like #bobross-tuesday (letters, numbers, dashes).', 'error');
            const existing = ch(name);
            if (existing) return enter(c, existing, { key });
            return create(c, name, key, titleWords.join(' '));
        },
        part(c, chan, [maybe]) {
            const target_ = maybe && ch(maybe) ? ch(maybe) : chan;
            if (target_.kind === 'lobby' && !isBand(c)) return bot(c, 'You can’t part #stalemate, but you can /quit.', 'error');
            return leave(c, target_);
        },
        quit(c, _chan, args) { kill(c, 1000, normalize(args.join(' '), 80) || 'Quit'); },
        nick(c, _chan, [n]) {
            if (now() - c.lastNick < L.nickEvery && !isBand(c)) return bot(c, 'One nick change per minute.', 'error');
            const v = checkNick(n, net.lists, { band: isBand(c) });
            if (!v.ok) return bot(c, v.reason, 'error');
            if (byNick(v.nick) && byNick(v.nick) !== c) return bot(c, 'That nick is taken right now.', 'error');
            if (!isBand(c) && banned(net.bans, { ...c, nick: v.nick })) return bot(c, 'That nick is banned.', 'error');
            const old = c.nick;
            c.nick = v.nick;
            c.lastNick = now();
            for (const p of pm.values()) if (p.state === 'pending' && p.fromId === c.id) {
                const recipient = conns.get(p.toId);
                if (recipient) {
                    out(recipient, { t: 'pm-request-ended', from: old });
                    out(recipient, { t: 'pm-request', from: c.nick, band: isBand(c) });
                }
            }
            out(c, { t: 'welcome', nick: c.nick, role: c.role, band: isBand(c), moderator: c.role === 'moderator', verified: !!c.account, capabilities: capabilities(c) });
            for (const name of c.channels) { const chn = ch(name); event(chn, `${old} is now known as ${c.nick}`); sendChan(chn); }
            return pushAdmin();
        },
        me(c, chan, args) { return say(c, chan.name, args.join(' '), true); },
        slap(c, chan, [n]) {
            const t = byNick(n);
            if (!t) return bot(c, `No such nick: ${String(n || '').slice(0, 20)}`, 'error');
            return say(c, chan.name, `slaps ${t.nick} around a bit with a large trout`, true);
        },
        msg(c, chan, [to, ...words]) {
            if (/^#/.test(to || '')) { const room = ch(to); if (!room || !room.members.has(c.id)) return bot(c, `You're not in ${String(to).slice(0, 30)}.`, 'error'); return say(c, room.name, words.join(' '), false); }
            if (lc(to) === lc(BOT)) return handlers.help(c);
            return privmsg(c, to, words.join(' '));
        },
        query(c, _chan, [to]) { return privmsg(c, to, ''); },
        accept(c, _chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            const k = pairKey(c.id, t.id);
            const p = pm.get(k);
            if (!p || p.state !== 'pending' || p.from !== t.dev || p.fromId !== t.id || p.toId !== c.id) return bot(c, `No PM request from ${t.nick}.`, 'error');
            if (now() - p.at >= PM_PENDING_TTL || !pendingPmAllowed(t, c)) {
                endPendingPm(k, p, 'The PM request expired or is no longer allowed.');
                return bot(c, 'This PM request expired or is no longer allowed. Ask for a new request if you want to chat.', 'error');
            }
            if ([...pm.values()].filter((item) => item.state === 'open').length >= SESSION_PM_PAIRS) return bot(c, 'Private conversation allowance is full. Try again later.', 'error');
            p.state = 'open';
            out(c, { t: 'pm-open', with: t.nick });
            out(t, { t: 'pm-open', with: c.nick });
            if (p.first) deliverPm(t, c, p.first);
            if (p.lostFirst) {
                bot(t, `Your PM with ${c.nick} is open. Your undelivered first message was not retained during a server restart. Please send it again.`);
                bot(c, `Your PM with ${t.nick} is open. Their undelivered first message was not retained during a server restart; ask them to resend it.`);
                p.lostFirst = false;
            }
            p.first = '';
            return undefined;
        },
        decline(c, _chan, [n]) {
            const t = byNick(n); if (!t) return bot(c, 'Request cleared.');
            const p = pm.get(pairKey(c.id, t.id));
            if (p?.state === 'pending' && (p.toId !== c.id || p.fromId !== t.id)) return bot(c, 'That PM request belongs to a different connection.', 'error');
            pm.delete(pairKey(c.id, t.id));
            out(t, { t: 'notice', from: BOT, text: `${c.nick} said no thanks to a PM.`, kind: 'info', ts: now() });
            return bot(c, `Declined ${t.nick}.`);
        },
        block(c, _chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            if ((!c.blocks.has(t.dev) && c.blocks.size >= SESSION_PREFERENCES) || (!c.ignores.has(lc(t.nick)) && c.ignores.size >= SESSION_PREFERENCES)) return bot(c, 'Your block or ignore list is full (50 each). Remove an entry before adding another.', 'error');
            c.blocks.add(t.dev); c.ignores.add(lc(t.nick));
            for (const [key, pending] of pm) if ((pending.fromId === c.id && conns.get(pending.toId)?.dev === t.dev)
                || (pending.toId === c.id && conns.get(pending.fromId)?.dev === t.dev)) {
                if (pending.state === 'pending') endPendingPm(key, pending, 'The conversation was blocked.');
                else pm.delete(key);
            }
            out(t, { t: 'pm-closed', with: c.nick });
            out(c, { t: 'pm-closed', with: t.nick });
            return bot(c, `Blocked ${t.nick}. They can't PM you and you won't see them.`);
        },
        unblock(c, _chan, [n]) { const t = byNick(n); if (t) { c.blocks.delete(t.dev); c.ignores.delete(lc(t.nick)); } return bot(c, `Unblocked ${String(n || '').slice(0, 20)}.`); },
        pm(c, _chan, [v]) { c.pmOff = lc(v) === 'off'; if (c.pmOff) for (const [k, p] of pm) if ((p.fromId === c.id || p.toId === c.id) && p.state === 'pending') endPendingPm(k, p, 'PM requests were turned off.'); return out(c, { t: 'pm-setting', off: c.pmOff, text: c.pmOff ? 'PMs are off. Nobody can send you requests.' : 'PMs are on (accept-first).' }); },
        whois(c, _chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            const mins = Math.round((now() - t.since) / MIN);
            const visible = [...t.channels].filter((name) => { const room = ch(name); return room && visibleRoom(c, room); });
            return bot(c, `${t.nick}${isBand(t) ? ' ⭐ BAND' : ''} · on ${visible.join(' ')} · here ${mins}m${t.away ? ` · away: ${t.away}` : ''}`);
        },
        away(c, _chan, args) {
            c.away = normalize(args.join(' '), 80);
            if (c.away && checkText(c.away, net.lists).verdict !== 'ok') c.away = 'away';
            for (const name of c.channels) sendChan(ch(name));
            return bot(c, c.away ? `You're marked away: ${c.away}` : 'Welcome back.');
        },
        ignore(c, _chan, [n]) {
            if (!n) return bot(c, `Ignoring: ${[...c.ignores].join(', ') || 'nobody'}`);
            const value = lc(n);
            if (!/^[a-z][a-z0-9_\-[\]{}^`|]{2,19}$/.test(value)) return bot(c, 'Use a nickname to ignore someone.', 'error');
            if (!c.ignores.has(value) && c.ignores.size >= SESSION_PREFERENCES) return bot(c, 'Your ignore list is full (50). Remove an entry before adding another.', 'error');
            c.ignores.add(value); return bot(c, `Ignoring ${String(n).slice(0, 20)}.`);
        },
        unignore(c, _chan, [n]) { c.ignores.delete(lc(n)); return bot(c, `Unignored ${String(n || '').slice(0, 20)}.`); },
        list(c) { return out(c, { t: 'list', rooms: directory(c), show: true }); },
        names(c, chan, [maybe]) { const room = maybe && ch(maybe) ? ch(maybe) : chan; if (!visibleRoom(c, room)) return bot(c, 'That room is unavailable.', 'error'); return bot(c, `${room.name}: ${names(room).map((n) => `${n.prefix}${n.nick}`).join(' ')}`); },
        topic(c, chan, args) {
            if (!visibleRoom(c, chan) || args.length && !chan.members.has(c.id) && !isOp(c, chan)) return bot(c, 'Join the room to view or change its topic.', 'error');
            if (!args.length) return bot(c, `${chan.name} topic: ${chan.topic || '(none)'}`);
            if (chan.modes.t && !isOp(c, chan) || (chan.kind === 'lobby' && !isBand(c))) { log(nickOf(c), 'denied', '/topic', 'not op', chan.name); return out(c, { t: 'denied', cmd: 'topic', text: '* /topic: only @ can set the topic (+t).' }); }
            const v = checkText(args.join(' '), net.lists);
            if (v.verdict !== 'ok') return bot(c, 'Not cool here. Topic not set.', 'error');
            chan.topic = v.text.slice(0, 160);
            event(chan, `${c.nick} changes topic to '${chan.topic}'`);
            return sendChan(chan);
        },
        report(c, chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            const last = [...lines.values()].reverse().find((l) => l.from === t.nick && l.ch === chan.name);
            if (!last) return bot(c, `Nothing recent from ${t.nick} here to report. Use the 🚩 on a message.`, 'error');
            return report(c, last.id);
        },
        cam(c, chan, [v, adult]) { return cam(c, chan.name, lc(v) === 'on', adult === '18+'); },
        // ---- room @ ----
        kick(c, chan, [n, ...why]) {
            const t = target(c, n); if (!t) return undefined;
            if (isStaff(t) && !isBand(c)) return bot(c, 'Only band administrators can act on site staff.', 'error');
            if (owns(t, chan) && !isStaff(c)) return bot(c, 'Only site moderators can remove a registered room owner.', 'error');
            if (!chan.members.has(t.id)) return bot(c, `${t.nick} isn't in ${chan.name}.`, 'error');
            const reason = normalize(why.join(' '), 80) || 'kicked';
            if (chan.kind === 'lobby') {
                event(chan, `${t.nick} was kicked by ${c.nick} (${reason})`);
                net.kicks[t.dev] = now() + L.kickCooldown;
                log(c.nick, 'kick', t.nick, reason, chan.name);
                out(t, { t: 'kicked', ch: chan.name, by: c.nick, reason });
                return kill(t, 4001, 'kicked');
            }
            for (const [dev, until] of Object.entries(chan.kicks)) if (until <= now()) delete chan.kicks[dev];
            if (Object.keys(chan.kicks).length >= 150 && !chan.kicks[t.dev]) return bot(c, 'Room cooldown list is full; ask a site moderator for help.', 'error');
            chan.kicks[t.dev] = now() + L.kickCooldown;
            event(chan, `${t.nick} was kicked by ${c.nick} (${reason})`);
            out(t, { t: 'kicked', ch: chan.name, by: c.nick, reason });
            log(c.nick, 'kick', t.nick, reason, chan.name);
            return leave(t, chan, 'kicked');
        },
        ban(c, chan, [n, ...why]) {
            if (chan.kind === 'lobby') return handlers.gban(c, chan, [n, ...why]);
            const t = target(c, n); if (!t) return undefined;
            if (isStaff(t)) return bot(c, 'Site staff access is managed by the owner.', 'error');
            if (owns(t, chan) && !isStaff(c)) return bot(c, 'Only site moderators can act on a registered room owner.', 'error');
            const reason = normalize(why.join(' '), 80) || 'banned';
            chan.bans.push({ mask: `dev:${t.dev}`, reason, by: c.nick, at: now() }, { mask: `nick:${lc(t.nick)}`, reason, by: c.nick, at: now() },
                { mask: `iph:${t.iph}`, nick: t.nick, reason, by: c.nick, at: now(), until: now() + L.ipBan }); // a private window can't dodge it
            if (t.account) chan.bans.push({ mask: `account:${t.account}`, reason, by: c.nick, at: now() });
            if (chan.bans.length > L.roomBanMax) chan.bans = chan.bans.slice(-L.roomBanMax); // keep the newest
            event(chan, `${c.nick} sets mode +b ${t.nick}`);
            log(c.nick, 'ban', t.nick, reason, chan.name);
            for (const person of membersOf(chan)) if (!isStaff(person) && !owns(person, chan) && banned(chan.bans, person)) {
                out(person, { t: 'kicked', ch: chan.name, by: c.nick, reason }); leave(person, chan, 'banned');
            }
            return undefined;
        },
        unban(c, chan, [mask]) {
            const m = lc(mask);
            const list = chan.kind === 'lobby' ? net.bans : chan.bans;
            const before = list.length;
            const keep = list.filter((b) => !(b.mask === m || b.mask === `nick:${m}` || b.nick && lc(b.nick) === m));
            if (keep.length === before) return bot(c, `No ban matching ${String(mask || '').slice(0, 30)}.`, 'error');
            if (chan.kind === 'lobby') { net.bans = keep; saveNet(); } else { chan.bans = keep; }
            event(chan, `${c.nick} sets mode -b ${mask}`);
            log(c.nick, 'unban', mask, '', chan.name);
            return undefined;
        },
        invite(c, chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            if (chan.kind === 'lobby') return bot(c, '/invite nick #room', 'error');
            if (chan.invites.size >= 150 && !chan.invites.has(t.dev)) return bot(c, 'Room invitation list is full.', 'error');
            chan.invites.add(t.dev);
            out(t, { t: 'invite', ch: chan.name, by: c.nick });
            return bot(c, `Invited ${t.nick} to ${chan.name}.`);
        },
        op(c, chan, [n]) { return setRank(c, chan, n, 'ops', true, '+o'); },
        deop(c, chan, [n]) { return setRank(c, chan, n, 'ops', false, '-o'); },
        voice(c, chan, [n]) { return setRank(c, chan, n, 'voice', true, '+v'); },
        devoice(c, chan, [n]) { return setRank(c, chan, n, 'voice', false, '-v'); },
        mode(c, chan, [flag, arg]) {
            const m = /^([+-])([miklSCQ])$/.exec(String(flag || ''));
            if (!m) return bot(c, `${chan.name} modes: ${modeString(chan)}. Usage: /mode +m|+i|+k key|+l N|+S secs|+C|+Q`);
            const on = m[1] === '+';
            const k = m[2];
            if (chan.kind === 'lobby' && ['k', 'i'].includes(k)) return bot(c, 'Use /lobby lock|readonly for #stalemate.', 'error');
            if (k === 'k') { if (on && !/^[A-Za-z0-9]{3,20}$/.test(arg || '')) return bot(c, '+k needs a 3-20 letter key.', 'error'); chan.modes.k = on ? arg : ''; }
            else if (k === 'l') { const n = Number(arg); const cap = chan.kind === 'lobby' ? L.lobbyMax : L.roomMax; chan.modes.l = on && Number.isInteger(n) && n > 0 ? Math.min(n, cap) : cap; }
            else if (k === 'S') { const n = Number(arg); chan.modes.S = on ? (Number.isInteger(n) && n >= 0 ? Math.min(n, 300) : 5) : 0; }
            else if (k === 'C') { if (on && (chan.kind === 'chat' || chan.kind === 'lobby')) return bot(c, 'Cameras belong in activity rooms.', 'error'); if (on && net.shield) return bot(c, 'Shield is on: cameras stay off.', 'error'); chan.modes.C = on; if (!on) camsOff(chan, c.nick); }
            else chan.modes[k] = on;
            event(chan, `${c.nick} sets mode ${flag}${k === 'k' && on ? ' ****' : arg && k !== 'k' ? ` ${arg}` : ''}`);
            log(c.nick, 'mode', `${chan.name} ${flag}${arg && k !== 'k' ? ` ${arg}` : ''}`, '', chan.name);
            sendChan(chan);
            return pushList();
        },
        // Hand-off to WebJam: the host pastes the invite WebJam's desktop app made. We store and relay it, nothing more;
        // WebJam owns signaling, the mailbox, TURN and Jamulus. `web` is the Web Join (#388) hook, off until an
        // allowed origin is configured.
        jamlink(c, chan, [which, link]) {
            if (!chan.jam) return bot(c, '/jamlink only works in a #jam room.', 'error');
            if (lc(which) === 'clear') { chan.jam = { desktop: '', web: '' }; event(chan, `${c.nick} cleared the jam links`); return sendChan(chan); }
            const v = which === 'web' ? validWebJoin(link, L.webJoinOrigins) : which === 'invitation' ? validWebjamInvitation(link) : validWebjamInvite(which === 'desktop' ? link : which);
            if (!v) return bot(c, which === 'web' ? 'Browser joining is not configured for this beta.' : 'Paste the complete message from WebJam’s Copy Invite into the room’s invitation box (maximum 8 KB).', 'error');
            if (which === 'web') chan.jam.web = v;
            else { chan.jam.invitation = v; chan.jam.desktop = validWebjamInvite(v); }
            event(chan, `${c.nick} shared a WebJam ${which === 'web' ? 'browser' : 'desktop'} invitation. Copy the full invitation into WebJam’s Join screen. Ethernet beats Wi-Fi.`);
            log(c.nick, 'jamlink', chan.name, which === 'web' ? 'web' : 'desktop', chan.name);
            return sendChan(chan);
        },
        lock(c, chan, [v]) {
            if (chan.kind === 'lobby') return handlers.lobby(c, chan, [v === 'off' ? 'unlock' : 'readonly']);
            chan.modes.locked = lc(v) !== 'off';
            event(chan, `${c.nick} ${chan.modes.locked ? 'locked' : 'unlocked'} ${chan.name}`);
            log(c.nick, chan.modes.locked ? 'lock-room' : 'unlock-room', chan.name, '', chan.name);
            sendChan(chan);
            return pushList();
        },
        close(c, chan) {
            if (chan.kind === 'lobby') return bot(c, '#stalemate can’t be closed. Use /lobby lock.', 'error');
            if (chan.owner && !owns(c, chan) && !isStaff(c)) return bot(c, 'Only the owner or site moderators can close a registered room.', 'error');
            return closeRoom(chan, c.nick, isBand(c) ? 'closed by the band' : 'closed by the host');
        },
        // ---- band @ ----
        gban(c, chan, [n, ...why]) {
            const t = target(c, n); if (!t) return undefined;
            if (isStaff(t)) return bot(c, 'Site staff access must be removed through the staff allowlist and Cloudflare Access.', 'error');
            const reason = normalize(why.join(' '), 80);
            if (!reason) return bot(c, 'A ban needs a reason: /ban nick why', 'error');
            net.bans.push({ mask: `dev:${t.dev}`, nick: t.nick, reason, by: c.nick, at: now() },
                { mask: `iph:${t.iph}`, nick: t.nick, reason, by: c.nick, at: now(), until: now() + L.ipBan },
                { mask: `nick:${lc(t.nick)}`, nick: t.nick, reason, by: c.nick, at: now() });
            if (t.account) net.bans.push({ mask: `account:${t.account}`, reason, by: c.nick, at: now() });
            if (net.bans.length > L.banMax) net.bans = net.bans.slice(-L.banMax); // keep the newest
            for (const name of t.channels) event(ch(name), `${t.nick} was banned by ${c.nick} (${reason})`);
            log(c.nick, 'ban', t.nick, reason, 'network');
            saveNet();
            for (const person of [...conns.values()]) if (!isStaff(person) && banned(net.bans, person)) {
                out(person, { t: 'kicked', ch: LOBBY, by: c.nick, reason, banned: true });
                kill(person, 4003, 'banned');
            }
            return undefined;
        },
        mute(c, chan, [n, dur]) {
            const t = target(c, n); if (!t) return undefined;
            if (isStaff(t) && !isBand(c)) return bot(c, 'Staff privileges are managed by the owner.', 'error');
            const ms = Math.min(parseDuration(dur, 10 * MIN), DAY);
            net.mutes[t.dev] = now() + ms;
            if (t.account) net.mutes[t.account] = now() + ms;
            bot(t, `You're muted for ${Math.round(ms / MIN)} min. You can still read.`, 'error');
            log(c.nick, 'mute', t.nick, `${Math.round(ms / MIN)}m`, chan.name);
            return saveNet();
        },
        purge(c, chan, [what]) {
            const t = byNick(what);
            if (t && isStaff(t) && !isBand(c)) return bot(c, 'Staff actions require a band administrator.', 'error');
            const window = /^\d+[smh]$/.test(what || '') ? parseDuration(what, 5 * MIN) : 0;
            const ids = [...new Set([...lines.keys(), ...receipts.keys()])].filter((id) => {
                const line = lines.get(id) || receipts.get(id);
                const author = lineMeta.get(id)?.authorDev || receipts.get(id)?.authorDev;
                return t ? author === t.dev : window ? line.ts >= now() - window : false;
            });
            if (!ids.length) return bot(c, 'Nothing to purge.', 'error');
            deleteIds(ids);
            return log(c.nick, 'purge', t ? t.nick : what, `${ids.length} lines`, chan.name);
        },
        delete(c, chan, [id]) {
            if (!lines.has(id) && !receipts.has(id) && !held.has(id) && !aiReviews.has(id) && !reports.has(id)) return bot(c, 'No such message.', 'error');
            if (held.delete(id)) { heldChannels.delete(id); saveModerationQueue(); }
            deleteIds([id]);
            return log(c.nick, 'delete', id, '', chan.name);
        },
        shield(c) { return shield(true, c.nick); },
        shieldoff(c) { return shield(false, c.nick); },
        lobby(c, chan, [v]) {
            const mode = { lock: 'closed', closed: 'closed', readonly: 'readonly', unlock: 'off', off: 'off' }[lc(v)];
            if (!mode) return bot(c, '/lobby lock|readonly|unlock', 'error');
            net.lock = mode;
            net.lockAuto = false;
            event(ch(LOBBY), `${c.nick} sets the lobby to ${mode === 'off' ? 'open' : mode === 'readonly' ? 'read-only for fans' : 'locked (back soon)'}`);
            for (const x of conns.values()) out(x, { t: 'net', lock: net.lock, shield: net.shield });
            log(c.nick, 'lobby', mode);
            saveNet();
            if (mode === 'closed') for (const x of [...conns.values()]) if (!isBand(x)) { out(x, { t: 'kicked', ch: LOBBY, by: BOT, reason: 'Back soon' }); kill(x, 4503, 'locked'); }
            return undefined;
        },
        slow(c, chan, [n]) { return handlers.mode(c, ch(LOBBY), [Number(n) > 0 ? '+S' : '-S', String(n || 0)]); },
        filter(c, _chan, [list, ...words]) {
            const word = lc(normalize(words.join(' '), 40));
            if (!['block', 'hold', 'allow', 'del'].includes(lc(list)) || !word) return bot(c, `Filter lists: block=${net.lists.block.length} hold=${net.lists.hold.length} allow=${net.lists.allow.length}. /filter block|hold|allow|del word`);
            for (const k of ['block', 'hold', 'allow']) net.lists[k] = net.lists[k].filter((w) => w !== word);
            if (lc(list) !== 'del') {
                if (net.lists[lc(list)].length >= L.listMax) return bot(c, `The ${lc(list)} list is full (${L.listMax}). /filter del a word first.`, 'error');
                net.lists[lc(list)].push(word);
            }
            log(c.nick, `filter-${lc(list)}`, word);
            return saveNet();
        },
        camoff(c, chan, [scope]) {
            const all = lc(scope) === 'all';
            for (const room of all ? channels.values() : [chan]) camsOff(room, c.nick);
            return log(c.nick, 'camoff', all ? 'all' : chan.name);
        },
        approve(c, _chan, [id]) {
            pruneModerationQueue();
            const h = held.get(id);
            if (!h) return bot(c, 'Nothing held with that id.', 'error');
            const room = ch(h.ch);
            if (!room || heldChannels.get(id) !== room) return bot(c, 'The original room is no longer available. Dismiss or delete this held message.', 'error');
            held.delete(id); heldChannels.delete(id); saveModerationQueue();
            const { reason: _r, dev, ...clean } = h;
            if (room) publish(room, clean, dev);
            return log(c.nick, 'approve', h.from, h.reason, h.ch);
        },
        dismiss(c, _chan, [id]) {
            if (held.delete(id)) { heldChannels.delete(id); saveModerationQueue(); return log(c.nick, 'reject-held', id); }
            const r = reports.get(id);
            if (!r) return bot(c, 'No such report.', 'error');
            r.done = true;
            // Dismissing a report updates moderation state only. Rebroadcasting old text
            // would disclose pre-join messages to people who arrived afterward.
            r.hidden = false;
            saveModerationQueue();
            return log(c.nick, 'dismiss-report', r.from, '', r.ch);
        },
        aidismiss(c, _chan, [id]) {
            if (!aiReviews.delete(id)) return bot(c, 'No AI review with that message id.', 'error');
            saveAiReviews();
            return log(c.nick, 'ai-dismiss', id);
        },
        log(c) { return out(c, { t: 'modlog', entries: net.modlog.slice(-50) }); }
    };

    function setRank(c, chan, n, set, on, flag) {
        if (chan.kind === 'lobby') return bot(c, 'In #stalemate authenticated site staff are the ops. Use this inside a room.', 'error');
        const t = target(c, n); if (!t) return undefined;
        if (!chan.members.has(t.id)) return bot(c, `${t.nick} isn't in ${chan.name}.`, 'error');
        if (chan.owner && set === 'ops' && !owns(c, chan) && !isBand(c)) return bot(c, 'Only the owner manages co-hosts.', 'error');
        if (!on && owns(t, chan)) return bot(c, 'The room owner keeps host access.', 'error');
        if (on && chan[set].size >= 150) return bot(c, 'Room grants are full; remove an existing grant first.', 'error');
        if (on) chan[set].add(t.dev); else chan[set].delete(t.dev);
        if (set === 'ops') {
            if (on && t.account) chan.opAccounts.set(t.dev, t.account);
            else chan.opAccounts.delete(t.dev);
        }
        event(chan, `${c.nick} sets mode ${flag} ${t.nick}`);
        log(c.nick, `mode ${flag}`, t.nick, '', chan.name);
        return sendChan(chan);
    }

    function modeString(chan) {
        const m = chan.modes;
        return `+t${m.m ? 'm' : ''}${m.i ? 'i' : ''}${m.k ? 'k' : ''}${m.C ? 'C' : ''}${m.Q ? 'Q' : ''} l=${m.l}${m.S ? ` S=${m.S}s` : ''}${m.locked ? ' (locked)' : ''}`;
    }

    function create(c, name, key, titleText) {
        const kind = Object.keys(KINDS).find((k) => name === `#${k}` || name.startsWith(`#${k}-`)) || 'chat';
        if (net.shield && !isBand(c)) return bot(c, 'Shield is on, so new rooms are paused. Try again later.', 'error');
        if (roomsBroken) return bot(c, 'Room storage needs administrator recovery.', 'error');
        const listed = [...channels.values()].filter((x) => x.kind !== 'lobby' && !x.owner).length;
        if (listed >= L.roomsListed) return bot(c, 'All 30 room slots are busy. Join one from the list.', 'error');
        let allowance;
        if (!isBand(c)) {
            if (devStats.size >= 5000 && !devStats.has(c.dev) || ipRooms.size >= 5000 && !ipRooms.has(c.iph)) return bot(c, 'Room creation is temporarily busy.', 'error');
            const st = devStats.get(c.dev) || {};
            if (st.lastRoom && now() - st.lastRoom < L.roomPerDevice) return bot(c, 'One new room per 10 minutes.', 'error');
            const hits = (ipRooms.get(c.iph) || []).filter((t) => t > now() - HOUR);
            if (hits.length >= L.roomsPerIpHour) return bot(c, 'Too many new rooms from your connection this hour.', 'error');
            hits.push(now()); allowance = { hits, device: { ...st, lastRoom: now() } };
        }
        const title = titleText ? checkText(titleText, net.lists) : { verdict: 'ok', text: KINDS[kind].replace(/^\S+\s/, '') };
        if (title.verdict !== 'ok') return bot(c, 'Not cool here. Pick another title.', 'error');
        const nameCheck = checkText(name.slice(1).replace(/-/g, ' '), net.lists, { handles: false });
        if (nameCheck.verdict !== 'ok') return bot(c, 'Not cool here. Pick another room name.', 'error');
        const room = mkChannel(name, kind, title.text.slice(0, 40), c.dev);
        if (c.account) room.opAccounts.set(c.dev, c.account);
        if (key && /^[A-Za-z0-9]{3,20}$/.test(key)) room.modes.k = key;
        if (net.shield) room.modes.C = false;
        if (kind === 'jam') room.modes.i = true; // a WebJam invite carries the host's address: members only, founder invites
        if (!roomCapacity(room)) return bot(c, 'Room storage is full. Join an existing room or try again after an idle activity is cleared.', 'error');
        if (allowance) { ipRooms.set(c.iph, allowance.hits); devStats.set(c.dev, allowance.device); }
        bump(net.stats.kinds, kind);
        channels.set(name, room);
        log(c.nick, 'room-open', name, title.text.slice(0, 40), name);
        enter(c, room, { key });
        event(room, `${BOT} sets mode +o ${c.nick} (founder)`);
        sendChan(room);
        return pushList();
    }

    function closeRoom(chan, by, why) {
        for (const m of membersOf(chan)) { out(m, { t: 'closed', ch: chan.name, by, reason: why }); m.channels.delete(chan.name); m.cams.delete(lc(chan.name)); }
        channels.delete(lc(chan.name));
        for (const [id, pending] of aiPending) if (pending.chan === chan) aiPending.delete(id);
        log(by, 'room-close', chan.name, why, chan.name);
        pushList();
    }

    function camsOff(chan, by) {
        let any = false;
        for (const m of membersOf(chan)) if (m.cams.delete(lc(chan.name))) { any = true; out(m, { t: 'cam', ch: chan.name, on: false, by }); }
        if (any || !chan.modes.C) sendChan(chan);
    }

    function cam(c, where, on, adult18) {
        const chan = ch(where);
        if (!chan || !chan.members.has(c.id)) return bot(c, 'Join the room first.', 'error');
        if (!on) { c.cams.delete(lc(chan.name)); out(c, { t: 'cam', ch: chan.name, on: false }); return sendChan(chan); }
        if (chan.kind === 'lobby') return bot(c, 'No cameras in #stalemate. Start or join an activity room.', 'error');
        if (chan.kind === 'chat') return bot(c, 'Cameras belong in activity rooms. Start or join one to turn yours on.', 'error');
        if (net.shield) return bot(c, 'Shield is on: cameras are off everywhere for now.', 'error');
        if (!chan.modes.C) return bot(c, `Cameras are off in ${chan.name} (-C).`, 'error');
        if (!adult18) return out(c, { t: 'cam-gate', ch: chan.name, text: 'Cameras in open rooms are 18+. Tick the box to turn yours on.' });
        if ((c.camReports || 0) >= L.reportsCamOff) return bot(c, 'Your camera is off pending moderator review.', 'error');
        c.cams.add(lc(chan.name));
        out(c, { t: 'cam', ch: chan.name, on: true });
        return sendChan(chan);
    }

    function actAllowed(c) {
        if (isBand(c)) return true;
        if (net.lock === 'readonly' || budgetLevel() !== 'ok') return false;
        return true;
    }

    function takeActToken(c) {
        const t = now();
        c.actTokens = Math.min(L.actBurst, c.actTokens + ((t - c.actLast) / 1000) * L.actPerSecond);
        c.actLast = t;
        if (c.actTokens < 1) return false;
        c.actTokens -= 1;
        return true;
    }

    function castAct(chan, msg) {
        cast(chan, msg, () => true);
    }

    function roomAct(c, raw) {
        const f = parseActFrame(raw);
        if (!f) return kill(c, 4400, 'bad frame');
        const chan = ch(f.ch);
        if (!chan || !chan.members.has(c.id)) return bot(c, 'Join the room first.', 'error');
        if (chan.kind === 'lobby' || chan.kind === 'chat' || chan.kind === 'jam') return bot(c, 'Not in that kind of room.', 'error');
        if (!actAllowed(c)) return bot(c, 'The lobby is read-only right now.', 'error');
        if (!takeActToken(c)) return bot(c, 'Easy on the paint brush.', 'error');
        const relayT = now();
        if (f.kind === 'stroke') {
            if (!PAINT_KINDS.has(chan.kind)) return undefined;
            const previous = structuredClone(chan.act.strokes);
            const stroke = applyStroke(chan, f.stroke);
            if (!stroke) return undefined;
            while (JSON.stringify(chan.act.strokes).length > 250000) chan.act.strokes.shift();
            if (!roomCapacity()) { chan.act.strokes = previous; return bot(c, 'Room storage is full. Clear a canvas before adding more paint.', 'error'); }
            return castAct(chan, { t: 'act', ch: chan.name, kind: 'stroke', stroke, from: c.id, ts: relayT });
        }
        if (f.kind === 'clear') {
            if (!isOp(c, chan)) return bot(c, 'Only @ can clear the canvas.', 'error');
            if (!applyClear(chan)) return undefined;
            return castAct(chan, { t: 'act', ch: chan.name, kind: 'clear', by: c.nick, ts: relayT });
        }
        if (f.kind === 'video') {
            if (!VIDEO_KINDS.has(chan.kind)) return undefined;
            if (!isOp(c, chan)) return bot(c, 'Only @ drives the video in open rooms.', 'error');
            const previous = chan.act.video;
            const video = applyVideo(chan, f, relayT);
            if (!video) return undefined;
            if (!roomCapacity()) { chan.act.video = previous; return bot(c, 'Room storage is full. Clear an idle canvas before adding more activity.', 'error'); }
            return castAct(chan, { t: 'act', ch: chan.name, kind: 'video', video, by: c.nick, ts: relayT });
        }
        if (f.kind === 'rtc') {
            if (net.shield || !chan.modes.C) return undefined;
            const rtc = cleanRtc(f);
            if (!rtc) return undefined;
            const target = conns.get(rtc.to);
            if (!target || !chan.members.has(target.id)) return undefined;
            if (!c.cams.has(lc(chan.name)) && !(target.cams && target.cams.has(lc(chan.name)))) return undefined;
            return out(target, { t: 'act', ch: chan.name, kind: 'rtc', from: c.id, sdp: rtc.sdp, ice: rtc.ice });
        }
        return undefined;
    }

    function say(c, where, rawText, action) {
        if (!limited(c, 'chat', L.burst, L.perSecond)) return;
        const chan = ch(where);
        if (!chan || !chan.members.has(c.id)) return bot(c, 'You are not in that room.', 'error');
        if (!isBand(c)) {
            if (Math.max(net.mutes[c.dev] || 0, net.mutes[c.account] || 0) > now()) return bot(c, 'You’re muted for now. You can still read.', 'error');
            if (net.lock === 'readonly' || budgetLevel() !== 'ok') return bot(c, 'The lobby is read-only right now.', 'error');
            if (chan.modes.m && !chan.voice.has(c.dev) && !hosts(c, chan)) return bot(c, `${chan.name} is +m: only @ and + can talk.`, 'error');
            if (chan.modes.Q) return bot(c, 'Quick lines only right now (+Q). Tap a quick line.', 'error');
            const t = now();
            c.tokens = Math.min(L.burst, c.tokens + ((t - c.last) / 1000) * L.perSecond);
            c.last = t;
            if (c.tokens < 1) return bot(c, 'Easy, speed racer.', 'error');
            const slow = net.shield && chan.kind === 'lobby' ? Math.max(30, chan.modes.S) : chan.modes.S;
            if (slow && c.lastSaid[chan.name] && t - c.lastSaid[chan.name] < slow * 1000) return bot(c, `Slow mode: one line every ${slow}s.`, 'error');
            if (!consumeDaily(c)) return;
            c.tokens -= 1;
            c.lastSaid[chan.name] = t;
        }
        if (String(rawText || '').length > L.maxChars * 2) return bot(c, `Keep it under ${L.maxChars} characters.`, 'error');
        const norm = lc(normalize(rawText));
        if (!isBand(c) && c.lastText === norm && now() - (c.lastTextAt || 0) < 30000) { log(BOT, 'filter-block', c.nick, 'spam:repeat', chan.name); return bot(c, 'Heard you the first time. 🦜', 'error'); }
        c.lastText = norm; c.lastTextAt = now();
        const v = checkText(rawText, net.lists);
        const line = { t: 'line', id: `m${now().toString(36)}${(seq += 1).toString(36)}`, ch: chan.name, from: c.nick, prefix: prefix(c, chan), band: isBand(c), moderator: c.role === 'moderator', me: !!action, text: v.text, ts: now() };
        if (v.verdict === 'block' && !(isBand(c) && v.reason.startsWith('link'))) {
            if (v.reason !== 'empty') { bot(c, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials in public chat.' : v.reason === 'link' ? 'Only YouTube links are allowed.' : v.reason === 'threat' ? 'Nope. No threats. Don’t be a dick.' : v.reason === 'spam' ? 'Easy on the keyboard mash.' : 'Don’t be a dick. Message not sent.', 'error'); log(BOT, 'filter-block', c.nick, v.reason, chan.name); }
            return undefined;
        }
        if (v.verdict === 'hold' && !isBand(c)) {
            held.set(line.id, { ...line, reason: v.reason, dev: c.dev });
            heldChannels.set(line.id, chan);
            while (held.size > MODERATION_QUEUE_MAX) { const oldest = held.keys().next().value; held.delete(oldest); heldChannels.delete(oldest); }
            saveModerationQueue();
            bot(c, 'Your message is waiting for a moderator to OK it.');
            log(BOT, 'filter-hold', c.nick, v.reason, chan.name);
            return undefined;
        }
        return publish(chan, line, c.dev, true);
    }

    function publish(chan, line, dev, reviewNewPublicLine = false) {
        statHour().lines += 1;
        const recipients = membersOf(chan).filter((m) => !m.ignores.has(lc(line.from)) && !(dev && m.blocks.has(dev)));
        rememberLine(line, { authorDev: dev, recipients: new Set(recipients.map((m) => m.id)) });
        chan.moderationContext.push(line);
        if (chan.moderationContext.length > L.moderationContext) chan.moderationContext.shift();
        for (const member of recipients) out(member, line);
        if (reviewNewPublicLine) requestAiReview(chan, line);
    }

    function rememberLine(line, meta) {
        lines.set(line.id, line); lineMeta.set(line.id, meta);
        while (lines.size > 1000) { const oldest = lines.keys().next().value; lines.delete(oldest); lineMeta.delete(oldest); aiPending.delete(oldest); }
        setReceipt(line.id, messageReceipt(line, meta));
        pruneReceipts(false);
    }

    function setReceipt(id, value) {
        const size = encoder.encode(JSON.stringify(value)).byteLength;
        if (receipts.has(id)) receiptBytes += size - receiptSizes.get(id);
        else receiptBytes += size + (receipts.size ? 1 : 0);
        receipts.set(id, value); receiptSizes.set(id, size); receiptRevision += 1;
    }
    function deleteReceipt(id) {
        if (!receipts.has(id)) return;
        receiptBytes -= receiptSizes.get(id) + (receipts.size > 1 ? 1 : 0);
        receipts.delete(id); receiptSizes.delete(id); receiptRevision += 1;
    }
    function pruneReceipts(pruneWitnesses = true) {
        const time = now();
        for (const [id, r] of receipts) {
            if (!r.recipients.length || time - r.ts >= DAY) { deleteReceipt(id); continue; }
            if (pruneWitnesses) {
                const recipients = r.recipients.filter((recipient) => conns.get(recipient)?.nick);
                if (!recipients.length) deleteReceipt(id);
                else if (recipients.length !== r.recipients.length) setReceipt(id, { ...r, recipients });
            }
        }
        // A popular lobby can have many delivery witnesses per line. Cap serialized
        // metadata as well as record count so it cannot exhaust the session record.
        while (receipts.size > RECEIPT_MAX || receiptBytes > RECEIPT_STATE_BYTES) deleteReceipt(receipts.keys().next().value);
    }

    function restoreReceipts(stored) {
        receipts.clear(); receiptSizes.clear(); receiptBytes = 2; receiptRevision += 1;
        // Old session records have no receipts. Invalid evidence never grants a
        // report, and need not destroy otherwise valid live chat sessions.
        if (!Array.isArray(stored) || stored.length > RECEIPT_MAX
            || encoder.encode(JSON.stringify(stored)).byteLength > RECEIPT_STATE_BYTES) return;
        for (const r of stored) {
            if (!r || typeof r !== 'object' || Array.isArray(r) || !moderationId(r.id)
                || !['line', 'pm'].includes(r.t) || !moderationChannel(r.ch) || !moderationNick(r.from)
                || !moderationIdentity(r.authorDev) || !/^[a-f0-9]{64}$/.test(r.digest)
                || !moderationTime(r.ts) || typeof r.prefix !== 'string' || !['', '@', '+'].includes(r.prefix)
                || ['band', 'moderator', 'me'].some((key) => typeof r[key] !== 'boolean')
                || typeof r.to !== 'string' || (r.t === 'pm' ? !moderationNick(r.to) || r.ch !== `pm:${r.from}>${r.to}` || !r.id.startsWith('p') : !!r.to || !r.ch.startsWith('#') || !r.id.startsWith('m'))
                || !Array.isArray(r.recipients) || !r.recipients.length || r.recipients.length > SESSION_CONNECTIONS
                || r.recipients.some((id) => !moderationIdentity(id)) || new Set(r.recipients).size !== r.recipients.length) continue;
            const eligible = r.recipients.filter((id) => conns.has(id));
            if (eligible.length) setReceipt(r.id, { t: r.t, id: r.id, ch: r.ch, from: r.from, to: r.to,
                prefix: r.prefix, band: r.band, moderator: r.moderator, me: r.me, ts: r.ts,
                authorDev: r.authorDev, digest: r.digest, recipients: eligible });
        }
    }

    function deleteIds(ids) {
        const set = new Set(ids);
        for (const chan of channels.values()) chan.moderationContext = chan.moderationContext.filter((h) => !set.has(h.id));
        let aiChanged = false;
        for (const id of ids) { lines.delete(id); lineMeta.delete(id); deleteReceipt(id); aiPending.delete(id); if (aiReviews.delete(id)) aiChanged = true; }
        if (aiChanged) saveAiReviews();
        for (const x of conns.values()) if (x.nick) out(x, { t: 'delete', ids });
        pushAdmin();
    }

    function pendingPmAllowed(from, to) {
        return !!from && !!to && !!from.nick && !!to.nick && !to.pmOff
            && !from.blocks.has(to.dev) && !to.blocks.has(from.dev)
            && !from.ignores.has(lc(to.nick)) && !to.ignores.has(lc(from.nick));
    }
    function endPendingPm(key, pending, reason) {
        pm.delete(key);
        const from = conns.get(pending.fromId), to = conns.get(pending.toId);
        if (to && from) out(to, { t: 'pm-request-ended', from: from.nick, reason });
        if (from) bot(from, `PM request${to ? ` to ${to.nick}` : ''} cleared. ${reason}`);
    }
    function prunePendingPm() {
        for (const [key, p] of pm) if (p.state === 'pending' && (now() - p.at >= PM_PENDING_TTL
            || !pendingPmAllowed(conns.get(p.fromId), conns.get(p.toId)))) endPendingPm(key, p, 'The request expired or is no longer allowed.');
    }
    function restorePendingPm(stored, records) {
        if (!Array.isArray(stored) || stored.length > SESSION_PM_PENDING) return;
        const perSender = new Map();
        for (const p of stored) {
            if (!p || typeof p !== 'object' || Array.isArray(p) || !moderationIdentity(p.from)
                || !moderationIdentity(p.fromId) || !moderationIdentity(p.toId) || p.fromId === p.toId
                || typeof p.key !== 'string' || !Number.isFinite(p.at) || p.at < 0 || p.at > now() || typeof p.hadFirst !== 'boolean') continue;
            const from = conns.get(p.fromId), to = conns.get(p.toId);
            if (!from || !to) {
                const original = records.get(p.fromId);
                if (to && original?.dev === p.from && pairKey(p.fromId, p.toId) === p.key) out(to, { t: 'pm-request-ended', from: original.nick, reason: 'The other visitor disconnected.' });
                continue;
            }
            if (from.dev !== p.from || pairKey(from.id, to.id) !== p.key || pm.has(p.key)) continue;
            const entry = { state: 'pending', from: p.from, fromId: p.fromId, toId: p.toId, at: p.at, first: '', lostFirst: p.hadFirst };
            if (now() - p.at >= PM_PENDING_TTL || !pendingPmAllowed(from, to) || (perSender.get(p.from) || 0) >= L.pmPendingMax) {
                endPendingPm(p.key, entry, 'The request expired or is no longer allowed.'); continue;
            }
            pm.set(p.key, entry); perSender.set(p.from, (perSender.get(p.from) || 0) + 1);
        }
    }

    function privmsg(c, to, rawText) {
        prunePendingPm();
        const t = byNick(to);
        if (!t || t === c) return bot(c, `No such nick: ${String(to || '').slice(0, 20)}`, 'error');
        if (lc(to) === lc(BOT)) return handlers.help(c);
        const k = pairKey(c.id, t.id);
        const p = pm.get(k);
        if (!isBand(c) && (net.lock === 'readonly' || budgetLevel() !== 'ok')) return bot(c, 'The lobby is read-only right now, PMs too.', 'error');
        if (p && p.state === 'open') {
            if (!rawText) return out(c, { t: 'pm-open', with: t.nick });
            return deliverPm(c, t, rawText);
        }
        if (!pendingPmAllowed(c, t)) return bot(c, `${t.nick} isn't taking PMs.`, 'error');
        if ([...pm.values()].filter((x) => x.state === 'pending').length >= SESSION_PM_PENDING) return bot(c, 'Private request allowance is full. Try again later.', 'error');
        const pending = [...pm.values()].filter((x) => x.from === c.dev && x.state === 'pending').length;
        if (pending >= L.pmPendingMax) return bot(c, 'Too many PM requests waiting. Give people a minute.', 'error');
        if (!isBand(c)) {
            if (net.shield) return bot(c, 'Shield is on: new PM requests are paused.', 'error');
            if (Math.max(net.mutes[c.dev] || 0, net.mutes[c.account] || 0) > now()) return bot(c, 'You’re muted for now.', 'error');
            if (now() - c.since < L.pmMinLobbyMs) return bot(c, `Hang in the lobby for ${Math.ceil(L.pmMinLobbyMs / MIN)} minutes before sending PM requests.`, 'error');
        }
        if (!limited(c, 'pm-request', 3, 3 / 60)) return;
        let first = '';
        if (rawText) {
            const v = checkText(rawText, net.lists);
            if (v.verdict !== 'ok') { log(BOT, 'pm-filter', c.nick, v.reason); return bot(c, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials, even in PMs.' : 'Not cool here. Message not sent.', 'error'); }
            first = v.text;
        }
        if (p && p.state === 'pending') return bot(c, `Still waiting for ${t.nick} to accept.`);
        pm.set(k, { state: 'pending', from: c.dev, fromId: c.id, toId: t.id, first, at: now() });
        out(t, { t: 'pm-request', from: c.nick, band: isBand(c) });
        return bot(c, `PM request sent to ${t.nick}. It opens if they accept.`);
    }

    function deliverPm(from, to, rawText) {
        if (!limited(from, 'chat', L.burst, L.perSecond)) return;
        if (!isBand(from) && !consumeDaily(from)) return;
        if (!isBand(from) && (net.lock === 'readonly' || budgetLevel() !== 'ok')) return bot(from, 'The lobby is read-only right now, PMs too.', 'error');
        if (!isBand(from) && Math.max(net.mutes[from.dev] || 0, net.mutes[from.account] || 0) > now()) return bot(from, 'You’re muted for now.', 'error');
        if (to.blocks.has(from.dev)) return bot(from, `${to.nick} isn't taking PMs.`, 'error');
        const v = checkText(rawText, net.lists);
        if (v.verdict !== 'ok') { log(BOT, 'pm-filter', from.nick, v.reason); return bot(from, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials, even in PMs.' : 'Not cool here. Message not sent.', 'error'); }
        const msg = { t: 'pm', id: `p${now().toString(36)}${(seq += 1).toString(36)}`, from: from.nick, to: to.nick, text: v.text, band: isBand(from), ts: now() };
        const recipients = new Set([from.id]);
        if (!to.ignores.has(lc(from.nick))) recipients.add(to.id);
        rememberLine({ ...msg, ch: `pm:${from.nick}>${to.nick}` }, { authorDev: from.dev, recipients });
        out(from, msg);
        if (!to.ignores.has(lc(from.nick))) out(to, msg);
        return undefined;
    }

    function report(c, id, text) {
        if (!limited(c, 'report', 5, 5 / 60)) return;
        let l = lines.get(id);
        let meta = lineMeta.get(id);
        if (!l) {
            const receipt = receipts.get(id);
            if (receipt && now() - receipt.ts < DAY && typeof text === 'string' && moderationText(text, L.maxChars)
                && receipt.digest === receiptDigest(receipt, receipt.authorDev, text)) {
                l = { ...receipt, text };
                meta = { authorDev: receipt.authorDev, recipients: new Set(receipt.recipients) };
            }
        }
        if (!l) return bot(c, 'That message is gone already.', 'error');
        if (!meta || !meta.recipients.has(c.id)) return bot(c, 'You can only report a message delivered to this connection.', 'error');
        if (meta.authorDev === c.dev) return bot(c, 'You can’t report yourself.', 'error');
        let r = reports.get(id);
        if (!r) {
            const chan = ch(l.ch);
            const hist = chan ? chan.moderationContext : [];
            const at = hist.findIndex((h) => h.id === id);
            const context = at >= 0 ? hist.slice(Math.max(0, at - 5), at + 6).map((h) => `${h.from ? `<${h.from}> ` : '* '}${h.text}`) : [`<${l.from}> ${l.text}`];
            r = { devs: new Set(), iphs: new Set(), ch: l.ch, from: l.from, text: l.text, hidden: false, context, at: now(), authorDev: meta.authorDev };
            reports.set(id, r);
            while (reports.size > MODERATION_QUEUE_MAX) reports.delete(reports.keys().next().value);
        }
        // Spoof-proof: one vote per signed device AND per daily IP hash.
        if (r.devs.has(c.dev) || r.iphs.has(c.iph)) {
            // A previous write may have failed after updating memory. A retry is
            // acknowledged only after storing the evidence again, without a vote.
            saveModerationQueue();
            out(c, { t: 'report-status', id, submitted: true });
            return bot(c, 'Already reported. Thanks.');
        }
        r.devs.add(c.dev); r.iphs.add(c.iph);
        net.stats.reports.made += 1;
        const offenders = [...conns.values()].filter((person) => person.dev === r.authorDev);
        if (r.devs.size >= net.reportsToHide && !r.hidden) {
            r.hidden = true;
            deleteIds([id]);
            log(BOT, 'auto-hide', l.from, `${r.devs.size} reports`, l.ch);
        }
        if (r.devs.size >= L.reportsCamOff) {
            for (const offender of offenders) {
                offender.camReports = Math.max(offender.camReports || 0, r.devs.size);
                for (const name of [...offender.cams]) { offender.cams.delete(name); out(offender, { t: 'cam', ch: name, on: false, by: BOT }); const room = ch(name); if (room) sendChan(room); }
            }
        }
        saveModerationQueue();
        pushAdmin();
        out(c, { t: 'report-status', id, submitted: true });
        return bot(c, 'Reported to the moderators. Thanks for looking out.');
    }

    function shield(on, by) {
        net.shield = on;
        net.shieldAuto = false;
        if (on) for (const room of channels.values()) { if (room.kind !== 'lobby') { room.modes.C = false; camsOff(room, by); } }
        else for (const room of channels.values()) if (room.kind !== 'lobby' && room.kind !== 'chat') room.modes.C = true;
        event(ch(LOBBY), on ? `${by} raised the shield: slow mode 30s, cameras off, new rooms and PM requests paused` : `${by} lowered the shield`);
        for (const x of conns.values()) out(x, { t: 'net', lock: net.lock, shield: net.shield });
        for (const room of channels.values()) sendChan(room);
        log(by, on ? 'shield' : 'shield-off');
        saveNet();
        pushList();
    }

    // Called by the DO alarm / dev relay timer. Expirations and empty-room cleanup only.
    let lastStatSave = '';
    function tick() {
        const t = now();
        rates.prune();
        if (hourKey() !== lastStatSave) { lastStatSave = hourKey(); saveNet(); } // stats: ~24 row writes/day
        for (const [key, v] of devStats) if ((!v.lastRoom || now() - v.lastRoom > HOUR) && v.day !== new Date(now()).toISOString().slice(0, 10)) devStats.delete(key);
        for (const [key, v] of ipRooms) { const fresh = v.filter((at) => now() - at < HOUR); if (fresh.length) ipRooms.set(key, fresh); else ipRooms.delete(key); }
        for (const [d, until] of Object.entries(net.kicks)) if (until <= t) delete net.kicks[d];
        for (const [d, until] of Object.entries(net.mutes)) if (until <= t) delete net.mutes[d];
        net.bans = net.bans.filter((b) => !b.until || b.until > t);
        for (const room of [...channels.values()]) {
            for (const [key, until] of Object.entries(room.kicks)) if (until <= t) delete room.kicks[key];
            if (room.kind === 'lobby') continue;
            if (room.owner && membersOf(room).some((m) => owns(m, room) || m.account && room.cohosts.has(m.account))) room.renewed = t;
            if (room.owner && t - room.renewed >= ROOM_TTL) { closeRoom(room, BOT, 'registration expired after 90 inactive days'); continue; }
            if (!room.members.size && room.emptySince !== null && t - room.emptySince >= L.emptyRoomClose) {
                if (!room.owner) closeRoom(room, BOT, 'empty for 10 minutes');
                else { room.act = { strokes: [], video: null }; if (room.jam) room.jam = { desktop: '', web: '' }; }
            }
        }
        net.modlog = net.modlog.filter((e) => now() - e.at < LOG_TTL).slice(-L.modlogKeep);
        const bandOn = [...conns.values()].some(isBand);
        if (bandOn) net.lastBand = t;
        // Community conversations stay open without band presence. Only explicit
        // moderation actions, budgets or invalid saved state change admission.
        pruneAiReviews();
        pruneModerationQueue();
        pruneReceipts();
        prunePendingPm();
    }

    function snapshot() {
        return { bans: net.bans, kicks: net.kicks, mutes: net.mutes, lock: net.lock, shield: net.shield, shieldAuto: net.shieldAuto, lockAuto: net.lockAuto, lists: net.lists, lastBand: net.lastBand, budget: net.budget, reportsToHide: net.reportsToHide, stats: net.stats };
    }
    function restore(s = {}) {
        // Fail closed: empty or wiped storage comes back read-only for fans until a band op runs /lobby unlock.
        if (!s || typeof s !== 'object' || !['off', 'readonly', 'closed'].includes(s.lock)) { s = { ...(s && typeof s === 'object' ? s : {}), lock: 'readonly', lockAuto: true }; }
        s = { ...s };
        // Bans: keep only well-formed entries. If any were malformed a ban may be lost, so lock read-only too.
        if (s.bans !== undefined) {
            const okBan = (b) => b && typeof b === 'object' && typeof b.mask === 'string' && /^(?:dev|iph|nick|account):.+/.test(b.mask)
                && (b.until === undefined || b.until === null || Number.isFinite(b.until));
            const list = Array.isArray(s.bans) ? s.bans : [];
            const good = list.filter(okBan);
            if (!Array.isArray(s.bans) || good.length !== list.length) { s.lock = 'readonly'; s.lockAuto = true; }
            // Over the cap: keep the newest, and lock read-only since some bans were dropped.
            if (good.length > L.banMax) { s.lock = 'readonly'; s.lockAuto = true; }
            s.bans = good.slice(-L.banMax);
        }
        const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
        const failClosed = () => { s.lock = 'readonly'; s.lockAuto = true; };
        // Kicks: dev -> until (number), same rule as mutes.
        if (s.kicks !== undefined) {
            const src = s.kicks && typeof s.kicks === 'object' && !Array.isArray(s.kicks) ? s.kicks : {};
            const good = Object.fromEntries(Object.entries(src).filter(([, v]) => Number.isFinite(v)));
            if (src !== s.kicks || Object.keys(good).length !== Object.keys(src).length) failClosed();
            s.kicks = good;
        }
        // Shield / auto flags must be booleans; anything else raises the shield.
        for (const k of ['shield', 'shieldAuto', 'lockAuto']) if (s[k] !== undefined && typeof s[k] !== 'boolean') { failClosed(); s.shield = true; if (k !== 'shield') s[k] = true; }
        // lastBand is informational; malformed persisted fields still require explicit recovery.
        if (s.lastBand !== undefined && !(Number.isFinite(s.lastBand) && s.lastBand >= 0 && s.lastBand <= now() + MIN)) { s.lastBand = 0; failClosed(); }
        // reportsToHide: integer 1..20, else the default (and read-only for a band look).
        if (s.reportsToHide !== undefined && !(Number.isInteger(s.reportsToHide) && s.reportsToHide >= 1 && s.reportsToHide <= 20)) { s.reportsToHide = L.reportsToHide; failClosed(); }
        // Mutes: dev -> until (number). Drop bad entries; any loss locks read-only.
        if (s.mutes !== undefined) {
            const src = isObj(s.mutes) ? s.mutes : {};
            const good = Object.fromEntries(Object.entries(src).filter(([, v]) => Number.isFinite(v)));
            if (!isObj(s.mutes) || Object.keys(good).length !== Object.keys(src).length) failClosed();
            s.mutes = good;
        }
        // Filter lists: block/hold/allow arrays of strings. A lost block word must not quietly reopen it.
        if (s.lists !== undefined) {
            const src = isObj(s.lists) ? s.lists : {};
            const out = defaultLists();
            let bad = !isObj(s.lists);
            for (const k of ['block', 'hold', 'allow']) {
                if (src[k] === undefined) continue;
                if (!Array.isArray(src[k])) { bad = true; continue; }
                const words = src[k].filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 40);
                if (words.length !== src[k].length || words.length > L.listMax) bad = true;
                out[k] = words.slice(0, L.listMax);
            }
            if (bad) failClosed();
            s.lists = out;
        }
        // Stats: shape-check; malformed -> fresh stats (and read-only so a band op takes a look).
        if (s.stats !== undefined) {
            const nums = (o) => isObj(o) && Object.values(o).every(Number.isFinite);
            const st = s.stats;
            const ok = isObj(st) && isObj(st.hours) && Object.values(st.hours).every((h) => isObj(h) && ['joins', 'peak', 'lines'].every((k) => Number.isFinite(h[k])))
                && nums(st.kinds) && nums(st.rooms) && nums(st.mod)
                && isObj(st.reports) && ['made', 'autoHidden', 'dismissed', 'actioned'].every((k) => Number.isFinite(st.reports[k]));
            if (!ok) { s.stats = { hours: {}, kinds: {}, rooms: {}, mod: {}, reports: { made: 0, autoHidden: 0, dismissed: 0, actioned: 0 } }; failClosed(); }
        }
        // Budget: malformed counts as spent for today (fans read-only/closed) rather than a fresh free day.
        if (s.budget !== undefined) {
            const b = s.budget;
            const okBudget = b && typeof b === 'object' && typeof b.day === 'string' && Number.isFinite(b.requests) && b.requests >= 0;
            if (!okBudget) { s.budget = { day: new Date(now()).toISOString().slice(0, 10), requests: L.requestBudget }; s.lock = 'readonly'; s.lockAuto = true; }
        }
        for (const k of ['bans', 'kicks', 'mutes', 'lock', 'shield', 'shieldAuto', 'lockAuto', 'lists', 'lastBand', 'budget', 'reportsToHide', 'stats']) if (s[k] !== undefined) net[k] = s[k];
    }
    function restoreLog(entries = []) { net.modlog = entries.filter((e) => Number.isFinite(e.at) && now() - e.at < LOG_TTL).slice(-L.modlogKeep); }

    return { connect, disconnect: (...args) => durable(disconnect, args), message: (...args) => durable(message, args), tick: (...args) => durable(tick, args), roomSnapshot, restoreRooms, sessionSnapshot, restoreSessions, abuseSnapshot, restoreAbuse, snapshot, restore, restoreLog, restoreModerationQueue, restoreAiReviews, applyAiReview, notifyAiStatus: pushAdmin, adminState, budgetLevel, spend, get modlog() { return net.modlog.slice(); }, _debug: { conns, channels, net, pm, reports, held, lines } };
}
