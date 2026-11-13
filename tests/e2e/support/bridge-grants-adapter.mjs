// Bridge grants adapter. Tests talk to room grants only through this file.
//
// STAND-IN: the factory below is an in-test stand-in. It is not the Worker.
// hangout-worker/src/game-night-room-grants.mjs is not in this worktree yet.
//
// One-line swap, only after that module is present and the table-hold plus
// route hooks are registered (importing it before then fails the suite):
// export { createRoomGrants } from '../../../hangout-worker/src/game-night-room-grants.mjs';
//
// Delete the stand-in factory when you uncomment that line. Keep USING_STAND_IN
// in sync: the Worker e2e cases stay test.fixme until the live route exists.
// Do not point a fixme at this stand-in to make it pass.

export const USING_STAND_IN = true;
export const HOLD_MS = 60_000;
export const GRANT_TTL_MS = 120_000;
export const TABLE_FULL = "Table full, you're up next game";
export const EXPIRED_ERROR = 'This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite.';
const HASH = /^[a-f0-9]{64}$/;
const SECRET_FIELDS = ['raw', 'code', 'token', 'value', 'secret', 'grant'];

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
});
const expired = () => reply({ error: EXPIRED_ERROR }, 410);
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0;

export async function hashGrant(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createRoomGrants({ now = () => Date.now() } = {}) {
    const tables = new Map();
    const keyOf = (room, match) => `${room}\n${match}`;
    const liveHold = (table, seat, at) => {
        const hold = table.holds.get(seat);
        return hold && hold.until > at ? hold : null;
    };
    const freeSeat = (table, at) => table.seats.b === null && !liveHold(table, 'b', at);
    const summary = table => ({
        room: table.room, match: table.match, game: table.game, status: table.status, present: true,
        seats: { ...table.seats },
        holds: [...table.holds.entries()].map(([seat, hold]) => ({ seat, hash: hold.hash, until: hold.until })),
        grants: [...table.grants.values()].map(({ hash, seat, burned, until, holdUntil }) => ({ hash, seat, burned, until, holdUntil }))
    });

    function seatHost({ hostSession, room, match, game }) {
        if (game !== 'chess') return reply({ error: 'This slice seats Chess only.' }, 403);
        if (!text(hostSession) || !text(room) || !text(match)) return reply({ error: 'The host session is missing.' }, 400);
        const key = keyOf(room, match);
        if (tables.has(key)) return reply({ error: 'The host is already seated.' }, 409);
        tables.set(key, {
            hostSession, room, match, game, status: 'waiting',
            seats: { w: hostSession, b: null }, holds: new Map(), grants: new Map()
        });
        return reply({ ok: true, status: 'waiting', seat: 'w' });
    }

    // Loading a fragment must not call this with confirmed:true. The host tap does.
    function registerGrants(input) {
        if (input?.confirmed !== true) return reply({ error: 'The host must confirm before any grant is issued.' }, 400);
        const table = tables.get(keyOf(input.room, input.match));
        if (!table || table.hostSession !== input.hostSession || table.game !== 'chess' || input.game !== 'chess') {
            return reply({ error: 'The host is seated by their own session before any grant exists.' }, 403);
        }
        const grants = Array.isArray(input.grants) ? input.grants : null;
        if (!grants) return reply({ error: 'Grants are stored as hashes only.' }, 400);
        for (const grant of grants) {
            if (!grant || typeof grant !== 'object' || SECRET_FIELDS.some(field => field in grant)) {
                return reply({ error: 'Grants are stored as hashes only.' }, 400);
            }
            if (grant.seat !== 'next' || !HASH.test(grant.hash || '')) {
                return reply({ error: "Grants resolve only to seat 'next'." }, 400);
            }
        }
        const at = input.now ?? now();
        const created = [];
        const overflow = [];
        for (const grant of grants) {
            if (!freeSeat(table, at) || table.grants.has(grant.hash)) {
                overflow.push({ message: TABLE_FULL, enabled: true, disabled: false });
                continue;
            }
            const holdUntil = at + HOLD_MS;
            table.holds.set('b', { hash: grant.hash, until: holdUntil });
            table.grants.set(grant.hash, {
                hash: grant.hash, seat: 'next', burned: false, until: at + GRANT_TTL_MS, holdUntil
            });
            created.push({ hash: grant.hash, seat: 'next', until: holdUntil });
        }
        return reply({ ok: true, status: table.status, grants: created, overflow });
    }

    function notePageLoad() {
        return { registered: 0, issued: false };
    }

    async function redeemGrant({ session, raw, room, match, now: at = now() }) {
        const table = tables.get(keyOf(room, match));
        if (!table) return expired();
        if (session === table.hostSession) return reply({ error: 'A host session cannot claim a guest grant.' }, 403);
        const hash = await hashGrant(raw);
        const grant = table.grants.get(hash);
        if (grant?.burned) return expired();
        const hold = table.holds.get('b');
        const holdExpired = hold && hold.hash === hash && hold.until <= at;
        if (grant && (grant.until <= at || holdExpired || !hold || hold.hash !== hash)) {
            if (hold && (hold.hash === hash || hold.until <= at)) table.holds.delete('b');
            if (table.seats.b === null) table.status = 'waiting';
            return expired();
        }
        if (grant && !grant.burned && grant.until > at && hold?.hash === hash && hold.until > at) {
            grant.burned = true;
            table.holds.delete('b');
            table.seats.b = session;
            table.status = 'playing';
            return reply({ ok: true, game: 'chess', seat: 'b', waiting: false });
        }
        if (!freeSeat(table, at)) return reply({ message: TABLE_FULL, enabled: true, disabled: false });
        return expired();
    }

    function sweep(at = now()) {
        const released = [];
        for (const table of tables.values()) {
            for (const [seat, hold] of [...table.holds.entries()]) {
                if (hold.until > at || table.seats[seat]) continue;
                table.holds.delete(seat);
                const grant = table.grants.get(hold.hash);
                if (grant && !grant.burned) grant.until = Math.min(grant.until, at);
                if (table.seats.b === null) table.status = 'waiting';
                released.push({ room: table.room, match: table.match, seat });
            }
        }
        return { released, tables: [...tables.values()].map(summary) };
    }

    function revokeAll({ room, match } = {}) {
        let revoked = 0;
        for (const table of tables.values()) {
            if (room && table.room !== room) continue;
            if (match && table.match !== match) continue;
            for (const grant of table.grants.values()) {
                if (grant.burned) continue;
                grant.burned = true;
                revoked += 1;
            }
            table.holds.clear();
            if (table.seats.b === null) table.status = 'waiting';
        }
        return { revoked, tables: [...tables.values()].map(summary) };
    }

    return { seatHost, registerGrants, notePageLoad, redeemGrant, sweep, revokeAll, snapshot: () => [...tables.values()].map(summary) };
}
