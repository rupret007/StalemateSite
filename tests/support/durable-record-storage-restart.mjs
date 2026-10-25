// Invoked in a separate Node process by the disk persistence test.
import { openDurableRecordSqlite } from './durable-record-sqlite.mjs';
import { writeSync } from 'node:fs';
import { createDurableRecordStorage } from '../../hangout-worker/src/durable-record-storage.mjs';

const [filename, key, mode = 'read'] = process.argv.slice(2);
if (!filename || !key || !['read', 'crash-uncommitted'].includes(mode) || process.argv.length > 5)
    throw Error('Explicit fixture database, key and known probe mode required');
const driver = openDurableRecordSqlite(filename);
try {
    const store = createDurableRecordStorage({ storage: driver, namespace: 'restart-test', maxRecordBytes: 1024 * 1024 });
    if (mode === 'crash-uncommitted') {
        await store.transaction(async tx => {
            await tx.put(key, { uncommitted: 'x'.repeat(300000) });
            await tx.put('partial-only', { uncommitted: true });
            writeSync(1, JSON.stringify({ uncommittedWritesCompleted: true }) + '\n');
            process.kill(process.pid, 'SIGKILL');
        });
        throw Error('Crash probe unexpectedly returned');
    }
    const before = await store.transaction(tx => tx.get(key));
    await store.transaction(tx => tx.put('child-receipt', { read: before, childProcess: true }));
    process.stdout.write(JSON.stringify({ read: before, childProcess: true }) + '\n');
} finally { await driver.close(); }
