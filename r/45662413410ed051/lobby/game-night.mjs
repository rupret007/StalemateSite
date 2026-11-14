// Accept only Discord's HTTPS invites and server channel links.
const INVITE = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9_-]{2,64}$/;
const CHANNEL = /^https:\/\/discord\.com\/channels\/[0-9]{17,20}\/[0-9]{17,20}$/;

export function discordCallLink(value) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    return INVITE.test(url) || CHANNEL.test(url) ? url : '';
}

// Reserve a generated room-name format so the durable chat record stays
// readable by the previous Worker without a storage migration.
export const webJamRoomName = name => typeof name === 'string' && /^#jam(?:-[a-z0-9-]{1,26})?$/.test(name);
export const gameNightRoomName = name => typeof name === 'string' && /^#game-[a-f0-9]{6}x[a-f0-9]{6}$/.test(name);

export function newGameNightRoomName() {
    // Split the random name to avoid phone-number matches.
    const code = crypto.randomUUID().replaceAll('-', '');
    return `#game-${code.slice(0, 6)}x${code.slice(6, 12)}`;
}

export const gameNightLabels = Object.freeze({
    chess: 'Royal Flush Chess', crapeights: 'Crappy Eights', turdrummy: 'TurdRummy', turdspades: 'TurdSpades',
    turdjack: 'Crapjack 21', turdtris: 'Turdtris Sprint', turdomania: 'Turdomania Duel',
    turdrush: 'Turd Rush Race', turdanoid: 'Turdanoid Brick Race'
});
const matchId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const gameInviteCode = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}\.[A-Za-z0-9_-]{43}$/.test(value);

export function gameNightInvite(game, match) {
    return typeof game === 'string' && Object.hasOwn(gameNightLabels, game) && typeof match === 'string' && matchId.test(match) ? { game, match } : null;
}

export function gameNightReturnHint(value, validRoom, now = Date.now()) {
    if (!value || !validRoom(value.room) || typeof value.ref !== 'string' || !/^[a-f0-9]{32}$/.test(value.ref)
        || !Number.isFinite(value.until) || value.until <= now) return null;
    const { room, ref, until, game } = value;
    return { room, ref, until, ...(gameNightRoomName(room) && typeof game === 'string' && Object.hasOwn(gameNightLabels, game) ? { game } : {}) };
}

export const GAME_INVITE_UNAVAILABLE = 'This invite is no longer available. Ask your host for a new one.';
