// Coalesce replaceable presence projections, never chat, activity or authority.
// The queue retains bounded room names/generation numbers and one directory bit.
// The adapter serializes flush() with application commands and recomputes views.
export function createPresenceProjections({ flush, serialize = fn => fn(), delay = 50,
    schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), maxChannels = 32 } = {}) {
    if (typeof flush !== 'function' || typeof serialize !== 'function' || !Number.isInteger(delay) || delay < 1 || delay > 50
        || !Number.isInteger(maxChannels) || maxChannels < 1 || maxChannels > 32) throw new Error('Invalid presence projection configuration');
    const channels = new Map();
    let directory = false, allChannels = false, timer = null, running = null, disposed = false;
    const stats = { marks: 0, flushes: 0, overflows: 0, failures: 0, peakChannels: 0 };
    const dirty = () => directory || allChannels || channels.size > 0;
    const arm = () => {
        if (disposed || timer !== null || running || !dirty()) return;
        timer = schedule(() => { timer = null; return drain(); }, delay);
        timer?.unref?.();
    };
    const drain = () => {
        if (running) return running;
        if (disposed || !dirty()) return Promise.resolve();
        if (timer !== null) { cancel(timer); timer = null; }
        const batch = { directory, allChannels, channels: [...channels].map(([name, generation]) => ({ name, generation })) };
        directory = false; allChannels = false; channels.clear();
        // Start serialization in a microtask, so all callers observe running
        // before a synchronous adapter can finish or schedule another marker.
        running = Promise.resolve().then(() => serialize(() => {
            if (!disposed) { stats.flushes += 1; return flush(batch); }
        })).catch(() => { stats.failures += 1; }).finally(() => { running = null; arm(); });
        return running;
    };
    return {
        mark(value) {
            if (disposed || !value || typeof value !== 'object' || Array.isArray(value)) return false;
            if (value.directory !== true && value.channel === undefined) return false;
            if (value.channel !== undefined && (typeof value.channel !== 'string' || !/^#[a-z0-9-]{2,30}$/.test(value.channel)
                || !Number.isSafeInteger(value.generation) || value.generation < 1)) return false;
            stats.marks += 1;
            if (value.directory === true) directory = true;
            if (value.channel !== undefined && !allChannels) {
                if (!channels.has(value.channel) && channels.size >= maxChannels) {
                    // A bounded fallback recomputes current active rooms; it
                    // never retains an unbounded sequence of departed names.
                    channels.clear(); allChannels = true; stats.overflows += 1;
                } else channels.set(value.channel, value.generation);
            }
            stats.peakChannels = Math.max(stats.peakChannels, channels.size);
            arm(); return true;
        },
        flush: drain,
        dispose() { disposed = true; if (timer !== null) cancel(timer); timer = null; channels.clear(); directory = false; allChannels = false; },
        snapshot: () => ({ ...stats, pendingChannels: channels.size, directory, allChannels, scheduled: timer !== null, running: !!running, delay, maxChannels })
    };
}
