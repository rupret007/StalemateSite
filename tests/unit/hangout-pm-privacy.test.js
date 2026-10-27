// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

function fixture() {
    let time = 1800000000000;
    const frames = [], writes = [], providerCalls = [];
    const engine = createLobby({ now: () => time, limits: { defaultSlow: 0 },
        send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }),
        persist: (kind, value) => { writes.push([kind, structuredClone(value)]); },
        reviewPublicText: (...args) => providerCalls.push(args) });
    const cmd = (id, name, args = []) => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch: '#stalemate' }));
    // Deliberate nickname intent at these explicit call sites; selected/negative frames stay unmarked.
    const namedCmd = (id, name, args = []) => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch: '#stalemate',
        ...(name === 'msg' || name === 'm' ? { pmExplicit: true } : { personNamed: true }) }));
    function join(id, role = 'fan') {
        expect(engine.connect({ id, dev: `device-${id}`, iph: `ip-${id}`, role, admin: role === 'owner' }).ok).toBe(true);
        engine.message(id, JSON.stringify({ t: 'hello', nick: id, age13: true }));
        return id;
    }
    const pm = id => frames.filter(frame => frame.recipient === id && frame.t === 'pm');
    function establish(text = 'Synthetic selected private sentence') {
        join('Sender'); join('Recipient'); join('Observer'); join('Staff', 'owner'); time += 180000;
        namedCmd('Sender', 'msg', ['Recipient', text]);
        expect(pm('Recipient')).toEqual([]);
        namedCmd('Recipient', 'accept', ['Sender']);
        expect(pm('Recipient')).toHaveLength(1);
        return pm('Recipient')[0];
    }
    return { engine, cmd, namedCmd, join, pm, establish, frames, writes, providerCalls, later: ms => { time += ms; } };
}

describe('private messages use consent and participant reports without automatic content classification', () => {
    it('does not apply public word or personal-information filters to pending or accepted PMs', () => {
        const f = fixture();
        f.join('Sender'); f.join('Recipient'); f.join('Observer'); f.join('Staff', 'owner'); f.later(180000);
        f.cmd('Staff', 'filter', ['block', 'syntheticmarker']);
        const text = 'syntheticmarker person@example.test';
        f.namedCmd('Sender', 'msg', ['Recipient', text]);
        expect(f.frames.filter(frame => frame.recipient === 'Recipient' && frame.t === 'pm-request')).toHaveLength(1);
        expect(f.pm('Recipient')).toEqual([]);
        f.namedCmd('Recipient', 'accept', ['Sender']);
        expect(f.pm('Recipient').map(frame => frame.text)).toEqual([text]);
        f.later(4000); f.namedCmd('Sender', 'msg', ['Recipient', 'Another contact choice: second@example.test']);
        expect(f.pm('Recipient')).toHaveLength(2);
        expect(f.pm('Observer')).toEqual([]); expect(f.pm('Staff')).toEqual([]);
        expect(f.providerCalls).toEqual([]);
        expect(f.engine.modlog.some(entry => entry.action === 'pm-filter')).toBe(false);
        // Public text still has its existing deterministic moderation policy.
        f.later(4000); f.engine.message('Sender', JSON.stringify({ t: 'say', ch: '#stalemate', text: 'syntheticmarker' }));
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'syntheticmarker')).toBe(false);
        expect(f.engine.modlog.some(entry => entry.action === 'filter-block')).toBe(true);
    });

    it('keeps no accepted PM body in the recent moderation buffer, durable snapshots or staff state', () => {
        const f = fixture(), line = f.establish();
        expect(f.engine._debug.lines.has(line.id)).toBe(false);
        expect([...f.engine._debug.pm.values()].every(pair => !pair.first)).toBe(true);
        for (const value of [f.engine.sessionSnapshot(), f.engine.roomSnapshot(), f.engine.snapshot(), f.engine.adminState(), f.writes])
            expect(JSON.stringify(value)).not.toContain(line.text);
        const receipt = f.engine.sessionSnapshot().receipts.find(item => item.id === line.id);
        expect(receipt).toMatchObject({ t: 'pm', recipients: ['Sender', 'Recipient'] });
        expect(receipt).not.toHaveProperty('text');
        expect(f.providerCalls).toEqual([]);
    });

    it('still normalizes and bounds private protocol text without publishing an empty frame', () => {
        const f = fixture(), line = f.establish(` \u202e${'p'.repeat(320)}  `);
        expect(line.text).toMatch(/^p+$/);
        expect(line.text.length).toBeGreaterThan(250);
        expect(line.text.length).toBeLessThanOrEqual(300);
        f.later(4000); f.namedCmd('Sender', 'msg', ['Recipient', '\u202e\u0001  ']);
        expect(f.pm('Recipient')).toHaveLength(1);
        expect(f.engine._debug.lines.has(line.id)).toBe(false);
    });

    it('accepts only an exact participant-selected report, without adjacent private messages', () => {
        const f = fixture(), first = f.establish('Private adjacent sentence excluded from the report');
        f.later(4000); f.namedCmd('Sender', 'msg', ['Recipient', 'Only this selected synthetic sentence goes to staff']);
        const selected = f.pm('Recipient').at(-1);
        const report = (who, text) => f.engine.message(who, JSON.stringify({ t: 'report', id: selected.id, text }));
        report('Observer', selected.text); report('Sender', selected.text); report('Recipient', 'Changed quote');
        expect(f.engine.adminState().reports).toEqual([]);
        report('Recipient', selected.text);
        const accepted = f.engine.adminState().reports;
        expect(accepted).toHaveLength(1);
        expect(accepted[0]).toMatchObject({ id: selected.id, text: selected.text, context: [`<Sender> ${selected.text}`] });
        expect(JSON.stringify(accepted)).not.toContain(first.text);
        expect(f.writes.filter(([kind]) => kind === 'moderation-queue').at(-1)[1].reports[0].text).toBe(selected.text);
        expect(f.providerCalls).toEqual([]);
    });

    it('preserves PM consent, blocking, muting and read-only checks without classifying private content', () => {
        const f = fixture(); f.establish();
        f.namedCmd('Recipient', 'block', ['Sender']);
        f.later(4000); f.namedCmd('Sender', 'msg', ['Recipient', 'A blocked message']);
        expect(f.pm('Recipient')).toHaveLength(1);
        f.namedCmd('Recipient', 'unblock', ['Sender']);
        f.namedCmd('Sender', 'msg', ['Recipient', 'A new request needs fresh acceptance']);
        expect(f.pm('Recipient')).toHaveLength(1);
        f.namedCmd('Recipient', 'accept', ['Sender']);
        expect(f.pm('Recipient')).toHaveLength(2);
        f.namedCmd('Staff', 'mute', ['Sender', '10']); f.later(4000);
        f.namedCmd('Sender', 'msg', ['Recipient', 'A muted message']);
        expect(f.pm('Recipient')).toHaveLength(2);
        f.cmd('Staff', 'lobby', ['readonly']); f.later(4000);
        f.namedCmd('Recipient', 'msg', ['Sender', 'A read-only message']);
        expect(f.pm('Sender')).toHaveLength(2);
        expect(f.providerCalls).toEqual([]);
    });

    it('expires pending first-message bodies without exposing them to a late acceptance', () => {
        const f = fixture(); f.join('Sender'); f.join('Recipient'); f.later(180000);
        const text = 'Pending private text is not a moderation record';
        f.namedCmd('Sender', 'msg', ['Recipient', text]);
        expect(JSON.stringify(f.engine.sessionSnapshot())).not.toContain(text);
        expect(JSON.stringify(f.writes)).not.toContain(text);
        f.later(600001); f.engine.tick(); f.namedCmd('Recipient', 'accept', ['Sender']);
        expect(f.engine._debug.pm.size).toBe(0); expect(f.pm('Recipient')).toEqual([]);
        expect(f.engine._debug.lines.size).toBe(0);
    });
});
