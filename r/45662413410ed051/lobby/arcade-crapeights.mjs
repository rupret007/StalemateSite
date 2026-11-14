import { gameNightCue } from './game-night-audio.mjs';
import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';

const suits = { S: ['♠', 'Spades'], H: ['♥', 'Hearts'], D: ['♦', 'Diamonds'], C: ['♣', 'Clubs'] };
const side = { a: 'Seat 1', b: 'Seat 2' };
const special = { '2': 'Draw two', '8': 'Wild', J: 'Skip', Q: 'Reverse' };
const describe = card => `${card.rank} of ${suits[card.suit][1]}`;
const face = card => `${card.rank}${suits[card.suit][0]}`;
const errors = {
    stale: 'The table changed. Check your hand and try again.',
    'wrong-turn': 'Wait for your turn.',
    'illegal-card': 'That card does not match the discard.',
    'choose-suit': 'Choose a suit for the eight.',
    'storage-unavailable': 'The move was not confirmed. Try again.',
    'seat-unavailable': 'That seat has already been taken.'
};
const markup = `
<summary>Crappy Eights</summary>
<p class="small arcade-card-status" data-eights-status role="status"></p>
<p class="small arcade-card-error" data-eights-error role="status"></p>
<button class="btn" type="button" data-eights-main hidden></button>
    <button type="button" class="btn btn--small btn--ghost" data-start-rematch hidden>Start now</button>
<div data-eights-table data-card-table hidden>
    <div class="arcade-card-score" aria-label="Match scores">
        <span data-eights-score="a"></span>
        <span data-eights-score="b"></span>
    </div>
    <div class="arcade-card-piles">
        <div class="arcade-card-discard" aria-label="Discard"><b data-eights-top></b><span data-eights-suit></span></div>
        <div><button class="btn btn--small" type="button" data-eights-action="draw">Draw</button><button class="btn btn--small btn--ghost" type="button" data-eights-action="pass" hidden>Pass</button></div>
    </div>
    <p class="small arcade-card-hand-label" data-eights-hand-label></p>
    <div class="arcade-card-hand" aria-label="Your hand" role="group" data-eights-hand></div>
    <fieldset data-eights-choose hidden>
        <legend>Choose the suit for your eight</legend>
        <div class="arcade-card-actions" data-eights-suits></div>
    </fieldset>
    <div class="arcade-card-actions">
        <button class="btn btn--small btn--ghost" type="button" data-eights-action="resign" hidden>Resign</button>
        <button class="btn btn--small btn--ghost" type="button" data-eights-action="leave" hidden>Leave table</button>
    </div>
</div>
<dialog class="sheet" aria-labelledby="eights-confirm-title" data-eights-confirm>
    <h3 id="eights-confirm-title"></h3>
    <p class="small" data-eights-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-eights-confirm-yes>Confirm</button>
        <button class="btn btn--small btn--ghost" type="button" data-eights-confirm-no>Cancel</button>
    </div>
</dialog>`;

export function mountArcadeCrapeights(container, onMatch) {
    const document = container.ownerDocument;
    const panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-eights';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-eights-status]'), error = $('[data-eights-error]');
    const main = $('[data-eights-main]'), table = $('[data-eights-table]'), hand = $('[data-eights-hand]');
    const choose = $('[data-eights-choose]'), suitControls = $('[data-eights-suits]'), confirm = $('[data-eights-confirm]');
    const actions = [...panel.querySelectorAll('[data-eights-action]')];
    let scope = null, model = null, canOpen = false, phase = 'connecting', pending = false, timer;
    let selected = null, confirmation = null, connectionError;

    function clearPending() { clearTimeout(timer); pending = false; }
    function closeChoices() {
        selected = null;
        confirmation = null;
        if (confirm.open) confirm.close();
    }
    function reset() {
        client.stop();
        clearPending();
        closeChoices();
        model = null;
        canOpen = false;
        phase = 'connecting';
        connectionError = undefined;
        error.textContent = '';
        draw();
    }

    const client = createGameNightMatchClient({
        onMatch,
        prefix: '/beta/arcade-crapeights',
        onStatus(next, reason) {
            phase = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = null;
            clearPending();
            closeChoices();
            draw();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'crapeights' || state.version !== 1)) return;
            const match = state?.match, previous = model?.match;
            const showingTable = match && (!previous || model.id !== state.id);
            const showingOutcome = panel.open && ((match?.result && !previous?.result) || (match?.roundResult && !previous?.roundResult));
            const focused = document.activeElement;
            const focusInTable = showingOutcome && panel.contains(focused);
            if (model?.id !== state?.id || previous?.revision !== match?.revision) closeChoices();
            phase = 'ready';
            connectionError = undefined;
            if (connection === 'ready' && state?.seat && state.match && state.match.id === model?.match?.id
                && state.match.revision !== model.match.revision) gameNightCue(state.match.action?.kind === 'draw' ? 'eights.draw' : 'eights.play');
            model = state;
            canOpen = host;
            clearPending();
            draw();
            if (showingTable || showingOutcome && (focusInTable || focused === document.body)) container.scrollTop = 0;
            if (focusInTable && !main.hidden && !main.disabled &&
                (document.activeElement !== focused || focused.matches(':disabled') || focused.closest('[hidden]'))) main.focus({ preventScroll: true });
        },
        onError(reason) {
            clearPending();
            error.textContent = errors[reason] || 'That action is unavailable right now.';
            draw();
        }
    });

    function send(action, fields = {}) {
        if (phase !== 'ready' || pending || !client.send({ action, id: model?.id, revision: model?.match?.revision, ...fields })) return;
        pending = true;
        error.textContent = '';
        timer = setTimeout(() => {
            pending = false;
            error.textContent = 'Checking the table…';
            client.send({ action: 'sync' });
            draw();
        }, 6000);
        draw();
    }

    function showHand(match) {
        const focused = document.activeElement?.dataset.eightsCard;
        const old = new Map([...hand.children].map(button => [button.dataset.eightsCard, button]));
        const next = (match?.hand || []).map(card => {
            const key = String(card.id);
            const button = old.get(key) || document.createElement('button');
            button.type = 'button';
            button.dataset.eightsCard = key;
            button.dataset.red = String(['H', 'D'].includes(card.suit));
            button.setAttribute('aria-label', `${describe(card)}${special[card.rank] ? ' · ' + special[card.rank] : ''}`);
            if (!old.has(key)) {
                const rank = document.createElement('b'), effect = document.createElement('span');
                rank.textContent = face(card);
                effect.textContent = special[card.rank] || suits[card.suit][1];
                button.append(rank, effect);
            }
            button.disabled = phase !== 'ready' || pending || !card.playable;
            return button;
        });
        if (next.length !== old.size || next.some((button, index) => hand.children[index] !== button)) {
            hand.replaceChildren(...next);
            next.find(button => button.dataset.eightsCard === focused && !button.disabled)?.focus();
        }
    }

    function message(match) {
        const name = seat => seat === model.seat ? 'You' : side[seat];
        const win = seat => seat === model.seat ? 'You won' : side[seat] + ' won';
        if (match.result) return `${win(match.result.winner)} the match${match.result.reason === 'resigned' ? ' by resignation' : ''}.`;
        if (match.roundResult) return match.roundResult.winner
            ? `${win(match.roundResult.winner)} round ${match.round} for ${match.roundResult.points} points.`
            : 'No cards left to draw. Round tied.';
        const turn = match.turn === model.seat ? 'Your turn' : side[match.turn] + ' to play';
        const action = match.action;
        const last = action?.kind === 'draw-two' ? ` · ${name(action.seat)} +${action.count} cards`
            : action?.kind === 'skip' ? ` · ${name(action.seat)} skipped` : '';
        return `Round ${match.round} · ${turn}${last}`;
    }

    const startRematch = $('[data-start-rematch]');

    function draw() {
        const match = model?.match, seated = !!model?.seat;
        let command = '', label = '';
        if (phase === 'unavailable') {
            status.textContent = matchConnectionErrors[connectionError] || 'The table couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { command = 'retry'; label = 'Reconnect table'; }
        } else if (phase !== 'ready') {
            status.textContent = match && seated ? 'Reconnecting to the table… Your hand is paused.'
                : phase === 'reconnecting' ? 'Reconnecting to the table…' : 'Connecting to the table…';
        } else if (!model) {
            status.textContent = canOpen ? 'Open a head-to-head table for this room.' : 'Waiting for the host to open a table.';
            if (canOpen) { command = 'open'; label = 'Open Eights table'; }
        } else if (model.waiting) {
            status.textContent = seated ? 'Waiting for an opponent.' : 'One seat is open.';
            if (!seated) { command = 'join'; label = 'Join Eights table'; }
            else { command = 'leave'; label = 'Close empty table'; }
        } else if (match) {
            status.textContent = message(match);
            if (match.result && seated) {
                command = model.rematch === model.seat ? '' : 'rematch';
                label = model.rematch ? 'Accept Eights rematch' : 'Request Eights rematch';
                if (!command) status.textContent += ' Waiting for rematch acceptance.';
            } else if (match.roundResult && seated) { command = 'next-round'; label = 'Next round'; }
        }
        startRematch.hidden = !(phase === 'ready' && seated && match?.result && model.canStartRematch);
        startRematch.disabled = !!pending;
        if (phase === 'ready' && seated && match && model.disconnectedSeats?.length) {
            status.textContent += ` · Waiting for ${model.disconnectedSeats.map(value => side[value]).join(', ')}, link still works.`;
        }
        main.hidden = !command;
        main.textContent = label;
        main.dataset.command = command;
        main.disabled = pending;
        table.hidden = !match;
        choose.hidden = selected === null || !match;
        if (!match) { showHand(null); return; }
        for (const seat of ['a', 'b']) {
            $(`[data-eights-score="${seat}"]`).textContent = `${model.seat === seat ? 'You' : side[seat]} · ${match.score[seat]}/${match.target} pts · ${match.counts[seat]} cards`;
        }
        const top = $('[data-eights-top]');
        top.textContent = face(match.top);
        top.setAttribute('aria-label', describe(match.top));
        top.dataset.red = String(['H', 'D'].includes(match.top.suit));
        $('[data-eights-suit]').textContent = `Match ${suits[match.activeSuit][1]} or ${match.top.rank}`;
        $('[data-eights-hand-label]').textContent = seated ? `Your hand · ${match.hand.length} cards` : 'Watching · hands are private';
        for (const button of actions) {
            const action = button.dataset.eightsAction;
            button.hidden = action === 'draw' ? !seated || !!match.roundResult || !!match.result
                : action === 'pass' ? !match.canPass
                    : !seated || action === 'resign' && !!match.result;
            button.disabled = phase !== 'ready' || pending || (action === 'draw' && !match.canDraw);
            if (action === 'draw') button.textContent = `Draw · ${match.deckCount}`;
        }
        showHand(match);
    }

    for (const [suit, [symbol, label]] of Object.entries(suits)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--small';
        button.textContent = `${symbol} ${label}`;
        button.addEventListener('click', () => {
            if (selected === null) return;
            const card = selected;
            selected = null;
            send('play', { card, suit });
        });
        suitControls.append(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--small btn--ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
        const card = selected;
        selected = null;
        draw();
        hand.querySelector(`[data-eights-card="${card}"]`)?.focus();
    });
    suitControls.append(cancel);

    hand.addEventListener('click', event => {
        const button = event.target.closest('[data-eights-card]');
        if (!button || button.disabled) return;
        const card = model?.match?.hand.find(item => item.id === Number(button.dataset.eightsCard));
        if (!card) return;
        if (card.rank !== '8') send('play', { card: card.id });
        else {
            selected = card.id;
            draw();
            suitControls.firstElementChild.focus();
        }
    });
    startRematch.addEventListener('click', () => send('start-rematch'));
    main.addEventListener('click', () => {
        if (main.dataset.command === 'retry') client.start(scope);
        else if (main.dataset.command) send(main.dataset.command);
    });
    for (const button of actions) button.addEventListener('click', () => {
        const action = button.dataset.eightsAction;
        if (!['resign', 'leave'].includes(action)) { send(action); return; }
        confirmation = action;
        $('[data-eights-confirm-yes]').textContent = button.textContent;
        $('#eights-confirm-title').textContent = action === 'resign' ? 'Resign this match?' : 'Leave this table?';
        $('[data-eights-confirm-text]').textContent = action === 'resign'
            ? 'Your opponent wins if you resign.' : 'Leaving closes this table for both players.';
        confirm.showModal();
    });
    $('[data-eights-confirm-yes]').addEventListener('click', () => {
        const action = confirmation;
        closeChoices();
        if (action) send(action);
    });
    $('[data-eights-confirm-no]').addEventListener('click', closeChoices);

    container.addEventListener('toggle', event => {
        if (event.target !== panel && event.target.open &&
            event.target.matches('.arcade-chess, .arcade-card-table')) panel.open = false;
    }, true);
    panel.addEventListener('toggle', () => {
        if (!panel.open || !scope) { reset(); return; }
        for (const details of container.querySelectorAll(':scope > details[open]')) if (details !== panel) details.open = false;
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
