// Test-only bounded retention: every payload is still cloned synchronously.
// Keeps the latest snapshot per key, not a complete persistence history.
export function createLatestPersistenceSnapshots(writes) {
    const positions = new Map();
    let total = 0;
    return (key, value) => {
        const snapshot = structuredClone(value);
        if (positions.has(key)) writes[positions.get(key)] = [key, snapshot];
        else { positions.set(key, writes.length); writes.push([key, snapshot]); }
        return ++total;
    };
}
