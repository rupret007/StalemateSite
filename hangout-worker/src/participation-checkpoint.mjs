// A transient rollback checkpoint for trusted engine-owned data. Never persist
// or expose its graph. Logical traversal limits are not a runtime-memory claim.
const CEILINGS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxNodes: 100000, maxMs: 50 });
const OPAQUE_MAX = 4096;
const unsupported = () => { throw new Error('Unsupported participation checkpoint graph'); };
const exceeded = () => { throw new Error('Participation checkpoint limit exceeded'); };
const clock = () => globalThis.performance.now();
const dataDescriptor = descriptor => descriptor && Object.hasOwn(descriptor, 'value');
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;

export function createParticipationCheckpoint(roots, options = {}) {
    if (!options || Object.getPrototypeOf(options) !== Object.prototype
        || Reflect.ownKeys(options).some(key => key !== 'opaque' && !Object.hasOwn(CEILINGS, key) || !dataDescriptor(Object.getOwnPropertyDescriptor(options, key))))
        throw new Error('Invalid participation checkpoint limits');
    const limits = Object.fromEntries(Object.entries(CEILINGS).map(([key, fallback]) => [key, Object.hasOwn(options, key) ? options[key] : fallback]));
    if (!['maxBytes', 'maxNodes'].every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= CEILINGS[key])
        || !Number.isFinite(limits.maxMs) || limits.maxMs <= 0 || limits.maxMs > CEILINGS.maxMs)
        throw new Error('Invalid participation checkpoint limits');
    if (!roots || typeof roots !== 'object') unsupported();
    const started = clock(), seen = new WeakMap(), records = [], pending = [];
    const opaque = new WeakSet();
    let bytes = 0, nodes = 0, entries = 0, opaqueObjects = 0;
    function timeCheck(start = started) { if (clock() - start > limits.maxMs) exceeded(); }
    function charge(size, count = 0) {
        bytes += size; nodes += count;
        if (bytes > limits.maxBytes || nodes > limits.maxNodes) exceeded();
        timeCheck();
    }
    function stringSize(value, available = limits.maxBytes - bytes, start = started) {
        if (value.length > available) exceeded();
        let size = 0;
        for (let i = 0; i < value.length; i += 1) {
            const code = value.charCodeAt(i);
            if (code <= 0x7f) size += 1;
            else if (code <= 0x7ff) size += 2;
            else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
                && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { size += 4; i += 1; }
            else size += 3;
            if (size > available) exceeded();
            if ((i & 255) === 0) timeCheck(start);
        }
        return size;
    }
    // Only trusted callers may omit objects whose internals this particular
    // operation cannot mutate. References remain reversible; opaque contents do
    // not. Never emit the supplied objects in metrics or other diagnostics.
    if (Object.hasOwn(options, 'opaque')) {
        const list = options.opaque;
        let values;
        if (Array.isArray(list) && Object.getPrototypeOf(list) === Array.prototype) {
            if (list.length > OPAQUE_MAX) exceeded();
            if (Reflect.ownKeys(list).length !== list.length + 1) unsupported();
            values = Array.from({ length: list.length }, (_, index) => {
                const entry = Object.getOwnPropertyDescriptor(list, String(index));
                if (!dataDescriptor(entry)) unsupported();
                return entry.value;
            });
        } else if (list && Object.getPrototypeOf(list) === Set.prototype) {
            if (setSize.call(list) > OPAQUE_MAX) exceeded();
            if (Reflect.ownKeys(list).length) unsupported();
            values = Set.prototype.values.call(list);
        } else unsupported();
        for (const value of values) {
            charge(8, 1);
            if (!value || typeof value !== 'object' || value === roots) unsupported();
            const prototype = Object.getPrototypeOf(value);
            if (![Object.prototype, null, Array.prototype, Map.prototype, Set.prototype].includes(prototype)
                || prototype === Array.prototype && !Array.isArray(value)) unsupported();
            if (prototype === Map.prototype) try { mapSize.call(value); } catch { unsupported(); }
            if (prototype === Set.prototype) try { setSize.call(value); } catch { unsupported(); }
            opaque.add(value);
        }
    }
    function visit(value) {
        if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') { charge(8); return; }
        if (typeof value === 'string') { charge(16 + stringSize(value)); return; }
        if (typeof value !== 'object') unsupported();
        charge(8);
        if (seen.has(value)) return;
        if (opaque.has(value)) {
            seen.set(value, null); charge(32, 1); opaqueObjects += 1; return;
        }
        const prototype = Object.getPrototypeOf(value);
        const kind = prototype === Map.prototype ? 'map' : prototype === Set.prototype ? 'set'
            : Array.isArray(value) && prototype === Array.prototype ? 'array'
                : prototype === Object.prototype || prototype === null ? 'object' : null;
        if (!kind) unsupported();
        if (kind === 'array' && value.length > limits.maxNodes) exceeded();
        charge(64, 1);
        const record = { value, prototype, kind, extensible: Object.isExtensible(value), properties: [], contents: [] };
        seen.set(value, record); records.push(record); pending.push(record);
    }
    visit(roots);
    while (pending.length) {
        const item = pending.pop(), keys = Reflect.ownKeys(item.value);
        if ((item.kind === 'map' || item.kind === 'set') && keys.length) unsupported();
        if (keys.length > limits.maxNodes - nodes) exceeded();
        for (const key of keys) {
            if (typeof key !== 'string') unsupported();
            const descriptor = Object.getOwnPropertyDescriptor(item.value, key);
            if (!dataDescriptor(descriptor)) unsupported();
            charge(48 + stringSize(key), 1); entries += 1;
            item.properties.push([key, { ...descriptor }]);
            visit(descriptor.value);
        }
        if (item.kind === 'map') {
            if (mapSize.call(item.value) > limits.maxNodes - nodes) exceeded();
            for (const [key, value] of Map.prototype.entries.call(item.value)) {
                charge(32, 1); entries += 1; visit(key); visit(value);
                item.contents.push([key, value]);
            }
        } else if (item.kind === 'set') {
            if (setSize.call(item.value) > limits.maxNodes - nodes) exceeded();
            for (const value of Set.prototype.values.call(item.value)) {
                charge(24, 1); entries += 1; visit(value); item.contents.push(value);
            }
        }
    }
    timeCheck();
    const metrics = Object.freeze({ bytes, nodes, objects: records.length, opaqueObjects, entries,
        captureMs: clock() - started, ...limits });
    let used = false;
    const restore = () => {
        if (used) return false;
        used = true;
        const restoreStarted = clock();
        let inspected = 0, currentBytes = 0;
        const plans = [];
        try {
            // Validate every descriptor before making a change. If trusted code
            // introduced irreversible/frozen structure, the caller fails closed.
            for (const item of records) {
                timeCheck(restoreStarted);
                if (Object.isExtensible(item.value) !== item.extensible) unsupported();
                if (Object.getPrototypeOf(item.value) !== item.prototype && !item.extensible) unsupported();
                const keys = Reflect.ownKeys(item.value);
                inspected += keys.length + 1;
                if (item.kind === 'map') inspected += mapSize.call(item.value);
                if (item.kind === 'set') inspected += setSize.call(item.value);
                if (inspected > limits.maxNodes) exceeded();
                const wanted = new Map(item.properties), remove = [];
                for (const key of keys) {
                    timeCheck(restoreStarted);
                    if (typeof key !== 'string') unsupported();
                    // Inspect only known original objects' keys/descriptors;
                    // never traverse new values or invoke an accessor.
                    currentBytes += 48 + stringSize(key, limits.maxBytes - currentBytes - 48, restoreStarted);
                    if (currentBytes > limits.maxBytes) exceeded();
                    const current = Object.getOwnPropertyDescriptor(item.value, key), desired = wanted.get(key);
                    if (!desired) {
                        if (!current.configurable) unsupported();
                        remove.push(key); continue;
                    }
                    if (!current.configurable && (desired.configurable || desired.enumerable !== current.enumerable
                        || !dataDescriptor(current) || !current.writable && (desired.writable || !Object.is(current.value, desired.value)))) unsupported();
                }
                if (!item.extensible && item.properties.some(([key]) => !Object.hasOwn(item.value, key))) unsupported();
                plans.push({ item, remove });
            }
            timeCheck(restoreStarted);
            for (const { item, remove } of plans) {
                if (Object.getPrototypeOf(item.value) !== item.prototype) Object.setPrototypeOf(item.value, item.prototype);
                for (const key of remove) if (!Reflect.deleteProperty(item.value, key)) unsupported();
                // Array length comes last, after original indices/extra entries.
                for (const [key, descriptor] of item.properties) if (item.kind !== 'array' || key !== 'length') Object.defineProperty(item.value, key, descriptor);
                if (item.kind === 'array') Object.defineProperty(item.value, 'length', item.properties.find(([key]) => key === 'length')[1]);
                if (item.kind === 'map') {
                    Map.prototype.clear.call(item.value);
                    for (const [key, value] of item.contents) Map.prototype.set.call(item.value, key, value);
                } else if (item.kind === 'set') {
                    Set.prototype.clear.call(item.value);
                    for (const value of item.contents) Set.prototype.add.call(item.value, value);
                }
            }
            timeCheck(restoreStarted);
            return true;
        } finally {
            // Release private snapshots on success or failure, including any
            // volatile PM body. A failed one-shot restore cannot be retried.
            records.length = 0; pending.length = 0;
        }
    };
    return Object.freeze({ restore, metrics });
}
