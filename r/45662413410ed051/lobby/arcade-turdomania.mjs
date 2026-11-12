import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';
import { POOP_KINDS, findGroup, popGroup } from '/play/games/turdomania-core.js';

const sprite = '/play/assets/turdomania-tiles.svg#';
const symbols = ['swirl', 'corn', 'splat', 'paper', 'bean', 'cheese'];
const svgNS = 'http://www.w3.org/2000/svg';
const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] };
const markup = `
<summary>Turdomania Duel</summary>
<p class="small arcade-card-status mania-status" data-mania-status role="status"></p>
<p class="small arcade-card-error" data-mania-error role="status"></p>
<div class="arcade-card-actions mania-actions">
    <button class="btn btn--small" type="button" data-mania-main hidden></button>
    <button class="btn btn--small btn--ghost" type="button" data-mania-leave hidden>Leave duel</button>
</div>
<div data-card-table data-mania-match hidden>
    <div class="mania-playfield">
        <div class="mania-own" data-mania-own>
            <div data-mania-board="self" class="mania-board" role="grid" aria-label="Your puzzle" aria-rowcount="6" aria-colcount="6"></div>
            <b class="mania-countdown" aria-hidden="true" data-mania-countdown hidden></b>
        </div>
        <div class="mania-watching" data-mania-watching hidden>
            <div data-mania-board="a" class="mania-board" role="img" aria-label="Player 1 puzzle"></div>
            <div data-mania-board="b" class="mania-board" role="img" aria-label="Player 2 puzzle"></div>
        </div>
        <div class="mania-hud">
            <time role="timer" data-mania-clock></time>
            <div data-mania-score="a"><span></span><b></b><small></small></div>
            <div data-mania-score="b"><span></span><b></b><small></small></div>
        </div>
    </div>
</div>
<dialog class="sheet" aria-labelledby="mania-confirm-title" data-mania-confirm>
    <h3 id="mania-confirm-title">Leave this duel?</h3>
    <p class="small" data-mania-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-mania-confirm-yes>Leave duel</button>
        <button class="btn btn--small btn--ghost" type="button" data-mania-confirm-no>Keep playing</button>
    </div>
</dialog>`;

function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
}

function puzzle(root, select) {
    const document = root.ownerDocument, buttons = new Map(), rows = [];
    const interactive = !!select;
    let board = [], key, active;
    if (interactive) for (let index = 0; index < 6; index++) {
        const row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', index + 1);
        root.append(row);
        rows.push(row);
    }
    function mark(tile, focus) {
        const node = buttons.get(tile?.id);
        if (active) buttons.get(active.id)?.setAttribute('tabindex', '-1');
        active = tile;
        if (node) {
            node.tabIndex = 0;
            if (focus) node.focus({ preventScroll: true });
        }
    }
    function highlight(node) {
        const group = node ? findGroup(board, Number(node.dataset.col), Number(node.dataset.row)) : [];
        const marked = new Set(group.length > 1 ? group.map(([col, row]) => board[col][row].id) : []);
        for (const [id, tile] of buttons) tile.classList.toggle('mania-group', marked.has(id));
    }
    if (interactive) {
        root.addEventListener('click', event => {
            const node = event.target.closest('[data-mania-tile]');
            if (node) select(Number(node.dataset.maniaTile));
        });
        root.addEventListener('focusin', event => {
            const node = event.target.closest('[data-mania-tile]');
            if (!node) return;
            mark(board[Number(node.dataset.col)][Number(node.dataset.row)], false);
            highlight(node);
        });
        root.addEventListener('pointerover', event => { if (event.pointerType === 'mouse') highlight(event.target.closest('[data-mania-tile]')); });
        root.addEventListener('pointerleave', () => highlight(root.contains(document.activeElement) ? document.activeElement : null));
        root.addEventListener('focusout', () => highlight(null));
        root.addEventListener('keydown', event => {
            const offset = keys[event.key], node = event.target.closest('[data-mania-tile]');
            if (!offset || !node) return;
            event.preventDefault();
            const col = Number(node.dataset.col) + offset[0], row = Number(node.dataset.row) + offset[1];
            const stack = board[col];
            const next = offset[0] && stack ? stack[Math.min(row, stack.length - 1)] : stack?.[row];
            if (next) mark(next, true);
        });
    }
    return next => {
        const nextKey = next.map(col => col.map(tile => tile.id + ':' + tile.kind).join(',')).join('/');
        if (nextKey === key) return;
        key = nextKey;
        const focused = interactive && root.contains(document.activeElement);
        const oldNode = buttons.get(active?.id);
        const anchor = [Number(oldNode?.dataset.col) || 0, Number(oldNode?.dataset.row) || 0];
        board = next;
        const alive = new Set();
        let fallback, distance = Infinity;
        for (const [col, stack] of next.entries()) for (const [row, tile] of stack.entries()) {
            alive.add(tile.id);
            const delta = Math.abs(col - anchor[0]) + Math.abs(row - anchor[1]);
            if (delta < distance) { distance = delta; fallback = tile; }
            let node = buttons.get(tile.id);
            if (!node) {
                node = document.createElement(interactive ? 'button' : 'span');
                if (interactive) {
                    node.type = 'button';
                    node.tabIndex = -1;
                    node.setAttribute('role', 'gridcell');
                } else node.setAttribute('aria-hidden', 'true');
                const icon = document.createElementNS(svgNS, 'svg'), use = document.createElementNS(svgNS, 'use');
                icon.setAttribute('viewBox', '0 0 64 64');
                icon.setAttribute('aria-hidden', 'true');
                icon.append(use);
                node.append(icon);
                node.className = 'mania-tile';
                node.dataset.maniaTile = tile.id;
                buttons.set(tile.id, node);
            }
            if (node.dataset.kind !== String(tile.kind)) {
                node.dataset.kind = tile.kind;
                node.querySelector('use').setAttribute('href', sprite + symbols[tile.kind]);
            }
            node.dataset.col = col;
            node.dataset.row = row;
            node.style.setProperty('--col', col);
            node.style.setProperty('--row', 5 - row);
            if (interactive) {
                node.setAttribute('aria-colindex', col + 1);
                node.setAttribute('aria-label', `${POOP_KINDS[tile.kind].name}, row ${6 - row}, column ${col + 1}`);
            }
            const parent = interactive ? rows[5 - row] : root;
            if (node.parentNode !== parent) parent.append(node);
        }
        for (const [id, tile] of buttons) if (!alive.has(id)) { tile.remove(); buttons.delete(id); }
        if (interactive) {
            mark(alive.has(active?.id) ? active : fallback, focused);
            highlight(focused ? buttons.get(active?.id) : null);
        }
    };
}

export function mountArcadeTurdomania(container, onMatch) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-mania';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-mania-status]'), error = $('[data-mania-error]'), main = $('[data-mania-main]'),
        table = $('[data-mania-match]'), leave = $('[data-mania-leave]'), confirm = $('[data-mania-confirm]');
    const ownBoard = $('[data-mania-board="self"]'), drawOwn = puzzle(ownBoard, choose);
    const drawWatch = ['a', 'b'].map(seat => puzzle($(`[data-mania-board="${seat}"]`)));
    let scope, model, canOpen, connection, connectionError, receivedAt, busy = null, prediction = null, ticker, lastSync = -Infinity;
    const serverNow = () => model.match.at + Math.max(0, performance.now() - receivedAt);
    function clearPending() { clearTimeout(busy); busy = null; prediction = null; }
    const client = createGameNightMatchClient({
        onMatch,
        prefix: '/beta/arcade-turdomania',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = null;
            clearPending();
            if (confirm.open) confirm.close();
            render();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'turdomania' || state.version !== 1)) return;
            const changed = state?.id !== model?.id || state?.seat !== model?.seat;
            const reveal = state?.match && (!model?.match || changed);
            if (changed || state?.match?.result) {
                clearPending();
                if (confirm.open) confirm.close();
            } else if (!prediction || state.match?.players[state.seat]?.moves > prediction.move) {
                clearPending();
            }
            model = state;
            canOpen = host;
            connection = 'ready';
            connectionError = undefined;
            receivedAt = performance.now();
            render();
            if (reveal) container.scrollTop = 0;
        },
        onError(reason) {
            clearPending();
            if (reason !== 'finished') error.textContent = reason === 'storage-unavailable'
                ? 'Move confirmation interrupted. Your board has been restored.' : 'The duel could not accept that move.';
            render();
        }
    });

    function send(action, fields = {}, preview = null) {
        if (action === 'retry') { client.start(scope); return; }
        if (connection !== 'ready' || busy || !client.send({ action, id: model?.id, ...fields })) return;
        prediction = preview;
        error.textContent = '';
        busy = setTimeout(() => client.start(scope), 4000);
        render();
    }

    function choose(id) {
        const match = model?.match, seat = model?.seat;
        if (connection !== 'ready' || !seat || !match || match.result || match.players[seat].over || busy || confirm.open ||
            serverNow() < match.startsAt || serverNow() >= match.endsAt) return;
        const board = match.self.board;
        const col = board.findIndex(stack => stack.some(tile => tile.id === id));
        if (col < 0) return;
        const row = board[col].findIndex(tile => tile.id === id), next = popGroup(board, col, row);
        if (!next) { error.textContent = 'Choose a group of two or more matching tiles.'; return; }
        const move = match.players[seat].moves;
        send('pop', { tile: id, move }, { move, board: next.board });
    }

    function clock() {
        const match = model?.match;
        if (!match) return;
        const now = serverNow(), countdown = Math.ceil((match.startsAt - now) / 1000);
        const waiting = !match.result && countdown > 0;
        const seconds = Math.max(0, Math.ceil((match.endsAt - Math.max(now, match.startsAt)) / 1000));
        table.dataset.phase = match.result ? 'finished' : waiting ? 'countdown' : 'play';
        const label = match.result ? 'Final' : waiting ? 'Starts in ' + countdown
            : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        setText($('[data-mania-clock]'), label);
        const overlay = $('[data-mania-countdown]');
        overlay.hidden = !waiting;
        setText(overlay, waiting ? String(countdown) : '');
        if (connection === 'ready' && !match.result && seconds === 0 && now - lastSync >= 1500 && client.send({ action: 'sync' })) lastSync = now;
    }

    function render() {
        const match = model?.match, seat = model?.seat, result = match?.result;
        let message = 'Connecting to the duel…', action = '', label = '';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'The duel couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { action = 'retry'; label = 'Reconnect duel'; }
        } else if (connection !== 'ready') {
            if (match) message = match.result ? 'Reconnecting to the duel…' : 'Reconnecting · duel clock keeps running';
        } else if (!model) {
            message = 'Same puzzle. Clear it or score the most in 90 seconds.';
            if (canOpen) { action = 'open'; label = 'Open Turdomania duel'; }
        } else if (model?.waiting) {
            message = seat ? 'Waiting for a second player.' : 'An opponent is ready.';
            if (!seat) { action = 'join'; label = 'Join Turdomania duel'; }
        } else if (result) {
            message = result.winner === null ? 'Draw' : seat ? (result.winner === seat ? 'You win' : 'Opponent wins')
                : (result.winner === 'a' ? 'Player 1 wins' : 'Player 2 wins');
            if (result.reason === 'resign') message += ' · forfeit';
            else if (result.reason === 'time') message += ' · time limit';
            if (seat && seat !== model.rematch) { action = 'rematch'; label = model.rematch ? 'Accept Turdomania rematch' : 'Request Turdomania rematch'; }
            if (seat && model.rematch === seat) message += ' · Rematch requested';
        } else if (match) {
            const own = match.players[seat];
            message = !seat ? 'Watching the duel' : own.cleared ? 'Puzzle cleared. Opponent still playing.'
                : own.over ? 'No matches left. Opponent still playing.' : 'Pop matching groups of two or more.';
        }
        setText(status, message);
        status.classList.toggle('mania-playing', !!match && !result && !!seat && !match.players[seat].over);
        main.hidden = !action;
        main.dataset.command = action;
        setText(main, label);
        main.disabled = !!busy;
        leave.hidden = !seat || !!result;
        leave.disabled = connection !== 'ready' || !!busy;
        table.hidden = !match;
        ownBoard.setAttribute('aria-disabled', String(connection !== 'ready'));
        if (!match) return;
        table.dataset.move = seat ? match.players[seat].moves : '';
        $('[data-mania-own]').hidden = !seat;
        $('[data-mania-watching]').hidden = !!seat;
        if (seat) drawOwn(prediction?.board || match.self.board);
        else ['a', 'b'].forEach((position, index) => drawWatch[index](match.boards[position]));
        for (const [index, position] of ['a', 'b'].entries()) {
            const score = $(`[data-mania-score="${position}"]`), data = match.players[position];
            score.style.order = position === seat ? '-1' : String(index + 1);
            setText(score.children[0], seat ? (position === seat ? 'You' : 'Opponent') : 'Player ' + (index + 1));
            setText(score.children[1], data.score.toLocaleString());
            setText(score.children[2], data.cleared ? 'Cleared' : data.left + ' left');
        }
        clock();
    }

    main.addEventListener('click', () => send(main.dataset.command));
    leave.addEventListener('click', () => {
        setText($('[data-mania-confirm-text]'), model?.waiting ? 'The open seat will close.' : 'Leaving forfeits your duel.');
        confirm.showModal();
    });
    $('[data-mania-confirm-no]').addEventListener('click', () => confirm.close());
    $('[data-mania-confirm-yes]').addEventListener('click', () => { confirm.close(); send(model?.waiting ? 'leave' : 'resign'); });
    function reset() {
        client.stop();
        clearInterval(ticker);
        clearPending();
        model = null;
        connection = 'connecting';
        connectionError = undefined;
        error.textContent = '';
        if (confirm.open) confirm.close();
        render();
    }
    container.addEventListener('toggle', event => {
        if (event.target !== panel && event.target.open &&
            event.target.matches('.arcade-chess, .arcade-card-table, [data-four]')) panel.open = false;
    }, true);
    panel.addEventListener('toggle', () => {
        if (!panel.open || !scope) { reset(); return; }
        for (const other of container.querySelectorAll(':scope > details[open]')) if (other !== panel) other.open = false;
        container.scrollTop = 0;
        ticker = setInterval(clock, 200);
        client.start(scope);
    });
    return {
        isOpen: () => panel.open,
        panel,
        open: () => { if (scope) panel.open = true; },
        setRoom(next) {
            if (scope?.room === next?.room && scope?.ref === next?.ref && scope?.actor === next?.actor) return;
            scope = next;
            panel.hidden = !scope;
            panel.open = false;
            reset();
        }
    };
}
