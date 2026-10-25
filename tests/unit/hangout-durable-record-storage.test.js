// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createDurableRecordStorage, DURABLE_RECORD_CEILINGS } from '../../hangout-worker/src/durable-record-storage.mjs';
import { createIncidentCases, createIncidentEvidenceCipher, incidentEvidenceDigest, initialIncidentCaseState } from '../../hangout-worker/src/incident-cases.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const fixtures = [];
async function fixture({ maxRecordBytes = 1024 * 1024, namespace = 'disk-test', hooks = {} } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'hangout-record-test-'));
    const filename = join(directory, 'records.sqlite');
    const driver = openDurableRecordSqlite(filename, hooks);
    const cleanup = { directory, drivers: [driver] };
    fixtures.push(cleanup);
    const create = () => createDurableRecordStorage({ storage: driver, namespace, maxRecordBytes });
    return { directory, filename, driver, store: create(), create, hooks, cleanup };
}
afterEach(async () => {
    for (const { directory, drivers } of fixtures.splice(0)) {
        for (const driver of drivers) await driver.close();
        await rm(directory, { recursive: true, force: true });
    }
});
const read = (f, key) => f.store.transaction(tx => tx.get(key));
const write = (f, key, value) => f.store.transaction(tx => tx.put(key, value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Hash every physical key/type/value byte; avoid a JS matcher walking millions
// of individual typed-array elements when proving an unchanged large record.
const physicalSnapshot = driver => {
    const records = [...driver.rows()].map(([key, value]) => {
        const binary = value instanceof Uint8Array, bytes = binary ? value : enc.encode(JSON.stringify(value));
        return { key, type: binary ? 'bytes' : 'json', bytes: bytes.byteLength, sha256: sha(bytes) };
    });
    return { rows: records.length, records };
};
const manifestKey = (f, key) => [...f.driver.rows().keys()].find(k => k.includes(':manifest:') && k.endsWith(Buffer.from(key).toString('hex')));
const partKey = (manifest, index) => manifest.replace(':manifest:', ':part:') + ':' + String(index).padStart(4, '0');
const pause = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

describe('durable JSON records over an actual SQLite transaction', () => {
    it('requires explicit bounded configuration and a transaction callback', async () => {
        const f = await fixture();
        for (const config of [undefined, {}, { storage: f.driver, namespace: 'x', maxRecordBytes: 10 },
            { storage: f.driver, namespace: 'disk-test', maxRecordBytes: 0 },
            { storage: f.driver, namespace: 'disk-test', maxRecordBytes: 16 * 1024 * 1024 + 1 },
            { storage: f.driver, namespace: 'disk-test', maxRecordBytes: Infinity }]) {
            expect(() => createDurableRecordStorage(config)).toThrow();
        }
        await expect(f.store.transaction(null)).rejects.toThrow();
        expect(f.driver.stats.transactions).toBe(0);
    });

    it('round trips UTF-8 JSON, returns detached values and bounds every physical chunk', async () => {
        const f = await fixture();
        const value = { text: '🎸 café e\u0301 '.repeat(16000), array: [null, true, 1.25], nested: Object.assign(Object.create(null), { safe: 'value' }) };
        await write(f, 'record:a/opaque?yes=1', value);
        const result = await read(f, 'record:a/opaque?yes=1');
        expect(result).toEqual(value); result.array.push('changed');
        expect((await read(f, 'record:a/opaque?yes=1')).array).toEqual([null, true, 1.25]);
        const rows = f.driver.rows(), key = manifestKey(f, 'record:a/opaque?yes=1'), meta = rows.get(key);
        expect(meta).toMatchObject({ v: 1, bytes: enc.encode(JSON.stringify(value)).length, sha256: sha(enc.encode(JSON.stringify(value))) });
        expect(meta.chunks).toBeGreaterThan(1);
        const parts = [...rows.values()].filter(v => v instanceof Uint8Array);
        expect(parts).toHaveLength(meta.chunks);
        expect(parts.every(p => p.byteLength >= 1 && p.byteLength <= 65536)).toBe(true);
        expect(parts.reduce((n, p) => n + p.byteLength, 0)).toBe(meta.bytes);
    });

    it('supports 512-byte opaque ASCII keys and isolates namespaces', async () => {
        const f = await fixture(), key = 'K'.repeat(512);
        await write(f, key, { private: 'one namespace' });
        const other = createDurableRecordStorage({ storage: f.driver, namespace: 'other-test', maxRecordBytes: 1024 });
        expect(await other.transaction(tx => tx.get(key))).toBeUndefined();
        expect(await read(f, key)).toEqual({ private: 'one namespace' });
    });

    it.each(['', 'x'.repeat(513), 'é', 'key\n', 'key\0', '\u007f'])('rejects invalid opaque key %j without a commit', async key => {
        const f = await fixture();
        await expect(write(f, key, { value: 1 })).rejects.toThrow('record-key');
        expect(f.driver.rows().size).toBe(0);
    });

    it('reopens the same disk records in a separate child process', async () => {
        const f = await fixture({ namespace: 'restart-test' });
        const value = { message: 'Benign child-process persistence', data: '🙂'.repeat(18000) };
        await write(f, 'persisted', value);
        await f.driver.close();
        const child = spawnSync(process.execPath, ['tests/support/durable-record-storage-restart.mjs', f.filename, 'persisted'],
            { cwd: process.cwd(), encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ read: value, childProcess: true });
        const reopened = openDurableRecordSqlite(f.filename);
        f.cleanup.drivers.push(reopened);
        const store = createDurableRecordStorage({ storage: reopened, namespace: 'restart-test', maxRecordBytes: 1024 * 1024 });
        expect(await store.transaction(tx => tx.get('child-receipt'))).toEqual({ read: value, childProcess: true });
        await reopened.close();
    });

    it('recovers committed records after a child is killed with partial SQLite writes uncommitted', async () => {
        const f = await fixture({ namespace: 'restart-test' });
        await write(f, 'persisted', { committed: true }); await f.driver.close();
        const child = spawnSync(process.execPath, ['tests/support/durable-record-storage-restart.mjs', f.filename, 'persisted', 'crash-uncommitted'],
            { cwd: process.cwd(), encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
        expect(child.error, child.stderr).toBeUndefined();
        expect(JSON.parse(child.stdout)).toEqual({ uncommittedWritesCompleted: true });
        expect(child.status, child.stderr).not.toBe(0);
        if (child.signal !== null) expect(child.signal).toBe('SIGKILL');
        const reopened = openDurableRecordSqlite(f.filename); f.cleanup.drivers.push(reopened);
        const store = createDurableRecordStorage({ storage: reopened, namespace: 'restart-test', maxRecordBytes: 1024 * 1024 });
        expect(await store.transaction(tx => tx.get('persisted'))).toEqual({ committed: true });
        expect(await store.transaction(tx => tx.get('partial-only'))).toBeUndefined();
        await reopened.close();
    });

    it('grows, shrinks and deletes a record without leaving physical orphan parts', async () => {
        const f = await fixture();
        await write(f, 'record', { text: 'a'.repeat(150000) }); expect(f.driver.rows().size).toBe(4);
        await write(f, 'record', { text: 'b'.repeat(280000) }); expect(f.driver.rows().size).toBe(6);
        await write(f, 'record', { text: 'small' }); expect(f.driver.rows().size).toBe(2);
        expect(await read(f, 'record')).toEqual({ text: 'small' });
        await f.store.transaction(tx => tx.delete('record')); expect(f.driver.rows().size).toBe(0);
        expect(await read(f, 'record')).toBeUndefined();
        await f.store.transaction(tx => tx.delete('record')); expect(f.driver.rows().size).toBe(0);
    });

    it('rolls back all earlier writes when a final authority check denies the transaction', async () => {
        const f = await fixture(); await write(f, 'before', { stable: true });
        const before = f.driver.rows();
        await expect(f.store.transaction(async tx => {
            await tx.put('before', { stable: false }); await tx.put('new', { text: 'x'.repeat(180000) });
            throw Error('authority-expired-after-final-write');
        })).rejects.toThrow('authority-expired-after-final-write');
        expect(f.driver.rows()).toEqual(before);
    });

    it.each([undefined, null, 0, false])('rolls back a callback throwing the falsy value %j', async thrown => {
        const f = await fixture();
        await expect(f.store.transaction(async tx => { await tx.put('never-commit', true); throw thrown; })).rejects.toBe(thrown);
        expect(f.driver.rows().size).toBe(0); expect(f.driver.stats.rollbacks).toBe(1);
    });

    it.each([undefined, null, 0, false])('keeps a caught falsy raw-driver failure fatal: %j', async thrown => {
        const f = await fixture();
        f.hooks.after = event => { if (event.name === 'put') throw thrown; };
        await expect(f.store.transaction(async tx => { try { await tx.put('partial', true); } catch { /* poison cannot be cleared */ } }))
            .rejects.toThrow('storage-unavailable');
        expect(f.driver.rows().size).toBe(0); expect(f.driver.stats.rollbacks).toBe(1);
    });

    it('rolls back partially written chunks and keeps a caught storage failure fatal', async () => {
        const f = await fixture(); await write(f, 'stable', { stable: true }); const before = f.driver.rows();
        let written = 0;
        f.hooks.after = event => { if (event.name === 'put' && ++written === 2) throw Error('disk-fault-after-write'); };
        await expect(f.store.transaction(async tx => {
            try { await tx.put('partial', { text: 'x'.repeat(180000) }); } catch { /* caller cannot clear poison */ }
            return 'false-success';
        })).rejects.toThrow('disk-fault-after-write');
        expect(f.driver.rows()).toEqual(before); expect(f.driver.stats.rollbacks).toBe(1);
    });

    it('never acknowledges before SQLite COMMIT and serializes competing updates', async () => {
        const f = await fixture(), barrier = pause(), reached = pause();
        f.hooks.after = async event => { if (event.name === 'put' && event.key.includes(':manifest:')) { reached.release(); await barrier.promise; } };
        let finished = false;
        const first = write(f, 'counter', 1).then(() => { finished = true; });
        await reached.promise; expect(finished).toBe(false); expect(f.driver.stats.commits).toBe(0);
        const next = f.store.transaction(async tx => { const value = await tx.get('counter'); await tx.put('counter', value + 1); });
        barrier.release(); await first; await next;
        expect(await read(f, 'counter')).toBe(2);
    });
});

describe('strict representation, physical corruption and resource ceilings', () => {
    const cycle = {}; cycle.self = cycle;
    const sparse = []; sparse[2] = true;
    const hidden = {}; Object.defineProperty(hidden, 'value', { value: true });
    const symbol = { [Symbol('hidden')]: true };
    it.each([
        ['undefined', undefined], ['NaN', NaN], ['infinity', Infinity], ['negative zero', -0], ['bigint', 1n],
        ['date', new Date(0)], ['map', new Map()], ['set', new Set()], ['typed array', new Uint8Array([1])],
        ['function', () => {}], ['cycle', cycle], ['sparse array', sparse], ['hidden property', hidden], ['symbol key', symbol]
    ])('rejects %s rather than silently changing its representation', async (_name, value) => {
        const f = await fixture();
        await expect(write(f, 'invalid', value)).rejects.toThrow('record-format');
        expect(f.driver.rows().size).toBe(0);
    });

    it('does not execute getters or toJSON during validation', async () => {
        const f = await fixture(); let calls = 0;
        const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { calls += 1; return 'leak'; } });
        await expect(write(f, 'getter', getter)).rejects.toThrow('record-format');
        await expect(write(f, 'method', { toJSON() { calls += 1; return 'leak'; } })).rejects.toThrow('record-format');
        expect(calls).toBe(0);
    });

    it('does not execute a proxy-provided toJSON after validating its data descriptors', async () => {
        const f = await fixture(); let calls = 0;
        const value = new Proxy({ benign: 'original' }, { get(target, key, receiver) {
            if (key === 'toJSON') { calls += 1; return () => ({ benign: 'substituted' }); }
            return Reflect.get(target, key, receiver);
        } });
        const [outcome] = await Promise.allSettled([write(f, 'proxy', value)]);
        expect(calls).toBe(0);
        if (outcome.status === 'fulfilled') expect(await read(f, 'proxy')).toEqual({ benign: 'original' });
        else expect(f.driver.rows().size).toBe(0);
    });

    it('does not execute an inherited toJSON hook on a plain record', async () => {
        const f = await fixture(); let calls = 0, outcome;
        const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
        try {
            Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls += 1; return { substituted: true }; } });
            [outcome] = await Promise.allSettled([write(f, 'inherited', { benign: ['original'] })]);
        } finally {
            if (original) Object.defineProperty(Object.prototype, 'toJSON', original);
            else delete Object.prototype.toJSON;
        }
        expect(calls).toBe(0);
        if (outcome.status === 'fulfilled') expect(await read(f, 'inherited')).toEqual({ benign: ['original'] });
        else expect(f.driver.rows().size).toBe(0);
    });

    it('rejects a proxy array whose virtual index contradicts its own length descriptor', async () => {
        const f = await fixture(); let reads = 0;
        const value = new Proxy([], {
            ownKeys: () => ['10', 'length'],
            getOwnPropertyDescriptor(target, key) {
                return key === '10' ? { value: 'benign', writable: true, enumerable: true, configurable: true }
                    : Reflect.getOwnPropertyDescriptor(target, key);
            },
            get(target, key, receiver) {
                return key === 'length' ? (++reads === 1 ? 1 : 11) : Reflect.get(target, key, receiver);
            }
        });
        await expect(write(f, 'moving-array-length', value)).rejects.toThrow('record-format');
        expect(reads).toBe(0); expect(f.driver.rows().size).toBe(0);
    });

    it('enforces actual UTF-8 bytes and exact depth/node ceilings', async () => {
        const f = await fixture({ maxRecordBytes: 32 });
        await write(f, 'fits', 'é'.repeat(15)); expect(await read(f, 'fits')).toBe('é'.repeat(15));
        await expect(write(f, 'too-large', 'é'.repeat(16))).rejects.toThrow('record-capacity');
        const deep = await fixture(); let value = null;
        for (let i = 0; i < 64; i += 1) value = [value];
        await write(deep, 'depth64', value);
        await expect(write(deep, 'depth65', [value])).rejects.toThrow('record-capacity');
        await expect(write(deep, 'nodes', Array.from({ length: 100000 }, () => null))).rejects.toThrow('record-capacity');
    });

    it.each(['missing-part', 'wrong-length', 'wrong-type', 'hash-mismatch', 'missing-manifest', 'extra-part', 'malformed-manifest'])
    ('fails closed on %s and does not repair or delete evidence automatically', async fault => {
        const f = await fixture(); await write(f, 'record', { text: 'x'.repeat(90000) });
        const key = manifestKey(f, 'record'), part = partKey(key, 0);
        await f.driver.transaction(async tx => {
            if (fault === 'missing-part') await tx.delete(part);
            if (fault === 'wrong-length') await tx.put(part, new Uint8Array([1]));
            if (fault === 'wrong-type') await tx.put(part, Array.from({ length: 65536 }, () => 1));
            if (fault === 'hash-mismatch') { const bytes = await tx.get(part); bytes[0] ^= 1; await tx.put(part, bytes); }
            if (fault === 'missing-manifest') await tx.delete(key);
            if (fault === 'extra-part') await tx.put(partKey(key, 2), new Uint8Array([1]));
            if (fault === 'malformed-manifest') await tx.put(key, { ...await tx.get(key), chunks: 999999 });
        });
        const before = f.driver.rows();
        await expect(read(f, 'record')).rejects.toThrow('storage-corrupt');
        expect(f.driver.rows()).toEqual(before);
    });

    it.each([
        ['invalid UTF-8', new Uint8Array([0xc3, 0x28])],
        ['non-JSON', enc.encode('not JSON')],
        ['noncanonical duplicate key', enc.encode('{"a":1,"a":2}')],
        ['noncanonical whitespace', enc.encode(' {"a":1} ')]
    ])('refuses %s even with a matching SHA manifest', async (_name, bytes) => {
        const f = await fixture(); await write(f, 'record', null); const key = manifestKey(f, 'record');
        await f.driver.transaction(async tx => {
            await tx.put(partKey(key, 0), bytes);
            await tx.put(key, { v: 1, bytes: bytes.byteLength, chunks: 1, sha256: sha(bytes) });
        });
        await expect(read(f, 'record')).rejects.toThrow('storage-corrupt');
    });

    it('bounds aggregate transaction writes at 16 MiB and rolls back two accepted 8 MiB records', async () => {
        const f = await fixture({ maxRecordBytes: 16 * 1024 * 1024 });
        const value = 'x'.repeat(8 * 1024 * 1024 - 2);
        await expect(f.store.transaction(async tx => {
            await tx.put('one', value); await tx.put('two', value); await tx.put('third', 1);
        })).rejects.toThrow('record-capacity');
        expect(f.driver.rows().size).toBe(0);
    });

    it('bounds aggregate transaction reads at 32 MiB and preserves every physical record byte', async () => {
        const f = await fixture({ maxRecordBytes: 16 * 1024 * 1024 });
        const value = 'x'.repeat(8 * 1024 * 1024 - 2);
        await write(f, 'one', value); const before = physicalSnapshot(f.driver);
        f.driver.resetOperations(); // Release retained seed buffers, not persisted records.
        await expect(f.store.transaction(async tx => {
            for (let i = 0; i < 4; i += 1) expect(await tx.get('one')).toBe(value);
            await tx.get('one');
        })).rejects.toThrow('record-capacity');
        expect(physicalSnapshot(f.driver)).toEqual(before);
    });

    it('bounds physical operations and poisons a swallowed ceiling failure', async () => {
        const f = await fixture(); f.driver.resetOperations();
        await expect(f.store.transaction(async tx => {
            try { for (let i = 0; i < DURABLE_RECORD_CEILINGS.rowOperations + 1; i += 1) await tx.get('absent'); }
            catch { /* an empty logical read can still exhaust physical work */ }
        })).rejects.toThrow('record-capacity');
        expect(f.driver.stats.operations.length).toBeLessThanOrEqual(4096);
        expect(f.driver.rows().size).toBe(0);
    });
});

describe('transaction lifetime and bounded logical listing', () => {
    it('rejects an escaped transaction without performing more disk operations', async () => {
        const f = await fixture(); let escaped;
        await f.store.transaction(async tx => { escaped = tx; await tx.put('good', true); });
        const operations = f.driver.stats.operations.length;
        await expect(escaped.get('good')).rejects.toThrow('transaction-closed');
        await expect(escaped.put('bad', true)).rejects.toThrow('transaction-closed');
        await expect(escaped.delete('good')).rejects.toThrow('transaction-closed');
        await expect(escaped.list({ prefix: '', limit: 1 })).rejects.toThrow('transaction-closed');
        expect(f.driver.stats.operations).toHaveLength(operations);
    });

    it('rejects concurrent operations and rolls back even when the caller catches the rejection', async () => {
        const f = await fixture();
        await expect(f.store.transaction(async tx => {
            const outcomes = await Promise.allSettled([tx.put('one', true), tx.put('two', true)]);
            expect(outcomes.some(o => o.status === 'rejected')).toBe(true);
        })).rejects.toThrow('transaction-concurrent-operation');
        expect(f.driver.rows().size).toBe(0);
    });

    it('drains and rolls back an unawaited write before closing the underlying transaction', async () => {
        const f = await fixture(), barrier = pause(), reached = pause();
        f.hooks.after = async event => { if (event.name === 'put') { reached.release(); await barrier.promise; } };
        let finished = false;
        const pending = f.store.transaction(tx => { tx.put('forgotten', 'never commit'); return 'false-success'; })
            .then(() => { finished = true; }, error => { finished = true; throw error; });
        const expectation = expect(pending).rejects.toThrow('transaction-unfinished-operation');
        await reached.promise; expect(finished).toBe(false); expect(f.driver.stats.commits).toBe(0);
        barrier.release(); await expectation;
        expect(f.driver.rows().size).toBe(0); expect(f.driver.stats.rollbacks).toBe(1);
    });

    it('lists only matching logical records in ASCII order with an exclusive cursor', async () => {
        const f = await fixture();
        for (const key of ['subject:z', 'subject:A', 'other:a', 'subject:a', 'subject:0', 'subject:b']) await write(f, key, { key });
        const first = await f.store.transaction(tx => tx.list({ prefix: 'subject:', limit: 4 }));
        expect(first).toBeInstanceOf(Map);
        expect([...first]).toEqual(['subject:0', 'subject:A', 'subject:a', 'subject:b'].map(key => [key, { key }]));
        const second = await f.store.transaction(tx => tx.list({ prefix: 'subject:', startAfter: 'subject:b', limit: 4 }));
        expect([...second]).toEqual([['subject:z', { key: 'subject:z' }]]);
        expect(await f.store.transaction(tx => tx.list({ prefix: 'missing:', limit: 1 }))).toEqual(new Map());
        expect(f.driver.stats.operations.filter(o => o.name === 'list').every(o => o.value.limit >= 1 && o.value.limit <= 4)).toBe(true);
    });

    it('uses only validated own list descriptors without invoking later proxy property reads', async () => {
        const f = await fixture(); await write(f, 'subject:a', true); let reads = 0;
        const options = new Proxy({ prefix: 'subject:', limit: 1 }, { get(target, key, receiver) {
            if (key === 'prefix' || key === 'limit') { reads += 1; return key === 'prefix' ? 'other:' : 999999; }
            return Reflect.get(target, key, receiver);
        } });
        expect(await f.store.transaction(tx => tx.list(options))).toEqual(new Map([['subject:a', true]]));
        expect(reads).toBe(0);
        const accessor = { limit: 1 }; Object.defineProperty(accessor, 'prefix', { enumerable: true, get() { reads += 1; return ''; } });
        await expect(f.store.transaction(tx => tx.list(accessor))).rejects.toThrow('record-list');
        expect(reads).toBe(0);
    });

    it.each(['oversized-page', 'unordered-page', 'foreign-prefix', 'invalid-hex'])('refuses a corrupt driver list: %s', async fault => {
        const f = await fixture(); for (const key of ['subject:a', 'subject:b', 'subject:c']) await write(f, key, { key });
        const before = f.driver.rows();
        const storage = { transaction: operation => f.driver.transaction(raw => operation({ ...raw, list: async options => {
            const values = await raw.list(options);
            if (!options.prefix.includes(':manifest:')) return values;
            const entries = [...values];
            if (fault === 'oversized-page') return new Map([...entries, ['extra-record', {}]]);
            if (fault === 'unordered-page') return new Map(entries.reverse());
            if (fault === 'foreign-prefix') return new Map([['foreign:manifest:61', {}]]);
            return new Map([[options.prefix + 'zz', {}]]);
        } })) };
        const store = createDurableRecordStorage({ storage, namespace: 'disk-test', maxRecordBytes: 1024 * 1024 });
        await expect(store.transaction(async tx => {
            await tx.put('will-rollback', true); try { await tx.list({ prefix: 'subject:', limit: 2 }); } catch { /* poison remains */ }
        })).rejects.toThrow('storage-corrupt');
        expect(f.driver.rows()).toEqual(before);
    });

    it.each([{ prefix: '', limit: 5 }, { prefix: '', limit: 0 }, { prefix: 'é', limit: 1 },
        { prefix: 'subject:', startAfter: 'other:a', limit: 1 }, { prefix: '', limit: Infinity }])
    ('rejects an unbounded or foreign-cursor list %j and keeps earlier writes rolled back', async options => {
        const f = await fixture();
        await expect(f.store.transaction(async tx => {
            await tx.put('before', true); try { await tx.list(options); } catch { /* denial remains fatal */ }
        })).rejects.toThrow();
        expect(f.driver.rows().size).toBe(0);
    });
});

describe('selected incident evidence on the real durable record transaction', () => {
    it('requires an explicit byte decoder, encrypts selected evidence and atomically rolls back final expiry', async () => {
        const f = await fixture({ maxRecordBytes: 8 * 1024 * 1024 });
        let at = 1800000000000, sequence = 0;
        const bytes = enc.encode('Benign selected evidence in the isolated SQLite fixture');
        const digest = await incidentEvidenceDigest(bytes), sourceId = 'report_alpha';
        const source = { id: sourceId, revision: 1, bytesBase64: Buffer.from(bytes).toString('base64'), digest, expiresAt: at + 500 };
        await f.store.transaction(async tx => {
            await tx.put('restricted-incident-cases-v1', initialIncidentCaseState());
            await tx.put('source:' + sourceId, source);
        });
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const cipher = createIncidentEvidenceCipher({ keyId: 'sqlite_fixture_key', key });
        const authority = { actorRef: 'alice', incidentReviewer: true, active: true, revision: 1, expiresAt: at + 100000, canOpen: true, canMaintain: true };
        const policy = { qualified: true, version: 'synthetic_v1', procedure: 'synthetic_only', authority: 'synthetic_authority', reason: 'selected_report',
            validFrom: at, validUntil: at + 100000, reviewAt: at + 1000, holdUntil: null, evidenceDeleteAt: at + 3000,
            caseDeleteAt: at + 4000, tombstoneUntil: at + 6000, receiptUntil: at + 7000, auditUntil: at + 8000,
            limits: { maxCases: 2, maxBytes: 100000, maxEvidenceBytes: 1000, maxAuditEvents: 100, maxOperations: 100, maxTombstones: 10 } };
        const create = () => createIncidentCases({ storage: f.store, now: () => at, newRef: kind => `${kind}_${++sequence}`,
            resolveAuthority: async () => structuredClone(authority), resolveReviewer: async () => structuredClone(authority),
            policyFor: async () => structuredClone(policy), cipher,
            loadEvidence: async ({ tx, sourceId: id }) => {
                const record = await tx.get('source:' + id);
                const { bytesBase64, ...metadata } = record;
                return { ...metadata, bytes: new Uint8Array(Buffer.from(bytesBase64, 'base64')), provenance: 'reported-public' };
            } });
        const model = create(), input = { principal: 'alice', operationId: 'operation_1', sourceId, sourceRevision: 1, sourceDigest: digest, type: 'safety' };
        const saved = await model.preserveSelectedReport(input); expect(saved.ok).toBe(true);
        const evidence = await create().readEvidence({ principal: 'alice', operationId: 'read_1', caseRef: saved.caseRef, expectedRevision: 1 });
        expect(evidence.ok).toBe(true); expect(dec.decode(evidence.evidence.bytes)).toBe(dec.decode(bytes));
        const state = await read(f, 'restricted-incident-cases-v1'); expect(JSON.stringify(state)).not.toContain(dec.decode(bytes));
        expect(await read(f, 'source:' + sourceId)).toEqual(source);
        const before = f.driver.rows();
        f.hooks.after = event => { if (event.name === 'put' && event.key.includes(':manifest:')) at = authority.expiresAt; };
        const denied = await model.transitionReview({ principal: 'alice', operationId: 'review_2', caseRef: saved.caseRef, expectedRevision: 1, status: 'triaged' });
        expect(denied.ok).toBe(false); expect(f.driver.rows()).toEqual(before);
    });
});
