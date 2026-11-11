import { Chess, claimReason, colorName, intendedClaims, pieceName } from '/play/games/chess-core.js';
import { ChessBoard } from '/play/games/chess-board.js';

const files = 'abcdefgh', ranks = '87654321';
const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const reasonText = {
    unavailable: 'Chess is unavailable in this room right now.',
    stale: 'The board changed. Try your move again.',
    'wrong-turn': 'Wait for your turn.',
    'illegal-move': 'That move is unavailable.',
    'match-changed': 'The match changed.',
    'seat-unavailable': 'That seat is unavailable.',
    'no-draw-claim': 'A draw cannot be claimed from this position.',
    'no-draw-offer': 'There is no draw offer to answer.',
    'rematch-unavailable': 'A rematch is unavailable right now.',
    'storage-unavailable': 'The change was not confirmed. Try again.'
};

const markup = `
<summary>Royal Flush Chess</summary>
<p class="small arcade-chess-status" data-chess-status role="status"></p>
<p class="small arcade-chess-feedback" data-chess-error role="status"></p>
<button type="button" class="btn btn--small" data-chess-primary hidden></button>
<div class="arcade-chess-playing" data-chess-playing hidden>
    <div class="arcade-chess-clocks" aria-label="Chess clocks">
        <div data-clock-side="w"><span>White</span><time data-clock="w">10:00</time></div>
        <div data-clock-side="b"><span>Black</span><time data-clock="b">10:00</time></div>
    </div>
    <div id="board" class="arcade-chess-board" role="group" aria-label="Chessboard"></div>
    <div class="arcade-chess-actions" aria-label="Match controls">
        <button type="button" class="btn btn--small btn--ghost" data-action="offer-draw">Offer draw</button>
        <button type="button" class="btn btn--small" data-action="accept-draw" hidden>Accept draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="decline-draw" hidden>Decline draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="claim-draw">Claim draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="resign">Resign</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="leave">Leave match</button>
    </div>
</div>
<dialog class="sheet" aria-labelledby="arcade-chess-choice-title" data-chess-choice>
    <h3 id="arcade-chess-choice-title"></h3>
    <p class="small" data-choice-hint></p>
    <div class="sheet-buttons" data-choice-buttons></div>
    <button class="btn btn--small btn--ghost" type="button" data-choice-cancel>Cancel</button>
</dialog>`;

function appendStyle(document, href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
}

export function mountArcadeChess(container) {
    const document = container.ownerDocument;
    const panel = document.createElement('details');
    panel.className = 'arcade-chess';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    appendStyle(document, '/play/assets/chess/chessground.base.css');
    appendStyle(document, '/play/assets/chess/chess-board.css');
    appendStyle(document, new URL('./arcade-chess.css', import.meta.url));
    const $ = selector => panel.querySelector(selector);
    const primary = $('[data-chess-primary]');
    const status = $('[data-chess-status]');
    const feedback = $('[data-chess-error]');
    const boardHost = $('#board');
    const choice = $('[data-chess-choice]');
    const actions = [...panel.querySelectorAll('[data-action]')];
    const squares = new Map();
    let scope, socket, controller, retryTimer, pendingTimer, clockTimer;
    let sequence = 0, retries = 0, pending = false, canOpen = false, ready = false, stopped = false;
    let model = null, chess = null, board = null, selected = null, focused = 'e2';
    let receivedAt = 0, deadlineSynced = false, lastOrientation = null, choiceContext = null;

    function send(action, details) {
        if (!ready || socket?.readyState !== WebSocket.OPEN || pending) return;
        if (action !== 'sync') {
            pending = true;
            feedback.textContent = '';
            pendingTimer = setTimeout(() => {
                pending = false;
                feedback.textContent = 'Checking the current match…';
                send('sync');
                draw();
            }, 6000);
        }
        try { socket.send(JSON.stringify({ version: 1, action, id: model?.id, revision: model?.match?.revision, ...details })); }
        catch { socket.close(1000); }
        if (action !== 'sync') draw();
    }

    function clearPending() {
        clearTimeout(pendingTimer);
        pending = false;
    }

    function closeChoice() {
        choiceContext = null;
        if (choice.open) choice.close();
    }

    function stop() {
        sequence++;
        controller?.abort(); controller = null;
        clearTimeout(retryTimer); clearInterval(clockTimer); clockTimer = null;
        clearPending(); closeChoice();
        if (socket) socket.close(1000);
        socket = null;
        ready = false; model = null; chess = null; selected = null; canOpen = false;
        retries = 0; stopped = false;
        board?.cancel();
    }

    function reconnect(attempt, code) {
        if (attempt !== sequence || !scope || !panel.open) return;
        ready = false; clearPending(); closeChoice(); selected = null;
        clearInterval(clockTimer); clockTimer = null;
        if ([4403, 4409, 4429].includes(code) || retries >= 3) stopped = true;
        else {
            retries++;
            retryTimer = setTimeout(connect, 400 * 2 ** (retries - 1));
        }
        draw();
    }

    async function connect() {
        if (!scope || !panel.open || socket?.readyState === WebSocket.OPEN || controller) return;
        const attempt = ++sequence;
        const own = new AbortController();
        controller = own;
        stopped = false; draw();
        try {
            const response = await fetch('/beta/arcade-ticket', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scope), signal: own.signal
            });
            if (!response.ok) {
                if (attempt === sequence) reconnect(attempt, [401, 403].includes(response.status) ? 4403 : response.status === 429 ? 4429 : 0);
                return;
            }
            const { ticket, protocol } = await response.json();
            if (attempt !== sequence) return;
            if (!/^m[a-f0-9]{32}$/.test(ticket) || protocol !== 'game-night.v1') throw Error('invalid match grant');
            const url = new URL('/beta/arcade-match', location.href);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const connection = new WebSocket(url, [protocol, ticket]);
            socket = connection;
            connection.addEventListener('close', event => {
                if (socket === connection) { socket = null; reconnect(attempt, event.code); }
            });
            connection.addEventListener('message', event => {
                if (attempt !== sequence || socket !== connection) return;
                let frame;
                try { frame = JSON.parse(event.data); } catch { return; }
                if (frame?.t === 'match-ready' && frame.version === 1) {
                    retries = 0; ready = true; send('sync');
                    clockTimer = setInterval(drawClocks, 200);
                } else if (frame?.t === 'match-state' && frame.version === 1 && frame.room === scope.room) {
                    try { applyState(frame); } catch { connection.close(4403, 'invalid match state'); }
                } else if (frame?.t === 'match-error') {
                    clearPending(); feedback.textContent = reasonText[frame.reason] || 'That action was not confirmed.';
                    draw();
                }
            });
        } catch {
            if (attempt === sequence) reconnect(attempt);
        } finally {
            if (controller === own) controller = null;
        }
    }

    function applyState(frame) {
        const prior = model?.match, next = frame.state?.match;
        if (model?.id !== frame.state?.id || prior?.revision !== next?.revision) {
            selected = null; closeChoice(); feedback.textContent = '';
        }
        clearPending();
        if (next?.fen !== prior?.fen || !chess) chess = next ? new Chess(next.fen) : null;
        model = frame.state; canOpen = frame.canOpen === true;
        receivedAt = performance.now(); deadlineSynced = false;
        draw();
    }

    const isTurn = () => ready && !pending && model?.seat === model?.match?.turn && !!chess && !model.match.result;
    function showChoice(title, hint, entries) {
        choiceContext = { id: model.id, revision: model.match.revision };
        choice.querySelector('h3').textContent = title;
        $('[data-choice-hint]').textContent = hint;
        const buttons = entries.map(([label, action]) => {
            const button = document.createElement('button');
            button.className = 'btn btn--small'; button.type = 'button'; button.textContent = label;
            button.addEventListener('click', () => {
                if (choiceContext?.id !== model?.id || choiceContext?.revision !== model?.match?.revision) return;
                closeChoice(); action();
            });
            return button;
        });
        $('[data-choice-buttons]').replaceChildren(...buttons);
        choice.showModal();
        (buttons[0] || $('[data-choice-cancel]')).focus();
    }

    function move(from, to) {
        if (!isTurn()) return;
        const options = chess.moves({ square: from, verbose: true }).filter(option => option.to === to);
        if (!options.length) return;
        if (options[0].promotion) {
            board.cancel(); selected = null; draw();
            showChoice('Promote pawn', 'Choose the piece to place on the board.',
                options.map(option => [pieceName(option.promotion), () => send('move', { move: option.lan })]));
        } else send('move', { move: options[0].lan });
    }

    function select(square) {
        if (!isTurn()) return;
        selected = chess.get(square)?.color === model.seat ? square : null;
        draw();
    }

    function drawBoard() {
        if (!chess || !model?.match) return;
        if (!board) board = new ChessBoard(boardHost, { select, move, cancel: () => { selected = null; draw(); } });
        const flipped = model.seat === 'b';
        if (flipped !== lastOrientation) {
            lastOrientation = flipped;
            const arranged = document.createDocumentFragment();
            for (const rank of flipped ? [...ranks].reverse() : ranks) {
                for (const file of flipped ? [...files].reverse() : files) {
                    const square = file + rank;
                    let button = squares.get(square);
                    if (!button) {
                        button = document.createElement('button');
                        button.type = 'button'; button.className = 'arcade-chess-square'; button.dataset.square = square;
                        squares.set(square, button);
                    }
                    arranged.append(button);
                }
            }
            board.grid.replaceChildren(arranged);
            focused = flipped ? 'e7' : 'e2';
        }
        for (const [square, button] of squares) {
            const piece = chess.get(square);
            button.setAttribute('aria-label', piece ? `${square}, ${colorName(piece.color)} ${pieceName(piece.type)}` : `${square}, empty`);
            button.setAttribute('aria-pressed', String(square === selected));
            button.tabIndex = square === focused ? 0 : -1;
        }
        const last = model.match.moves.at(-1);
        board.update({ chess, id: model.id, view: 'live', flipped, selected, allowed: isTurn(),
            last: last && { from: last.slice(0, 2), to: last.slice(2, 4) } });
    }

    function drawClocks() {
        const match = model?.match;
        if (!match || !panel.open) return;
        const running = match.result ? null : match.turn;
        for (const color of ['w', 'b']) {
            const ms = Math.max(0, match.clock[color] - (color === running ? performance.now() - receivedAt : 0));
            const total = Math.ceil(ms / 1000);
            const clock = $(`[data-clock="${color}"]`);
            clock.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
            clock.parentElement.dataset.running = String(color === running);
            if (color === running && ms === 0 && !deadlineSynced && !pending && ready) {
                deadlineSynced = true;
                send('sync');
            }
        }
    }

    function draw() {
        const match = model?.match, seated = !!model?.seat;
        $('[data-chess-playing]').hidden = !match || !panel.open;
        primary.hidden = true; primary.disabled = pending; primary.dataset.command = '';
        const button = (text, command) => { primary.hidden = false; primary.textContent = text; primary.dataset.command = command; };
        if (!ready) {
            status.textContent = stopped ? 'Chess connection unavailable.' : 'Connecting to Chess…';
            if (stopped) button('Reconnect to Chess', 'retry');
        } else if (!model) {
            status.textContent = canOpen ? 'Open a ten-minute match for two players.' : 'Waiting for the host to open a match.';
            if (canOpen) button('Open Chess match', 'open');
        } else if (model.waiting) {
            status.textContent = seated ? 'Waiting for another player. Invite someone from Game Night.' : 'A seat is available. You’ll play Black.';
            button(seated ? 'Close waiting match' : 'Join as Black', seated ? 'leave' : 'join');
        } else if (match?.result) {
            status.textContent = `${match.result.winner ? colorName(match.result.winner) + ' wins' : 'Draw'} · ${match.result.reason}`;
            if (seated && model.rematch !== model.seat) button(model.rematch ? 'Accept rematch' : 'Request rematch', 'rematch');
            if (seated && model.rematch === model.seat) status.textContent += ' · Waiting for rematch';
        } else {
            const who = seated ? `You’re ${colorName(model.seat)}` : 'Watching';
            status.textContent = `${who} · ${model.seat === match?.turn ? 'Your turn' : colorName(match?.turn) + ' to move'}`;
        }
        for (const control of actions) {
            const active = seated && match && !match.result;
            const offer = active && match.drawOffer && match.drawOffer !== model.seat;
            const action = control.dataset.action;
            control.disabled = pending || !ready;
            control.hidden = action === 'leave' ? !seated
                : action === 'accept-draw' || action === 'decline-draw' ? !offer
                    : !active || action === 'offer-draw' && !!match.drawOffer || action === 'claim-draw' && model.seat !== match.turn;
        }
        if (match && panel.open) { drawBoard(); drawClocks(); }
    }

    function chooseClaim() {
        const full = new Chess();
        for (const move of model.match.moves) full.move(move);
        const current = claimReason(full);
        const entries = current ? [[current, () => send('claim-draw')]]
            : intendedClaims(full).map(option => [`${option.san} · ${option.reason}`, () => send('claim-draw', { move: option.move })]);
        showChoice('Claim a draw', entries.length ? 'Select a claim to send to the server.' : 'There is no claim available from this position.', entries);
    }

    primary.addEventListener('click', () => {
        if (primary.dataset.command === 'retry') { retries = 0; void connect(); }
        else if (primary.dataset.command) send(primary.dataset.command);
    });
    for (const control of actions) control.addEventListener('click', () => {
        const action = control.dataset.action;
        if (action === 'claim-draw') chooseClaim();
        else if (action === 'resign') showChoice('Resign match?', 'Your opponent wins if you resign.', [['Resign', () => send('resign')]]);
        else if (action === 'leave') showChoice('Leave match?', 'This ends the match for both players.', [['Leave match', () => send('leave')]]);
        else send(action);
    });
    $('[data-choice-cancel]').addEventListener('click', closeChoice);
    choice.addEventListener('close', () => { if (!choice.open) choiceContext = null; });
    boardHost.addEventListener('click', event => {
        const target = event.target.closest('[data-square]')?.dataset.square;
        if (!target || event.detail !== 0) return;
        if (selected && chess.moves({ square: selected, verbose: true }).some(option => option.to === target)) move(selected, target);
        else select(target);
    });
    boardHost.addEventListener('focusin', event => {
        if (!event.target.dataset.square) return;
        focused = event.target.dataset.square;
        for (const [name, button] of squares) button.tabIndex = name === focused ? 0 : -1;
    });
    boardHost.addEventListener('keydown', event => {
        if (!model?.match) return;
        if (event.key === 'Escape') { selected = null; board.cancel(); draw(); return; }
        if (!directions[event.key]) return;
        event.preventDefault();
        const [x, y] = directions[event.key], sign = model.seat === 'b' ? -1 : 1;
        const file = Math.max(0, Math.min(7, files.indexOf(focused[0]) + x * sign));
        const rank = Math.max(1, Math.min(8, Number(focused[1]) + y * sign));
        squares.get(files[file] + rank)?.focus();
    });
    panel.addEventListener('toggle', () => { if (panel.open && scope) void connect(); else stop(); });
    return {
        setRoom(next) {
            if (scope?.room === next?.room && scope?.ref === next?.ref && scope?.actor === next?.actor) return;
            stop(); scope = next;
            panel.hidden = !scope;
            panel.open = false;
            feedback.textContent = ''; draw();
        }
    };
}
