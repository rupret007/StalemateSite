// Pure pieces of scripts/family-alpha-regrade-shots.mjs, kept apart so
// scripts/family-alpha-regrade-shots.test.mjs can cover them without a browser.

// lobby-core.mjs stops its hello features at Game Night. The Durable Object
// (lobby-do.mjs) adds one flag per available arcade game, and the lobby client
// disables a game's picker option without its flag.
const arcadeFeatures = { arcadeChess: 1, arcadeTurdSpades: 1, arcadeTurdanoid: 1 };
export const arcadeHello = frame => frame?.t === 'hello' ? { ...frame, features: { ...frame.features, ...arcadeFeatures } } : frame;

// `live` is the status each seat shows once every seat is taken and play has begun.
// `proof` is what must be on the board before a screenshot counts.
const spadesLive = /^Round \d+ · |computer partner|Waiting for the host to bid/;
const spadesProof = { selector: '[data-spades-hand] [data-spades-card]', min: 13 };
export const gameSpecs = {
    chess: { game: 'chess', seats: 2, button: 'Open Chess match', joins: ['Join as Black'], board: '.arcade-chess-board', status: '[data-chess-status]',
        live: [/^You’re White · /, /^You’re Black · /],
        // Every square is a [data-square] button; an empty one carries data-piece="".
        proof: { selector: '[data-piece]:not([data-piece=""])', min: 32 } },
    'partners-spades': { game: 'turdspades', seats: 2, button: 'Open 2-player Spades', joins: ['Join West'], board: '[data-spades-table]', status: '[data-spades-status]',
        live: [spadesLive, spadesLive], proof: spadesProof },
    'four-player-spades': { game: 'turdspades', seats: 4, button: 'Open 4-player Spades', joins: ['Join West', 'Join North', 'Join East'], board: '[data-spades-table]', status: '[data-spades-status]',
        live: [spadesLive, spadesLive, spadesLive, spadesLive], proof: spadesProof },
    // The live status is the wall's name; the wall itself is proved by brickWallShown.
    turdanoid: { game: 'turdanoid', seats: 2, button: 'Open Turdanoid race', joins: ['Join Turdanoid race'], board: '[data-brick-match]', status: '[data-brick-status]',
        live: [/\S/, /\S/] }
};

const notStarted = new RegExp([
    'Waiting for an opponent', 'Waiting for a second player', 'An opponent is ready', 'is open\\. Join', 'seat is open', '\\d+/\\d+ seated',
    'Waiting for the host to open', '^Open a ', '^Play with one friend', '^Same wall and three balls', 'Connecting', 'Reconnecting',
    'couldn’t reconnect', 'link still works'
].join('|'), 'i');

export function seatStarted(spec, index, status) {
    const text = String(status || '').trim();
    return !!text && spec.live[index].test(text) && !notStarted.test(text);
}

// The canvas is part of the board template, so its presence proves nothing.
export const brickWallShown = ({ phase, bricks, painted }) => (phase === 'countdown' || phase === 'play') && bricks > 0 && painted === true;

// lobby.css gives phone controls 44px; 24px is the pointer minimum elsewhere.
export const controlFloor = viewport => viewport.width < 600 ? 44 : 24;

// `controls` are boxes measured after each control was scrolled to the nearest edge.
export function layoutFindings({ scrollWidth, controls }, viewport) {
    const findings = [], floor = controlFloor(viewport);
    if (scrollWidth > viewport.width + 1) findings.push(`horizontal overflow: ${scrollWidth}px wide in a ${viewport.width}px viewport`);
    for (const { label, x, y, width, height } of controls) {
        if (width < floor || height < floor) findings.push(`undersized control (${Math.round(width)}x${Math.round(height)}, floor ${floor}): ${label}`);
        if (x < -1 || y < -1 || x + width > viewport.width + 1 || y + height > viewport.height + 1) findings.push(`unreachable control: ${label}`);
    }
    return findings;
}

// The server end of a routed match socket, shaped like a workerd WebSocket.
// `closed` runs when the server closes it, as webSocketClose does in lobby-do.mjs.
export function matchSocket(route, closed) {
    let attachment = null;
    const socket = { readyState: 1, retired: false, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
        send: raw => { if (socket.readyState === 1) route.send(raw); },
        close: (code = 1000, reason = '') => {
            if (socket.readyState !== 1) return;
            socket.readyState = 3;
            void Promise.resolve(route.close({ code, reason })).catch(() => {});
            closed(socket);
        } };
    return socket;
}

// Runs once per socket whichever end closed first.
export async function retireMatchSocket(socket, transport, matchSockets) {
    if (socket.retired) return;
    socket.retired = true;
    socket.readyState = 3;
    const scope = socket.deserializeAttachment();
    try {
        if (scope) { socket.serializeAttachment({ ...scope, retired: true }); await transport.presenceChanged(scope); }
    } finally { const index = matchSockets.indexOf(socket); if (index !== -1) matchSockets.splice(index, 1); }
}

// Runs every cleanup step, then rethrows the first failure.
export async function settle(steps) {
    const failures = [];
    for (const step of steps) { try { await step(); } catch (error) { failures.push(error); } }
    if (failures.length) throw failures[0];
}

export function assertPort(port) {
    if (!Number.isInteger(port) || port < 4800 || port > 4849) throw new Error('REGRADE_PORT must be within 4800–4849.');
    return port;
}
