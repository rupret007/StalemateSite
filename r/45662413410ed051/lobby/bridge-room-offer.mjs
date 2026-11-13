// WebJam room Play. Imported later by the lobby. One host confirm registers
// one Chess seat for people already in this room and shows one Join Chess
// control. It does not open another room or a share sheet.

export const JOIN_CHESS_LABEL = 'Join Chess';
export const OFFER_MIN_PX = 44;
export const CHESS_GAME = 'chess';

const JAM_ROOM = /^#jam(?:-[a-z0-9-]{1,26})?$/;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-f0-9]{32}$/;
const MATCH = /^[a-zA-Z0-9-]{5,80}$/;
const SUBJECT = /^[a-z0-9-]{16,64}$/;

const refused = reason => ({ ok: false, status: 403, reason, shareSheet: false, secondRoom: false });

export function raiseInRoomOffer(button) {
    if (!button?.hasAttribute?.('data-game-offer-join')) return button;
    button.style.minHeight = `${OFFER_MIN_PX}px`;
    return button;
}

function joinButton(document) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = JOIN_CHESS_LABEL;
    button.style.minHeight = `${OFFER_MIN_PX}px`;
    button.style.minWidth = `${OFFER_MIN_PX}px`;
    button.dataset.bridgeJoinChess = 'true';
    return button;
}

export function createRoomOffer({ room, register }) {
    if (!JAM_ROOM.test(room || '') || typeof register !== 'function') throw new TypeError('Play stays in the current WebJam room.');
    let confirmed = false;
    let roster = new Set();
    let hostId = null;

    return {
        async confirmPlay({ hostId: id, hostSubject, members, ref, match, hash, now }) {
            if (confirmed) return { ok: false, status: 409, reason: 'already-confirmed', shareSheet: false, secondRoom: false, room };
            if (!Array.isArray(members) || !members.every(member => typeof member === 'string' && member.length > 0)
                || !members.includes(id)) return refused('not-in-room');
            const guests = members.filter(member => member !== id);
            if (guests.length === 0) return refused('nobody-waiting');
            if (!SUBJECT.test(hostSubject || '') || !REF.test(ref || '') || !MATCH.test(match || '')
                || !HASH.test(hash || '') || !Number.isFinite(now)) return refused('unavailable');
            let result;
            try {
                result = await register({
                    room, game: CHESS_GAME, match, hostSubject, hashes: [hash], now, ref
                });
            } catch {
                return { ok: false, status: 503, reason: 'unavailable', shareSheet: false, secondRoom: false, room };
            }
            if (result?.ok === true && result.body?.granted === 1) {
                confirmed = true;
                hostId = id;
                roster = new Set(members);
            }
            return { ...result, shareSheet: false, secondRoom: false, room };
        },

        offerFor(memberId) {
            if (!confirmed || memberId === hostId || !roster.has(memberId)) return null;
            return { label: JOIN_CHESS_LABEL, minHeightPx: OFFER_MIN_PX, room, shareSheet: false, secondRoom: false };
        },

        render(document, memberId) {
            if (!this.offerFor(memberId)) return null;
            const button = joinButton(document);
            button.dataset.room = room;
            return button;
        }
    };
}
