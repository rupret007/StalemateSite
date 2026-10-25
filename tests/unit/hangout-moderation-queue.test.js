// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby, LOBBY } from '../../hangout-worker/src/lobby-core.mjs';

const DAY = 24 * 60 * 60 * 1000;
let clock; let engine; let frames; let writes; let seq;
function boot() {
    clock = 1_800_000_000_000; frames = new Map(); writes = []; seq = 0;
    engine = createLobby({ now: () => clock, send: (id, frame) => {
        if (!frames.has(id)) frames.set(id, []);
        frames.get(id).push(frame);
    }, persist: (key, value) => writes.push([key, structuredClone(value)]) });
}
function guest(nick, role = 'fan', dev = `dev-${nick}`) {
    const id = `conn-${++seq}`;
    expect(engine.connect({ id, dev, iph: `ip-${id}`, role, admin: role === 'band' }).ok).toBe(true);
    engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return { id, nick };
}
const got = (person) => frames.get(person.id) || [];
const cmd = (person, name, args = [], ch = LOBBY) => engine.message(person.id, JSON.stringify({ t: 'cmd', name, args, ch }));
const report = (person, id) => engine.message(person.id, JSON.stringify({ t: 'report', id }));
const say = (person, text, ch = LOBBY) => {
    clock += 4000;
    engine.message(person.id, JSON.stringify({ t: 'say', ch, text }));
    return got(person).filter((frame) => frame.t === 'line').at(-1)?.id;
};
const saved = () => writes.filter(([key]) => key === 'moderation-queue').at(-1)?.[1];
const cam = (person, ch) => engine.message(person.id, JSON.stringify({ t: 'cam', ch, on: true, adult18: true }));

beforeEach(boot);

describe('human moderation evidence and recipient authorization', () => {
    it('rejects private-room ID guesses, late joiners and ignored recipients, while preserving a witness report after part', () => {
        const host = guest('Host'); const witness = guest('Witness'); const ignored = guest('Ignored');
        const outsiders = [guest('OutsideA'), guest('OutsideB'), guest('OutsideC')];
        cmd(host, 'join', ['#sealed']); cmd(host, 'mode', ['+k', 'secret'], '#sealed');
        cmd(witness, 'join', ['#sealed', 'secret']); cmd(ignored, 'join', ['#sealed', 'secret']);
        cmd(ignored, 'ignore', ['Host']);
        const id = say(host, 'private room evidence', '#sealed');
        for (const outsider of [...outsiders, ignored]) report(outsider, id);
        expect(engine.adminState().reports).toEqual([]);
        expect(engine._debug.lines.has(id)).toBe(true);
        const late = guest('LateGuest'); cmd(late, 'join', ['#sealed', 'secret']); report(late, id);
        expect(engine.adminState().reports).toEqual([]);
        cmd(witness, 'part', [], '#sealed'); report(witness, id);
        expect(engine.adminState().reports).toEqual([expect.objectContaining({ id, count: 1, text: 'private room evidence' })]);
        engine.disconnect(witness.id);
        const reconnected = guest('Witness', 'fan', 'dev-Witness'); report(reconnected, id);
        expect(engine.adminState().reports[0].count).toBe(1);
        expect(got(reconnected).at(-1).text).toMatch(/delivered to this connection/);
    });

    it('binds camera action and report resolution to the author device, despite nickname reuse', () => {
        const author = guest('SameNick'); const one = guest('WitnessA'); const two = guest('WitnessB');
        const band = guest('Drummer', 'band');
        const id = say(author, 'original author words');
        clock += 61_000; cmd(author, 'nick', ['Renamed']);
        const newcomer = guest('SameNick', 'fan', 'new-device');
        cmd(author, 'join', ['#art-original']); cam(author, '#art-original');
        cmd(newcomer, 'join', ['#art-later']); cam(newcomer, '#art-later');
        report(one, id); report(two, id);
        expect(engine._debug.conns.get(author.id).cams.size).toBe(0);
        expect(engine._debug.conns.get(author.id).camReports).toBe(2);
        expect(engine._debug.conns.get(newcomer.id).cams.has('#art-later')).toBe(true);
        expect(engine._debug.conns.get(newcomer.id).camReports || 0).toBe(0);
        cmd(band, 'mute', ['SameNick', '1m']);
        expect(engine.adminState().reports).toHaveLength(1);
        cmd(band, 'purge', ['SameNick']);
        expect(engine._debug.lines.has(id)).toBe(true);
        cmd(band, 'mute', ['Renamed', '1m']);
        expect(engine.adminState().reports).toEqual([]);
    });

    it('deleting one reported line resolves exactly its report and persists the other', () => {
        const sender = guest('Sender'); const witness = guest('Witness'); const band = guest('Drummer', 'band');
        const first = say(sender, 'first report words'); const second = say(sender, 'second report words');
        report(witness, first); report(witness, second);
        cmd(band, 'delete', [first]);
        expect(engine.adminState().reports.map((entry) => entry.id)).toEqual([second]);
        expect(saved().reports.map((entry) => entry.id)).toEqual([second]);
    });

    it('restores admin evidence without chat, and refuses approval into a recreated room after hibernation', async () => {
        const host = guest('Host'); const witness = guest('Witness');
        cmd(host, 'join', ['#old-room']); cmd(witness, 'join', ['#old-room']);
        const reportId = say(host, 'retained report evidence', '#old-room'); report(witness, reportId);
        say(host, 'you are such a loser', '#old-room');
        const stored = saved(); const heldId = stored.held[0].id;
        expect(stored.reports[0]).toMatchObject({ authorDev: 'dev-Host', devs: ['dev-Witness'] });
        const restartAt = clock;
        boot(); clock = restartAt; engine.restoreModerationQueue(stored);
        expect(engine.adminState().reports).toHaveLength(1); expect(engine.adminState().held).toHaveLength(1);
        expect(engine._debug.channels.has('#old-room')).toBe(false); expect(engine._debug.lines.size).toBe(0);
        const fan = guest('NewGuest'); const band = guest('Drummer', 'band');
        cmd(fan, 'join', ['#old-room']); cmd(band, 'approve', [heldId]); await Promise.resolve();
        expect(JSON.stringify(got(fan))).not.toContain('retained report evidence');
        expect(JSON.stringify(got(fan))).not.toContain('you are such a loser');
        expect(got(band).some((frame) => frame.t === 'notice' && /original room/.test(frame.text))).toBe(true);
        expect(engine.adminState().held).toHaveLength(1);
        cmd(fan, 'dismiss', [heldId]); expect(engine.adminState().held).toHaveLength(1);
        cmd(band, 'dismiss', [heldId]); cmd(band, 'delete', [reportId]);
        expect(saved()).toEqual({ reports: [], held: [] });
    });

    it('refuses a live held approval when the original room closed and its name was reused', () => {
        const host = guest('Host'); const band = guest('Drummer', 'band');
        cmd(host, 'join', ['#old-room']); say(host, 'you are such a loser', '#old-room');
        const id = engine.adminState().held[0].id;
        cmd(band, 'close', ['#old-room']); cmd(band, 'join', ['#old-room']);
        cmd(band, 'approve', [id]);
        expect(engine.adminState().held).toHaveLength(1);
        expect(got(band).filter((frame) => frame.t === 'line')).toEqual([]);
    });

    it('bounds both queues and expires evidence after 24 hours with a persisted deletion', () => {
        const sender = guest('Drummer', 'band'); const witness = guest('Witness'); const heldSender = guest('HeldGuest');
        for (let i = 0; i < 105; i += 1) { clock += 12000; report(witness, say(sender, `report queue words ${i}`)); }
        for (let i = 0; i < 105; i += 1) say(heldSender, `you are such a loser ${i}`);
        expect(engine.adminState().reports).toHaveLength(100); expect(engine.adminState().held).toHaveLength(100);
        // Accepted visitor reports keep their evidence when new intake is full.
        // Filter-held messages retain their existing bounded rolling behavior.
        expect(saved().reports[0].text).toBe('report queue words 0');
        expect(saved().held[0].text).toBe('you are such a loser 5');
        clock += DAY; engine.tick();
        expect(engine.adminState().reports).toEqual([]); expect(engine.adminState().held).toEqual([]);
        expect(saved()).toEqual({ reports: [], held: [] });
    });

    it('preserves accepted evidence at capacity, rejects new intake truthfully and accepts after a human dismissal', async () => {
        const sender = guest('Drummer', 'band'), witness = guest('Witness'), other = guest('OtherWitness');
        const band = guest('Reviewer', 'band'), accepted = [];
        for (let i = 0; i < 100; i += 1) {
            clock += 12000;
            const id = say(sender, `accepted report evidence ${i}`);
            await report(witness, id); accepted.push(id);
        }
        expect(saved().reports.map(entry => entry.id)).toEqual(accepted);
        const rejected = say(sender, 'new evidence after the queue reached its capacity');
        frames.set(witness.id, []);
        await report(witness, rejected);
        expect(got(witness)).toContainEqual(expect.objectContaining({ t: 'notice', kind: 'error',
            text: 'The report queue is full. Try again later or use the moderation contact in House rules.' }));
        expect(got(witness).some(frame => frame.t === 'report-status' && frame.id === rejected && frame.submitted)).toBe(false);
        expect(engine.adminState().reports.map(entry => entry.id)).toEqual(accepted);
        expect(saved().reports.map(entry => entry.id)).toEqual(accepted);
        expect(engine._debug.reports.size).toBe(100);

        clock += 12000; frames.set(witness.id, []);
        await report(witness, accepted[0]);
        expect(got(witness)).toContainEqual({ t: 'report-status', id: accepted[0], submitted: true });
        expect(engine.adminState().reports[0].count).toBe(1);
        await report(other, accepted[0]);
        expect(engine.adminState().reports[0].count).toBe(2);
        expect(engine._debug.reports.size).toBe(100);

        await cmd(band, 'dismiss', [accepted[60]]);
        expect(engine.adminState().reports).toHaveLength(99);
        clock += 12000; frames.set(witness.id, []);
        await report(witness, rejected);
        expect(got(witness)).toContainEqual({ t: 'report-status', id: rejected, submitted: true });
        const remaining = accepted.filter(id => id !== accepted[60]);
        expect(saved().reports.map(entry => entry.id)).toEqual([...remaining, rejected]);
        expect(engine._debug.reports.size).toBe(100);
        expect(saved().reports[0]).toMatchObject({ id: accepted[0], text: 'accepted report evidence 0' });
    });

    it('sanitizes restored queues and rejects malformed, expired and unbounded evidence', () => {
        const reportEntry = { id: 'mone', ch: LOBBY, from: 'Sender', text: 'valid evidence', at: clock, hidden: false,
            context: ['<Sender> valid evidence'], devs: ['device-one'], iphs: ['ip_one'], authorDev: 'author-device' };
        const heldEntry = { id: 'mtwo', ch: '#old-room', from: 'Sender', text: 'held evidence', ts: clock,
            prefix: '', band: false, me: false, reason: 'targeted insult', dev: 'author-device' };
        engine.restoreModerationQueue({ reports: [reportEntry, { ...reportEntry, id: 'mold', at: clock - DAY }, { ...reportEntry, id: 'mbad', devs: [{}] }],
            held: [{ ...heldEntry, ignored: 'drop this' }, { ...heldEntry, id: 'mfuture', ts: clock + 1 }, null] });
        expect(engine.adminState().reports.map((entry) => entry.id)).toEqual(['mone']);
        expect(saved()).toEqual({ reports: [reportEntry], held: [heldEntry] });
        const large = { reports: Array.from({ length: 105 }, (_, i) => ({ ...reportEntry, id: `mr${i}` })),
            held: Array.from({ length: 105 }, (_, i) => ({ ...heldEntry, id: `mh${i}` })) };
        engine.restoreModerationQueue(large);
        expect(saved().reports).toHaveLength(100); expect(saved().held).toHaveLength(100);
        expect(() => engine.restoreModerationQueue(null)).not.toThrow();
        expect(saved()).toEqual({ reports: [], held: [] });
    });
});
