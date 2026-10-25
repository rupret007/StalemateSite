// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createParticipationCheckpoint } from '../../hangout-worker/src/participation-checkpoint.mjs';

afterEach(() => vi.restoreAllMocks());

describe('bounded, transient participation rollback checkpoint', () => {
    it('restores an engine-shaped graph in place without breaking existing AI, line or channel identities', () => {
        const line = { id: 'mEarlier', text: 'Synthetic earlier channel content' };
        const chan = { name: '#earlier', members: new Set(['actor']), act: { strokes: [{ points: [[1, 2], [3, 4]] }] }, moderationContext: [line] };
        const actor = { channels: new Set(['#earlier']), cams: new Set(), frames: 2, tokens: 5 };
        const pending = { line, chan };
        const roots = { net: { budget: { requests: 12 } }, conns: new Map([['actor', actor]]),
            channels: new Map([['#earlier', chan]]), lines: new Map([['mEarlier', line]]), aiPending: new Map([['mEarlier', pending]]),
            pm: new Map([['pair', { state: 'pending', first: 'Synthetic volatile first PM' }]]) };
        const old = { channels: roots.channels, members: chan.members, context: chan.moderationContext, stroke: chan.act.strokes[0], first: roots.pm.get('pair') };
        const checkpoint = createParticipationCheckpoint(roots);
        chan.members.clear(); chan.members.add('intruder'); chan.act.strokes[0].points[0][0] = 99;
        chan.moderationContext.push({ id: 'mUncommitted', text: 'Uncommitted line' }); line.text = 'Changed text';
        roots.channels.set('#uncommitted', { members: new Set(['actor']) }); roots.lines.delete('mEarlier');
        roots.aiPending.set('mEarlier', { line: {}, chan: {} }); roots.pm.get('pair').first = '';
        roots.pm.set('new-pair', { state: 'open' }); actor.channels.add('#uncommitted'); actor.cams.add('#earlier');
        expect(checkpoint.restore()).toBe(true);
        expect(roots.channels).toBe(old.channels); expect(roots.channels.get('#earlier')).toBe(chan);
        expect(roots.aiPending.get('mEarlier')).toBe(pending);
        expect(pending.line).toBe(roots.lines.get('mEarlier')); expect(pending.chan).toBe(roots.channels.get('#earlier'));
        expect(line.text).toBe('Synthetic earlier channel content'); expect(chan.members).toBe(old.members);
        expect([...chan.members]).toEqual(['actor']); expect(chan.moderationContext).toBe(old.context);
        expect(chan.moderationContext).toEqual([line]); expect(chan.act.strokes[0]).toBe(old.stroke);
        expect(chan.act.strokes[0].points).toEqual([[1, 2], [3, 4]]);
        expect([...roots.channels.keys()]).toEqual(['#earlier']); expect([...roots.pm.keys()]).toEqual(['pair']);
        expect(roots.pm.get('pair')).toBe(old.first); expect(old.first.first).toBe('Synthetic volatile first PM');
        expect([...actor.channels]).toEqual(['#earlier']); expect(actor.cams.size).toBe(0);
    });

    it('preserves cycles, collection keys, insertion order, shared aliases and null-prototype records', () => {
        const key = Object.assign(Object.create(null), { label: 'original' }), other = { key };
        key.peer = other;
        const map = new Map([[key, other], ['last', key]]), set = new Set([other, key]);
        const roots = { map, set, key, other, alias: key };
        const checkpoint = createParticipationCheckpoint(roots);
        key.label = 'changed'; delete other.key; roots.alias = {}; map.delete(key); map.set('new', {});
        set.clear(); set.add('replacement'); Object.setPrototypeOf(other, null);
        checkpoint.restore();
        expect(Object.getPrototypeOf(key)).toBeNull(); expect(Object.getPrototypeOf(other)).toBe(Object.prototype);
        expect(key.label).toBe('original'); expect(other.key).toBe(key); expect(key.peer).toBe(other);
        expect(roots.alias).toBe(key); expect([...map.keys()]).toEqual([key, 'last']);
        expect(map.get(key)).toBe(other); expect([...set]).toEqual([other, key]);
    });

    it('restores sparse arrays, original descriptors, deletions and replaced roots', () => {
        const shared = { x: 1 }, array = [shared, , shared];
        Object.defineProperty(shared, 'label', { value: 'original', configurable: true, enumerable: false, writable: false });
        const fixed = Object.seal({ value: 1 }), roots = { array, fixed };
        const checkpoint = createParticipationCheckpoint(roots);
        array.splice(0, 3, { x: 999 }); array.push('extra'); roots.array = [];
        Object.defineProperty(shared, 'label', { value: 'changed', configurable: true, enumerable: true, writable: true });
        fixed.value = 2; delete shared.x;
        checkpoint.restore();
        expect(roots.array).toBe(array); expect(array.length).toBe(3); expect(Object.hasOwn(array, 1)).toBe(false);
        expect(array[0]).toBe(shared); expect(array[2]).toBe(shared); expect(shared.x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(shared, 'label')).toEqual({ value: 'original', configurable: true, enumerable: false, writable: false });
        expect(fixed.value).toBe(1); expect(Object.isSealed(fixed)).toBe(true);
    });

    it('removes staged collection accessors without invoking them', () => {
        let invoked = false;
        const map = new Map([['original', 1]]), set = new Set(['original']);
        const checkpoint = createParticipationCheckpoint({ map, set });
        for (const value of [map, set]) Object.defineProperty(value, 'size', { configurable: true, get() { invoked = true; throw new Error('must not execute'); } });
        map.clear(); map.set('new', 2); set.clear(); set.add('new');
        checkpoint.restore();
        expect(invoked).toBe(false); expect([...map]).toEqual([['original', 1]]); expect([...set]).toEqual(['original']);
        expect(Object.hasOwn(map, 'size')).toBe(false); expect(Object.hasOwn(set, 'size')).toBe(false);
    });

    it('is one-shot so a stale checkpoint cannot undo a later accepted mutation', () => {
        const state = { topic: 'original' }, checkpoint = createParticipationCheckpoint(state);
        state.topic = 'uncommitted'; expect(checkpoint.restore()).toBe(true);
        state.topic = 'later accepted'; expect(checkpoint.restore()).toBe(false);
        expect(state.topic).toBe('later accepted'); expect(Object.isFrozen(checkpoint)).toBe(true);
    });

    it.each(['array', 'set'])('keeps trusted opaque child references while restoring metadata with a bounded %s declaration', kind => {
        const act = { strokes: Array.from({ length: 5000 }, () => ({ points: [[0, 0], [1, 1]] })), video: null };
        const member = { cams: new Set(['#art']) }, room = { act, members: new Set(['actor']), topic: 'original' };
        const roots = { room, member, actAlias: act }, checkpoint = createParticipationCheckpoint(roots,
            { maxNodes: 64, maxBytes: 4096, opaque: kind === 'array' ? [act] : new Set([act]) });
        room.act = { strokes: [], video: null }; roots.actAlias = room.act;
        room.members.clear(); room.topic = 'uncommitted'; member.cams.clear();
        expect(checkpoint.restore()).toBe(true);
        expect(room.act).toBe(act); expect(roots.actAlias).toBe(act);
        expect(room.act.strokes).toHaveLength(5000); expect([...room.members]).toEqual(['actor']);
        expect(room.topic).toBe('original'); expect([...member.cams]).toEqual(['#art']);
        expect(checkpoint.metrics.opaqueObjects).toBe(1); expect(checkpoint.metrics.nodes).toBeLessThan(64);
    });

    it('explicitly leaves opaque internals unchanged and excludes their content from diagnostics', () => {
        const secret = 'Synthetic creative content excluded from diagnostics', act = { strokes: [secret] };
        const roots = { act, metadata: { muted: false } }, checkpoint = createParticipationCheckpoint(roots, { opaque: [act] });
        act.strokes.push('This operation must never mutate opaque content'); roots.metadata.muted = true;
        checkpoint.restore();
        expect(act.strokes).toHaveLength(2); expect(roots.metadata.muted).toBe(false);
        expect(JSON.stringify(checkpoint.metrics)).not.toContain(secret);
        expect(Object.hasOwn(checkpoint.metrics, 'opaque')).toBe(false);
    });

    it('does not traverse accessors inside explicitly opaque trusted objects', () => {
        let invoked = false;
        const act = Object.defineProperty({}, 'creative', { get() { invoked = true; throw Error('must not execute'); } });
        const checkpoint = createParticipationCheckpoint({ act }, { opaque: [act] });
        expect(checkpoint.restore()).toBe(true); expect(invoked).toBe(false);
        expect(() => createParticipationCheckpoint({ act })).toThrow(/Unsupported/);
    });

    it('bounds opaque declarations and rejects accessors, sparse lists, exotic values and opaque roots', () => {
        expect(() => createParticipationCheckpoint({}, { opaque: Array.from({ length: 4097 }, () => ({})) })).toThrow(/limit/);
        expect(() => createParticipationCheckpoint({}, { opaque: new Set(Array.from({ length: 4097 }, () => ({}))) })).toThrow(/limit/);
        const sparse = []; sparse.length = 1;
        expect(() => createParticipationCheckpoint({}, { opaque: sparse })).toThrow(/Unsupported/);
        let invoked = false;
        const entries = Object.defineProperty([], '0', { get() { invoked = true; return {}; }, configurable: true });
        expect(() => createParticipationCheckpoint({}, { opaque: entries })).toThrow(/Unsupported/);
        const options = Object.defineProperty({}, 'opaque', { get() { invoked = true; return []; } });
        expect(() => createParticipationCheckpoint({}, options)).toThrow(/Invalid/);
        for (const value of [undefined, null, 1, new Date(), new Uint8Array(), () => {}, Object.create(Map.prototype)])
            expect(() => createParticipationCheckpoint({}, { opaque: [value] })).toThrow(/Unsupported/);
        expect(() => createParticipationCheckpoint({}, { opaque: {} })).toThrow(/Unsupported/);
        const roots = {};
        expect(() => createParticipationCheckpoint(roots, { opaque: [roots] })).toThrow(/Unsupported/);
        expect(invoked).toBe(false);
    });

    it('preflights irreversible structure before changing any earlier object and cannot retry a failed restore', () => {
        const first = { value: 1 }, second = { value: 2 }, checkpoint = createParticipationCheckpoint({ first, second });
        first.value = 99; second.value = 100;
        Object.defineProperty(second, 'irreversible', { value: true, configurable: false });
        expect(() => checkpoint.restore()).toThrow(/Unsupported/);
        expect(first.value).toBe(99); expect(second.value).toBe(100); expect(checkpoint.restore()).toBe(false);
    });

    it('does not report a successful restore after irreversible extensibility changes', () => {
        const state = { value: 1 }, checkpoint = createParticipationCheckpoint(state);
        state.value = 2; Object.preventExtensions(state);
        expect(() => checkpoint.restore()).toThrow(/Unsupported/);
        expect(state.value).toBe(2);
    });

    it.each([new Date(), new Uint8Array(1), new Error('synthetic'), Promise.resolve(), () => {}, 1n, Symbol('synthetic')])
        ('rejects unsupported nested values without serializing them', value => {
            expect(() => createParticipationCheckpoint({ nested: value })).toThrow(/Unsupported/);
        });

    it('rejects accessor or custom-prototype graphs without calling getters or toJSON', () => {
        let invoked = false;
        const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { invoked = true; return 'private'; } });
        expect(() => createParticipationCheckpoint(getter)).toThrow(/Unsupported/);
        expect(() => createParticipationCheckpoint({ toJSON() { invoked = true; return {}; } })).toThrow(/Unsupported/);
        expect(() => createParticipationCheckpoint(Object.create({ inherited: true }))).toThrow(/Unsupported/);
        expect(invoked).toBe(false);
    });

    it('bounds deep traversal iteratively, count, string bytes and restore growth', () => {
        const root = {}, tail = { value: 'end' }; let cursor = root;
        for (let i = 0; i < 2000; i += 1) { cursor.child = {}; cursor = cursor.child; }
        cursor.child = tail;
        const checkpoint = createParticipationCheckpoint(root);
        tail.value = 'changed'; checkpoint.restore(); expect(tail.value).toBe('end');
        expect(() => createParticipationCheckpoint({ child: {} }, { maxNodes: 2 })).toThrow(/limit/);
        expect(() => createParticipationCheckpoint({ text: '🔒'.repeat(1000) }, { maxBytes: 256 })).toThrow(/limit/);
        const graph = { map: new Map([['first', 1]]) }, small = createParticipationCheckpoint(graph, { maxNodes: 8 });
        for (let i = 0; i < 20; i += 1) graph.map.set(i, i);
        expect(() => small.restore()).toThrow(/limit/);
    });

    it('enforces capture and restore clock budgets with no graph-content error or metrics', () => {
        let time = 0; const timer = vi.spyOn(performance, 'now').mockImplementation(() => time++);
        const secret = 'Synthetic private body excluded from diagnostics';
        expect(() => createParticipationCheckpoint({ secret }, { maxMs: 1 })).toThrow(/limit/);
        timer.mockImplementation(() => 0);
        const state = { secret }, checkpoint = createParticipationCheckpoint(state, { maxMs: 1 });
        expect(JSON.stringify(checkpoint.metrics)).not.toContain(secret); expect(Object.isFrozen(checkpoint.metrics)).toBe(true);
        state.secret = 'uncommitted'; time = 0; timer.mockImplementation(() => time++);
        expect(() => checkpoint.restore()).toThrow(/limit/);
        expect(state.secret).toBe('uncommitted'); expect(checkpoint.restore()).toBe(false);
    });

    it.each([{ maxBytes: 0 }, { maxBytes: 8 * 1024 * 1024 + 1 }, { maxNodes: 100001 }, { maxMs: 51 }, { maxMs: Infinity }, { unknown: 1 }])
        ('does not let a caller widen or disable defensive ceilings: %j', options => {
            expect(() => createParticipationCheckpoint({}, options)).toThrow(/Invalid/);
        });
});
