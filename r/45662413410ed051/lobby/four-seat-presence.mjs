// Waiting and host-left copy for the shared Four in a Row table.
// Hang Out already drops the match when the host leaves the room. This module
// turns that moment, and a quiet open seat, into stranger-readable status.
// It does not keep its own invitation map or a second game server.

export const FOUR_PRESENCE_MS = 30 * 1000;

export const LOBBY_HOST_WAITING = 'Waiting for someone in the room to join.';
export const LOBBY_OPEN_SEAT = 'An open seat is available. X goes first.';
export const LOBBY_MATCH_ENDED = 'Match ended. A host can open another.';
export const LOBBY_INTRO = 'Two players. Connect four pieces in any direction.';

export const FOUR_HOST_WAITING = 'Waiting for a friend to take the open seat.';
export const FOUR_GUEST_FIRST = "You're O. Waiting for Host to drop the first piece";
export const FOUR_HOST_LEFT = "Your friend's host left - start your own game";

const MOVE = /^([XO]) played column ([1-7])\. ([XO]) to play\.$/;
const BARE = /^([XO]) to play\.$/;

export function emptyFourSeatMemory() {
    return { seat: '', hostLeft: false, selfLeft: false, finished: false, authored: '', shown: '' };
}

// Membership wins when the caller knows it. A last-seen time applies only when
// the caller cannot tell whether the host is still in the room.
export function hostGone({ guestSeated = false, hostConnected, hostSeenAt, now } = {}) {
    if (!guestSeated) return false;
    if (hostConnected === false) return true;
    if (hostConnected === true) return false;
    if (typeof hostSeenAt !== 'number' || typeof now !== 'number') return false;
    return now - hostSeenAt > FOUR_PRESENCE_MS;
}

export function fourDropReason({ hostLeft = false, waiting = false, finished = false, yourTurn = false, columnOk = true } = {}) {
    if (hostLeft) return 'host-left';
    if (waiting) return 'waiting';
    if (finished) return 'finished';
    if (!yourTurn) return 'wrong-turn';
    if (!columnOk) return 'illegal-move';
    return '';
}

export function fourDropMessage(reason) {
    const messages = {
        waiting: 'The open seat is still empty.',
        'wrong-turn': 'Waiting for the other player to move.',
        finished: 'This match is over. Start your own game.',
        'illegal-move': 'That column is full.',
        'host-left': FOUR_HOST_LEFT
    };
    return messages[reason] || '';
}

export function fourOwnGameHref(search = '') {
    const params = new URLSearchParams(String(search).replace(/^\?/, ''));
    const via = params.getAll('via');
    const source = via.length === 1 && (via[0] === 'rad-dad' || via[0] === 'stalemate') ? via[0] : '';
    return `/beta/?game-night=1${source ? `&via=${source}` : ''}`;
}

function waitingMove(mark) {
    return `Waiting for ${mark} to move`;
}

export function presentFourSeat(memory = emptyFourSeatMemory(), view = {}) {
    const status = typeof view.status === 'string' ? view.status : '';
    const leaveLabel = view.leaveHidden ? '' : String(view.leaveLabel || '');
    const next = {
        seat: memory.seat || '',
        hostLeft: memory.hostLeft === true,
        selfLeft: memory.selfLeft === true || view.selfLeft === true,
        finished: memory.finished === true,
        authored: status,
        shown: ''
    };

    const yourTurn = status.match(/Your turn \(([XO])\)\./);
    if (yourTurn) next.seat = yourTurn[1];
    else if (status === LOBBY_HOST_WAITING || leaveLabel === 'Close match') next.seat = 'X';
    else if (status === LOBBY_OPEN_SEAT) next.seat = '';
    else if (leaveLabel === 'Leave match') {
        const moved = status.match(MOVE);
        const bare = status.match(BARE);
        const mark = moved?.[3] || bare?.[1] || '';
        if (mark === 'X') next.seat = 'O';
        else if (mark === 'O') next.seat = 'X';
    }

    const priorFinished = memory.finished === true;
    if (/wins\.$/.test(status) || status === 'Draw.') next.finished = true;

    const fresh = status === LOBBY_HOST_WAITING || status === LOBBY_OPEN_SEAT || status === LOBBY_INTRO;
    if (fresh) {
        next.finished = false;
        next.hostLeft = false;
        next.selfLeft = false;
    }

    const seatedGuest = next.seat === 'O' && !next.selfLeft && !priorFinished;
    if (status === LOBBY_MATCH_ENDED && seatedGuest) next.hostLeft = true;
    else if (status === LOBBY_MATCH_ENDED) next.hostLeft = false;
    else if (hostGone({
        guestSeated: seatedGuest && status !== '' && !fresh,
        hostConnected: view.hostConnected,
        hostSeenAt: view.hostSeenAt,
        now: view.now
    })) next.hostLeft = true;

    let shown = status;
    let phase = 'ready';
    let showBoard = false;
    let ownGame = false;
    let presence = '';

    if (next.hostLeft) {
        shown = FOUR_HOST_LEFT;
        phase = 'blocked';
        ownGame = true;
        presence = 'Host left';
    } else if (status === LOBBY_HOST_WAITING) {
        shown = FOUR_HOST_WAITING;
        phase = 'waiting';
        showBoard = true;
        presence = 'Waiting for your friend…';
    } else if (status === 'X to play.' && leaveLabel === 'Leave match') {
        shown = FOUR_GUEST_FIRST;
        phase = 'waiting';
        next.seat = 'O';
        presence = 'Live · Host is at the table';
    } else if (MOVE.test(status)) {
        const moved = status.match(MOVE);
        shown = `${moved[1]} played column ${moved[2]}. ${waitingMove(moved[3])}`;
        phase = 'waiting';
        presence = `Live · waiting for ${moved[3]}`;
    } else if (BARE.test(status)) {
        const mark = status[0];
        shown = waitingMove(mark);
        phase = 'waiting';
        presence = `Live · waiting for ${mark}`;
    }

    next.shown = shown;
    return {
        memory: next,
        status: shown,
        phase,
        showBoard,
        ownGame,
        presence,
        presenceLive: phase === 'waiting'
    };
}
