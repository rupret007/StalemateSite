// @vitest-environment node
// Core-only regression: intentionally imports modules that existed in39db, so
// the archived baseline failure is missing provenance rather than a new import.
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { receiptDigest } from '../../hangout-worker/src/message-receipts.mjs';

function fixture() {
    let at = 1800000000000, queue = { reports: [], held: [] };
    const frames = [], make = () => createLobby({ now: () => at, incidentSources: true, limits: { defaultSlow: 0 },
        send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }),
        persist: (kind, value) => { if (kind === 'moderation-queue') queue = structuredClone(value); } });
    const engine = make();
    const identities = [{ id: 'author', dev: 'author_device', iph: 'author_ip', role: 'band', admin: true },
        { id: 'reader', dev: 'reader_device', iph: 'reader_ip' }];
    const message = async (who, value) => { at += 1000; await engine.message(who, JSON.stringify(value)); };
    const command = (name, args) => message('author', { t: 'cmd', name, args, ch: '#chat-origin' });
    const say = async text => { const offset = frames.length; await message('author', { t: 'say', ch: '#chat-origin', text }); return frames.slice(offset).find(frame => frame.t === 'line'); };
    return { engine, identities, frames, make, message, command, say, queue: () => queue };
}
async function join(f) {
    for (const [index, identity] of f.identities.entries()) {
        await f.engine.connect(identity); await f.message(identity.id, { t: 'hello', nick: index ? 'Reader' : 'Author', age13: true });
        await f.message(identity.id, { t: 'cmd', name: 'join', args: ['#chat-origin'] });
    }
}
describe('original public delivery report provenance', () => {
    it('records accepted public delivery before invite-only transition, never a browser assertion or current-room guess', async () => {
        const f = fixture(); await join(f); const first = await f.say('Benign public original delivery');
        await f.command('mode', ['+i']); await f.message('reader', { t: 'report', id: first.id, publicOrigin: { v: 1, at: 1 } });
        expect(f.queue().reports[0].publicOrigin).toEqual({ v: 1, at: first.ts });
        expect(first).not.toHaveProperty('publicOrigin');
        const privateLine = await f.say('Benign invite-only original delivery'); await f.command('mode', ['-i']);
        await f.message('reader', { t: 'report', id: privateLine.id, publicOrigin: { v: 1, at: privateLine.ts } });
        expect(f.queue().reports.find(row => row.id === privateLine.id)).not.toHaveProperty('publicOrigin');
    });
    it('binds the optional delivery stamp into persisted receipt digest and preserves it through same-socket restoration', async () => {
        const f = fixture(); await join(f); const line = await f.say('Benign public receipt selection');
        const sessions = f.engine.sessionSnapshot(), receipt = sessions.receipts.find(row => row.id === line.id);
        expect(receipt.publicOrigin).toEqual({ v: 1, at: line.ts });
        expect(receipt.digest).toBe(receiptDigest(receipt, receipt.authorDev, line.text));
        expect(receipt.digest).not.toBe(receiptDigest({ ...receipt, publicOrigin: undefined }, receipt.authorDev, line.text));
        const restored = f.make(); await restored.restoreRooms(f.engine.roomSnapshot());
        expect(restored.restoreSessions(sessions, f.identities).rejected).toEqual([]);
        await restored.message('reader', JSON.stringify({ t: 'report', id: line.id, text: line.text }));
        expect(f.queue().reports[0].publicOrigin).toEqual(receipt.publicOrigin);
    });
});
