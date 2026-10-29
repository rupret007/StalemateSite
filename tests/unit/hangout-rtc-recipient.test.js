// @vitest-environment node
// Recipient references follow existing admission/session identity contracts.
// Real engine routing uses explicit synthetic trusted identities, not Access,
// actual WebSockets, camera capture or native media transport qualification.
import { describe, expect, it } from 'vitest';
import { cleanRtc } from '../../hangout-worker/src/lobby-act.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

const ROOM = '#art-rtc-recipient';
const SENDER = 'cabcdef0123456789abcdef0123456789';
const RECIPIENT = 'c0123456789abcdef0123456789abcdef';
const PREFIX_DECOY = RECIPIENT.slice(0, 24);
const SIGNALS = [
    ['offer', { sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' } }],
    ['answer', { sdp: { type: 'answer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' } }],
    ['ICE', { ice: { candidate: 'candidate:synthetic-recipient-contract', sdpMid: '0', sdpMLineIndex: 0 } }]
];

async function roomFixture(withDecoy) {
    const frames = [];
    const engine = createLobby({ now: () => 1800000000000,
        send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }) });
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    const people = [[SENDER, 'RtcSender', 'sender'], [RECIPIENT, 'RtcRecipient', 'recipient'],
        ...(withDecoy ? [[PREFIX_DECOY, 'PrefixDecoy', 'decoy']] : [])];
    for (const [id, nick, device] of people) {
        expect(await engine.connect({ id, dev: `synthetic-${device}`, iph: `test-ip-${device}` })).toMatchObject({ ok: true });
        await message(id, { t: 'hello', nick, age13: true });
        await message(id, { t: 'cmd', ch: '#stalemate', name: 'join', args: [ROOM] });
        expect(engine._debug.channels.get(ROOM).members.has(id)).toBe(true);
    }
    await message(SENDER, { t: 'cam', ch: ROOM, on: true, adult18: true });
    expect(engine._debug.conns.get(SENDER).cams.has(ROOM)).toBe(true);
    expect(frames.some(frame => frame.recipient === SENDER && frame.t === 'cam' && frame.on === true)).toBe(true);
    frames.length = 0;
    return { engine, frames, message };
}

describe.each([['with a same-room prefix decoy', true], ['without a prefix decoy', false]])('full admitted RTC recipient %s', (_label, decoy) => {
    it.each(SIGNALS)('routes %s only to the complete 33-character recipient', async (_kind, signal) => {
        expect(RECIPIENT).toHaveLength(33); expect(PREFIX_DECOY).toHaveLength(24);
        const f = await roomFixture(decoy);
        await f.message(SENDER, { t: 'act', ch: ROOM, kind: 'rtc', to: RECIPIENT, ...signal });
        const delivered = f.frames.filter(frame => frame.t === 'act' && frame.kind === 'rtc');
        expect(delivered.map(frame => frame.recipient)).toEqual([RECIPIENT]);
        expect(delivered[0]).toMatchObject({ from: SENDER, ch: ROOM, ...signal });
        expect(f.frames.some(frame => frame.recipient === PREFIX_DECOY && frame.kind === 'rtc')).toBe(false);
    });
});

describe('RTC recipient reference validation', () => {
    it.each([
        ['one character', 'x'],
        ['existing 24-character reference', PREFIX_DECOY],
        ['actual gateway shape', RECIPIENT],
        ['hyphenated UUID', '01234567-89ab-cdef-0123-456789abcdef'],
        ['existing 128-character boundary', 'A0_-'.repeat(32)]
    ])('preserves the exact %s for SDP and ICE', (_label, to) => {
        for (const [, signal] of SIGNALS) expect(cleanRtc({ to, ...signal })).toEqual({ to, ...signal });
    });

    it.each([
        ['missing', undefined], ['null', null], ['number', 123], ['boolean', true], ['array', [RECIPIENT]],
        ['object', { id: RECIPIENT }], ['boxed string', new String(RECIPIENT)], ['empty', ''],
        ['129 characters', 'A'.repeat(129)], ['leading space', ` ${RECIPIENT}`], ['trailing space', `${RECIPIENT} `],
        ['interior space', 'valid recipient'], ['trailing LF', `${RECIPIENT}\n`], ['trailing CR', `${RECIPIENT}\r`],
        ['tab', 'valid\trecipient'], ['NUL', 'valid\0recipient'], ['slash', 'valid/recipient'],
        ['percent encoding', 'valid%20recipient'], ['non-ASCII', 'récipient']
    ])('refuses %s rather than normalizing or truncating an alias', (_label, to) => {
        for (const [, signal] of SIGNALS) expect(cleanRtc({ to, ...signal })).toBeNull();
    });

    it.each(SIGNALS)('never routes oversized %s to an admitted prefix decoy', async (_kind, signal) => {
        const f = await roomFixture(true), to = RECIPIENT + 'Z'.repeat(129 - RECIPIENT.length);
        await f.message(SENDER, { t: 'act', ch: ROOM, kind: 'rtc', to, ...signal });
        expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
    });

    it('retains the existing SDP and ICE payload ceilings', () => {
        expect(cleanRtc({ to: RECIPIENT, sdp: { type: 'offer', sdp: 'x'.repeat(16001) } })).toBeNull();
        expect(cleanRtc({ to: RECIPIENT, ice: { candidate: 'x'.repeat(1201) } })).toBeNull();
    });
});
