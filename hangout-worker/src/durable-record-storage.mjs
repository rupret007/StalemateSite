// Physical record mapping only. The caller supplies ONE rollback-capable async
// transaction domain shared by authority, consent and effects. No provisioning,
// production activation, remote authority, key management or provider starts.
export const DURABLE_RECORD_CEILINGS = Object.freeze({ chunkBytes: 65536, recordBytes: 16 * 1024 * 1024,
    transactionReadBytes: 32 * 1024 * 1024, transactionWriteBytes: 16 * 1024 * 1024, rowOperations: 4096, listPage: 4, nodes: 100000, depth: 64 });
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const fail = reason => { throw Error(reason); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
        const d = Object.getOwnPropertyDescriptor(value, key); return d?.enumerable && Object.hasOwn(d, 'value');
    });
function encode(value, limit) {
    let nodes = 0, characters = 0;
    const seen = new Set();
    function visit(item, depth) {
        if (++nodes > DURABLE_RECORD_CEILINGS.nodes || depth > DURABLE_RECORD_CEILINGS.depth) fail('record-capacity');
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'number') { if (!Number.isFinite(item) || Object.is(item, -0)) fail('record-format'); return item; }
        if (typeof item === 'string') { characters += item.length; if (characters > limit) fail('record-capacity'); return item; }
        if (!item || typeof item !== 'object' || seen.has(item)) fail('record-format');
        const array = Array.isArray(item), prototype = Object.getPrototypeOf(item), keys = Reflect.ownKeys(item);
        const lengthDescriptor = array ? Object.getOwnPropertyDescriptor(item, 'length') : null, length = lengthDescriptor?.value;
        if (array ? prototype !== Array.prototype || !lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
            || lengthDescriptor.enumerable || !Number.isSafeInteger(length) || length < 0 || length > DURABLE_RECORD_CEILINGS.nodes
            || keys.length !== length + 1 : ![Object.prototype, null].includes(prototype)) fail('record-format');
        const snapshot = array ? Object.setPrototypeOf([], null) : Object.create(null);
        seen.add(item);
        for (const key of keys) {
            if (array && key === 'length') continue;
            const d = Object.getOwnPropertyDescriptor(item, key);
            if (typeof key !== 'string' || !d?.enumerable || !Object.hasOwn(d, 'value')
                || array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) fail('record-format');
            characters += key.length;
            if (characters > limit) fail('record-capacity');
            snapshot[key] = visit(d.value, depth + 1);
        }
        seen.delete(item);
        return snapshot;
    }
    // Stringify only our descriptor snapshot: never re-read caller properties,
    // invoke a virtual toJSON, or inherit a serializer from Object/Array.prototype.
    const snapshot = visit(value, 0), bytes = enc.encode(JSON.stringify(snapshot));
    if (bytes.byteLength > limit) fail('record-capacity');
    return bytes;
}

export function createDurableRecordStorage({ storage, namespace, maxRecordBytes } = {}) {
    if (typeof storage?.transaction !== 'function' || typeof namespace !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(namespace)
        || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > DURABLE_RECORD_CEILINGS.recordBytes)
        throw TypeError('Explicit transaction storage, namespace and record bound required');
    const prefix = `durable-record:v1:${namespace}:`;
    return Object.freeze({
        async transaction(operation) {
            if (typeof operation !== 'function') throw TypeError('Transaction callback required');
            return storage.transaction(async raw => {
                if (['get', 'put', 'delete', 'list'].some(name => typeof raw?.[name] !== 'function')) fail('storage-unavailable');
                let active = true, busy = false, failure = null, pending = null, rows = 0, readBytes = 0, writtenBytes = 0;
                const row = async (name, ...args) => {
                    if (++rows > DURABLE_RECORD_CEILINGS.rowOperations) fail('record-capacity');
                    return raw[name](...args);
                };
                // Ordered ASCII keys permit bounded scans without a global
                // index. The caller uses opaque references, never secret keys.
                const keyOk = key => typeof key === 'string' && /^[\x21-\x7e]{1,512}$/.test(key);
                const route = key => {
                    if (!keyOk(key)) fail('record-key');
                    return [...key].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
                };
                const manifestKey = base => `${prefix}manifest:${base}`;
                const partPrefix = base => `${prefix}part:${base}:`;
                const partKey = (base, i) => `${partPrefix(base)}${String(i).padStart(4, '0')}`;
                const metadata = async base => {
                    const value = await row('get', manifestKey(base));
                    if (value === undefined) {
                        const orphans = await row('list', { prefix: partPrefix(base), limit: 1 });
                        if (!(orphans instanceof Map) || orphans.size) fail('storage-corrupt');
                        return null;
                    }
                    if (!exact(value, ['v', 'bytes', 'chunks', 'sha256']) || value.v !== 1
                        || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > maxRecordBytes
                        || value.chunks !== Math.ceil(value.bytes / DURABLE_RECORD_CEILINGS.chunkBytes)
                        || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('storage-corrupt');
                    return value;
                };
                const readRecord = async (key, knownMetadata) => {
                    const base = route(key), meta = knownMetadata || await metadata(base);
                    if (!meta) return undefined;
                    readBytes += meta.bytes;
                    if (readBytes > DURABLE_RECORD_CEILINGS.transactionReadBytes) fail('record-capacity');
                    const bytes = new Uint8Array(meta.bytes);
                    for (let i = 0; i < meta.chunks; i += DURABLE_RECORD_CEILINGS.listPage) {
                        const count = Math.min(DURABLE_RECORD_CEILINGS.listPage, meta.chunks - i);
                        const parts = await row('list', { prefix: partPrefix(base), limit: count, ...(i ? { startAfter: partKey(base, i - 1) } : {}) });
                        if (!(parts instanceof Map) || parts.size !== count) fail('storage-corrupt');
                        let index = i;
                        for (const [physical, part] of parts) {
                            const offset = index * DURABLE_RECORD_CEILINGS.chunkBytes;
                            if (physical !== partKey(base, index) || !(part instanceof Uint8Array)
                                || part.byteLength !== Math.min(DURABLE_RECORD_CEILINGS.chunkBytes, meta.bytes - offset)) fail('storage-corrupt');
                            bytes.set(part, offset); index += 1;
                        }
                    }
                    const extra = await row('list', { prefix: partPrefix(base), startAfter: partKey(base, meta.chunks - 1), limit: 1 });
                    if (!(extra instanceof Map) || extra.size) fail('storage-corrupt');
                    if (await digest(bytes) !== meta.sha256) fail('storage-corrupt');
                    let value;
                    try { value = JSON.parse(dec.decode(bytes)); } catch { fail('storage-corrupt'); }
                    try { if (await digest(encode(value, maxRecordBytes)) !== meta.sha256) fail('storage-corrupt'); }
                    catch { fail('storage-corrupt'); }
                    return value;
                };
                const run = task => {
                    if (!active || failure || busy) {
                        const error = !active ? Error('transaction-closed') : failure || (failure = Error('transaction-concurrent-operation'));
                        const refused = Promise.reject(error); refused.catch(() => {}); return refused;
                    }
                    busy = true;
                    const promise = (async () => {
                        try { return await task(); }
                        catch (error) { failure ||= error instanceof Error ? error : Error('storage-unavailable'); throw error; }
                        finally { busy = false; }
                    })();
                    // Even a caller that forgets to await cannot write past commit.
                    promise.catch(() => {});
                    pending = promise;
                    return promise;
                };
                const tx = Object.freeze({
                    get: key => run(() => readRecord(key)),
                    put: (key, value) => run(async () => {
                        const base = route(key), bytes = encode(value, maxRecordBytes);
                        writtenBytes += bytes.byteLength;
                        if (writtenBytes > DURABLE_RECORD_CEILINGS.transactionWriteBytes) fail('record-capacity');
                        const old = await metadata(base), chunks = Math.ceil(bytes.byteLength / DURABLE_RECORD_CEILINGS.chunkBytes), sha256 = await digest(bytes);
                        if (old) await readRecord(key, old);
                        for (let i = 0; i < chunks; i += 1) await row('put', partKey(base, i), bytes.slice(i * DURABLE_RECORD_CEILINGS.chunkBytes, (i + 1) * DURABLE_RECORD_CEILINGS.chunkBytes));
                        for (let i = chunks; i < (old?.chunks || 0); i += 1) await row('delete', partKey(base, i));
                        await row('put', manifestKey(base), { v: 1, bytes: bytes.byteLength, chunks, sha256 });
                    }),
                    delete: key => run(async () => {
                        const base = route(key), old = await metadata(base);
                        if (!old) return;
                        await readRecord(key, old);
                        for (let i = 0; i < old.chunks; i += 1) await row('delete', partKey(base, i));
                        await row('delete', manifestKey(base));
                    }),
                    list: options => run(async () => {
                        if (!options || Object.getPrototypeOf(options) !== Object.prototype
                            || Reflect.ownKeys(options).some(key => !['prefix', 'startAfter', 'limit'].includes(key))) fail('record-list');
                        const descriptors = Object.getOwnPropertyDescriptors(options);
                        if (Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, 'value'))
                            || !Object.hasOwn(descriptors, 'prefix') || !Object.hasOwn(descriptors, 'limit')) fail('record-list');
                        const logicalPrefix = descriptors.prefix.value, limit = descriptors.limit.value;
                        const startAfter = descriptors.startAfter?.value;
                        if (typeof logicalPrefix !== 'string' || logicalPrefix !== '' && !keyOk(logicalPrefix)
                            || !Number.isInteger(limit) || limit < 1 || limit > DURABLE_RECORD_CEILINGS.listPage
                            || Object.hasOwn(descriptors, 'startAfter') && (!keyOk(startAfter) || !startAfter.startsWith(logicalPrefix))) fail('record-list');
                        const physicalPrefix = `${prefix}manifest:`, result = new Map();
                        const found = await row('list', { prefix: physicalPrefix + (logicalPrefix ? route(logicalPrefix) : ''), limit,
                            ...(startAfter ? { startAfter: physicalPrefix + route(startAfter) } : {}) });
                        if (!(found instanceof Map) || found.size > limit) fail('storage-corrupt');
                        let previous = startAfter || '';
                        for (const physical of found.keys()) {
                            if (typeof physical !== 'string' || !physical.startsWith(physicalPrefix)) fail('storage-corrupt');
                            const hex = physical.slice(physicalPrefix.length);
                            if (!/^(?:[0-9a-f]{2}){1,512}$/.test(hex)) fail('storage-corrupt');
                            const key = String.fromCharCode(...hex.match(/../g).map(n => parseInt(n, 16)));
                            if (!keyOk(key) || !key.startsWith(logicalPrefix) || key <= previous) fail('storage-corrupt');
                            const value = await readRecord(key); if (value === undefined) fail('storage-corrupt');
                            result.set(key, value); previous = key;
                        }
                        return result;
                    })
                });
                let result, operationError, operationFailed = false;
                try { result = await operation(tx); } catch (error) { operationFailed = true; operationError = error; }
                const unfinished = busy;
                active = false;
                if (unfinished) {
                    await pending.catch(() => {});
                    failure ||= Error('transaction-unfinished-operation');
                }
                if (operationFailed) throw operationError;
                if (failure) throw failure;
                return result;
            });
        }
    });
}
