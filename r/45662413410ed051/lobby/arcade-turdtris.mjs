import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';
import { createTurdtrisArt } from '/play/games/turdtris-art.js';
import { classifyGesture } from '/play/games/turdtris-presentation.js';
import { formatRunTime } from '/play/games/turdtris-modes.js';
import { SPRINT_TICK_MS, advanceSprint, applySprintInput, sprintCells, sprintGhost, sprintNext } from '/play/games/turdtris-sprint.js';

const inputs = [
    ['left', '←', 'Move left'], ['right', '→', 'Move right'], ['ccw', '↶', 'Rotate left'],
    ['cw', '↷', 'Rotate right'], ['soft', '↓', 'Soft drop'], ['drop', '⇊', 'Hard drop'], ['hold', 'H', 'Hold piece']
];
const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft', ArrowUp: 'cw', z: 'ccw', x: 'cw', ' ': 'drop', c: 'hold' };
const repeatable = action => ['left', 'right', 'soft'].includes(action);
const renderOptions = { reducedMotion: true };
const ghostOptions = { reducedMotion: true, ghost: true };
const markup = `
<summary>Turdtris Sprint</summary>
<p class="small arcade-card-status" data-tris-status role="status"></p>
<p class="small arcade-card-error" data-tris-error role="status"></p>
<div class="arcade-card-actions tris-actions">
    <button class="btn btn--small" type="button" data-tris-main hidden></button>
    <button class="btn btn--small btn--ghost" type="button" data-tris-leave hidden>Leave race</button>
</div>
<div data-card-table data-tris-match hidden>
    <div class="tris-hud"><span data-tris-score></span><time role="timer" data-tris-clock></time></div>
    <div class="tris-arena">
        <div class="tris-primary" data-tris-playfield>
            <canvas width="240" height="480" role="img" aria-label="Turdtris playfield" tabindex="0" aria-describedby="tris-keyboard"></canvas>
            <b class="tris-countdown" aria-hidden="true" data-tris-countdown hidden></b>
        </div>
        <aside class="tris-rival">
            <span data-tris-rival></span>
            <canvas width="120" height="240" role="img" aria-label="Second playfield"></canvas>
            <div class="tris-preview" data-tris-preview></div>
        </aside>
        <div class="tris-controls" data-tris-controls hidden role="group" aria-label="Turdtris controls">
            ${inputs.map(([action, symbol, label]) => `<button type="button" class="btn btn--ghost" data-tris-input="${action}" aria-label="${label}" title="${label}">${symbol}</button>`).join('')}
        </div>
    </div>
    <p id="tris-keyboard" class="small tris-keyboard">Arrows move and rotate · Z rotates left · Space drops · C holds</p>
</div>
<dialog class="sheet" aria-labelledby="tris-confirm-title" data-tris-confirm>
    <h3 id="tris-confirm-title">Leave this race?</h3>
    <p class="small" data-tris-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-tris-confirm-yes>Leave race</button>
        <button class="btn btn--small btn--ghost" type="button" data-tris-confirm-no>Keep playing</button>
    </div>
</dialog>`;

function paint(ctx, art, grid, piece, ghost = []) {
    const size = ctx.canvas.width / 10;
    art.drawBackground(ctx, { width: ctx.canvas.width, height: ctx.canvas.height, reducedMotion: true });
    const tile = (row, col, type, preview = false) => {
        if (row >= 2) art.drawTile(ctx, col * size, (row - 2) * size, size, type,
            preview ? .75 : 1, preview ? ghostOptions : renderOptions);
    };
    for (const [row, line] of grid.entries()) {
        for (let col = 0; col < line.length; col++) if (line[col] && line[col] !== '.') tile(row, col, line[col]);
    }
    for (const [row, col] of ghost) tile(row, col, piece.name, true);
    for (const [row, col] of sprintCells(piece)) tile(row, col, piece.name);
}

export function mountArcadeTurdtris(container, onMatch) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-tris';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-tris-status]'), error = $('[data-tris-error]'), main = $('[data-tris-main]'),
        table = $('[data-tris-match]'), controls = $('[data-tris-controls]'), boardCanvas = $('.tris-primary canvas'),
        opponentCanvas = $('.tris-rival canvas'), confirm = $('[data-tris-confirm]'), leave = $('[data-tris-leave]');
    let scope, model, canOpen, connection, connectionError, receivedAt, raf = 0, lastDraw = 0, lastSent = -Infinity,
        lastSync = -Infinity, pending = null, art, drawKey = '', rivalDirty = true, retryAt = 0;
    let buffer = [], inflight = null, gesture = null, repeatTimer = 0, repeatInterval = 0;
    const serverTime = time => model.match.at + Math.max(0, time - receivedAt);
    const tickAt = time => Math.floor((serverTime(time) - model.match.startsAt) / SPRINT_TICK_MS);
    const clearRepeat = () => { clearTimeout(repeatTimer); clearInterval(repeatInterval); };
    const clearInputs = () => { buffer = []; inflight = null; clearRepeat(); gesture = null; };
    const clearPending = () => { clearTimeout(pending); pending = null; };
    const client = createGameNightMatchClient({
        onMatch,
        prefix: '/beta/arcade-turdtris',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = null;
            clearInputs();
            clearPending();
            if (confirm.open) confirm.close();
            render();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'turdtris' || state.version !== 1)) return;
            const switched = state?.id !== model?.id || state?.seat !== model?.seat;
            const reveal = state?.match && (!model?.match || switched);
            if (switched || state?.match?.result) {
                clearInputs();
                if (confirm.open) confirm.close();
            } else if (inflight && state?.match?.self?.sequence >= inflight.sequence) {
                inflight = null;
                error.textContent = '';
            }
            model = state;
            canOpen = host;
            receivedAt = performance.now();
            connection = 'ready';
            connectionError = undefined;
            clearPending();
            rivalDirty = true;
            drawKey = '';
            render();
            if (reveal) container.scrollTop = 0;
        },
        onError(reason) {
            clearPending();
            if (inflight && reason === 'input-paced') {
                buffer.unshift(...inflight.events);
                retryAt = performance.now() + 160;
            } else if (reason !== 'finished') {
                error.textContent = reason === 'storage-unavailable' ? 'Move confirmation interrupted. Continue from the current board.'
                    : 'The race could not accept that action.';
            }
            inflight = null;
            render();
        }
    });

    function send(action) {
        if (action === 'retry') { client.start(scope); return; }
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id })) return;
        error.textContent = '';
        pending = setTimeout(() => {
            pending = null;
            client.send({ action: 'sync' });
            render();
        }, 3000);
        render();
    }

    function queue(action) {
        if (connection !== 'ready' || !model?.match?.self || model.match.result || confirm.open || buffer.length >= 12) return;
        const tick = tickAt(performance.now());
        if (tick < 0 || serverTime(performance.now()) >= model.match.endsAt || model.match.self.board.status !== 'playing') return;
        buffer.push({ action, tick });
    }

    function predict(match, tick) {
        const board = structuredClone(match.self.board);
        for (const { action, tick: at } of [...(inflight?.events || []), ...buffer]) {
            advanceSprint(board, match.seed, Math.min(tick, Math.max(board.tick, at)));
            applySprintInput(board, match.seed, action);
        }
        advanceSprint(board, match.seed, tick);
        return board;
    }

    function drawFrame(time) {
        raf = 0;
        const match = model?.match;
        if (!match || !panel.open || panel.hidden) return;
        if (connection === 'ready' && !match.result) {
            if (inflight && time - inflight.sent > 4000) {
                client.start(scope);
                return;
            }
            if (!inflight && !pending && buffer.length && time >= retryAt && time - lastSent >= 100) {
                const sequence = match.self.sequence + 1, events = buffer.splice(0, 6);
                if (client.send({ action: 'input', id: match.id, sequence, inputs: events.map(event => event.action) })) {
                    inflight = { sequence, events, sent: time };
                    lastSent = time;
                }
            }
            if (!inflight && time - lastSync >= 1500 && time - lastSent > 500) {
                if (client.send({ action: 'sync' })) lastSync = time;
            }
        }
        if (time - lastDraw >= 32 || !drawKey) {
            const at = serverTime(time), seconds = Math.ceil(Math.max(0, match.startsAt - at) / 1000);
            const tick = Math.max(0, Math.min(tickAt(time), (match.endsAt - match.startsAt) / SPRINT_TICK_MS));
            const side = model.seat === 'b' ? 'b' : 'a';
            const rival = match.boards[side === 'a' ? 'b' : 'a'];
            const projected = match.self && !match.result && connection === 'ready' ? predict(match, tick) : match.boards[side];
            const shown = match.self?.board || projected;
            const clock = $('[data-tris-clock]'), overlay = $('[data-tris-countdown]');
            const clockText = formatRunTime(match.result ? match.result.tick * SPRINT_TICK_MS
                : Math.max(0, Math.ceil((match.endsAt - Math.max(at, match.startsAt)) / 1000)) * 1000);
            if (clock.textContent !== clockText) clock.textContent = clockText;
            overlay.hidden = !seconds || !!match.result;
            overlay.textContent = seconds || '';
            const playable = connection === 'ready' && !!match.self && !match.result && !seconds && shown.status === 'playing' && at < match.endsAt;
            table.dataset.phase = match.result ? 'finished' : seconds ? 'countdown' : 'play';
            table.dataset.sequence = match.self?.sequence ?? '';
            for (const button of controls.children) button.disabled = !playable;
            const primaryLabel = match.self ? 'You' : 'Player 1';
            $('[data-tris-score]').textContent = `${primaryLabel} · ${shown.lines}/40 · ${shown.score.toLocaleString()} pts`;
            $('[data-tris-rival]').textContent = `${match.self ? 'Opponent' : 'Player 2'} · ${rival.lines}/40${rival.status === 'top-out' ? ' · Out' : ''}`;
            const preview = $('[data-tris-preview]');
            const previewText = match.self && !match.result ? `Hold ${projected.hold ?? '—'} · Next ${sprintNext(match.seed, projected.cursor).join(' ')}` : '';
            if (preview.textContent !== previewText) preview.textContent = previewText;
            const key = JSON.stringify([projected.cursor, projected.hold, projected.piece, projected.status]);
            if (key !== drawKey) {
                art ||= createTurdtrisArt(() => document.createElement('canvas'));
                paint(boardCanvas.getContext('2d'), art, projected.grid, projected.piece, match.self && !match.result ? sprintGhost(projected) : []);
                drawKey = key;
            }
            if (rivalDirty) {
                paint(opponentCanvas.getContext('2d'), art, rival.grid, rival.piece);
                rivalDirty = false;
            }
            lastDraw = time;
        }
        if (!match.result) raf = requestAnimationFrame(drawFrame);
    }

    function render() {
        const match = model?.match, seat = model?.seat, result = match?.result;
        let message = 'Connecting to the race…', action = '', label = '';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'The race couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { action = 'retry'; label = 'Reconnect race'; }
        } else if (connection !== 'ready') {
            if (match) message = match.result ? 'Reconnecting to the race…' : 'Reconnecting · race clock keeps running';
        } else if (!model) {
            message = 'Same pieces. First to 40 lines or best board after two minutes.';
            if (canOpen) { action = 'open'; label = 'Open Turdtris race'; }
        } else if (model?.waiting) {
            message = seat ? 'Waiting for a second player.' : 'An opponent is ready.';
            if (!seat) { action = 'join'; label = 'Join Turdtris race'; }
        } else if (result) {
            message = result.winner === null ? 'Draw' : seat ? (result.winner === seat ? 'You win' : 'Opponent wins')
                : (result.winner === 'a' ? 'Player 1 wins' : 'Player 2 wins');
            message += ' · ' + { finish: '40 lines', time: 'time limit', resign: 'forfeit', 'top-out': 'both boards out' }[result.reason];
            if (seat && seat !== model.rematch) { action = 'rematch'; label = model.rematch ? 'Accept Turdtris rematch' : 'Request Turdtris rematch'; }
            if (seat && model.rematch === seat) message += ' · Rematch requested';
        } else if (match) {
            message = !seat ? 'Watching the race' : match.self.board.status === 'top-out' ? 'Your board topped out. Opponent still playing.'
                : match.self.board.status === 'cleared' ? '40 lines cleared. Confirming the finish…' : 'Race to 40';
        }
        if (message !== status.textContent) status.textContent = message;
        main.hidden = !action;
        main.dataset.command = action;
        main.textContent = label;
        main.disabled = !!pending;
        leave.hidden = !seat || !!result;
        leave.disabled = connection !== 'ready' || !!pending;
        table.hidden = !match;
        controls.hidden = !match?.self || !!result;
        if (connection !== 'ready') for (const button of controls.children) button.disabled = true;
        if (!raf && match && panel.open) raf = requestAnimationFrame(drawFrame);
    }

    main.addEventListener('click', () => send(main.dataset.command));
    leave.addEventListener('click', () => {
        $('[data-tris-confirm-text]').textContent = model?.waiting ? 'The open seat will close.' : 'Leaving forfeits your race.';
        clearRepeat();
        confirm.showModal();
    });
    $('[data-tris-confirm-no]').addEventListener('click', () => confirm.close());
    $('[data-tris-confirm-yes]').addEventListener('click', () => { confirm.close(); send(model?.waiting ? 'leave' : 'resign'); });
    panel.addEventListener('keydown', event => {
        const action = keys[event.key.toLowerCase()] ?? keys[event.key];
        if (event.target !== boardCanvas || !action || event.ctrlKey || event.altKey || event.metaKey) return;
        event.preventDefault();
        if (!event.repeat || repeatable(action)) queue(action);
    });
    for (const button of controls.children) {
        const action = button.dataset.trisInput;
        button.addEventListener('click', event => { if (event.detail === 0) queue(action); });
        button.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0) return;
            button.setPointerCapture(event.pointerId);
            clearRepeat();
            queue(action);
            if (repeatable(action)) repeatTimer = setTimeout(() => {
                queue(action);
                repeatInterval = setInterval(() => queue(action), 55);
            }, 155);
        });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(name, clearRepeat);
    }
    boardCanvas.addEventListener('pointerdown', event => {
        if (connection !== 'ready' || !event.isPrimary || event.pointerType === 'mouse') return;
        boardCanvas.setPointerCapture(event.pointerId);
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
    });
    boardCanvas.addEventListener('pointerup', event => {
        if (event.pointerId !== gesture?.id) return;
        const action = classifyGesture({ dx: event.clientX - gesture.x, dy: event.clientY - gesture.y, elapsedMs: performance.now() - gesture.at });
        if (action) queue({ rotate: 'cw', hardDrop: 'drop', softDrop: 'soft' }[action] || action);
        gesture = null;
    });
    for (const name of ['pointercancel', 'lostpointercapture']) boardCanvas.addEventListener(name, () => { gesture = null; });

    function reset() {
        client.stop();
        clearInputs();
        clearPending();
        cancelAnimationFrame(raf);
        raf = 0;
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
        client.start(scope);
    });
    return {
        panel,
        isOpen: () => panel.open,
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
