import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';
import { createEngineLoadFailure, loadEngine } from './arcade-engine-load.mjs';

let classifyRushSwipe, advanceRushRacer, RUSH_LIMIT_TICKS, rushRaceTick, unpackRushRacer, TurdRushRenderer;
const rushEngineSlot = { current: null };
const rushViewSlot = { current: null };
let onRushEngineFailure = () => {};
let onRushEngineSuccess = () => {};
let onRushViewFailure = () => {};
let onRushViewSuccess = () => {};
function loadRushEngine() {
    // Same versioned core URL as turdrush-race.js so the browser fetches that file once.
    return loadEngine(rushEngineSlot, () => Promise.all([
        import('/play/games/turdrush-core.js?v=fa8a8ce86510b759'),
        import('/play/games/turdrush-race.js')
    ]).then(([core, race]) => {
        classifyRushSwipe = core.classifyRushSwipe;
        ({ advanceRushRacer, RUSH_LIMIT_TICKS, rushRaceTick, unpackRushRacer } = race);
    }), () => onRushEngineFailure(), () => onRushEngineSuccess());
}
function loadRushView() {
    return loadEngine(rushViewSlot, () => import('/play/games/turdrush-renderer.js').then(view => {
        TurdRushRenderer = view.TurdRushRenderer;
    }), () => onRushViewFailure(), () => onRushViewSuccess());
}

const keys = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'jump', w: 'jump', ' ': 'jump', ArrowDown: 'slide', s: 'slide' };
const buttons = [['left', '←', 'Move left'], ['right', '→', 'Move right'], ['jump', '↑', 'Jump'], ['slide', '↓', 'Slide']];
const isLane = action => action === 'left' || action === 'right';
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const markup = `
<summary>Turd Rush Race</summary>
<p class="small arcade-card-status rush-race-status" data-race-status role="status"></p>
<p class="small arcade-card-error" data-race-error role="status"></p>
<div class="arcade-card-actions rush-race-actions">
    <button class="btn btn--small" type="button" data-race-main hidden></button>
    <button class="btn btn--small btn--ghost" type="button" data-race-leave hidden>Leave race</button>
</div>
<div data-card-table data-race-match hidden>
    <div class="rush-race-hud">
        <div data-race-score="a"><b></b><span></span><progress></progress></div>
        <div data-race-score="b"><b></b><span></span><progress></progress></div>
    </div>
    <div class="rush-race-track" data-race-track role="region" aria-label="Turd Rush race track" tabindex="0">
        <canvas data-race-3d aria-hidden="true"></canvas>
        <canvas data-race-2d width="640" height="340" aria-hidden="true" hidden></canvas>
        <b data-race-overlay hidden aria-hidden="true"></b>
    </div>
    <div class="rush-race-controls" data-race-controls role="group" aria-label="Turd Rush controls" hidden>
        ${buttons.map(([action, symbol, label]) => `<button type="button" class="btn btn--ghost" data-race-input="${action}" aria-label="${label}">${symbol} <small>${label.replace('Move ', '')}</small></button>`).join('')}
    </div>
</div>
<dialog class="sheet" aria-labelledby="race-confirm-title" data-race-confirm>
    <h3 id="race-confirm-title">Leave this race?</h3>
    <p class="small" data-race-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-race-confirm-yes>Leave race</button>
        <button class="btn btn--small btn--ghost" type="button" data-race-confirm-no>Keep running</button>
    </div>
</dialog>`;

// The same course stays readable on a device without WebGL 2.
function paintFlat(ctx, run) {
    const { width: w, height: h } = ctx.canvas, mid = w / 2, horizon = h * .16;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#167a79'); sky.addColorStop(1, '#092735');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, '#285562'); floor.addColorStop(1, '#10232d');
    ctx.beginPath(); ctx.moveTo(mid - 12, horizon); ctx.lineTo(mid + 12, horizon);
    ctx.lineTo(w * .97, h); ctx.lineTo(w * .03, h); ctx.closePath();
    ctx.fillStyle = floor; ctx.fill();
    for (const side of [-1, 1]) for (const edge of [.15, .46]) {
        ctx.beginPath(); ctx.moveTo(mid + side * 4, horizon); ctx.lineTo(mid + side * w * edge, h);
        ctx.strokeStyle = edge > .2 ? '#8fe9d0' : '#a3ded187';
        ctx.lineWidth = edge > .2 ? 3 : 1.5; ctx.stroke();
    }
    const nearby = run.entities.filter(entity => entity.at >= run.distance - 1 && entity.at - run.distance < 92);
    for (const { at, lane, kind } of nearby.sort((a, b) => b.at - a.at)) {
        const depth = 1 / (1 + Math.max(0, at - run.distance) / 18);
        const x = mid + (lane - 1) * w * .285 * depth, y = horizon + h * .72 * depth;
        const size = Math.max(3, 28 * depth);
        ctx.fillStyle = { pick: '#ffde74', shield: '#7afcc5', magnet: '#ff88b3', beam: '#a7f3ef', crate: '#ffab62', barrier: '#e76587' }[kind];
        if (kind === 'pick' || kind === 'magnet' || kind === 'shield') {
            ctx.beginPath(); ctx.moveTo(x, y - size * 1.2); ctx.lineTo(x + size * .38, y - size * .7);
            ctx.lineTo(x, y - size * .27); ctx.lineTo(x - size * .38, y - size * .7); ctx.closePath(); ctx.fill();
        } else if (kind === 'beam') {
            ctx.fillRect(x - size, y - size * 1.5, size * .19, size * 1.5);
            ctx.fillRect(x + size * .81, y - size * 1.5, size * .19, size * 1.5);
            ctx.fillRect(x - size, y - size * 1.5, size * 2, size * .32);
        } else {
            const high = kind === 'barrier' ? size * 1.9 : size * .88;
            ctx.fillRect(x - size * .78, y - high, size * 1.56, high);
            ctx.fillStyle = '#18242d'; ctx.fillRect(x - size * .54, y - high + size * .19, size * 1.08, size * .25);
        }
    }
    const x = mid + run.player.x / 2.4 * w * .285, y = h * .88 - run.player.y * 27;
    ctx.fillStyle = '#10212caa'; ctx.beginPath(); ctx.ellipse(x, h * .91, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = run.player.shield ? '#8effd7' : '#ffcc71';
    const body = run.player.slide ? 10 : 21;
    ctx.beginPath(); ctx.ellipse(x, y - body, 17, body, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d3441'; ctx.fillRect(x - 10, y - body - 3, 20, 5);
}

export function mountArcadeTurdRush(container, onMatch) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-rush-race';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-race-status]'), error = $('[data-race-error]'), main = $('[data-race-main]'), leave = $('[data-race-leave]'),
        table = $('[data-race-match]'), track = $('[data-race-track]'), controls = $('[data-race-controls]'), confirm = $('[data-race-confirm]'),
        canvas = $('[data-race-3d]'), flat = $('[data-race-2d]'), motion = matchMedia('(prefers-reduced-motion: reduce)');
    let pendingRushFrame = null;
    let scope, model, canOpen, connection, connectionError, visual, receivedAt, renderer, fallback = false, raf = 0, previous = 0,
        lastSent = -Infinity, lastSync = -Infinity, retryAt = 0, pending, gesture, redraw = true;
    let buffer = [], flights = [];
    const serverNow = time => model.match.at + Math.max(0, time - receivedAt);
    const clearInputs = () => { buffer = []; flights = []; gesture = null; };
    const clearPending = () => { clearTimeout(pending); pending = null; };
    function fallbackView() {
        fallback = true;
        renderer?.dispose();
        renderer = null;
        redraw = true;
    }
    function rebuild() {
        visual = model?.match && unpackRushRacer ? unpackRushRacer(model.match.runner) : null;
        if (!visual) return;
        const outstanding = [...flights.flatMap(flight => flight.inputs), ...buffer].filter(input => input[0] > visual.tick);
        visual.queue.push(...outstanding);
        visual.queue.sort((a, b) => a[0] - b[0]);
        redraw = true;
    }
    const engineLoad = createEngineLoadFailure(status, main);
    const retryRushEngine = () => loadRushEngine().then(ok => {
        if (!ok || !unpackRushRacer || !pendingRushFrame || !panel.isConnected) return;
        const frame = pendingRushFrame;
        pendingRushFrame = null;
        clientOptions.onState(frame);
    });
    const retryRushView = () => loadRushView().then(ok => {
        if (!ok) return;
        redraw = true;
        if (!raf && panel.open && !panel.hidden) raf = requestAnimationFrame(drawFrame);
    });
    onRushEngineFailure = () => engineLoad.fail(retryRushEngine);
    onRushEngineSuccess = () => engineLoad.loaded(retryRushEngine);
    onRushViewFailure = () => engineLoad.fail(retryRushView);
    onRushViewSuccess = () => engineLoad.loaded(retryRushView);
    const clientOptions = {
        onMatch,
        prefix: '/beta/arcade-turdrush',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = visual = null;
            clearPending();
            clearInputs();
            if (confirm.open) confirm.close();
            render();
        },
        onState(frame) {
            if (!unpackRushRacer) {
                pendingRushFrame = frame;
                if (!engineLoad.showing()) retryRushEngine();
                return;
            }
            pendingRushFrame = null;
            const { state, canOpen: host } = frame;
            if (state && (state.game !== 'turdrush' || state.version !== 1)) return;
            const changed = state?.id !== model?.id || state?.seat !== model?.seat;
            const reveal = state?.match && (!model?.match || changed);
            if (changed || state?.match?.result) {
                clearInputs();
                renderer?.resetRun();
                if (confirm.open) confirm.close();
            } else if (state?.match) {
                flights = flights.filter(flight => flight.sequence > state.match.runner.sequence);
            }
            model = state;
            canOpen = host;
            receivedAt = performance.now();
            connection = 'ready';
            connectionError = undefined;
            clearPending();
            rebuild();
            render();
            if (reveal) container.scrollTop = 0;
        },
        onError(reason) {
            clearPending();
            clearInputs();
            rebuild();
            retryAt = performance.now() + 170;
            if (reason !== 'finished') put(error, reason === 'late-input' ? 'A move arrived late. Resynced to the course.'
                : reason === 'input-paced' ? 'Too many moves at once.' : 'The race could not confirm that action.');
            render();
        }
    };
    const client = createGameNightMatchClient(clientOptions);

    function send(action) {
        if (action === 'retry') { client.start(scope); return; }
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id })) return;
        put(error, '');
        pending = setTimeout(() => client.start(scope), 4000);
        render();
    }

    function queue(action) {
        const match = model?.match;
        if (!rushRaceTick || connection !== 'ready' || !model?.seat || !match || match.result || pending || confirm.open || buffer.length >= 8 ||
            visual?.status !== 'running') return;
        const now = serverNow(performance.now());
        if (now < match.startsAt) return;
        const tick = Math.max(visual.tick + 1, rushRaceTick(match.startsAt, now) + 1, visual.queue.at(-1)?.[0] || 1);
        if (tick > RUSH_LIMIT_TICKS) return;
        const input = [tick, action];
        buffer.push(input);
        visual.queue.push(input);
        put(error, '');
    }

    function drawFrame(time) {
        raf = 0;
        const match = model?.match, seat = model?.seat;
        if (!match || !visual || !panel.open || panel.hidden) return;
        if (connection === 'ready' && !match.result) {
            if (flights.length && time - flights[0].sent > 4000) { client.start(scope); return; }
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
        if (connection === 'ready' && !match.result && countdown <= 0 && advanceRushRacer) {
            advanceRushRacer(visual, seat ? rushRaceTick(match.startsAt, at) : match.tick);
        }
        const run = visual.run;
        const overlay = $('[data-race-overlay]');
        const shown = match.result ? '' : countdown > 0 ? String(countdown) : visual.status === 'running' ? ''
            : match.runner.status === 'running' ? 'Confirming run…' : visual.status === 'finished' ? 'Course complete' : 'Run ended';
        overlay.hidden = !shown;
        put(overlay, shown);
        table.dataset.phase = match.result ? 'finished' : countdown > 0 ? 'countdown' : 'play';
        table.dataset.lane = run.player.lane;
        table.dataset.sequence = seat ? match.runner.sequence : '';
        table.dataset.confirmedTick = match.runner.tick;
        for (const button of controls.children) button.disabled = connection !== 'ready' || countdown > 0 || visual.status !== 'running';
        for (const [index, position] of ['a', 'b'].entries()) {
            const score = $(`[data-race-score="${position}"]`);
            const data = match.players[position];
            const label = seat ? (position === seat ? 'You' : 'Rival') : 'Player ' + (index + 1);
            const distance = Math.min(match.course, Math.floor(data.distance));
            score.style.order = position === seat ? '-1' : String(index);
            put(score.children[0], label);
            put(score.children[1], `${distance} m · ${data.picks} pick${data.picks === 1 ? '' : 's'}${data.status === 'crashed' ? ' · Out' : ''}`);
            const progress = score.children[2];
            if (progress.max !== match.course) progress.max = match.course;
            if (progress.getAttribute('aria-label') !== label + ' progress') progress.setAttribute('aria-label', label + ' progress');
            if (Math.floor(progress.value) !== distance) progress.value = distance;
        }
        const render3d = !!seat && !fallback;
        canvas.hidden = !render3d;
        flat.hidden = render3d;
        if (render3d && !renderer) {
            if (!TurdRushRenderer) {
                if (!engineLoad.showing()) retryRushView();
            } else {
                try { renderer = new TurdRushRenderer(canvas, { reducedMotion: motion.matches, onLost: fallbackView }); }
                catch { fallbackView(); canvas.hidden = true; flat.hidden = false; }
            }
        }
        const resized = renderer?.resize();
        if (redraw || resized || visual.tick !== oldTick) {
            if (renderer) {
                renderer.reducedMotion = motion.matches;
                renderer.render(run, Math.max(0, (time - previous) / 1000));
            } else paintFlat(flat.getContext('2d'), run);
            redraw = false;
        }
        table.dataset.renderer = renderer ? '3d' : '2d';
        previous = time;
        if (!match.result) raf = requestAnimationFrame(drawFrame);
    }

    function render() {
        if (engineLoad.showing()) {
            engineLoad.hold();
            return;
        }
        const match = model?.match, seat = model?.seat, result = match?.result;
        let message = 'Connecting to the race…', action = '', label = '';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'The race couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { action = 'retry'; label = 'Reconnect race'; }
        } else if (connection !== 'ready') {
            if (match) message = match.result ? 'Reconnecting to the race…' : 'Reconnecting · the course keeps moving';
        } else if (!model) {
            message = 'Same 480 m course. Go farther, then collect more picks to break a tie.';
            if (canOpen) { action = 'open'; label = 'Open Turd Rush race'; }
        } else if (model?.waiting) {
            message = seat ? 'Waiting for a second runner.' : 'A runner is ready.';
            if (!seat) { action = 'join'; label = 'Join Turd Rush race'; }
        } else if (result) {
            message = result.winner === null ? 'Draw' : seat ? (result.winner === seat ? 'You win' : 'Rival wins')
                : (result.winner === 'a' ? 'Player 1 wins' : 'Player 2 wins');
            if (result.reason === 'resign') message += ' · forfeit';
            if (seat && seat !== model.rematch) { action = 'rematch'; label = model.rematch ? 'Accept Turd Rush rematch' : 'Request Turd Rush rematch'; }
            if (seat && seat === model.rematch) message += ' · Rematch requested';
        } else if (match) message = !seat ? 'Watching both runners' : 'Swipe or use arrows to move, jump and slide.';
        put(status, message);
        status.classList.toggle('rush-race-playing', !!match && !result);
        main.hidden = !action;
        main.dataset.command = action;
        put(main, label);
        main.disabled = !!pending;
        leave.hidden = !seat || !!result;
        leave.disabled = connection !== 'ready' || !!pending;
        table.hidden = !match;
        controls.hidden = !seat || !match || !!result;
        if (connection !== 'ready') for (const button of controls.children) button.disabled = true;
        if (!raf && match && panel.open) raf = requestAnimationFrame(drawFrame);
    }

    main.addEventListener('click', () => send(main.dataset.command));
    leave.addEventListener('click', () => {
        put($('[data-race-confirm-text]'), model?.waiting ? 'The open seat will close.' : 'Leaving forfeits your race.');
        confirm.showModal();
    });
    $('[data-race-confirm-no]').addEventListener('click', () => confirm.close());
    $('[data-race-confirm-yes]').addEventListener('click', () => { confirm.close(); send(model?.waiting ? 'leave' : 'resign'); });
    track.addEventListener('keydown', event => {
        const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
        if (!action || event.ctrlKey || event.altKey || event.metaKey) return;
        event.preventDefault();
        if (!event.repeat) queue(action);
    });
    for (const button of controls.children) {
        const action = button.dataset.raceInput;
        button.addEventListener('pointerdown', event => {
            if (event.button === 0 && event.isPrimary !== false) { event.preventDefault(); queue(action); }
        });
        button.addEventListener('click', event => { if (event.detail === 0) queue(action); });
    }
    track.addEventListener('pointerdown', event => {
        if (connection !== 'ready' || !model?.seat || gesture || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, action: null };
        track.setPointerCapture?.(event.pointerId);
    });
    function swipe(event) {
        if (gesture?.id !== event.pointerId || gesture.action) return;
        if (!classifyRushSwipe) return;
        const action = classifyRushSwipe(event.clientX - gesture.x, event.clientY - gesture.y);
        if (action) { gesture.action = action; queue(isLane(action) ? 'swipe-' + action : action); }
    }
    track.addEventListener('pointermove', swipe);
    track.addEventListener('pointerup', event => { swipe(event); if (gesture?.id === event.pointerId) gesture = null; });
    function cancel(event) {
        if (gesture?.id !== event.pointerId) return;
        if (isLane(gesture.action)) queue('cancel-swipe');
        gesture = null;
    }
    track.addEventListener('pointercancel', cancel);
    track.addEventListener('lostpointercapture', cancel);

    function reset() {
        client.stop();
        clearPending();
        clearInputs();
        cancelAnimationFrame(raf);
        raf = previous = 0;
        renderer?.dispose();
        renderer = null;
        model = visual = null;
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
        void loadRushEngine();
        void loadRushView();
        client.start(scope);
    });
    return {
        panel,
        isOpen: () => panel.open,
        ready: () => loadRushEngine(),
        open() {
            if (!scope) return;
            void loadRushEngine();
            void loadRushView();
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
