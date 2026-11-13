// Maps a taken Chess seat onto the offer the guest already has open.
// The redeem route is Hook 2 and is not registered here.

export const ASK_HOST_COPY = 'This game invitation no longer has an open seat. Ask the host for a fresh invitation.';
export const TABLE_FULL_COPY = "Table full, you're up next game";

export const REDEEM_METHOD = 'POST';
export const REDEEM_PATH = '/beta/game-night/room-grant/redeem';
const VALUE = /^[A-Za-z0-9_-]{32,128}$/;

export function redeemRequest({ value, attempt }) {
    if (!VALUE.test(value || '') || !VALUE.test(attempt || '')) return null;
    return {
        method: REDEEM_METHOD,
        path: REDEEM_PATH,
        headers: { 'Content-Type': 'application/json' },
        body: { value, attempt, age13: true }
    };
}

// Seats taken: the table-full sentence, and the guest stays in this room.
// Anything else, including a missing route, is left to the caller.
export function mapTakenSeats({ seatsTaken = false, status = null, body = null } = {}) {
    const full = seatsTaken === true || (status === 409 && body?.tableFull === true);
    if (!full) return { handled: false, stayInRoom: false, message: null, askHost: false, next: null };
    return { handled: true, stayInRoom: true, message: TABLE_FULL_COPY, askHost: false, next: null };
}
