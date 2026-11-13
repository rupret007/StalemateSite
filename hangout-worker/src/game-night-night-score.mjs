// Light "tonight" score for one room. A night is the local calendar date in
// timeZone, except a finish before 06:00 local counts toward the previous night.
// Stored rows are display nicks plus win and draw counts. Rows drop 24h after
// that night ends (06:00 local the next morning, plus 24 absolute hours).

const PREFIX = 'ns:v1:';
const LIST_LIMIT = 128;
const NICK_MAX = 24;
const PLAYER_MAX = 12;
const ROOM_ID = /^#[a-z0-9-]{2,30}$/;
const HOUR_MS = 60 * 60 * 1000;
const EMPTY = 'Tonight: no results yet';
const DOT = ' \u00b7 ';

function assertStorage(storage) {
    if (!storage || ['get', 'put', 'list', 'delete'].some(name => typeof storage[name] !== 'function')) throw new TypeError('storage');
}

function epoch(now) {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now');
    return value;
}

function queue() {
    let tail = Promise.resolve();
    return task => {
        const run = tail.then(task, task);
        tail = run.then(() => {}, () => {});
        return run;
    };
}

function realDay(year, month, day) {
    const time = new Date(Date.UTC(year, month - 1, day));
    return time.getUTCFullYear() === year && time.getUTCMonth() === month - 1 && time.getUTCDate() === day;
}

function formatDay(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(year, month, day, delta) {
    const time = new Date(Date.UTC(year, month - 1, day + delta));
    return { year: time.getUTCFullYear(), month: time.getUTCMonth() + 1, day: time.getUTCDate() };
}

function partsInZone(format, ms) {
    const bag = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    for (const part of format.formatToParts(new Date(ms))) {
        if (Object.hasOwn(bag, part.type)) bag[part.type] = Number(part.value);
    }
    if (bag.hour === 24) bag.hour = 0;
    return bag;
}

function offsetMs(format, ms) {
    const parts = partsInZone(format, ms);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

function zonedTimeToUtc(format, year, month, day, hour, minute) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    let utc = guess;
    for (let pass = 0; pass < 4; pass++) {
        const next = guess - offsetMs(format, utc);
        if (next === utc) break;
        utc = next;
    }
    const check = partsInZone(format, utc);
    if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
        throw new TypeError('time');
    }
    return utc;
}

function nightOf(format, ms) {
    const parts = partsInZone(format, ms);
    const date = parts.hour < 6 ? addDays(parts.year, parts.month, parts.day, -1) : parts;
    return formatDay(date.year, date.month, date.day);
}

function nightPruneAt(format, night) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
    if (!match) return 0;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (!realDay(year, month, day)) return 0;
    const next = addDays(year, month, day, 1);
    return zonedTimeToUtc(format, next.year, next.month, next.day, 6, 0) + 24 * HOUR_MS;
}

function normalizeNick(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return '';
    const chars = Array.from(trimmed);
    return chars.length <= NICK_MAX ? trimmed : chars.slice(0, NICK_MAX).join('');
}

function playerNicks(players) {
    if (!Array.isArray(players)) return [];
    const nicks = [];
    const seen = new Set();
    for (const value of players) {
        const nick = normalizeNick(value);
        if (!nick || seen.has(nick)) continue;
        seen.add(nick);
        nicks.push(nick);
    }
    return nicks;
}

function readRows(value) {
    if (!Array.isArray(value)) return [];
    const rows = [];
    const seen = new Set();
    for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        const nick = normalizeNick(row.nick);
        if (!nick || seen.has(nick) || !Number.isSafeInteger(row.wins) || row.wins < 0 || !Number.isSafeInteger(row.draws) || row.draws < 0) continue;
        seen.add(nick);
        rows.push({ nick, wins: row.wins, draws: row.draws });
        if (rows.length === PLAYER_MAX) break;
    }
    return rows;
}

function bump(rows, nick, field) {
    const row = rows.find(item => item.nick === nick);
    if (!row || row[field] >= Number.MAX_SAFE_INTEGER) return;
    row[field] += 1;
}

function applyResult(rows, players, winner, draw) {
    const next = rows.map(row => ({ nick: row.nick, wins: row.wins, draws: row.draws }));
    const have = new Set(next.map(row => row.nick));
    const accepted = [];
    for (const nick of players) {
        if (!have.has(nick)) {
            if (next.length >= PLAYER_MAX) continue;
            next.push({ nick, wins: 0, draws: 0 });
            have.add(nick);
        }
        accepted.push(nick);
    }
    if (draw) for (const nick of accepted) bump(next, nick, 'draws');
    else if (accepted.includes(winner)) bump(next, winner, 'wins');
    return { rows: next, accepted };
}

function sortStandings(rows) {
    return [...rows].sort((a, b) => b.wins - a.wins || b.draws - a.draws || (a.nick < b.nick ? -1 : a.nick > b.nick ? 1 : 0));
}

function displayLine(rows) {
    const parts = [];
    for (const row of rows) {
        if (row.wins > 0 && row.draws > 0) parts.push(`${row.nick} ${row.wins} (${row.draws} ${row.draws === 1 ? 'draw' : 'draws'})`);
        else if (row.draws > 0) parts.push(`${row.nick} ${row.draws} ${row.draws === 1 ? 'draw' : 'draws'}`);
        else if (row.wins > 0) parts.push(`${row.nick} ${row.wins}`);
    }
    return parts.length ? `Tonight: ${parts.join(DOT)}` : EMPTY;
}

function storageKey(night, roomId) {
    return `${PREFIX}${night}:${roomId}`;
}

function parseKey(key) {
    const match = /^ns:v1:(\d{4}-\d{2}-\d{2}):(#[a-z0-9-]{2,30})$/.exec(key);
    if (!match) return null;
    const [year, month, day] = match[1].split('-').map(Number);
    if (!realDay(year, month, day)) return null;
    return { night: match[1], roomId: match[2] };
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

export function createNightScore({ storage, now, timeZone = 'America/Chicago' } = {}) {
    assertStorage(storage);
    if (typeof now !== 'function') throw new TypeError('now');
    let format;
    try {
        format = new Intl.DateTimeFormat('en-US', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        });
        format.format(new Date(0));
    } catch {
        throw new TypeError('timeZone');
    }
    const serial = queue();
    const empty = { night: null, standings: [], display: EMPTY };

    async function recordResult(roomId, result) {
        if (typeof roomId !== 'string' || !ROOM_ID.test(roomId) || !result || typeof result !== 'object' || Array.isArray(result)) return false;
        const players = playerNicks(result.players);
        const winner = normalizeNick(result.winnerNick);
        const draw = result.draw === true;
        if (draw ? players.length === 0 : !winner || !players.includes(winner)) return false;
        const night = nightOf(format, epoch(now));
        const key = storageKey(night, roomId);
        return serial(async () => {
            const applied = applyResult(readRows(await storage.get(key)), players, winner, draw);
            if (!applied.accepted.length) return false;
            await storage.put(key, applied.rows);
            return true;
        });
    }

    async function tonight(roomId) {
        if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) return { ...empty, standings: [] };
        const night = nightOf(format, epoch(now));
        const standings = sortStandings(readRows(await storage.get(storageKey(night, roomId))));
        return { night, standings, display: displayLine(standings) };
    }

    function prune() {
        return serial(async () => {
            const at = epoch(now);
            const stale = [];
            for (const key of await listPrefix(storage, PREFIX)) {
                const parsed = parseKey(key);
                if (!parsed || at >= nightPruneAt(format, parsed.night)) stale.push(key);
            }
            return { deleted: await deleteChunks(storage, stale) };
        });
    }

    return { recordResult, tonight, prune };
}
