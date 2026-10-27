// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { ENTRY_SITES, createEntrySiteRegistry, entrySitesFromConfig, normalizeEntrySource, entrySourceFromParams,
    entryBadge, entryReturn, entryHandoff, readEntryHandoff } from '../../r/45662413410ed051/entry-sites.mjs';

describe('reviewed entry-site display configuration', () => {
    it('uses allowlisted names and fixed return links; unknown and duplicate sources stay neutral', () => {
        expect(entryBadge('stalemate')).toBe('via Stalemate');
        expect(entryBadge('rad-dad')).toBe('via Rad Dad');
        expect(entryReturn('rad-dad')).toEqual({ label: 'Back to Rad Dad', href: 'https://raddadband.com/' });
        for (const source of ['', null, {}, ['stalemate'], 'STALEMATE', 'owner', 'constructor', '__proto__', '<img>', 'x'.repeat(3000)]) {
            expect(normalizeEntrySource(source)).toBe(''); expect(entryBadge(source)).toBe(''); expect(entryReturn(source)).toBeNull();
        }
        expect(entrySourceFromParams(new URLSearchParams('via=stalemate&via=rad-dad'))).toBe('');
        expect(entrySourceFromParams(new URLSearchParams('via=stalemate&return=https://evil.example'))).toBe('stalemate');
        expect(entryReturn('stalemate').href).toBe('https://stalemate.band/');
    });
    it('extends one shared registry with reviewed partners without replacing builtins or interpreting link claims', () => {
        const registry = createEntrySiteRegistry([
            { id: 'community-demo', label: 'Community demo', home: 'https://demo.example/community/' },
            { id: 'stalemate', label: 'Forged staff', home: 'https://evil.example/' },
            { id: 'bad-label', label: '<img onerror=alert(1)>' },
            { label: 'Missing identifier' },
            { id: 'no-home', label: 'No home', home: 'javascript:alert(1)' },
            { id: 'credential-home', label: 'No credentials', home: 'https://user:password@demo.example/' }
        ]);
        expect(entryBadge('community-demo', registry)).toBe('via Community demo');
        expect(entryReturn('community-demo', registry).href).toBe('https://demo.example/community/');
        expect(registry.stalemate).toEqual(ENTRY_SITES.stalemate);
        expect(registry['bad-label']).toBeUndefined(); expect(registry.undefined).toBeUndefined();
        expect(entryReturn('no-home', registry)).toBeNull(); expect(entryReturn('credential-home', registry)).toBeNull();
        expect(entryBadge('community-demo')).toBe('');
        expect(entrySitesFromConfig(JSON.stringify([{ id: 'community-demo', label: 'Community demo' }]))['community-demo'].label).toBe('Community demo');
        for (const bad of ['not-json', 'x'.repeat(8193), '{}', JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ id: `site-${i}`, label: 'Too many' })))]) {
            expect(Object.keys(entrySitesFromConfig(bad))).toEqual(['stalemate', 'rad-dad']);
        }
    });
    it('carries a hidden choice through only a bounded, unexpired tab handoff', () => {
        const now = 1800000000000;
        const raw = entryHandoff('rad-dad', false, now);
        expect(readEntryHandoff(raw, now + 2000)).toEqual({ source: 'rad-dad', share: false });
        expect(readEntryHandoff(raw, now + 10 * 60 * 1000)).toBeNull();
        expect(readEntryHandoff(raw, now - 1)).toBeNull();
        expect(readEntryHandoff(entryHandoff('unknown', true, now), now)).toBeNull();
        for (const raw of ['no-json', 'x'.repeat(257), JSON.stringify({ v: 1, source: 'stalemate', share: 'yes', at: now })]) expect(readEntryHandoff(raw, now)).toBeNull();
    });
});

let engine, frames, ids, now;
const cmd = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
function boot(entrySites = ENTRY_SITES) {
    frames = [];
    engine = createLobby({ now: () => now, send: (id, msg) => frames.push({ recipient: id, ...msg }), limits: { defaultSlow: 0, entrySites } });
}
function guest(nick, source, extra = {}) {
    const identity = { id: `socket-${ids.length + 1}`, dev: `device-${nick}`, iph: `ip-${nick}`, account: '', role: 'fan', admin: false, ...extra };
    ids.push(identity); engine.connect(identity); engine.message(identity.id, JSON.stringify({ t: 'hello', nick, age13: true, entrySource: source, role: 'owner', admin: true }));
    return identity.id;
}
beforeEach(() => { now = 1800000000000; ids = []; boot(); });

describe('one community with optional entry context', () => {
    it('shares rooms and messages across entry sites while keeping source separate from identity and authority', () => {
        const a = guest('Alice', 'stalemate'), b = guest('Bravo', 'rad-dad');
        expect(frames.find((frame) => frame.recipient === a && frame.t === 'hello').features).toEqual({ entrySources: 1, privateMessageContext: 1, privateMessagePeers: 1, roomKeep: 1, messageResults: 1 });
        cmd(a, 'join', ['#our-room']); cmd(b, 'join', ['#our-room']);
        const room = frames.filter((f) => f.recipient === b && f.t === 'join').at(-1).ch;
        expect(room.names.map(({ nick, entrySource }) => ({ nick, entrySource }))).toEqual([
            { nick: 'Alice', entrySource: 'stalemate' }, { nick: 'Bravo', entrySource: 'rad-dad' }
        ]);
        engine.message(a, JSON.stringify({ t: 'say', ch: '#our-room', text: 'One shared room' }));
        expect(frames.filter((f) => f.t === 'line' && f.text === 'One shared room').map((f) => f.recipient)).toEqual([a, b]);
        expect(frames.filter((f) => f.t === 'line').at(-1).entrySource).toBe('stalemate');
        expect(engine._debug.conns.get(a)).toMatchObject({ role: 'fan', admin: false, account: '' });
        cmd(b, 'shield'); expect(frames.at(-1).t).toBe('denied');
    });
    it('hides current People context and new messages without rewriting previously delivered history', () => {
        const a = guest('Alice', 'stalemate'), b = guest('Bravo', 'rad-dad');
        engine.message(a, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Before hiding' }));
        engine.message(a, JSON.stringify({ t: 'entry-source', source: '' }));
        expect(frames.filter((f) => f.recipient === b && f.t === 'chan').at(-1).ch.names.find((n) => n.nick === 'Alice').entrySource).toBe('');
        engine.message(a, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'After hiding' }));
        expect(frames.filter((f) => f.t === 'line' && f.text === 'After hiding').every((f) => f.entrySource === '')).toBe(true);
        expect(frames.filter((f) => f.t === 'line' && f.text === 'Before hiding').every((f) => f.entrySource === 'stalemate')).toBe(true);
        engine.message(a, JSON.stringify({ t: 'entry-source', source: '<script>site</script>', role: 'owner' }));
        expect(engine._debug.conns.get(a)).toMatchObject({ entrySource: '', role: 'fan' });
    });
    it('honors hiding under command throttling without letting new sharing bypass that limit', () => {
        const a = guest('Alice', 'stalemate'), b = guest('Bravo', 'rad-dad');
        for (let i = 0; i < 12; i++) cmd(a, 'help');
        expect(frames.some((frame) => frame.recipient === a && frame.t === 'rate-limit')).toBe(true);
        frames.length = 0;
        engine.message(a, JSON.stringify({ t: 'entry-source', source: '' }));
        expect(engine._debug.conns.get(a).entrySource).toBe('');
        expect(frames.filter((frame) => frame.recipient === b && frame.t === 'chan')).toHaveLength(1);
        expect(frames.at(-1)).toMatchObject({ recipient: a, t: 'entry-source', source: '', accepted: true });
        engine.message(a, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Hidden even after a command burst' }));
        expect(frames.find((frame) => frame.recipient === b && frame.t === 'line')).toMatchObject({ entrySource: '' });
        frames.length = 0;
        engine.message(a, JSON.stringify({ t: 'entry-source', source: 'stalemate' }));
        expect(engine._debug.conns.get(a).entrySource).toBe('');
        expect(frames.at(-1)).toMatchObject({ recipient: a, t: 'entry-source', source: '', accepted: false });
        expect(frames.some((frame) => frame.t === 'chan')).toBe(false);
        now += 2000;
        engine.message(a, JSON.stringify({ t: 'entry-source', source: 'stalemate' }));
        expect(engine._debug.conns.get(a).entrySource).toBe('stalemate');
        expect(frames.at(-1)).toMatchObject({ t: 'entry-source', source: 'stalemate', accepted: true });
    });
    it('does not amplify repeated no-op clears and still enforces frame and byte bounds', () => {
        const a = guest('Alice', ''), b = guest('Bravo', 'rad-dad');
        frames.length = 0;
        const before = engine._debug.conns.get(a).frames;
        const budget = engine._debug.net.budget.requests;
        for (let i = 0; i < 20; i++) engine.message(a, JSON.stringify({ t: 'entry-source', source: '' }));
        expect(engine._debug.conns.get(a).frames).toBe(before + 20);
        expect(engine._debug.net.budget.requests - budget).toBeCloseTo(1);
        expect(frames).toHaveLength(20);
        expect(frames.every((frame) => frame.recipient === a && frame.t === 'entry-source' && frame.accepted === true)).toBe(true);
        expect(frames.some((frame) => frame.recipient === b)).toBe(false);
        engine._debug.conns.get(a).frames = 4000;
        engine.message(a, JSON.stringify({ t: 'entry-source', source: '' }));
        expect(engine._debug.conns.has(a)).toBe(false);
        engine.message(b, JSON.stringify({ t: 'entry-source', source: '', padding: 'x'.repeat(2048) }));
        expect(engine._debug.conns.has(b)).toBe(false);
    });
    it('keeps direct and unknown entry neutral and never sends a newcomer previous messages', () => {
        const a = guest('Alice', 'stalemate');
        engine.message(a, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Before arrival' }));
        const b = guest('Bravo', 'not-registered');
        expect(engine._debug.conns.get(b).entrySource).toBe('');
        expect(frames.filter((f) => f.recipient === b && f.t === 'line')).toEqual([]);
    });
    it('restores optional context only for admitted live sockets, and accepts legacy session metadata', () => {
        const a = guest('Alice', 'rad-dad'), b = guest('Bravo', 'stalemate');
        const saved = engine.sessionSnapshot(); delete saved.connections[1].entrySource;
        boot(); expect(engine.restoreSessions(saved, ids).resumed).toEqual([a, b]);
        expect(engine._debug.conns.get(a).entrySource).toBe('rad-dad'); expect(engine._debug.conns.get(b).entrySource).toBe('');
        expect(frames).toEqual([]);
    });
    it('projects a reviewed third partner through the same engine and neutralizes revoked source metadata', () => {
        const registry = createEntrySiteRegistry([{ id: 'community-demo', label: 'Community demo' }]); boot(registry);
        const a = guest('PartnerGuest', 'community-demo');
        expect(engine._debug.conns.get(a).entrySource).toBe('community-demo');
        const saved = engine.sessionSnapshot(); boot();
        expect(engine.restoreSessions(saved, ids).resumed).toEqual([a]);
        expect(engine._debug.conns.get(a).entrySource).toBe(''); expect(engine._debug.conns.get(a).role).toBe('fan');
    });
});
