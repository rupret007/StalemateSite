// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

function fixture(persist) {
    const frames = [], closed = [];
    const engine = createLobby({ now: () => 1800000000000, persist,
        send: (id, frame) => frames.push({ recipient: id, ...frame }), close: (...args) => closed.push(args) });
    const join = (id, nick, role = 'fan') => {
        engine.connect({ id, dev: `dev-${id}`, iph: `ip-${id}`, role, admin: role === 'owner' });
        return engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    };
    const cmd = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
    return { engine, frames, closed, join, cmd };
}

describe('durable emergency and abuse controls', () => {
    it('does not broadcast shield success or an admin-state confirmation until the network write commits', async () => {
        let delayed = false, finish;
        const f = fixture((kind) => kind === 'net' && delayed ? new Promise((resolve) => { finish = resolve; }) : undefined);
        f.join('staff', 'Staff', 'owner'); f.join('guest', 'Visitor'); await Promise.resolve(); f.frames.length = 0;
        delayed = true; const pending = f.cmd('staff', 'shield'); await Promise.resolve();
        expect(f.frames.some((frame) => frame.t === 'event' && /raised the shield/.test(frame.text))).toBe(false);
        expect(f.frames.some((frame) => frame.t === 'admin')).toBe(false);
        finish(); await pending; await Promise.resolve();
        expect(f.frames.some((frame) => frame.t === 'event' && /raised the shield/.test(frame.text))).toBe(true);
        expect(f.frames.some((frame) => frame.t === 'admin' && frame.state.shield)).toBe(true);
    });

    it('shows a failure instead of confirming a failed shield and explicitly stops existing captures', async () => {
        let failed = false;
        const f = fixture((kind) => kind === 'net' && failed ? Promise.reject(new Error('network write failed')) : undefined);
        f.join('staff', 'Staff', 'owner'); f.join('guest', 'Visitor'); f.cmd('guest', 'join', ['#art-test']);
        await f.engine.message('guest', JSON.stringify({ t: 'cam', ch: '#art-test', on: true, adult18: true }));
        await Promise.resolve(); f.frames.length = 0; failed = true; await f.cmd('staff', 'shield');
        expect(f.frames.some((frame) => frame.t === 'event' && /raised the shield/.test(frame.text))).toBe(false);
        expect(f.frames.some((frame) => frame.recipient === 'staff' && frame.kind === 'error' && /Changes are not confirmed/.test(frame.text))).toBe(true);
        expect(f.frames.some((frame) => frame.recipient === 'guest' && frame.t === 'cam' && frame.on === false)).toBe(true);
        expect(f.engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
    });

    it('does not confirm a failed global ban and terminates the removed socket with a service error', async () => {
        let failed = false;
        const f = fixture((kind) => kind === 'net' && failed ? Promise.reject(new Error('network write failed')) : undefined);
        f.join('staff', 'Staff', 'owner'); f.join('guest', 'Visitor'); await Promise.resolve(); f.frames.length = 0;
        failed = true; await f.cmd('staff', 'gban', ['Visitor', 'synthetic reason']);
        expect(f.frames.some((frame) => frame.t === 'event' && /was banned/.test(frame.text))).toBe(false);
        expect(f.frames.some((frame) => frame.t === 'kicked')).toBe(false);
        expect(f.frames.some((frame) => frame.recipient === 'guest' && frame.kind === 'error' && /Storage is unavailable/.test(frame.text))).toBe(true);
        expect(f.closed).toContainEqual(['guest', 1011, 'storage unavailable']);
        expect(f.engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
    });

    it('handles rejected connection-time network writes without an unhandled rejection or false open service', async () => {
        const f = fixture((kind) => kind === 'net' ? Promise.reject(new Error('connection write failed')) : undefined);
        await f.join('staff', 'Staff', 'owner'); await Promise.resolve();
        expect(f.engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
        expect(f.frames.some((frame) => frame.kind === 'error' && /Storage is unavailable/.test(frame.text))).toBe(true);
    });
});
