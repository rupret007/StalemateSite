// Daily join-funnel counters. Storage holds UTC day + source + event -> integer.
// Unknown event names are refused. Any other source collapses to "unknown".
// A report never returns a count below minCell, and it withholds a total or a
// ratio when a small day would make that total invertible.

export const JOIN_FUNNEL_EVENTS = Object.freeze([
    'invite_created',
    'invite_opened',
    'redeemed',
    'room_joined',
    'seated',
    'game_finished',
    'rematch',
    'install_card_shown'
]);
// install_card_shown is an impression, not the step after rematch.
export const JOIN_FUNNEL_STEPS = Object.freeze([
    'invite_created',
    'invite_opened',
    'redeemed',
    'room_joined',
    'seated',
    'game_finished',
    'rematch'
]);
export const JOIN_FUNNEL_SOURCES = Object.freeze(['stalemate', 'rad-dad', 'unknown']);

const PREFIX = 'jf:v1:';
const LIST_LIMIT = 128;
const EVENT_SET = new Set(JOIN_FUNNEL_EVENTS);
const SOURCE_SET = new Set(JOIN_FUNNEL_SOURCES);
const KEY = /^(\d{4}-\d{2}-\d{2}):(stalemate|rad-dad|unknown):([a-z_]+)$/;

function assertStorage(storage) {
    if (!storage || ['get', 'put', 'list', 'delete'].some(name => typeof storage[name] !== 'function')) throw new TypeError('storage');
}

function retentionOf(value) {
    if (!Number.isInteger(value) || value < 1 || value > 366) throw new TypeError('retentionDays');
    return value;
}

function epoch(now) {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now');
    return value;
}

function utcDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

function realDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), date = Number(match[3]);
    const time = new Date(Date.UTC(year, month - 1, date));
    return time.getUTCFullYear() === year && time.getUTCMonth() === month - 1 && time.getUTCDate() === date;
}

function shiftDay(day, delta) {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

function queue() {
    let tail = Promise.resolve();
    return task => {
        const run = tail.then(task, task);
        tail = run.then(() => {}, () => {});
        return run;
    };
}

function bucketKey(day, source, event) {
    return `${PREFIX}${day}:${source}:${event}`;
}

function parseKey(key) {
    if (!key.startsWith(PREFIX)) return null;
    const match = KEY.exec(key.slice(PREFIX.length));
    if (!match || !EVENT_SET.has(match[3]) || !realDay(match[1])) return null;
    return { day: match[1], source: match[2], event: match[3] };
}

function countOf(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function listPrefix(storage, prefix) {
    const keys = [];
    const seen = new Set();
    let startAfter;
    for (let page = 0; page < 10000; page++) {
        const listed = await storage.list({ prefix, limit: LIST_LIMIT, ...(startAfter ? { startAfter } : {}) });
        if (!listed || typeof listed.keys !== 'function') throw new TypeError('storage');
        const batch = [...listed.keys()].sort();
        if (!batch.length) break;
        const fresh = batch.filter(key => key.startsWith(prefix) && (!startAfter || key > startAfter) && !seen.has(key));
        if (!fresh.length) break;
        for (const key of fresh) {
            seen.add(key);
            keys.push(key);
        }
        if (batch.length < LIST_LIMIT) break;
        startAfter = fresh[fresh.length - 1];
    }
    return keys;
}

async function deleteChunks(storage, keys) {
    for (let index = 0; index < keys.length; index += LIST_LIMIT) {
        await storage.delete(keys.slice(index, index + LIST_LIMIT));
    }
    return keys.length;
}

function emptyCounts() {
    const counts = {};
    for (const source of JOIN_FUNNEL_SOURCES) {
        counts[source] = {};
        for (const event of JOIN_FUNNEL_EVENTS) counts[source][event] = 0;
    }
    return counts;
}

function shown(count, minCell) {
    return typeof count === 'number' && count >= minCell ? count : `<${minCell}`;
}

// A total is published only when every day in the window is itself publishable.
// Otherwise a reader could subtract the exact days from the total and recover a "<3".
function shownTotal(perDay, minCell) {
    if (perDay.some(count => count < minCell)) return `<${minCell}`;
    return perDay.reduce((sum, count) => sum + count, 0);
}

function stepRatio(fromCount, toCount) {
    if (typeof fromCount !== 'number' || typeof toCount !== 'number' || fromCount === 0) return null;
    return Math.round((toCount / fromCount) * 10000) / 10000;
}

function conversions(counts, minCell) {
    const rows = {};
    for (const source of JOIN_FUNNEL_SOURCES) {
        rows[source] = [];
        for (let index = 0; index < JOIN_FUNNEL_STEPS.length - 1; index++) {
            const from = JOIN_FUNNEL_STEPS[index], to = JOIN_FUNNEL_STEPS[index + 1];
            const fromCount = shown(counts[source][from], minCell);
            const toCount = shown(counts[source][to], minCell);
            rows[source].push({ from, to, fromCount, toCount, ratio: stepRatio(fromCount, toCount) });
        }
    }
    return rows;
}

function presentCounts(raw, minCell) {
    const counts = {};
    for (const source of JOIN_FUNNEL_SOURCES) {
        counts[source] = {};
        for (const event of JOIN_FUNNEL_EVENTS) counts[source][event] = shown(raw[source][event], minCell);
    }
    return counts;
}

export function createJoinFunnel({ storage, now, retentionDays = 30 } = {}) {
    assertStorage(storage);
    if (typeof now !== 'function') throw new TypeError('now');
    const retention = retentionOf(retentionDays);
    const serial = queue();

    async function record(event, source) {
        if (typeof event !== 'string' || !EVENT_SET.has(event)) return false;
        const normalised = SOURCE_SET.has(source) ? source : 'unknown';
        return serial(async () => {
            const day = utcDay(epoch(now));
            const key = bucketKey(day, normalised, event);
            const next = countOf(await storage.get(key)) + 1;
            if (!Number.isSafeInteger(next)) return true;
            await storage.put(key, next);
            return true;
        });
    }

    async function report({ days, minCell = 3 } = {}) {
        if (!Number.isSafeInteger(days) || days < 1) throw new TypeError('days');
        if (!Number.isSafeInteger(minCell) || minCell < 1 || minCell > 1000000) throw new TypeError('minCell');
        const span = Math.min(days, retention);
        const today = utcDay(epoch(now));
        const dayList = [];
        for (let ago = span - 1; ago >= 0; ago--) dayList.push(shiftDay(today, -ago));
        const window = new Set(dayList);
        const rawDays = Object.fromEntries(dayList.map(day => [day, emptyCounts()]));
        for (const key of await listPrefix(storage, PREFIX)) {
            const parsed = parseKey(key);
            if (!parsed || !window.has(parsed.day)) continue;
            rawDays[parsed.day][parsed.source][parsed.event] += countOf(await storage.get(key));
        }
        const daysOut = {};
        const series = emptyCounts();
        for (const source of JOIN_FUNNEL_SOURCES) {
            for (const event of JOIN_FUNNEL_EVENTS) series[source][event] = [];
        }
        for (const day of dayList) {
            daysOut[day] = { counts: presentCounts(rawDays[day], minCell), conversions: conversions(rawDays[day], minCell) };
            for (const source of JOIN_FUNNEL_SOURCES) {
                for (const event of JOIN_FUNNEL_EVENTS) series[source][event].push(rawDays[day][source][event]);
            }
        }
        const totals = {};
        for (const source of JOIN_FUNNEL_SOURCES) {
            totals[source] = {};
            for (const event of JOIN_FUNNEL_EVENTS) totals[source][event] = shownTotal(series[source][event], minCell);
        }
        return {
            minCell,
            retentionDays: retention,
            from: dayList[0],
            to: dayList[dayList.length - 1],
            sources: [...JOIN_FUNNEL_SOURCES],
            events: [...JOIN_FUNNEL_EVENTS],
            steps: [...JOIN_FUNNEL_STEPS],
            days: daysOut,
            totals: { counts: totals, conversions: conversions(totals, minCell) }
        };
    }

    function prune() {
        return serial(async () => {
            const cutoff = shiftDay(utcDay(epoch(now)), -(retention - 1));
            const stale = [];
            for (const key of await listPrefix(storage, PREFIX)) {
                const parsed = parseKey(key);
                if (!parsed || parsed.day < cutoff) stale.push(key);
            }
            return { deleted: await deleteChunks(storage, stale) };
        });
    }

    return { record, report, prune };
}
