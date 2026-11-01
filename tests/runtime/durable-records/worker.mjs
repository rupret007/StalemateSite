// Local workerd qualification fixture only. No production route, authority,
// provider start, credentials or externally reachable service is introduced.
import { createDurableRecordStorage, DURABLE_RECORD_CEILINGS } from '../../../hangout-worker/src/durable-record-storage.mjs';

const enc = new TextEncoder(), NAMESPACE = 'runtime-proof', MIB = 1024 * 1024;
const PREFIX = `durable-record:v1:${NAMESPACE}:`, BASELINE = 'recovery:baseline', UNCOMMITTED = 'recovery:uncommitted', COUNTER = 'recovery:counter', MULTICHUNK = 'recovery:multichunk';
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const hex = value => [...value].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const manifestKey = key => `${PREFIX}manifest:${hex(key)}`;
const partPrefix = key => `${PREFIX}part:${hex(key)}:`;
const partKey = (key, index) => `${partPrefix(key)}${String(index).padStart(4, '0')}`;
const assert = (condition, reason) => { if (!condition) throw Error(reason); };
const same = (actual, expected, reason) => assert(JSON.stringify(actual) === JSON.stringify(expected), reason);
const baseline = nonce => ({ version: 1, nonce, value: 'synthetic baseline committed before crash' });
const largeValue = () => {
    const unit = '🎸 café e\u0301\n';
    return { kind: 'synthetic-runtime', text: unit.repeat(Math.ceil(3 * MIB / enc.encode(unit).byteLength)) };
};
const response = (value, status = 200) => Response.json(value, { status });

export class RecordFixture {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }

    store({ failAfterPart = 0, observe = null } = {}) {
        const native = this.ctx.storage;
        return createDurableRecordStorage({ namespace: NAMESPACE, maxRecordBytes: 4 * MIB,
            storage: { transaction: operation => native.transaction(async tx => {
                let parts = 0;
                return operation({
                    get: key => tx.get(key),
                    delete: key => tx.delete(key),
                    list: options => { observe?.(options); return tx.list(options); },
                    put: async (key, value) => {
                        await tx.put(key, value);
                        // Fault follows an ACTUAL staged write; it is not a
                        // substitute storage implementation or pre-write veto.
                        if (failAfterPart && key.startsWith(`${PREFIX}part:`) && ++parts === failAfterPart)
                            throw Error('synthetic-mid-chunk-failure');
                    }
                });
            }) }
        });
    }

    async fetch(request) {
        const checks = [];
        let phase = 'invalid', nonce = '';
        const objectId = this.ctx.id.toString();
        try {
            const deny = () => response({ ok: false, phase: 'invalid', objectId, error: 'local-fixture-request-denied' }, 403);
            // Loopback is not authentication. No browser-origin request or
            // mismatched runner nonce may touch SQL, storage or phase effects.
            if (request.method !== 'POST' || request.headers.has('Origin') || request.headers.get('Content-Type') !== 'application/json'
                || typeof this.env.FIXTURE_NONCE !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(this.env.FIXTURE_NONCE)) return deny();
            const reader = request.body?.getReader();
            assert(reader, 'json-body-required');
            const chunks = []; let bytes = 0;
            while (true) {
                const part = await reader.read(); if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 512) { await reader.cancel(); throw Error('bounded-body-required'); }
                chunks.push(part.value);
            }
            const bodyBytes = new Uint8Array(bytes); let offset = 0;
            for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
            const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes));
            assert(body && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 2
                && Object.hasOwn(body, 'phase') && Object.hasOwn(body, 'nonce'), 'exact-phase-nonce-required');
            ({ phase, nonce } = body);
            if (nonce !== this.env.FIXTURE_NONCE) return deny();
            assert(['qualify', 'increment', 'crash', 'recover'].includes(phase), 'unknown-phase');
            assert(typeof nonce === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(nonce), 'bounded-nonce-required');
            assert(this.ctx.storage.sql && typeof this.ctx.storage.sql.exec === 'function', 'actual-sqlite-required');
            const schema = [...this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name LIMIT 32")].map(row => row.name);
            const sqlite = { enabled: true, schemaTables: schema };
            const store = this.store(), read = key => store.transaction(tx => tx.get(key));
            const check = (name, details = {}) => checks.push({ name, pass: true, ...details });
            const verifyCommittedMultichunk = async () => {
                const expected = largeValue(), original = enc.encode(JSON.stringify(expected)), actual = await read(MULTICHUNK);
                same(actual, expected, 'committed-multichunk-content-mismatch');
                const received = enc.encode(JSON.stringify(actual)), expectedDigest = await sha(original);
                assert(received.byteLength === original.byteLength && await sha(received) === expectedDigest, 'committed-multichunk-digest-mismatch');
                return { bytes: original.byteLength, sha256: expectedDigest };
            };
            const verifyOrdinaryRollbacks = async () => {
                // Reopen in a fresh runtime before accepting earlier thrown
                // and deliberately caught failures as durable rollbacks.
                same(await read('atomic:baseline'), { stable: true }, 'ordinary-rollback-baseline-lost-on-reopen');
                assert(await read('atomic:failed') === undefined && await read('atomic:authority') === undefined,
                    'ordinary-failed-write-survived-on-reopen');
            };

            if (phase === 'increment') {
                same(await read(BASELINE), baseline(nonce), 'counter-requires-committed-baseline');
                const counter = await store.transaction(async tx => {
                    const current = await tx.get(COUNTER);
                    assert(Number.isSafeInteger(current) && current >= 0 && current < 8, 'counter-out-of-range');
                    // No host mutex and no transactionSync. Actual DO storage
                    // owns the read/await/write serialization and any retries.
                    await Promise.resolve(); await Promise.resolve();
                    await tx.put(COUNTER, current + 1);
                    return current + 1;
                });
                check('actual-async-counter-transaction', { counter });
                return response({ ok: true, phase, nonce, objectId, sqlite, checks, counter });
            }

            if (phase === 'crash') {
                assert(this.env.GATE && typeof this.env.GATE.fetch === 'function', 'local-never-resolving-gate-required');
                same(await read(BASELINE), baseline(nonce), 'crash-requires-original-baseline');
                await verifyOrdinaryRollbacks();
                // This phase runs in a fresh process: reconstruct the complete
                // committed large value before staging any crash mutation.
                await verifyCommittedMultichunk();
                assert(await read(UNCOMMITTED) === undefined, 'crash-key-already-present');
                await store.transaction(async tx => {
                    await tx.put(BASELINE, { version: 1, nonce, value: 'uncommitted overwrite must disappear' });
                    // Shrinking stages deletion of the committed surplus
                    // chunks. A killed transaction must restore every chunk.
                    await tx.put(MULTICHUNK, { nonce, value: 'small uncommitted replacement' });
                    await tx.put(UNCOMMITTED, { nonce, value: 'synthetic uncommitted chunk '.repeat(8000) });
                    console.log(`WEBJAM_DURABLE_STAGED:${nonce}`);
                    // Parent kills only its owned workerd process group after
                    // this marker. GATE is a local never-resolving service.
                    await this.env.GATE.fetch('http://test-gate.invalid');
                    throw Error('crash-gate-returned-without-runtime-termination');
                });
                throw Error('crash-transaction-returned');
            }

            if (phase === 'recover') {
                same(await read(BASELINE), baseline(nonce), 'committed-baseline-lost-after-runtime-kill');
                await verifyOrdinaryRollbacks();
                check('committed-baseline-survives-runtime-kill');
                assert(await read(UNCOMMITTED) === undefined, 'uncommitted-record-survived-runtime-kill');
                check('uncommitted-overwrite-and-new-record-rolled-back');
                const multiRecord = await verifyCommittedMultichunk();
                check('committed-multichunk-record-survives-runtime-kill', multiRecord);
                const counter = await read(COUNTER);
                assert(Number.isSafeInteger(counter) && counter >= 0 && counter <= 8, 'recovered-counter-invalid');
                // Runner separately requires eight completed concurrent calls
                // and exactly 8 here; a worker response alone is not that proof.
                return response({ ok: true, phase, nonce, objectId, sqlite, checks, counter, multiRecord });
            }

            // Runner routes ALL global fetches to its local deny service. This
            // reserved-name probe carries no real provider or sensitive data.
            const deniedEgress = await fetch('https://webjam-runtime-egress.invalid/', { redirect: 'manual' });
            assert(deniedEgress.status === 503 && deniedEgress.headers.get('X-WebJam-Test-Egress') === 'denied', 'outbound-egress-was-not-denied');
            await deniedEgress.body?.cancel();
            check('outbound-egress-denied');

            assert(await read(BASELINE) === undefined, 'qualification-already-seeded-use-fresh-owned-runtime');
            const rawKey = `synthetic-raw-limit:${nonce}`;
            const rawValue = 'x'.repeat(3 * MIB);
            let rawRefused = false, rawError = '';
            try { await this.ctx.storage.transaction(tx => tx.put(rawKey, rawValue)); }
            catch (error) { rawRefused = true; rawError = String(error?.message || error).slice(0, 240); }
            if (rawRefused) assert(await this.ctx.storage.get(rawKey) === undefined, 'refused-raw-value-was-persisted');
            else {
                const stored = await this.ctx.storage.get(rawKey);
                assert(typeof stored === 'string' && stored.length === rawValue.length && stored === rawValue, 'accepted-raw-value-roundtrip-mismatch');
                await this.ctx.storage.delete(rawKey);
                assert(await this.ctx.storage.get(rawKey) === undefined, 'accepted-raw-value-cleanup-failed');
            }
            // The pinned local runtime does not enforce the hosted raw-value
            // ceiling. Preserve the observation separately, never as a PASS.
            const sizeProbe = { attemptedBytes: 3 * MIB, nativeRejected: rawRefused, error: rawError, rawOversizeAccepted: !rawRefused,
                hostedLimitQualified: false, hostedLimitStatus: 'unsupported-by-pinned-local-runtime' };

            const value = largeValue();
            const encoded = enc.encode(JSON.stringify(value)), expectedDigest = await sha(encoded);
            assert(encoded.byteLength >= 3 * MIB && encoded.byteLength <= 4 * MIB, 'utf8-proof-size-out-of-range');
            const lists = [], observed = this.store({ observe: options => lists.push({ ...options }) });
            await observed.transaction(tx => tx.put('roundtrip:utf8', value));
            const actual = await observed.transaction(tx => tx.get('roundtrip:utf8'));
            same(actual, value, 'strict-utf8-roundtrip-mismatch');
            assert(await sha(enc.encode(JSON.stringify(actual))) === expectedDigest, 'strict-utf8-digest-mismatch');
            const metadata = await this.ctx.storage.get(manifestKey('roundtrip:utf8'));
            const parts = await this.ctx.storage.list({ prefix: partPrefix('roundtrip:utf8'), limit: 65 });
            assert(metadata.bytes === encoded.byteLength && metadata.sha256 === expectedDigest && parts.size === metadata.chunks, 'physical-manifest-mismatch');
            let index = 0, physicalBytes = 0;
            for (const [key, part] of parts) {
                assert(key === partKey('roundtrip:utf8', index) && part instanceof Uint8Array
                    && part.byteLength === Math.min(DURABLE_RECORD_CEILINGS.chunkBytes, encoded.byteLength - physicalBytes), 'physical-chunk-bound-or-order');
                physicalBytes += part.byteLength; index++;
            }
            assert(physicalBytes === encoded.byteLength && parts.size > 1, 'physical-chunk-total-mismatch');
            assert(lists.length > 1 && lists.every(options => options.limit <= 4), 'codec-physical-page-bound');
            const record = { bytes: encoded.byteLength, sha256: expectedDigest, chunks: parts.size, chunkBytes: DURABLE_RECORD_CEILINGS.chunkBytes };
            check('utf8-chunk-roundtrip', record);

            await store.transaction(tx => tx.put('atomic:baseline', { stable: true }));
            for (const caught of [false, true]) {
                const faulty = this.store({ failAfterPart: 3 }); // baseline part, then two new record parts
                let denied = false;
                try {
                    await faulty.transaction(async tx => {
                        await tx.put('atomic:baseline', { stable: false });
                        if (caught) { try { await tx.put('atomic:failed', value); } catch { /* deliberately caught by caller */ } }
                        else await tx.put('atomic:failed', value);
                        return 'caller-must-not-acknowledge';
                    });
                } catch (error) { denied = error?.message === 'synthetic-mid-chunk-failure'; }
                assert(denied, caught ? 'caught-storage-failure-acknowledged' : 'mid-chunk-failure-not-propagated');
                same(await read('atomic:baseline'), { stable: true }, 'earlier-baseline-write-not-rolled-back');
                assert(await read('atomic:failed') === undefined, 'failed-record-or-orphans-survived');
                check(caught ? 'caught-failure-poisons-transaction' : 'mid-chunk-rollback');
            }

            let authorityDenied = false;
            try {
                await store.transaction(async tx => {
                    await tx.put('atomic:baseline', { stable: false }); await tx.put('atomic:authority', { synthetic: 'no real appointment' });
                    await Promise.resolve();
                    throw Error('synthetic-final-authority-denied');
                });
            } catch (error) { authorityDenied = error?.message === 'synthetic-final-authority-denied'; }
            assert(authorityDenied, 'final-authority-denial-was-acknowledged');
            same(await read('atomic:baseline'), { stable: true }, 'final-authority-baseline-not-rolled-back');
            assert(await read('atomic:authority') === undefined, 'final-authority-write-survived');
            check('final-authority-rollback');

            await store.transaction(tx => tx.put('roundtrip:utf8', { small: true }));
            assert((await this.ctx.storage.list({ prefix: partPrefix('roundtrip:utf8'), limit: 65 })).size === 1, 'shrink-left-surplus-parts');
            same(await read('roundtrip:utf8'), { small: true }, 'shrunken-record-mismatch');
            await store.transaction(tx => tx.delete('roundtrip:utf8'));
            assert(await this.ctx.storage.get(manifestKey('roundtrip:utf8')) === undefined
                && (await this.ctx.storage.list({ prefix: partPrefix('roundtrip:utf8'), limit: 65 })).size === 0, 'delete-left-physical-orphans');
            check('shrink-delete-no-orphans');

            await store.transaction(tx => tx.put('corruption:record', { synthetic: 'digest corruption control' }));
            const saved = await this.ctx.storage.get(partKey('corruption:record', 0)), corrupted = saved.slice(); corrupted[0] ^= 1;
            await this.ctx.storage.put(partKey('corruption:record', 0), corrupted);
            let corruptDenied = false;
            try { await read('corruption:record'); } catch (error) { corruptDenied = error?.message === 'storage-corrupt'; }
            assert(corruptDenied, 'corrupt-record-not-denied');
            await this.ctx.storage.put(partKey('corruption:record', 0), saved);
            await store.transaction(tx => tx.delete('corruption:record'));
            check('corruption-denied');

            await store.transaction(async tx => { for (let n = 0; n < 5; n++) await tx.put(`pagination:${n}`, { n }); });
            const first = await store.transaction(tx => tx.list({ prefix: 'pagination:', limit: 4 }));
            const second = await store.transaction(tx => tx.list({ prefix: 'pagination:', startAfter: [...first.keys()].at(-1), limit: 4 }));
            same([...first.keys()], ['pagination:0', 'pagination:1', 'pagination:2', 'pagination:3'], 'first-page-mismatch');
            same([...second.keys()], ['pagination:4'], 'second-page-mismatch');
            same([...first.values(), ...second.values()], Array.from({ length: 5 }, (_, n) => ({ n })), 'pagination-values-mismatch');
            check('bounded-prefix-pagination', { first: first.size, second: second.size });

            await store.transaction(async tx => { await tx.put(BASELINE, baseline(nonce)); await tx.put(COUNTER, 0); await tx.put(MULTICHUNK, value); });
            same(await read(BASELINE), baseline(nonce), 'committed-recovery-baseline-mismatch');
            same(await verifyCommittedMultichunk(), { bytes: record.bytes, sha256: record.sha256 }, 'committed-recovery-multichunk-mismatch');
            assert(await read(UNCOMMITTED) === undefined && await read(COUNTER) === 0, 'fresh-recovery-records-invalid');
            check('recovery-baseline-committed');
            return response({ ok: true, phase, nonce, objectId, sqlite, checks, record, sizeProbe,
                scope: 'Local SQLite workerd record mapping only; no production authority, hosted rollout, native audio or release qualification.' });
        } catch (error) {
            return response({ ok: false, phase, nonce, objectId, checks, error: String(error?.message || error).slice(0, 512) }, 500);
        }
    }
}

export default {
    fetch(request, env) { return env.RECORDS.get(env.RECORDS.idFromName('fixture')).fetch(request); }
};
