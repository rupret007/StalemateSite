// Test-only sink. Not a storage adapter or a production performance claim.
// Preserves every AI-review emission as a deep snapshot. Other records are
// counted without retaining references; their cloneability is not tested here.
export function createAiReviewPersistenceSink(writes) {
    const counts = new Map();
    let total = 0;
    return {
        counts,
        persist(key, value) {
            // Clone before changing counters: a snapshot error still propagates.
            if (key === 'ai-reviews') writes.push([key, structuredClone(value)]);
            counts.set(key, (counts.get(key) || 0) + 1);
            return ++total; // Same successful-call ordinal as old writes.push.
        }
    };
}
