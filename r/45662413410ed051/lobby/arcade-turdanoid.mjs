import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';
import '/play/games/turdanoid-sprites-core.js';
import { advanceBrickRacer, brickRaceWall, brickRacePaddle, brickRaceTick, BRICK_LIMIT_TICKS, BRICK_WIDTH, BRICK_HEIGHT } from '/play/games/turdanoid-race.js';

const { paintWorldStageCached, paintBrickBevel, paintHpPips, paintPaddle, paintBall, roundRect } = globalThis.TurdanoidSprites;
const tileColors = [['#72efad', '#1f8b66'], ['#68d5ed', '#236c9b'], ['#f6d677', '#b48b2b'], ['#ffac87', '#be6151'],
    ['#f294d5', '#9c4383'], ['#b8a7ff', '#6d56be']];
const capsules = { wide: ['Wide Load', 'W', '#9effc8'], sticky: ['Plunger Catch', 'C', '#ffd76a'], slow: ['Air Freshener', 'S', '#7ae6ff'] };
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const markup = `
<summary>Turdanoid Brick Race</summary>
<p class="small arcade-card-status brick-race-status" data-brick-status role="status"></p>
<p class="small arcade-card-error" data-brick-error role="status"></p>
<div class="arcade-card-actions brick-race-actions">
    <button class="btn btn--small" type="button" data-brick-main hidden></button>
    <button class="btn btn--small btn--ghost" type="button" data-brick-leave hidden>Leave</button>
</div>
<div data-card-table data-brick-match hidden>
    <div class="brick-race-layout">
        <div class="brick-race-board" data-brick-board tabindex="0" role="region" aria-label="Turdanoid playfield" aria-describedby="brick-race-help">
            <canvas width="${BRICK_WIDTH}" height="${BRICK_HEIGHT}" aria-hidden="true"></canvas>
            <b data-brick-overlay aria-hidden="true" hidden></b>
        </div>
        <div class="brick-race-rail">
            <time role="timer" data-brick-clock></time>
            <div data-brick-score="a"><b></b><span></span><small></small></div>
            <div data-brick-score="b"><b></b><span></span><small></small></div>
            <button type="button" class="btn btn--small" data-brick-serve hidden>Launch</button>
            <span class="small" data-brick-power></span>
        </div>
    </div>
    <p class="small" id="brick-race-launch-wait" data-brick-launch-wait hidden></p>
    <p class="small brick-race-help" id="brick-race-help">Drag or use the arrow keys to move. Tap the stuck ball or press Launch.</p>
</div>
<dialog class="sheet" aria-labelledby="brick-confirm-title" data-brick-confirm>
    <h3 id="brick-confirm-title">Leave this race?</h3>
    <p class="small" data-brick-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-brick-confirm-yes>Leave</button>
        <button class="btn btn--small btn--ghost" type="button" data-brick-confirm-no>Cancel</button>
    </div>
</dialog>`;

function createPainter(canvas) {
    const ctx = canvas.getContext('2d'), layer = canvas.ownerDocument.createElement('canvas');
    layer.width = BRICK_WIDTH;
    layer.height = BRICK_HEIGHT;
    const scenery = layer.getContext('2d');
    let field, pattern;
    return (run, wall, reducedMotion) => {
        const hp = run.hp.join(',');
        if (field !== wall || pattern !== hp) {
            field = wall;
            pattern = hp;
            const gradient = scenery.createLinearGradient(0, 0, 0, BRICK_HEIGHT);
            gradient.addColorStop(0, '#10272d');
            gradient.addColorStop(1, '#07131b');
            scenery.fillStyle = gradient;
            scenery.fillRect(0, 0, BRICK_WIDTH, BRICK_HEIGHT);
            paintWorldStageCached(scenery, { id: 'sewer' }, { W: BRICK_WIDTH, H: BRICK_HEIGHT, reducedMotion: true });
            for (const [id, brick] of wall.bricks.entries()) {
                if (!run.hp[id]) continue;
                const [c1, c2] = tileColors[brick.color ?? brick.r % tileColors.length];
                scenery.save();
                scenery.translate(brick.x, brick.y);
                paintBrickBevel(scenery, brick.w, brick.h, { c1, c2 });
                scenery.restore();
                paintHpPips(scenery, { ...brick, hp: run.hp[id] });
            }
        }
        ctx.drawImage(layer, 0, 0);
        for (const capsule of run.capsules) {
            const [, label, color] = capsules[capsule.kind];
            ctx.fillStyle = color;
            roundRect(ctx, capsule.x - 13, capsule.y - 8, 26, 16, 7);
            ctx.fill();
            ctx.fillStyle = '#182325'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
            ctx.fillText(label, capsule.x, capsule.y + 4);
        }
        paintPaddle(ctx, brickRacePaddle(run), run.powers, 0, { W: BRICK_WIDTH, H: BRICK_HEIGHT, reducedMotion });
        if (run.status !== 'out') paintBall(ctx, run.ball, { reducedMotion });
    };
}

export function mountArcadeTurdanoid(container, onMatch) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-brick-race';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const table = $('[data-brick-match]'), board = $('[data-brick-board]'), status = $('[data-brick-status]'),
        error = $('[data-brick-error]'), main = $('[data-brick-main]'), leave = $('[data-brick-leave]'),
        launch = $('[data-brick-serve]'), confirm = $('[data-brick-confirm]'), motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (matchMedia('(pointer: coarse)').matches) {
        $('.brick-race-help').textContent = 'Drag to move. Tap the stuck ball or press Launch.';
    }
    const paint = createPainter(board.querySelector('canvas'));
    let scope, model, canOpen, connection, connectionError, visual, wall, receivedAt, raf = 0, pending, pointer,
        desiredAim = null, lastAim = -Infinity, lastSent = -Infinity, lastSync = -Infinity, retryAt = 0, redraw = true;
    const inputBufferLimit = 8;
    let launchPointer = null, desiredAxis = null, keyboardActive = false, pointerStart = null;
    let buffer = [], flights = [], keys = new Set();
    const serverNow = time => model.match.at + Math.max(0, time - receivedAt);
    function clearPending() { clearTimeout(pending); pending = null; }
    function clearInputs(keepKeyboard = false) {
        buffer = [];
        flights = [];
        if (!keepKeyboard) { keys.clear(); keyboardActive = false; }
        pointer = null;
        pointerStart = null;
        launchPointer = null;
        desiredAim = desiredAxis = null;
    }
    function rebuild() {
        visual = model?.match ? structuredClone(model.match.runner) : null;
        if (!visual) return;
        visual.queue.push(...[...flights.flatMap(flight => flight.inputs), ...buffer].filter(input => input[0] > visual.tick));
        visual.queue.sort((a, b) => a[0] - b[0]);
        redraw = true;
    }
    const client = createGameNightMatchClient({
        onMatch,
        prefix: '/beta/arcade-turdanoid',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = visual = null;
            clearPending();
            clearInputs();
            if (confirm.open) confirm.close();
            render();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'turdanoid' || state.version !== 1)) return;
            const reconnecting = connection !== 'ready';
            const changed = state?.id !== model?.id || state?.seat !== model?.seat;
            const reveal = state?.match && (!model?.match || changed);
            if (reveal) wall = brickRaceWall(state.match.seed);
            if (changed || state?.match?.result) {
                clearInputs();
                if (confirm.open) confirm.close();
            } else if (state?.match) flights = flights.filter(flight => flight.sequence > state.match.runner.sequence);
            model = state;
            canOpen = host;
            receivedAt = performance.now();
            connection = 'ready';
            connectionError = undefined;
            clearPending();
            rebuild();
            if ((reveal || reconnecting) && state?.seat && visual?.run.axis) {
                keyboardActive = true;
                desiredAxis = 0;
            }
            render();
            if (reveal) container.scrollTop = 0;
        },
        onError(reason) {
            clearPending();
            const retryKeyboard = keyboardActive && reason !== 'finished';
            clearInputs(retryKeyboard);
            rebuild();
            retryAt = performance.now() + 175;
            if (retryKeyboard) {
                // A rejected batch can discard a release after the previous move was accepted.
                desiredAxis = axis();
                client.send({ action: 'sync' });
            }
            if (reason !== 'finished') put(error, reason === 'late-input' ? 'A move arrived late. Resynced to the board.'
                : reason === 'input-paced' ? 'Too many moves at once.' : 'The race could not confirm that action.');
            render();
        }
    });

    function send(action) {
        if (action === 'retry') { client.start(scope); return; }
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id })) return;
        put(error, '');
        pending = setTimeout(() => client.start(scope), 4000);
        render();
    }

    function queue(action, value, time = performance.now()) {
        const match = model?.match;
        if (connection !== 'ready' || !model?.seat || !match || match.result || pending || confirm.open || buffer.length >= inputBufferLimit ||
            visual?.run.status !== 'play' || serverNow(time) < match.startsAt) return false;
        const tick = Math.max(visual.tick + 1, brickRaceTick(match.startsAt, serverNow(time)) + 1, visual.queue.at(-1)?.[0] || 1);
        if (tick > BRICK_LIMIT_TICKS) return false;
        const input = action === 'serve' ? [tick, action] : [tick, action, value];
        buffer.push(input);
        visual.queue.push(input);
        put(error, '');
        return true;
    }

    function requestServe() {
        const containsServe = inputs => inputs.some(([, control]) => control === 'serve');
        if (!visual?.run.ball.stuck || containsServe(visual.queue) || containsServe(buffer) ||
            flights.some(flight => containsServe(flight.inputs))) return;
        queue('serve');
    }

    function drawFrame(time) {
        raf = 0;
        const match = model?.match, seat = model?.seat;
        if (!match || !visual || !panel.open || panel.hidden) return;
        if (connection === 'ready' && !match.result) {
            if (flights.length && time - flights[0].sent > 4000) { client.start(scope); return; }
            if (desiredAxis !== null && time >= retryAt && queue('axis', desiredAxis, time)) desiredAxis = null;
            if (desiredAim !== null && time - lastAim >= 90 && queue('aim', desiredAim, time)) {
                lastAim = time;
                desiredAim = null;
            }
            if (buffer.length && flights.length < 4 && !pending && time >= retryAt && time - lastSent >= 85) {
                const sequence = (flights.at(-1)?.sequence ?? match.runner.sequence) + 1, inputs = buffer.splice(0, 4);
                if (client.send({ action: 'input', id: match.id, sequence, inputs })) {
                    flights.push({ sequence, inputs, sent: time });
                    lastSent = time;
                }
            }
            if (time - lastSync >= 950 && time - lastSent >= 350 && client.send({ action: 'sync' })) lastSync = time;
        }
        const at = serverNow(time), countdown = Math.ceil((match.startsAt - at) / 1000), oldTick = visual.tick;
        if (connection === 'ready' && !match.result && countdown <= 0 && seat) advanceBrickRacer(visual, brickRaceTick(match.startsAt, at), wall, match.seed);
        const run = visual.run;
        const overlay = $('[data-brick-overlay]');
        const label = match.result ? '' : countdown > 0 ? String(countdown) : run.status === 'out' ? 'Out of balls' : '';
        overlay.hidden = !label;
        put(overlay, label);
        table.dataset.phase = match.result ? 'finished' : countdown > 0 ? 'countdown' : 'play';
        table.dataset.sequence = seat ? match.runner.sequence : '';
        table.dataset.paddle = Math.round(run.paddleX);
        table.dataset.stuck = String(run.ball.stuck);
        launch.disabled = connection !== 'ready' || countdown > 0 || !run.ball.stuck || run.status !== 'play' || !!pending;
        const showLaunchWait = !!seat && !match.result && countdown > 0;
        const launchWait = $('[data-brick-launch-wait]');
        launchWait.hidden = !showLaunchWait;
        put(launchWait, showLaunchWait ? 'Launch is not active yet. The countdown is still running.' : '');
        if (showLaunchWait) launch.setAttribute('aria-describedby', 'brick-race-launch-wait');
        else launch.removeAttribute('aria-describedby');
        const seconds = Math.max(0, Math.ceil((match.endsAt - Math.max(at, match.startsAt)) / 1000));
        put($('[data-brick-clock]'), match.result ? 'Final' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
        const active = Object.keys(capsules).find(power => run.powers[power]);
        put($('[data-brick-power]'), seat && active ? capsules[active][0] : '');
        for (const [index, position] of ['a', 'b'].entries()) {
            const score = $(`[data-brick-score="${position}"]`), data = match.players[position];
            score.style.order = position === seat ? '-1' : String(index + 1);
            put(score.children[0], seat ? (position === seat ? 'You' : 'Rival') : 'Player ' + (index + 1));
            put(score.children[1], `${data.broken}/${match.wall.total} bricks`);
            put(score.children[2], `${data.score} pts · ${data.lives} ball${data.lives === 1 ? '' : 's'}`);
        }
        if (redraw || visual.tick !== oldTick) { paint(run, wall, motion.matches); redraw = false; }
        if (!match.result) raf = requestAnimationFrame(drawFrame);
    }

    function render() {
        const match = model?.match, seat = model?.seat, result = match?.result;
        let message = 'Connecting to the race…', action = '', label = '';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'Reconnecting… The clock keeps running.';
            if (!connectionError || connectionError === 'rate-limited') { action = 'retry'; label = 'Retry'; }
        } else if (connection !== 'ready') {
            if (match) message = match.result ? 'Reconnecting…' : 'Reconnecting… The clock keeps running.';
        } else if (!model) {
            message = canOpen ? 'Same wall and three balls. Clear it first or break the most bricks in 75 seconds.'
                : 'Waiting for the host to open a table.';
            if (canOpen) { action = 'open'; label = 'Open'; }
        } else if (model?.waiting) {
            message = seat ? 'Waiting for a second player.' : 'An opponent is ready.';
            if (!seat) { action = 'join'; label = 'Join'; }
        } else if (result) {
            message = result.winner === null ? 'Draw' : seat ? (result.winner === seat ? 'You win' : 'Rival wins')
                : (result.winner === 'a' ? 'Player 1 wins' : 'Player 2 wins');
            message += ' · ' + { clear: 'wall cleared', time: 'time limit', out: 'out of balls', resign: 'forfeit' }[result.reason];
            if (seat && seat !== model.rematch) { action = 'rematch'; label = 'Rematch'; }
            if (seat && seat === model.rematch) message += ' · Rematch requested';
        } else if (match) message = seat ? match.wall.name : `Watching · ${match.wall.name}`;
        put(status, message);
        main.hidden = !action;
        main.dataset.command = action;
        put(main, label);
        main.disabled = !!pending;
        leave.hidden = !seat || !!result;
        leave.disabled = connection !== 'ready' || !!pending;
        table.hidden = !match;
        launch.hidden = !seat || !match || !!result;
        if (connection !== 'ready') launch.disabled = true;
        if (!raf && match && panel.open) raf = requestAnimationFrame(drawFrame);
    }

    main.addEventListener('click', () => send(main.dataset.command));
    const hitsLaunch = event => launch.contains(document.elementFromPoint(event.clientX, event.clientY));
    launch.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch' && event.isPrimary && event.button === 0 && !launch.disabled) launchPointer = event.pointerId;
    });
    launch.addEventListener('pointerup', event => {
        if (event.pointerId !== launchPointer) return;
        launchPointer = null;
        // Captured touch can end outside the button, and a touch release may have no click.
        if (!launch.disabled && hitsLaunch(event)) requestServe();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) launch.addEventListener(name, event => {
        if (event.pointerId === launchPointer) launchPointer = null;
    });
    launch.addEventListener('click', event => {
        if (event.detail === 0 || hitsLaunch(event)) requestServe();
    });
    leave.addEventListener('click', () => {
        put($('[data-brick-confirm-text]'), model?.waiting ? 'The open seat will close.' : 'Leaving forfeits your race.');
        confirm.showModal();
    });
    $('[data-brick-confirm-no]').addEventListener('click', () => confirm.close());
    $('[data-brick-confirm-yes]').addEventListener('click', () => { confirm.close(); send(model?.waiting ? 'leave' : 'resign'); });
    function axis() { return Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')); }
    function updateAxis() {
        const value = axis();
        if (queue('axis', value)) { keyboardActive = true; desiredAxis = null; return true; }
        if (!keyboardActive && buffer.length < inputBufferLimit) return false;
        // Keep the latest keyboard intent when a release arrives between sends.
        keyboardActive = true;
        desiredAxis = value;
        return true;
    }
    board.addEventListener('keydown', event => {
        if (event.ctrlKey || event.altKey || event.metaKey || !['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) return;
        event.preventDefault();
        if (event.repeat) return;
        if (event.key === ' ') { requestServe(); return; }
        desiredAim = null;
        keys.add(event.key);
        if (!updateAxis()) keys.delete(event.key);
    });
    board.addEventListener('keyup', event => {
        if (!keys.delete(event.key)) return;
        event.preventDefault();
        updateAxis();
    });
    board.addEventListener('blur', () => { if (keys.size) { keys.clear(); updateAxis(); } });
    function aim(event) {
        if (pointer !== event.pointerId) return;
        const rect = board.getBoundingClientRect();
        if (rect.width > 0) desiredAim = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 1000);
    }
    // A finger on the painted ball counts. The radius stays inside a nearby aim tap.
    function hitsStuckBall(event) {
        const ball = visual?.run?.ball;
        const rect = board.getBoundingClientRect();
        if (!ball?.stuck || visual.run.status !== 'play' || !(rect.width > 0) || !(rect.height > 0)) return false;
        const x = (event.clientX - rect.left) / rect.width * BRICK_WIDTH;
        const y = (event.clientY - rect.top) / rect.height * BRICK_HEIGHT;
        const radius = Math.max(ball.r * 2.2, 16 * BRICK_WIDTH / rect.width);
        return Math.hypot(x - ball.x, y - ball.y) <= radius;
    }
    board.addEventListener('pointerdown', event => {
        if (connection !== 'ready' || !model?.seat || pointer !== null && pointer !== undefined || event.isPrimary === false || event.button !== 0) return;
        event.preventDefault();
        keys.clear();
        keyboardActive = false;
        desiredAxis = null;
        pointer = event.pointerId;
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, ball: hitsStuckBall(event) };
        board.setPointerCapture?.(pointer);
        aim(event);
    });
    board.addEventListener('pointermove', aim);
    board.addEventListener('pointerup', event => {
        const start = pointerStart?.id === event.pointerId ? pointerStart : null;
        aim(event);
        if (pointer === event.pointerId) pointer = null;
        if (!start) return;
        pointerStart = null;
        // A drag keeps aiming. A tap on the stuck ball is the only board serve.
        if (!start.ball || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
        requestServe();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) board.addEventListener(name, event => {
        if (pointer !== event.pointerId) return;
        pointer = null;
        desiredAim = null;
        if (name === 'pointercancel') pointerStart = null;
    });

    function reset() {
        client.stop();
        clearPending();
        clearInputs();
        cancelAnimationFrame(raf);
        raf = 0;
        model = visual = wall = null;
        connection = 'connecting';
        connectionError = undefined;
        put(error, '');
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
        open() {
            if (!scope) return;
            panel.open = true;
            return panel;
        },
        setRoom(next) {
            if (scope?.room === next?.room && scope?.ref === next?.ref && scope?.actor === next?.actor) return;
            scope = next;
            panel.hidden = !scope;
            panel.open = false;
            reset();
        }
    };
}
