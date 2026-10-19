// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const S = require('../../r/45662413410ed051/private-snapshot.js');
const subtle = webcrypto.subtle;
const clone = value => JSON.parse(JSON.stringify(value));
let keys, savedLock, savedVideo, savedClear;

async function sign(body) {
    const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
        new TextEncoder().encode(JSON.stringify(body)));
    return { type: 'host', body, sig: Buffer.from(signature).toString('base64url') };
}

async function verifyHost(signed) {
    return signed.type === 'host' && subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey,
        Buffer.from(signed.sig, 'base64url'), new TextEncoder().encode(JSON.stringify(signed.body)));
}

const stroke = (id = 'stroke-1', points = 3) => ({ id, color: '#171410', size: 4,
    pts: Array.from({ length: points }, () => [0.1234, 0.5678]) });
const input = overrides => ({ to: 'peer_1', request: S.nonce(webcrypto), seq: 10, epoch: 0,
    clear: null, strokes: [stroke()], video: null, mods: [], ...overrides });
const context = data => ({ to: data.to, request: data.request, seqFloor: 0 });
const make = data => S.makeChunks(data, { crypto: webcrypto });
async function signedPart(part, seq = 10) {
    return { ...part, lastHostSeqSigned: await sign(await S.proofBody(part, seq, subtle)) };
}
const verifiedPart = (part, ctx) => S.verifyPart(part, ctx, verifyHost, subtle);

beforeAll(async () => {
    keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    savedLock = await sign({ kind: 'lock', seq: 3, on: true });
    savedVideo = { signed: await sign({ kind: 'video', seq: 9,
        source: { kind: 'yt', id: 'BtnyqIHTDMM' }, playing: false, pos: 21, t: 1000 }), t: 1000 };
    savedClear = await sign({ kind: 'clear', seq: 5 });
});

describe('fresh private snapshot attestations', () => {
    it('uses a bounded request nonce and rejects malformed nonce values', () => {
        const request = S.nonce({ getRandomValues: bytes => bytes.fill(255) });
        expect(request).toBe('_'.repeat(24));
        expect(S.validNonce(request)).toBe(true);
        for (const invalid of ['', '_'.repeat(23), '_'.repeat(25), 'é'.repeat(24), null, {}]) {
            expect(S.validNonce(invalid)).toBe(false);
        }
    });

    it('captures immutable long strokes and signed controls synchronously within the part budget', () => {
        const data = input({ epoch: 5, clear: savedClear,
            strokes: Array.from({ length: 10 }, (_, index) => stroke('long-' + index, 3200)),
            video: clone(savedVideo), mods: [savedLock], chat: ['must never be copied'] });
        const parts = make(data);
        expect(parts.length).toBeGreaterThan(1);
        data.strokes[0].pts[0][0] = 1;
        data.video.signed.body.pos = 999;
        expect(parts[0].strokes[0].pts[0][0]).toBe(0.1234);
        expect(parts.at(-1).video.signed.body.pos).toBe(21);
        for (const [index, part] of parts.entries()) {
            expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(S.LIMITS.partBytes);
            expect(part.part).toBe(index);
            expect(part.parts).toBe(parts.length);
            expect(Object.hasOwn(part, 'chat')).toBe(false);
            expect(Object.isFrozen(part.strokes[0].pts[0])).toBe(true);
            if (!part.done) expect([part.video, part.mods]).toEqual([null, []]);
        }
        expect(parts.flatMap(part => part.strokes).map(item => item.pts.length)).toEqual(Array(10).fill(3200));
    });

    it('assembles genuine signed parts out of order, preserving older attested lock state and original signatures', async () => {
        const video = clone(savedVideo);
        const data = input({ epoch: 5, clear: savedClear, video, mods: [savedLock],
            strokes: Array.from({ length: 8 }, (_, index) => stroke('long-' + index, 3200)) });
        const ctx = { ...context(data), seqFloor: 8 };
        const parts = await Promise.all(make(data).map(async part => verifiedPart(await signedPart(part), ctx)));
        const assembly = S.createAssembly(ctx);
        let snapshot;
        for (const [index, part] of parts.toReversed().entries()) {
            snapshot = assembly.add(part);
            if (index < parts.length - 1) expect(snapshot).toBeNull();
        }
        expect(snapshot.strokes.map(item => item.id)).toEqual(data.strokes.map(item => item.id));
        expect(snapshot.seq).toBe(10);
        expect(snapshot.trusted).toBe(true);
        expect(snapshot.epoch).toBe(5);
        expect(snapshot.mods[0].body.seq).toBe(3);
        expect(snapshot.video.signed.body.pos).toBe(21);
        expect(await verifyHost(snapshot.mods[0])).toBe(true);
        expect(await verifyHost(snapshot.video.signed)).toBe(true);
        expect(Object.isFrozen(snapshot.strokes)).toBe(true);
        expect(assembly.add(parts[0])).toBeNull(); // Duplicate cannot cause a second commit.
        expect(assembly.finish()).toBe(snapshot);
    });

    it('does not expose incomplete state or mutate the caller replay floor', async () => {
        const data = input({ strokes: Array.from({ length: 8 }, (_, index) => stroke('missing-' + index, 3200)) });
        const ctx = context(data);
        const parts = make(data);
        expect(parts.length).toBeGreaterThan(1);
        const assembly = S.createAssembly(ctx);
        expect(assembly.add(await verifiedPart(await signedPart(parts[0]), ctx))).toBeNull();
        expect(assembly.finish()).toBeNull();
        expect(ctx.seqFloor).toBe(0);
    });

    it.each([
        ['strokes', message => { message.strokes[0].pts[0][0] = 0.8; }],
        ['video', message => { message.video.signed.body.pos = 123; }],
        ['embedded signing key order', message => {
            message.video.signed.body = Object.fromEntries(Object.entries(message.video.signed.body).reverse());
        }],
        ['persistent control', message => { message.mods[0].body.on = false; }],
        ['drawing epoch', message => { message.epoch = 4; }],
        ['clear proof', message => { message.clear.body.seq = 4; }],
        ['target', message => { message.to = 'different_peer'; }],
        ['request nonce', message => { message.request = 'A'.repeat(24); }],
        ['batch identity', message => { message.batch = 'B'.repeat(24); }],
        ['chunk flags', message => { message.first = false; }],
        ['chat field', message => { message.chat = [{ text: 'legacy backlog' }]; }]
    ])('rejects %s tampering before assembly', async (_, mutate) => {
        const video = { signed: await sign({ kind: 'video', seq: 9,
            source: { kind: 'yt', id: 'BtnyqIHTDMM' }, playing: false, pos: 21, t: 1000 }), t: 1000 };
        const data = input({ epoch: 5, clear: savedClear, video, mods: [savedLock] });
        const message = clone(await signedPart(make(data)[0]));
        mutate(message);
        await expect(verifiedPart(message, context(data))).rejects.toThrow('Invalid private snapshot');
    });

    it('rejects old replay floors, other contexts, forged signatures and sequence substitution', async () => {
        const data = input();
        const message = clone(await signedPart(make(data)[0]));
        for (const ctx of [{ ...context(data), seqFloor: 11 }, { ...context(data), to: 'another_peer' },
            { ...context(data), request: 'Z'.repeat(24) }]) {
            await expect(verifiedPart(message, ctx)).rejects.toThrow();
        }
        const forged = clone(message);
        const signature = Buffer.from(forged.lastHostSeqSigned.sig, 'base64url');
        signature[0] ^= 1;
        forged.lastHostSeqSigned.sig = signature.toString('base64url');
        await expect(verifiedPart(forged, context(data))).rejects.toThrow();
        const changedSeq = clone(message);
        changedSeq.lastHostSeqSigned.body.seq += 1;
        await expect(verifiedPart(changedSeq, context(data))).rejects.toThrow();
    });

    it('freezes the verified copy before an asynchronous verifier can see caller mutation', async () => {
        const data = input();
        const message = clone(await signedPart(make(data)[0]));
        let release, started;
        const ready = new Promise(resolve => { started = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const pending = S.verifyPart(message, context(data), async signed => {
            started(); await gate; return verifyHost(signed);
        }, subtle);
        await ready;
        message.strokes[0].pts[0][0] = 0.9;
        message.lastHostSeqSigned.body.seq = 999;
        release();
        const part = await pending;
        expect(part.strokes[0].pts[0][0]).toBe(0.1234);
        expect(part.lastHostSeqSigned.body.seq).toBe(10);
    });

    it('bounds the outer attestation before invoking the signature verifier', async () => {
        const data = input(), original = await signedPart(make(data)[0]);
        let calls = 0;
        const verifier = async () => { calls += 1; return true; };
        for (const mutate of [
            proof => { proof.body.extra = 'x'.repeat(S.LIMITS.controlBytes); },
            proof => { proof.sig = 'A'.repeat(S.LIMITS.controlBytes); },
            proof => { proof.extra = true; },
            proof => { proof.type = 'different-envelope'; }
        ]) {
            const message = clone(original); mutate(message.lastHostSeqSigned);
            await expect(S.verifyPart(message, context(data), verifier, subtle)).rejects.toThrow();
        }
        expect(calls).toBe(0);
    });

    it('rejects unverified parts and latches conflicting duplicates even when both signatures are genuine', async () => {
        const data = input({ strokes: Array.from({ length: 8 }, (_, index) => stroke('duplicate-' + index, 3200)) });
        const parts = make(data), ctx = context(data);
        const unverified = S.createAssembly(ctx);
        expect(() => unverified.add(parts[0])).toThrow();
        const assembly = S.createAssembly(ctx);
        const first = await verifiedPart(await signedPart(parts[0]), ctx);
        expect(assembly.add(first)).toBeNull();
        expect(assembly.add(first)).toBeNull();
        const conflict = clone(parts[0]); conflict.strokes[0].pts[0][0] = 0.8;
        const verifiedConflict = await verifiedPart(await signedPart(conflict), ctx);
        expect(() => assembly.add(verifiedConflict)).toThrow();
        expect(assembly.finish()).toBeNull();
    });

    it('rejects mixing batches or sequence barriers, without promoting a partial snapshot', async () => {
        for (const change of [part => { part.batch = 'Q'.repeat(24); }, () => {}]) {
            const data = input({ strokes: Array.from({ length: 8 }, (_, index) => stroke('mixed-' + index, 3200)) });
            const parts = make(data), ctx = context(data), assembly = S.createAssembly(ctx);
            assembly.add(await verifiedPart(await signedPart(parts[0]), ctx));
            const other = clone(parts[1]); change(other);
            const seq = other.batch === parts[1].batch ? 11 : 10;
            other.seq = seq;
            const verifiedOther = await verifiedPart(await signedPart(other, seq), ctx);
            expect(() => assembly.add(verifiedOther)).toThrow();
            expect(assembly.finish()).toBeNull();
        }
    });

    it('rejects oversized geometry and aggregate stroke counts instead of silently truncating', async () => {
        expect(() => make(input({ strokes: [stroke('too-long', 3201)] }))).toThrow();
        expect(() => make(input({ strokes: Array.from({ length: 1501 }, (_, i) => stroke('many-' + i, 1)) }))).toThrow();
        const data = input(), template = make(data)[0], ctx = context(data), assembly = S.createAssembly(ctx);
        for (let index = 0; index < 16; index += 1) {
            const part = { ...template, part: index, parts: 16, first: index === 0, done: index === 15,
                chunk: true, strokes: Array.from({ length: 100 }, (_, i) => stroke('bounded-' + index + '-' + i, 1)) };
            const valid = await verifiedPart(await signedPart(part), ctx);
            if (index < 15) expect(assembly.add(valid)).toBeNull();
            else expect(() => assembly.add(valid)).toThrow();
        }
        expect(assembly.finish()).toBeNull();
    });

    it('preserves the hundred-stroke multipart boundary even for short geometry', () => {
        const parts = make(input({ strokes: Array.from({ length: 150 }, (_, i) => stroke('short-' + i, 1)) }));
        expect(parts.map(part => part.strokes.length)).toEqual([100, 50]);
        expect(parts.map(part => [part.first, part.done])).toEqual([[true, false], [false, true]]);
    });

    it('assembles peer-only drawing without treating its unsigned sequence as a host proof', () => {
        const data = input({ strokes: Array.from({ length: 105 }, (_, i) => stroke('peer-' + i, 1)) });
        const ctx = { ...context(data), seqFloor: 999, peer: true };
        const parts = make(data).map(part => S.parsePeerPart(part, ctx));
        const assembly = S.createAssembly(ctx);
        expect(assembly.add(parts[1])).toBeNull();
        const snapshot = assembly.add(parts[0]);
        expect(snapshot.trusted).toBe(false);
        expect(snapshot.seq).toBe(10);
        expect(snapshot.strokes).toHaveLength(105);
        expect(ctx.seqFloor).toBe(999);
        expect(assembly.add(parts[0])).toBeNull();
    });

    it('keeps peer and authenticated brands separate even for identical drawing payloads', async () => {
        const data = input(), ctx = context(data), raw = make(data)[0];
        const host = await verifiedPart(await signedPart(raw), ctx);
        const guest = S.parsePeerPart(raw, ctx);
        expect(() => S.createAssembly(ctx).add(guest)).toThrow();
        expect(() => S.createAssembly({ ...ctx, peer: true }).add(host)).toThrow();
        expect(() => S.createAssembly({ ...ctx, peer: true }).add(raw)).toThrow();
    });

    it('enforces known drawing epochs and peer context without granting unsigned controls authority', async () => {
        const data = input({ epoch: 5, clear: savedClear, video: savedVideo, mods: [savedLock] });
        const raw = make(data)[0], ctx = { ...context(data), epochFloor: 5 };
        const snapshot = S.createAssembly({ ...ctx, peer: true }).add(S.parsePeerPart(raw, ctx));
        expect(snapshot.trusted).toBe(false);
        expect(snapshot.mods[0].body.seq).toBe(3);
        for (const badCtx of [{ ...ctx, epochFloor: 6 }, { ...ctx, to: 'different_peer' },
            { ...ctx, request: 'N'.repeat(24) }]) {
            expect(() => S.parsePeerPart(raw, badCtx)).toThrow();
        }
        await expect(verifiedPart(await signedPart(raw), { ...ctx, epochFloor: 6 })).rejects.toThrow();
        const signed = await verifiedPart(await signedPart(raw), ctx);
        expect(() => S.createAssembly({ ...ctx, epochFloor: 6 }).add(signed)).toThrow();
    });
});
