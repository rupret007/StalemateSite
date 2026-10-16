// Hang Out lobby engine: an old-school IRC network in one authoritative place (one Durable Object, one writer,
// so no netsplits and no "first in gets @"). Pure logic, no I/O: the Worker DO and the local dev relay both
// drive it, and unit tests drive it directly. Every permission is checked here, never in the browser.
import { checkNick, checkText, defaultLists, normalize } from './filter.mjs';

export const BOT = 'StaleBot';
export const LOBBY = '#stalemate';
export const KINDS = Object.freeze({ bobross: '🎨 Bob Ross paint-along', watch: '📺 Watch together', art: '🖌️ Art on camera', jam: '🎸 Jam' });
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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
    framesPerConnection: 4000,
    defaultSlow: 3,
    nickEvery: 60 * 1000,
    kickCooldown: 10 * MIN,
    ipBan: DAY,
    reportsToHide: 3,
    reportsCamOff: 2,
    pmMinLobbyMs: 2 * MIN,
    pmPendingMax: 5,
    noBandShield: DAY,
    history: 50,
    emptyRoomClose: 10 * MIN,
    requestBudget: 40000, // the lobby's share of the free 100k DO requests/day
    modlogKeep: 2000,
    webJoinOrigins: [] // WebJam Web Join (#388) page origin(s); empty = browser join hook stays off
});

export const HELP = [
    'Everyone: /join #room  /part  /quit  /nick NewNick  /me does a thing  /msg nick text  /query nick  /whois nick',
    '          /away [reason]  /ignore nick  /unignore nick  /list  /names  /topic  /slap nick  /report nick  /help',
    'PMs:      /accept nick  /decline nick  /block nick  /unblock nick  /pm on|off   (a PM opens only after they accept)',
    'Jam @:    /jamlink webjam://…  (from the WebJam desktop app)  /jamlink clear',
    'Room @:   /topic text  /kick nick [why]  /ban nick [why]  /unban mask  /invite nick  /op /deop /voice /devoice nick',
    '          /mode +m|-m +i|-i +k key|-k +l N|-l +S secs|-S +C|-C +Q|-Q   /close',
    'Band @:   /mute nick 10m  /gban nick why  /purge nick  /shield  /shieldoff  /lobby lock|readonly|unlock',
    '          /filter block|hold|allow|del word  /camoff all  /close #room  /approve id  /dismiss id  /log'
];

// Exact shape checks only: we never fetch, parse or rewrite WebJam's invite (WebJam's invitation_ingress owns that).
export function validWebjamInvite(link) {
    const s = String(link || '');
    return /^webjam:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{8,1800}$/.test(s) && !/[\s<>"`]/.test(s) ? s : '';
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
    join: 'any', part: 'any', quit: 'any', nick: 'any', me: 'any', msg: 'any', query: 'any', whois: 'any', away: 'any',
    ignore: 'any', unignore: 'any', list: 'any', names: 'any', topic: 'any', slap: 'any', help: 'any', report: 'any',
    accept: 'any', decline: 'any', block: 'any', unblock: 'any', pm: 'any', cam: 'any',
    kick: 'chanop', ban: 'chanop', unban: 'chanop', invite: 'chanop', op: 'chanop', deop: 'chanop', voice: 'chanop',
    devoice: 'chanop', jamlink: 'chanop', mode: 'chanop', close: 'chanop', lock: 'chanop',
    mute: 'band', gban: 'band', purge: 'band', shield: 'band', shieldoff: 'band', lobby: 'band', filter: 'band',
    camoff: 'band', approve: 'band', dismiss: 'band', log: 'band', delete: 'band', slow: 'band'
});

export function createLobby({ now = () => Date.now(), send = () => {}, close = () => {}, persist = () => {}, limits = LOBBY_LIMITS } = {}) {
    const L = { ...LOBBY_LIMITS, ...limits };
    const conns = new Map();          // connId -> conn
    const channels = new Map();       // lc(name) -> channel
    const pm = new Map();             // "devA|devB" (sorted) -> {state:'pending'|'open', from}
    const devStats = new Map();       // dev -> {day, msgs, lastRoom}
    const ipRooms = new Map();        // iph -> [timestamps]
    let seq = 0;
    const net = {
        bans: [],                     // {mask, reason, by, at, until}
        kicks: {},                    // dev -> until
        mutes: {},                    // dev -> until
        lock: 'off',                  // off | readonly | closed
        shield: false,
        shieldAuto: false,
        lockAuto: false,              // auto-lockdown (no band op for 24h): read-only for fans until a band op unlocks
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

    const mkChannel = (name, kind, title, founder) => ({
        name, kind, title, founder, created: now(), topic: kind === 'lobby' ? 'Welcome to #stalemate. House rule: Don’t be a dick. Next show Sat Oct 24 @ Los Amigo’s, Plano' : '',
        modes: { m: false, i: false, k: '', l: kind === 'lobby' ? L.lobbyMax : L.roomMax, t: true, S: kind === 'lobby' ? L.defaultSlow : 0, C: kind !== 'lobby', Q: false, locked: false },
        jam: kind === 'jam' ? { desktop: '', web: '' } : null, ops: new Set(founder ? [founder] : []), voice: new Set(), bans: [], invites: new Set(), kicks: {},
        members: new Set(), history: [], emptySince: null
    });
    channels.set(LOBBY, mkChannel(LOBBY, 'lobby', 'The lobby', null));

    // ---------- helpers ----------
    const out = (c, msg) => { try { send(c.id, msg); } catch (e) { /* gone */ } };
    const isBand = (c) => c && (c.role === 'band' || c.role === 'owner');
    const ch = (name) => channels.get(lc(name));
    const byNick = (nick) => [...conns.values()].find((c) => c.nick && lc(c.nick) === lc(String(nick || '').replace(/^[@+]/, '')));
    const isOp = (c, chan) => isBand(c) || (chan && chan.ops.has(c.dev));
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
            for (const r of reports.values()) if (!r.done && (r.from === target || action === 'delete')) { r.done = true; net.stats.reports.actioned += 1; }
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
        chan.history.push(msg);
        if (chan.history.length > L.history) chan.history.shift();
        cast(chan, msg);
    };
    const names = (chan) => membersOf(chan).filter((m) => m.nick).map((m) => ({ nick: m.nick, prefix: prefix(m, chan), band: isBand(m), away: !!m.away, cam: !!(m.cams && m.cams.has(lc(chan.name))) }))
        .sort((a, b) => (a.prefix === b.prefix ? lc(a.nick).localeCompare(lc(b.nick)) : a.prefix === '@' ? -1 : b.prefix === '@' ? 1 : a.prefix === '+' ? -1 : 1));
    const chanView = (chan) => ({ name: chan.name, kind: chan.kind, title: chan.title, topic: chan.topic, modes: { ...chan.modes, k: chan.modes.k ? true : false }, count: chan.members.size, names: names(chan), jam: chan.jam ? { desktop: chan.jam.desktop, web: chan.jam.web, webReady: !!chan.jam.web } : null });
    const sendChan = (chan) => cast(chan, { t: 'chan', ch: chanView(chan) });
    const directory = () => [...channels.values()].filter((c) => c.kind !== 'lobby').slice(0, L.roomsListed)
        .map((c) => ({ name: c.name, kind: c.kind, title: c.title, count: c.members.size, max: c.modes.l, locked: c.modes.locked || c.modes.i, key: !!c.modes.k, cams: c.modes.C }));
    const pushList = () => { const rooms = directory(); for (const c of conns.values()) if (c.nick) out(c, { t: 'list', rooms }); pushAdmin(); };
    const banned = (list, c) => list.some((b) => (!b.until || b.until > now()) && (b.mask === `dev:${c.dev}` || b.mask === `iph:${c.iph}` || (c.nick && b.mask === `nick:${lc(c.nick)}`)));
    const pairKey = (a, b) => [a, b].sort().join('|');

    function adminState() {
        return {
            lock: net.lock, shield: net.shield, shieldAuto: net.shieldAuto, lockAuto: net.lockAuto, lastBand: net.lastBand,
            slow: ch(LOBBY).modes.S, lists: net.lists, reportsToHide: net.reportsToHide,
            budget: { ...net.budget, cap: L.requestBudget, level: budgetLevel() },
            users: [...conns.values()].filter((c) => c.nick).map((c) => ({ nick: c.nick, role: c.role, dev: c.dev.slice(0, 6), away: !!c.away, muted: (net.mutes[c.dev] || 0) > now(), channels: [...c.channels] })),
            rooms: [...channels.values()].map((c) => ({ name: c.name, kind: c.kind, title: c.title, count: c.members.size, modes: { ...c.modes, k: !!c.modes.k } })),
            reports: [...reports.entries()].filter(([, r]) => !r.done).map(([id, r]) => ({ id, ch: r.ch, from: r.from, text: r.text, count: r.devs.size, hidden: r.hidden, context: r.context })),
            held: [...held.values()].map((h) => ({ id: h.id, ch: h.ch, from: h.from, text: h.text, reason: h.reason })),
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
            const state = adminState();
            for (const c of conns.values()) if (isBand(c) && c.admin) out(c, { t: 'admin', state });
        });
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
    function connect({ id, dev, iph, role = 'fan', email = '', admin = false }) {
        spend(1);
        const lvl = budgetLevel();
        const band = role === 'band' || role === 'owner';
        if (lvl === 'closed' && !band) return { ok: false, status: 503, reason: 'budget' };
        if (!band) {
            if (net.lock === 'closed') return { ok: false, status: 503, reason: 'locked' };
            if (banned(net.bans, { dev, iph })) return { ok: false, status: 403, reason: 'banned' };
            if ((net.kicks[dev] || 0) > now()) return { ok: false, status: 403, reason: 'kicked' };
            const inLobby = [...conns.values()].filter((c) => !isBand(c)).length;
            if (inLobby >= L.lobbyMax) return { ok: false, status: 429, reason: 'full' };
        }
        const c = { id, dev, iph, role, email, admin: band && admin, nick: '', channels: new Set(), away: '', ignores: new Set(), blocks: new Set(), pmOff: false,
            cams: new Set(), since: now(), lastNick: 0, tokens: L.burst, last: now(), frames: 0, lastSaid: {} };
        conns.set(id, c);
        if (band) { net.lastBand = now(); if (net.shieldAuto || net.lockAuto) bot(c, 'Auto-lockdown is on because no band op was around for a day: fans can read but not talk. /lobby unlock and /shieldoff when you are ready.'); saveNet(); }
        out(c, { t: 'hello', role, lock: net.lock, shield: net.shield, budget: lvl, needNick: true });
        return { ok: true };
    }

    function disconnect(id, why = 'Quit') {
        const c = conns.get(id);
        if (!c) return;
        for (const name of [...c.channels]) leave(c, ch(name), why, true);
        conns.delete(id);
        for (const [k, v] of pm) if (k.split('|').includes(c.dev) && v.state === 'pending') pm.delete(k);
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
        if (!isBand(c)) {
            if (banned(chan.bans, c)) return bot(c, `You're banned from ${chan.name}.`, 'error'), false;
            if ((chan.kicks[c.dev] || 0) > now()) return bot(c, `Kicked from ${chan.name} recently. Give it a few minutes.`, 'error'), false;
            if (chan.modes.locked && !chan.ops.has(c.dev)) return bot(c, `${chan.name} is locked right now.`, 'error'), false;
            if (chan.modes.i && !chan.invites.has(c.dev) && !chan.ops.has(c.dev)) return bot(c, `${chan.name} is invite-only (+i). Ask an @ to /invite you.`, 'error'), false;
            if (chan.modes.k && key !== chan.modes.k && !chan.ops.has(c.dev)) return bot(c, `${chan.name} needs a key (+k): /join ${chan.name} key`, 'error'), false;
            if (chan.members.size >= chan.modes.l) return bot(c, `${chan.name} is full (+l ${chan.modes.l}).`, 'error'), false;
        }
        chan.members.add(c.id);
        chan.emptySince = null;
        if (chan.kind !== 'lobby') bump(net.stats.rooms, (KINDS[chan.kind].endsWith(chan.title) ? KINDS[chan.kind] : `${KINDS[chan.kind]} · ${chan.title}`).slice(0, 60));
        c.channels.add(chan.name);
        out(c, { t: 'join', ch: chanView(chan), history: chan.history.filter((h) => !(h.from && c.ignores.has(lc(h.from)))) });
        event(chan, `${nickOf(c)} has joined ${chan.name}`);
        if (chan.kind === 'lobby') bot(c, `welcome to #stalemate, ${c.nick}. One rule: Don’t be a dick. Swear all you want; no hate, threats, creepy stuff or personal info. 🚩 anything gross. /help for commands.`);
        else if (chan.kind === 'jam') bot(c, `welcome to ${chan.name}. Music runs in the WebJam desktop app (Jamulus) for tight timing. Plug in Ethernet: Wi-Fi adds lag and dropouts.`);
        else bot(c, `welcome to ${chan.name}. Open rooms are moderated by the band. Cameras stay off unless you turn yours on (18+).`);
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
        if (typeof raw !== 'string' || raw.length > L.frameBytes) return kill(c, 4400, 'bad frame');
        if (c.frames > L.framesPerConnection) return kill(c, 4429, 'frame cap');
        let f;
        try { f = JSON.parse(raw); } catch (e) { return kill(c, 4400, 'bad frame'); }
        if (!f || typeof f !== 'object' || typeof f.t !== 'string') return kill(c, 4400, 'bad frame');
        if (!c.nick && f.t !== 'hello') return bot(c, 'Pick a nickname first.', 'error');
        switch (f.t) {
        case 'hello': return hello(c, f);
        case 'say': {
            const text = typeof f.text === 'string' ? f.text : '';
            if (text.startsWith('/') && !text.startsWith('//')) return runLine(c, f.ch, text);
            return say(c, f.ch, text.replace(/^\/\//, '/'), false);
        }
        case 'cmd': {
            const name = lc(f.name);
            const args = Array.isArray(f.args) ? f.args.slice(0, 8).map((a) => String(a).slice(0, 300)) : [];
            return command(c, f.ch, name, args);
        }
        case 'report': return report(c, String(f.id || ''));
        case 'cam': return cam(c, f.ch, !!f.on, f.adult18 === true);
        case 'admin-refresh': if (isBand(c) && c.admin) out(c, { t: 'admin', state: adminState() }); return undefined;
        default: return kill(c, 4400, 'bad frame');
        }
    }

    function kill(c, code, reason) { close(c.id, code, reason); disconnect(c.id, reason); }

    function hello(c, f) {
        if (c.nick) return bot(c, 'Already here. Use /nick to change.', 'error');
        if (!isBand(c) && f.age13 !== true) return bot(c, 'Tick "I\'m 13+ and will be cool" to chat.', 'error');
        const v = checkNick(f.nick, net.lists, { band: isBand(c) });
        if (!v.ok) return out(c, { t: 'nick-error', text: v.reason });
        if (byNick(v.nick)) return out(c, { t: 'nick-error', text: 'That nick is taken right now.' });
        if (!isBand(c) && banned(net.bans, { ...c, nick: v.nick })) { kill(c, 4403, 'banned'); return undefined; }
        c.nick = v.nick;
        c.lastNick = now();
        statHour().joins += 1; statPeak();
        out(c, { t: 'welcome', nick: c.nick, role: c.role, band: isBand(c) });
        out(c, { t: 'list', rooms: directory() });
        enter(c, ch(LOBBY));
        if (c.admin) out(c, { t: 'admin', state: adminState() });
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
        if (scope === 'band') return isBand(c);
        if (scope === 'chanop') return !!chan && chan.kind !== 'lobby' ? isOp(c, chan) : isBand(c); // lobby ops = band only
        return false;
    }

    function command(c, where, name, args) {
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
            return out(c, { t: 'denied', cmd: name, text: `* /${name}: permission denied. ${scope === 'band' ? 'Band ops only.' : `You need @ in ${chan ? chan.name : 'that room'}.`}` });
        }
        const fn = handlers[name];
        return fn(c, chan, args);
    }

    const target = (c, nick) => {
        const t = byNick(nick);
        if (!t) bot(c, `No such nick: ${String(nick || '').slice(0, 20)}`, 'error');
        return t;
    };

    const handlers = {
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
            out(c, { t: 'welcome', nick: c.nick, role: c.role, band: isBand(c) });
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
            const k = pairKey(c.dev, t.dev);
            const p = pm.get(k);
            if (!p || p.state !== 'pending' || p.from !== t.dev) return bot(c, `No PM request from ${t.nick}.`, 'error');
            p.state = 'open';
            out(c, { t: 'pm-open', with: t.nick });
            out(t, { t: 'pm-open', with: c.nick });
            if (p.first) deliverPm(t, c, p.first);
            return undefined;
        },
        decline(c, _chan, [n]) {
            const t = byNick(n); if (!t) return bot(c, 'Request cleared.');
            pm.delete(pairKey(c.dev, t.dev));
            out(t, { t: 'notice', from: BOT, text: `${c.nick} said no thanks to a PM.`, kind: 'info', ts: now() });
            return bot(c, `Declined ${t.nick}.`);
        },
        block(c, _chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            c.blocks.add(t.dev); c.ignores.add(lc(t.nick));
            pm.delete(pairKey(c.dev, t.dev));
            out(t, { t: 'pm-closed', with: c.nick });
            out(c, { t: 'pm-closed', with: t.nick });
            return bot(c, `Blocked ${t.nick}. They can't PM you and you won't see them.`);
        },
        unblock(c, _chan, [n]) { const t = byNick(n); if (t) { c.blocks.delete(t.dev); c.ignores.delete(lc(t.nick)); } return bot(c, `Unblocked ${String(n || '').slice(0, 20)}.`); },
        pm(c, _chan, [v]) { c.pmOff = lc(v) === 'off'; if (c.pmOff) for (const [k, p] of pm) if (k.split('|').includes(c.dev) && p.state === 'pending') pm.delete(k); return out(c, { t: 'pm-setting', off: c.pmOff, text: c.pmOff ? 'PMs are off. Nobody can send you requests.' : 'PMs are on (accept-first).' }); },
        whois(c, _chan, [n]) {
            const t = target(c, n); if (!t) return undefined;
            const mins = Math.round((now() - t.since) / MIN);
            return bot(c, `${t.nick}${isBand(t) ? ' ⭐ BAND' : ''} · on ${[...t.channels].join(' ')} · here ${mins}m${t.away ? ` · away: ${t.away}` : ''}`);
        },
        away(c, _chan, args) {
            c.away = normalize(args.join(' '), 80);
            if (c.away && checkText(c.away, net.lists).verdict !== 'ok') c.away = 'away';
            for (const name of c.channels) sendChan(ch(name));
            return bot(c, c.away ? `You're marked away: ${c.away}` : 'Welcome back.');
        },
        ignore(c, _chan, [n]) { if (!n) return bot(c, `Ignoring: ${[...c.ignores].join(', ') || 'nobody'}`); c.ignores.add(lc(n)); return bot(c, `Ignoring ${String(n).slice(0, 20)}.`); },
        unignore(c, _chan, [n]) { c.ignores.delete(lc(n)); return bot(c, `Unignored ${String(n || '').slice(0, 20)}.`); },
        list(c) { return out(c, { t: 'list', rooms: directory(), show: true }); },
        names(c, chan, [maybe]) { const room = maybe && ch(maybe) ? ch(maybe) : chan; return bot(c, `${room.name}: ${names(room).map((n) => `${n.prefix}${n.nick}`).join(' ')}`); },
        topic(c, chan, args) {
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
            if (isBand(t) && !isBand(c)) return bot(c, 'You can’t kick a band op.', 'error');
            if (!chan.members.has(t.id)) return bot(c, `${t.nick} isn't in ${chan.name}.`, 'error');
            const reason = normalize(why.join(' '), 80) || 'kicked';
            if (chan.kind === 'lobby') {
                event(chan, `${t.nick} was kicked by ${c.nick} (${reason})`);
                net.kicks[t.dev] = now() + L.kickCooldown;
                log(c.nick, 'kick', t.nick, reason, chan.name);
                out(t, { t: 'kicked', ch: chan.name, by: c.nick, reason });
                return kill(t, 4001, 'kicked');
            }
            chan.kicks[t.dev] = now() + L.kickCooldown;
            event(chan, `${t.nick} was kicked by ${c.nick} (${reason})`);
            out(t, { t: 'kicked', ch: chan.name, by: c.nick, reason });
            log(c.nick, 'kick', t.nick, reason, chan.name);
            return leave(t, chan, 'kicked');
        },
        ban(c, chan, [n, ...why]) {
            if (chan.kind === 'lobby') return handlers.gban(c, chan, [n, ...why]);
            const t = target(c, n); if (!t) return undefined;
            if (isBand(t)) return bot(c, 'You can’t ban a band op.', 'error');
            const reason = normalize(why.join(' '), 80) || 'banned';
            chan.bans.push({ mask: `dev:${t.dev}`, reason, by: c.nick, at: now() }, { mask: `nick:${lc(t.nick)}`, reason, by: c.nick, at: now() },
                { mask: `iph:${t.iph}`, nick: t.nick, reason, by: c.nick, at: now(), until: now() + L.ipBan }); // a private window can't dodge it
            event(chan, `${c.nick} sets mode +b ${t.nick}`);
            log(c.nick, 'ban', t.nick, reason, chan.name);
            if (chan.members.has(t.id)) { out(t, { t: 'kicked', ch: chan.name, by: c.nick, reason }); leave(t, chan, 'banned'); }
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
            else if (k === 'C') { if (on && net.shield) return bot(c, 'Shield is on: cameras stay off.', 'error'); chan.modes.C = on; if (!on) camsOff(chan, c.nick); }
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
            const v = which === 'web' ? validWebJoin(link, L.webJoinOrigins) : validWebjamInvite(which === 'desktop' ? link : which);
            if (!v) return bot(c, which === 'web' ? 'Browser join isn’t switched on yet (it arrives with WebJam Web Join).' : 'Paste the webjam:// invite from the WebJam app: /jamlink webjam://…', 'error');
            chan.jam[which === 'web' ? 'web' : 'desktop'] = v;
            event(chan, `${c.nick} shared a WebJam ${which === 'web' ? 'browser' : 'desktop'} invite. Tap “Open in WebJam”. Ethernet beats Wi-Fi.`);
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
            return closeRoom(chan, c.nick, isBand(c) ? 'closed by the band' : 'closed by the host');
        },
        // ---- band @ ----
        gban(c, chan, [n, ...why]) {
            const t = target(c, n); if (!t) return undefined;
            if (isBand(t)) return bot(c, 'Band ops can’t be banned here; remove them in Cloudflare Access.', 'error');
            const reason = normalize(why.join(' '), 80);
            if (!reason) return bot(c, 'A ban needs a reason: /ban nick why', 'error');
            net.bans.push({ mask: `dev:${t.dev}`, nick: t.nick, reason, by: c.nick, at: now() },
                { mask: `iph:${t.iph}`, nick: t.nick, reason, by: c.nick, at: now(), until: now() + L.ipBan },
                { mask: `nick:${lc(t.nick)}`, nick: t.nick, reason, by: c.nick, at: now() });
            for (const name of t.channels) event(ch(name), `${t.nick} was banned by ${c.nick} (${reason})`);
            log(c.nick, 'ban', t.nick, reason, 'network');
            saveNet();
            out(t, { t: 'kicked', ch: LOBBY, by: c.nick, reason, banned: true });
            return kill(t, 4003, 'banned');
        },
        mute(c, chan, [n, dur]) {
            const t = target(c, n); if (!t) return undefined;
            const ms = Math.min(parseDuration(dur, 10 * MIN), DAY);
            net.mutes[t.dev] = now() + ms;
            bot(t, `You're muted for ${Math.round(ms / MIN)} min. You can still read.`, 'error');
            log(c.nick, 'mute', t.nick, `${Math.round(ms / MIN)}m`, chan.name);
            return saveNet();
        },
        purge(c, chan, [what]) {
            const t = byNick(what);
            const window = /^\d+[smh]$/.test(what || '') ? parseDuration(what, 5 * MIN) : 0;
            const ids = [...lines.values()].filter((l) => (t ? l.from === t.nick : window ? l.ts >= now() - window : false)).map((l) => l.id);
            if (!ids.length) return bot(c, 'Nothing to purge.', 'error');
            deleteIds(ids);
            return log(c.nick, 'purge', t ? t.nick : what, `${ids.length} lines`, chan.name);
        },
        delete(c, chan, [id]) { if (!lines.has(id) && !held.has(id)) return bot(c, 'No such message.', 'error'); held.delete(id); deleteIds([id]); return log(c.nick, 'delete', id, '', chan.name); },
        shield(c) { return shield(true, c.nick, false); },
        shieldoff(c) { return shield(false, c.nick, false); },
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
            if (lc(list) !== 'del') net.lists[lc(list)].push(word);
            log(c.nick, `filter-${lc(list)}`, word);
            return saveNet();
        },
        camoff(c, chan, [scope]) {
            const all = lc(scope) === 'all';
            for (const room of all ? channels.values() : [chan]) camsOff(room, c.nick);
            return log(c.nick, 'camoff', all ? 'all' : chan.name);
        },
        approve(c, _chan, [id]) {
            const h = held.get(id);
            if (!h) return bot(c, 'Nothing held with that id.', 'error');
            held.delete(id);
            const room = ch(h.ch);
            const { reason: _r, dev, ...clean } = h;
            if (room) publish(room, clean, dev);
            return log(c.nick, 'approve', h.from, h.reason, h.ch);
        },
        dismiss(c, _chan, [id]) {
            if (held.delete(id)) return log(c.nick, 'reject-held', id);
            const r = reports.get(id);
            if (!r) return bot(c, 'No such report.', 'error');
            r.done = true;
            if (r.hidden && lines.has(id)) { r.hidden = false; const l = lines.get(id); const room = ch(l.ch); if (room) cast(room, { ...l, restored: true }); }
            return log(c.nick, 'dismiss-report', r.from, '', r.ch);
        },
        log(c) { return out(c, { t: 'modlog', entries: net.modlog.slice(-50) }); }
    };

    function setRank(c, chan, n, set, on, flag) {
        if (chan.kind === 'lobby') return bot(c, 'In #stalemate the band are the ops. Use this inside a room.', 'error');
        const t = target(c, n); if (!t) return undefined;
        if (!chan.members.has(t.id)) return bot(c, `${t.nick} isn't in ${chan.name}.`, 'error');
        if (on) chan[set].add(t.dev); else chan[set].delete(t.dev);
        event(chan, `${c.nick} sets mode ${flag} ${t.nick}`);
        log(c.nick, `mode ${flag}`, t.nick, '', chan.name);
        return sendChan(chan);
    }

    function modeString(chan) {
        const m = chan.modes;
        return `+t${m.m ? 'm' : ''}${m.i ? 'i' : ''}${m.k ? 'k' : ''}${m.C ? 'C' : ''}${m.Q ? 'Q' : ''} l=${m.l}${m.S ? ` S=${m.S}s` : ''}${m.locked ? ' (locked)' : ''}`;
    }

    function create(c, name, key, titleText) {
        const kind = Object.keys(KINDS).find((k) => name.startsWith(`#${k}`)) || 'watch';
        if (net.shield && !isBand(c)) return bot(c, 'Shield is on, so new rooms are paused. Try again later.', 'error');
        const listed = [...channels.values()].filter((x) => x.kind !== 'lobby').length;
        if (listed >= L.roomsListed) return bot(c, 'All 30 room slots are busy. Join one from the list.', 'error');
        if (!isBand(c)) {
            const st = devStats.get(c.dev) || {};
            if (st.lastRoom && now() - st.lastRoom < L.roomPerDevice) return bot(c, 'One new room per 10 minutes.', 'error');
            const hits = (ipRooms.get(c.iph) || []).filter((t) => t > now() - HOUR);
            if (hits.length >= L.roomsPerIpHour) return bot(c, 'Too many new rooms from your connection this hour.', 'error');
            hits.push(now()); ipRooms.set(c.iph, hits);
            devStats.set(c.dev, { ...st, lastRoom: now() });
        }
        const title = titleText ? checkText(titleText, net.lists) : { verdict: 'ok', text: KINDS[kind].replace(/^\S+\s/, '') };
        if (title.verdict !== 'ok') return bot(c, 'Not cool here. Pick another title.', 'error');
        const nameCheck = checkText(name.slice(1).replace(/-/g, ' '), net.lists, { handles: false });
        if (nameCheck.verdict !== 'ok') return bot(c, 'Not cool here. Pick another room name.', 'error');
        const room = mkChannel(name, kind, title.text.slice(0, 40), c.dev);
        bump(net.stats.kinds, kind);
        if (key && /^[A-Za-z0-9]{3,20}$/.test(key)) room.modes.k = key;
        if (net.shield) room.modes.C = false;
        if (kind === 'jam') room.modes.i = true; // a WebJam invite carries the host's address: members only, founder invites
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
        if (chan.kind === 'lobby') return bot(c, 'No cameras in #stalemate. Start or join a room.', 'error');
        if (net.shield) return bot(c, 'Shield is on: cameras are off everywhere for now.', 'error');
        if (!chan.modes.C) return bot(c, `Cameras are off in ${chan.name} (-C).`, 'error');
        if (!adult18) return out(c, { t: 'cam-gate', ch: chan.name, text: 'Cameras in open rooms are 18+. Tick the box to turn yours on.' });
        if ((c.camReports || 0) >= L.reportsCamOff) return bot(c, 'Your camera is off pending band review.', 'error');
        c.cams.add(lc(chan.name));
        out(c, { t: 'cam', ch: chan.name, on: true });
        return sendChan(chan);
    }

    function say(c, where, rawText, action) {
        const chan = ch(where);
        if (!chan || !chan.members.has(c.id)) return bot(c, 'You are not in that room.', 'error');
        if (!isBand(c)) {
            if ((net.mutes[c.dev] || 0) > now()) return bot(c, 'You’re muted for now. You can still read.', 'error');
            if (net.lock === 'readonly' || budgetLevel() !== 'ok') return bot(c, 'The lobby is read-only right now.', 'error');
            if (chan.modes.m && !chan.voice.has(c.dev) && !chan.ops.has(c.dev)) return bot(c, `${chan.name} is +m: only @ and + can talk.`, 'error');
            if (chan.modes.Q) return bot(c, 'Quick lines only right now (+Q). Tap a quick line.', 'error');
            const t = now();
            c.tokens = Math.min(L.burst, c.tokens + ((t - c.last) / 1000) * L.perSecond);
            c.last = t;
            if (c.tokens < 1) return bot(c, 'Easy, speed racer.', 'error');
            const slow = net.shield && chan.kind === 'lobby' ? Math.max(30, chan.modes.S) : chan.modes.S;
            if (slow && c.lastSaid[chan.name] && t - c.lastSaid[chan.name] < slow * 1000) return bot(c, `Slow mode: one line every ${slow}s.`, 'error');
            const day = new Date(t).toISOString().slice(0, 10);
            const st = devStats.get(c.dev) || {};
            if (st.day !== day) { st.day = day; st.msgs = 0; }
            if (st.msgs >= L.perDeviceDay) return bot(c, 'That’s 200 lines today. Come back tomorrow.', 'error');
            st.msgs += 1; devStats.set(c.dev, st);
            c.tokens -= 1;
            c.lastSaid[chan.name] = t;
        }
        if (String(rawText || '').length > L.maxChars * 2) return bot(c, `Keep it under ${L.maxChars} characters.`, 'error');
        const norm = lc(normalize(rawText));
        if (!isBand(c) && c.lastText === norm && now() - (c.lastTextAt || 0) < 30000) { log(BOT, 'filter-block', c.nick, 'spam:repeat', chan.name); return bot(c, 'Heard you the first time. 🦜', 'error'); }
        c.lastText = norm; c.lastTextAt = now();
        const v = checkText(rawText, net.lists);
        const line = { t: 'line', id: `m${now().toString(36)}${(seq += 1).toString(36)}`, ch: chan.name, from: c.nick, prefix: prefix(c, chan), band: isBand(c), me: !!action, text: v.text, ts: now() };
        if (v.verdict === 'block' && !(isBand(c) && v.reason.startsWith('link'))) {
            if (v.reason !== 'empty') { bot(c, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials in public chat.' : v.reason === 'link' ? 'Only YouTube links are allowed.' : v.reason === 'threat' ? 'Nope. No threats. Don’t be a dick.' : v.reason === 'spam' ? 'Easy on the keyboard mash.' : 'Don’t be a dick. Message not sent.', 'error'); log(BOT, 'filter-block', c.nick, v.reason, chan.name); }
            return undefined;
        }
        if (v.verdict === 'hold' && !isBand(c)) {
            held.set(line.id, { ...line, reason: v.reason, dev: c.dev });
            bot(c, 'Your message is waiting for a band op to OK it.');
            log(BOT, 'filter-hold', c.nick, v.reason, chan.name);
            return undefined;
        }
        return publish(chan, line, c.dev);
    }

    function publish(chan, line, dev) {
        statHour().lines += 1;
        lines.set(line.id, line);
        if (lines.size > 1000) lines.delete(lines.keys().next().value);
        chan.history.push(line);
        if (chan.history.length > L.history) chan.history.shift();
        cast(chan, line, (m) => !m.ignores.has(lc(line.from)) && !(dev && m.blocks.has(dev)));
    }

    function deleteIds(ids) {
        const set = new Set(ids);
        for (const chan of channels.values()) chan.history = chan.history.filter((h) => !set.has(h.id));
        for (const id of ids) lines.delete(id);
        for (const x of conns.values()) if (x.nick) out(x, { t: 'delete', ids });
        pushAdmin();
    }

    function privmsg(c, to, rawText) {
        const t = byNick(to);
        if (!t || t === c) return bot(c, `No such nick: ${String(to || '').slice(0, 20)}`, 'error');
        if (lc(to) === lc(BOT)) return handlers.help(c);
        const k = pairKey(c.dev, t.dev);
        const p = pm.get(k);
        if (!isBand(c) && (net.lock === 'readonly' || budgetLevel() !== 'ok')) return bot(c, 'The lobby is read-only right now, PMs too.', 'error');
        if (p && p.state === 'open') {
            if (!rawText) return out(c, { t: 'pm-open', with: t.nick });
            return deliverPm(c, t, rawText);
        }
        if (t.pmOff || t.blocks.has(c.dev) || c.blocks.has(t.dev)) return bot(c, `${t.nick} isn't taking PMs.`, 'error');
        if (!isBand(c)) {
            if (net.shield) return bot(c, 'Shield is on: new PM requests are paused.', 'error');
            if ((net.mutes[c.dev] || 0) > now()) return bot(c, 'You’re muted for now.', 'error');
            if (now() - c.since < L.pmMinLobbyMs) return bot(c, `Hang in the lobby for ${Math.ceil(L.pmMinLobbyMs / MIN)} minutes before sending PM requests.`, 'error');
            const pending = [...pm.values()].filter((x) => x.from === c.dev && x.state === 'pending').length;
            if (pending >= L.pmPendingMax) return bot(c, 'Too many PM requests waiting. Give people a minute.', 'error');
        }
        let first = '';
        if (rawText) {
            const v = checkText(rawText, net.lists);
            if (v.verdict !== 'ok') { log(BOT, 'pm-filter', c.nick, v.reason); return bot(c, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials, even in PMs.' : 'Not cool here. Message not sent.', 'error'); }
            first = v.text;
        }
        if (p && p.state === 'pending') return bot(c, `Still waiting for ${t.nick} to accept.`);
        pm.set(k, { state: 'pending', from: c.dev, first, at: now() });
        out(t, { t: 'pm-request', from: c.nick, band: isBand(c) });
        return bot(c, `PM request sent to ${t.nick}. It opens if they accept.`);
    }

    function deliverPm(from, to, rawText) {
        if (!isBand(from) && (net.lock === 'readonly' || budgetLevel() !== 'ok')) return bot(from, 'The lobby is read-only right now, PMs too.', 'error');
        if (!isBand(from) && (net.mutes[from.dev] || 0) > now()) return bot(from, 'You’re muted for now.', 'error');
        if (to.blocks.has(from.dev)) return bot(from, `${to.nick} isn't taking PMs.`, 'error');
        const v = checkText(rawText, net.lists);
        if (v.verdict !== 'ok') { log(BOT, 'pm-filter', from.nick, v.reason); return bot(from, v.reason.startsWith('personal-info') ? 'Not cool here: no phone numbers, emails, addresses or socials, even in PMs.' : 'Not cool here. Message not sent.', 'error'); }
        const msg = { t: 'pm', id: `p${now().toString(36)}${(seq += 1).toString(36)}`, from: from.nick, to: to.nick, text: v.text, band: isBand(from), ts: now() };
        lines.set(msg.id, { ...msg, ch: `pm:${from.nick}>${to.nick}` });
        out(from, msg);
        if (!to.ignores.has(lc(from.nick))) out(to, msg);
        return undefined;
    }

    function report(c, id) {
        const l = lines.get(id);
        if (!l) return bot(c, 'That message is gone already.', 'error');
        if (l.from === c.nick) return bot(c, 'You can’t report yourself.', 'error');
        if (String(l.ch).startsWith('pm:') && l.to !== c.nick) return bot(c, 'You can only report PMs sent to you.', 'error');
        let r = reports.get(id);
        if (!r) {
            const chan = ch(l.ch);
            const hist = chan ? chan.history : [];
            const at = hist.findIndex((h) => h.id === id);
            const context = at >= 0 ? hist.slice(Math.max(0, at - 5), at + 6).map((h) => `${h.from ? `<${h.from}> ` : '* '}${h.text}`) : [`<${l.from}> ${l.text}`];
            r = { devs: new Set(), iphs: new Set(), ch: l.ch, from: l.from, text: l.text, hidden: false, context, at: now() };
            reports.set(id, r);
        }
        // Spoof-proof: one vote per signed device AND per daily IP hash.
        if (r.devs.has(c.dev) || r.iphs.has(c.iph)) return bot(c, 'Already reported. Thanks.');
        r.devs.add(c.dev); r.iphs.add(c.iph);
        net.stats.reports.made += 1;
        const offender = byNick(l.from);
        if (r.devs.size >= net.reportsToHide && !r.hidden) {
            r.hidden = true;
            deleteIds([id]);
            log(BOT, 'auto-hide', l.from, `${r.devs.size} reports`, l.ch);
        }
        if (offender && r.devs.size >= L.reportsCamOff) {
            offender.camReports = Math.max(offender.camReports || 0, r.devs.size);
            for (const name of [...offender.cams]) { offender.cams.delete(name); out(offender, { t: 'cam', ch: name, on: false, by: BOT }); const room = ch(name); if (room) sendChan(room); }
        }
        pushAdmin();
        return bot(c, 'Reported to the band. Thanks for looking out.');
    }

    function shield(on, by, auto) {
        net.shield = on;
        net.shieldAuto = on && auto;
        if (on) for (const room of channels.values()) { if (room.kind !== 'lobby') { room.modes.C = false; camsOff(room, by); } }
        else for (const room of channels.values()) if (room.kind !== 'lobby') room.modes.C = true;
        event(ch(LOBBY), on ? `${by} raised the shield: slow mode 30s, cameras off, new rooms and PM requests paused` : `${by} lowered the shield`);
        for (const x of conns.values()) out(x, { t: 'net', lock: net.lock, shield: net.shield });
        for (const room of channels.values()) sendChan(room);
        log(by, on ? (auto ? 'auto-shield' : 'shield') : 'shield-off', '', auto ? 'no band op online for 24h' : '');
        saveNet();
        pushList();
    }

    // Called by the DO alarm / dev relay timer. Expirations, empty-room cleanup, auto-shield.
    let lastStatSave = '';
    function tick() {
        const t = now();
        if (hourKey() !== lastStatSave) { lastStatSave = hourKey(); saveNet(); } // stats: ~24 row writes/day
        for (const [d, until] of Object.entries(net.kicks)) if (until <= t) delete net.kicks[d];
        for (const [d, until] of Object.entries(net.mutes)) if (until <= t) delete net.mutes[d];
        net.bans = net.bans.filter((b) => !b.until || b.until > t);
        for (const room of [...channels.values()]) if (room.kind !== 'lobby' && room.members.size === 0 && room.emptySince && t - room.emptySince >= L.emptyRoomClose) closeRoom(room, BOT, 'empty for 10 minutes');
        const bandOn = [...conns.values()].some(isBand);
        if (bandOn) net.lastBand = t;
        if (!bandOn && !net.lockAuto && net.lock === 'off' && t - net.lastBand >= L.noBandShield) {
            // True lockdown: fans go read-only everywhere (rooms and PMs too), not just slow mode.
            net.lock = 'readonly';
            net.lockAuto = true;
            event(ch(LOBBY), `${BOT} locked the lobby: no band op for 24 hours, so it's read-only for fans until the band is back`);
            for (const x of conns.values()) out(x, { t: 'net', lock: net.lock, shield: net.shield });
            log(BOT, 'auto-lockdown', 'readonly', 'no band op online for 24h');
            saveNet();
        }
        if (!bandOn && !net.shield && t - net.lastBand >= L.noBandShield) shield(true, BOT, true);
    }

    function snapshot() {
        return { bans: net.bans, kicks: net.kicks, mutes: net.mutes, lock: net.lock, shield: net.shield, shieldAuto: net.shieldAuto, lockAuto: net.lockAuto, lists: net.lists, lastBand: net.lastBand, budget: net.budget, reportsToHide: net.reportsToHide, stats: net.stats };
    }
    function restore(s = {}) {
        // Fail closed: empty or wiped storage comes back read-only for fans until a band op runs /lobby unlock.
        if (!s || typeof s !== 'object' || !['off', 'readonly', 'closed'].includes(s.lock)) { s = { ...(s && typeof s === 'object' ? s : {}), lock: 'readonly', lockAuto: true }; }
        for (const k of ['bans', 'kicks', 'mutes', 'lock', 'shield', 'shieldAuto', 'lockAuto', 'lists', 'lastBand', 'budget', 'reportsToHide', 'stats']) if (s[k] !== undefined) net[k] = s[k];
    }
    function restoreLog(entries = []) { net.modlog = entries.slice(-L.modlogKeep); }

    return { connect, disconnect, message, tick, snapshot, restore, restoreLog, adminState, budgetLevel, spend, get modlog() { return net.modlog.slice(); }, _debug: { conns, channels, net, pm, reports, held, lines } };
}
