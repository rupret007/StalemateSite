import { Chess, claimReason, colorName, intendedClaims, pieceName } from '/play/games/chess-core.js';
import { ChessBoard } from '/play/games/chess-board.js';
import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';

const files = 'abcdefgh', ranks = '87654321';
const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const reasonText = {
    unavailable: 'Chess is unavailable in this room right now.',
    stale: 'The board changed. Try your move again.',
    'wrong-turn': 'Wait for your turn.',
    'illegal-move': 'That move is unavailable.',
    'match-changed': 'The match changed. Check the current board before trying again.',
    'seat-unavailable': 'The Black seat is no longer open. Check the match status.',
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
        <div data-clock-side="w"><span data-clock-label>White</span><time data-clock="w">10:00</time></div>
        <div data-clock-side="b"><span data-clock-label>Black</span><time data-clock="b">10:00</time></div>
    </div>
    <div id="board" class="arcade-chess-board" role="group" aria-label="Chessboard" aria-description="Use arrow keys to navigate squares and Enter to select or move."></div>
    <div class="arcade-chess-actions" aria-label="Match controls">
        <button type="button" class="btn btn--small btn--ghost" data-action="offer-draw">Offer draw</button>
        <button type="button" class="btn btn--small" data-action="accept-draw" hidden>Accept draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="decline-draw" hidden>Decline draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="claim-draw">Claim draw</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="resign">Resign</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="leave">Leave match</button>
    </div>
    <a class="small" href="/play/assets/chess/chessground-10.5.0-source.tar.gz" download>Chess board source</a>
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
    let scope, pendingTimer, clockTimer;
    let pending = false, canOpen = false, connection = 'connecting', connectionError;
    let model = null, chess = null, board = null, selected = null, focused = 'e2';
    let receivedAt = 0, deadlineSynced = false, lastOrientation = null, choiceContext = null;
    const client = createGameNightMatchClient({
        prefix: '/beta/arcade',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') { model = null; chess = null; }
            clearPending();
            closeChoice();
            selected = null;
            board?.cancel();
            draw();
        },
        onState(frame) {
            try { applyState(frame); }
            catch {
                client.stop();
                connection = 'unavailable';
                connectionError = undefined;
                draw();
            }
        },
        onError(reason) {
            clearPending();
            feedback.textContent = reasonText[reason] || 'That action was not confirmed.';
            draw();
        }
    });

    function send(action, details) {
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id, revision: model?.match?.revision, ...details })) return;
        if (action !== 'sync') {
            pending = true;
            feedback.textContent = '';
            pendingTimer = setTimeout(() => {
                pending = false;
                feedback.textContent = 'Checking the current match…';
                send('sync');
                draw();
            }, 6000);
            draw();
        }
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
        client.stop();
        clearInterval(clockTimer); clockTimer = null;
        clearPending(); closeChoice();
        connection = 'connecting'; connectionError = undefined;
        model = null; chess = null; selected = null; canOpen = false;
        board?.cancel();
    }

    function applyState(frame) {
        const prior = model?.match, next = frame.state?.match;
        const enteringBoard = next && next.id !== prior?.id;
        if (model?.id !== frame.state?.id || prior?.revision !== next?.revision) {
            selected = null; closeChoice(); feedback.textContent = '';
        }
        clearPending();
        if (next?.fen !== prior?.fen || !chess) chess = next ? new Chess(next.fen) : null;
        model = frame.state; canOpen = frame.canOpen === true;
        receivedAt = performance.now(); deadlineSynced = false;
        connection = 'ready'; connectionError = undefined;
        if (!clockTimer) clockTimer = setInterval(drawClocks, 200);
        draw();
        if (enteringBoard) requestAnimationFrame(() => {
            if (panel.open && model?.id === next.id) container.scrollTop = 0;
        });
    }

    const isTurn = () => connection === 'ready' && !pending && model?.seat === model?.match?.turn && !!chess && !model.match.result;
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
            const time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
            if (clock.textContent !== time) clock.textContent = time;
            const seat = clock.parentElement;
            const label = seat.querySelector('[data-clock-label]');
            const labelText = colorName(color) + (model.seat === color ? ' · You' : '');
            if (label.textContent !== labelText) label.textContent = labelText;
            const active = String(color === running);
            if (seat.dataset.running !== active) {
                seat.dataset.running = active;
                seat.setAttribute('aria-current', active);
            }
            if (color === running && ms === 0 && !deadlineSynced && !pending && connection === 'ready') {
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
        if (connection === 'unavailable') {
            status.textContent = matchConnectionErrors[connectionError] || 'Chess couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') button('Reconnect to Chess', 'retry');
        } else if (connection !== 'ready') {
            status.textContent = match ? 'Reconnecting to Chess… The clocks keep running.'
                : connection === 'reconnecting' ? 'Reconnecting to Chess…' : 'Connecting to Chess…';
        } else if (!model) {
            status.textContent = canOpen ? 'Open a ten-minute match for two players.' : 'Waiting for the host to open a match.';
            if (canOpen) button('Open Chess match', 'open');
        } else if (model.waiting) {
            status.textContent = seated ? 'You’re White · Waiting for an opponent. Use Invite players to bring someone in.' : 'Black is open. Join to play.';
            button(seated ? 'Close waiting match' : 'Join as Black', seated ? 'leave' : 'join');
        } else if (match?.result) {
            status.textContent = `${match.result.winner ? colorName(match.result.winner) + ' wins' : 'Draw'} · ${match.result.reason}`;
            if (seated && model.rematch !== model.seat) button(model.rematch ? 'Accept rematch' : 'Request rematch', 'rematch');
            if (seated && model.rematch) status.textContent += model.rematch === model.seat
                ? ' · Rematch requested. Waiting for your opponent.' : ' · Your opponent requested a rematch.';
        } else {
            const who = seated ? `You’re ${colorName(model.seat)}` : 'Watching';
            status.textContent = `${who} · ${model.seat === match?.turn ? 'Your turn' : colorName(match?.turn) + ' to move'}`;
        }
        for (const control of actions) {
            const active = seated && match && !match.result;
            const offer = active && match.drawOffer && match.drawOffer !== model.seat;
            const action = control.dataset.action;
            control.disabled = pending || connection !== 'ready';
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
        if (primary.dataset.command === 'retry') client.start(scope);
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
    const four = container.querySelector('[data-four]');
    four?.addEventListener('toggle', () => { if (four.open) panel.open = false; });
    panel.addEventListener('toggle', () => {
        if (panel.open && scope) {
            if (four) four.open = false;
            client.start(scope);
        } else stop();
    });
    return {
        isOpen: () => panel.open,
        open: () => { if (scope) panel.open = true; },
        setRoom(next) {
            if (scope?.room === next?.room && scope?.ref === next?.ref && scope?.actor === next?.actor) return;
            stop(); scope = next;
            panel.hidden = !scope;
            panel.open = false;
            feedback.textContent = ''; draw();
        }
    };
}
