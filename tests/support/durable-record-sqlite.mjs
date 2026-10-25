// Test-only disk driver. SQLite is the actual rollback domain, not a Map copy.
import { DatabaseSync } from 'node:sqlite';
import { serialize, deserialize } from 'node:v8';

export function openDurableRecordSqlite(filename, hooks = {}) {
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-64; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value BLOB NOT NULL) STRICT;');
    const get = db.prepare('SELECT value FROM records WHERE key = ?');
    const put = db.prepare('INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const remove = db.prepare('DELETE FROM records WHERE key = ?');
    const list = db.prepare('SELECT key,value FROM records WHERE key >= ? AND key < ? AND (? IS NULL OR key > ?) ORDER BY key LIMIT ?');
    const stats = { transactions: 0, commits: 0, rollbacks: 0, operations: [] };
    let tail = Promise.resolve(), closed = false;
    const driver = {
        stats,
        transaction(callback) {
            const task = tail.then(async () => {
                if (closed) throw Error('test-sqlite-closed');
                stats.transactions += 1;
                db.exec('BEGIN IMMEDIATE');
                let active = true;
                const operation = async (name, key, value, apply) => {
                    if (!active) throw Error('test-raw-transaction-closed');
                    const event = { name, key, value, ordinal: stats.operations.length + 1 };
                    stats.operations.push(event);
                    await hooks.before?.(event);
                    const result = apply();
                    await hooks.after?.(event);
                    return result;
                };
                const raw = {
                    get: key => operation('get', key, undefined, () => {
                        const row = get.get(key); return row ? deserialize(row.value) : undefined;
                    }),
                    put: (key, value) => operation('put', key, value, () => { put.run(key, serialize(value)); }),
                    delete: key => operation('delete', key, undefined, () => remove.run(key).changes > 0),
                    list: options => operation('list', options?.prefix, options, () => {
                        if (typeof options?.prefix !== 'string' || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 4)
                            throw Error('test-driver-unbounded-list');
                        return new Map(list.all(options.prefix, options.prefix + '\uffff', options.startAfter ?? null, options.startAfter ?? null, options.limit)
                            .map(row => [row.key, deserialize(row.value)]));
                    })
                };
                try {
                    const result = await callback(raw);
                    active = false;
                    db.exec('COMMIT');
                    stats.commits += 1;
                    return result;
                } catch (error) {
                    active = false;
                    db.exec('ROLLBACK');
                    stats.rollbacks += 1;
                    throw error;
                }
            });
            tail = task.catch(() => {});
            return task;
        },
        rows() {
            return new Map(db.prepare('SELECT key,value FROM records ORDER BY key').all()
                .map(row => [row.key, deserialize(row.value)]));
        },
        resetOperations() { stats.operations.length = 0; },
        async close() { await tail; if (!closed) { closed = true; db.close(); } }
    };
    return driver;
}
