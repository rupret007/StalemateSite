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

// Beta Game Night lobby card order (Map insertion order in lobby.js). TurdSpades is one
// card with 2-player partners and 4-player modes; partners is offered first in the panel UI.
export const GAME_NIGHT_LOBBY_ORDER = Object.freeze([
    'chess', 'turdspades', 'turdanoid',
    'crapeights', 'turdrummy', 'turdjack', 'turdtris', 'turdomania', 'turdrush'
]);

/** Desktop grid row names for closed arcade panels while a card table is open. */
export const GAME_NIGHT_LOBBY_GRID_AREA = Object.freeze({
    chess: 'chess', turdspades: 'spades', turdanoid: 'brick',
    crapeights: 'eights', turdrummy: 'rummy', turdjack: 'jack',
    turdtris: 'tris', turdomania: 'mania', turdrush: 'rush'
});

const ARCADE_LOBBY_PANEL_ROOT_CLASS = Object.freeze({
    chess: 'arcade-chess', turdspades: 'arcade-spades', turdanoid: 'arcade-brick-race',
    crapeights: 'arcade-eights', turdrummy: 'arcade-rummy', turdjack: 'arcade-jack',
    turdtris: 'arcade-tris', turdomania: 'arcade-mania', turdrush: 'arcade-rush-race'
});

export function arcadeLobbyPanelSelector(game) {
    const root = ARCADE_LOBBY_PANEL_ROOT_CLASS[game];
    return root ? `details.${root}` : null;
}

/** Keep mounted panels in GAME_NIGHT_LOBBY_ORDER regardless of dynamic import() resolution order. */
export function placeArcadePanelInLobbyOrder(container, panel, game) {
    if (!container || !panel) return;
    const idx = GAME_NIGHT_LOBBY_ORDER.indexOf(game);
    if (idx < 0) {
        container.append(panel);
        return;
    }
    for (let i = idx + 1; i < GAME_NIGHT_LOBBY_ORDER.length; i++) {
        const selector = arcadeLobbyPanelSelector(GAME_NIGHT_LOBBY_ORDER[i]);
        const later = selector ? container.querySelector(`:scope > ${selector}`) : null;
        if (later && later !== panel) {
            container.insertBefore(panel, later);
            return;
        }
    }
    const gameCall = container.querySelector(':scope > .game-call');
    if (gameCall && gameCall !== panel) container.insertBefore(panel, gameCall);
    else if (panel.parentElement !== container) container.append(panel);
}

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
