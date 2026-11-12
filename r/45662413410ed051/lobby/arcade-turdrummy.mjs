import '/play/games/turdrummy-rules.js';
import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';

const { analyzeHand } = globalThis.TurdRummyRules;
const suits = { S: ['♠', 'Spades'], H: ['♥', 'Hearts'], D: ['♦', 'Diamonds'], C: ['♣', 'Clubs'] };
const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const side = { a: 'Seat 1', b: 'Seat 2' };
const face = card => ranks[card.rank] + suits[card.suit][0];
const describe = card => ranks[card.rank] + ' of ' + suits[card.suit][1];
const red = card => card.suit === 'D' || card.suit === 'H';
const errors = {
    stale: 'The table changed. Check your hand.',
    'return-discard': 'Keep the card you took from discard this turn.',
    'wrong-turn': 'Wait for your turn.',
    'wrong-phase': 'Draw once, then choose a discard.',
    'knock-limit': 'Choose a discard that leaves 10 deadwood or less.',
    'not-gin': 'Gin requires zero deadwood after your discard.',
    'pile-empty': 'That pile is empty.',
    'storage-unavailable': 'The move was not confirmed. Try again.'
};
const markup = `
<summary>TurdRummy</summary>
<p class="small arcade-card-status" data-rummy-status role="status"></p>
<p class="small arcade-card-error" data-rummy-error role="status"></p>
<button class="btn" type="button" data-rummy-main hidden></button>
<div data-card-table data-rummy-table hidden>
    <div class="arcade-card-score" aria-label="Match scores">
        <span data-rummy-score="a"></span><span data-rummy-score="b"></span>
    </div>
    <div class="arcade-card-piles">
        <button class="btn btn--small" type="button" data-rummy-action="draw-stock">Draw stock</button>
        <button class="btn btn--small btn--ghost" type="button" data-rummy-action="draw-discard">Take discard</button>
    </div>
    <p class="small arcade-card-hand-label" data-rummy-hand-label></p>
    <div class="arcade-card-hand" aria-label="Your hand" role="group" data-rummy-hand></div>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-rummy-action="discard">Discard</button>
        <button class="btn btn--small btn--ghost" type="button" data-rummy-action="knock">Knock</button>
        <button class="btn btn--small btn--ghost" type="button" data-rummy-action="gin">Gin</button>
    </div>
    <div class="arcade-card-actions">
        <button class="btn btn--small btn--ghost" type="button" data-rummy-action="resign">Resign</button>
        <button class="btn btn--small btn--ghost" type="button" data-rummy-action="leave">Leave table</button>
    </div>
</div>
<dialog class="sheet" aria-labelledby="rummy-confirm-title" data-rummy-confirm>
    <h3 id="rummy-confirm-title"></h3>
    <p class="small" data-rummy-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-rummy-confirm-yes>Confirm</button>
        <button class="btn btn--small btn--ghost" type="button" data-rummy-confirm-no>Cancel</button>
    </div>
</dialog>`;

export function mountArcadeTurdRummy(container) {
    const panel = container.ownerDocument.createElement('details');
    const document = panel.ownerDocument;
    panel.className = 'arcade-card-table arcade-rummy';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-rummy-status]'), error = $('[data-rummy-error]'), main = $('[data-rummy-main]');
    const hand = $('[data-rummy-hand]'), table = $('[data-rummy-table]'), confirm = $('[data-rummy-confirm]');
    const actions = [...panel.querySelectorAll('[data-rummy-action]')];
    let scope = null, model = null, canOpen = false, connection = 'connecting', connectionError;
    let selected = null, pending = false, timer, confirmation = null;

    function clearPending() { clearTimeout(timer); pending = false; }
    function clearChoice() {
        selected = null;
        confirmation = null;
        if (confirm.open) confirm.close();
    }

    const client = createGameNightMatchClient({
        prefix: '/beta/arcade-turdrummy',
        onStatus(value, reason) {
            connection = value;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') {
                model = null;
                clearChoice();
            } else {
                confirmation = null;
                if (confirm.open) confirm.close();
            }
            clearPending();
            draw();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'turdrummy' || state.version !== 1)) return;
            const match = state?.match, previous = model?.match;
            const revealing = match && (!previous || model.id !== state.id);
            const showingOutcome = panel.open && ((match?.result && !previous?.result) || (match?.roundResult && !previous?.roundResult));
            const focused = document.activeElement;
            const focusInTable = showingOutcome && panel.contains(focused);
            if (model?.id !== state?.id || previous?.revision !== match?.revision) {
                clearChoice();
                error.textContent = '';
            }
            model = state;
            canOpen = host;
            connection = 'ready';
            connectionError = undefined;
            clearPending();
            draw();
            if (revealing || showingOutcome && (focusInTable || focused === document.body)) container.scrollTop = 0;
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
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id, revision: model?.match?.revision, ...fields })) return;
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

    function reset() {
        client.stop();
        model = null;
        canOpen = false;
        connection = 'connecting';
        connectionError = undefined;
        error.textContent = '';
        clearChoice();
        clearPending();
        draw();
    }

    function showHand(cards, canSelect, blocked, drawn) {
        const old = new Map([...hand.children].map(button => [button.dataset.rummyCard, button]));
        const next = cards.map(card => {
            const key = String(card.id);
            const button = old.get(key) || document.createElement('button');
            button.type = 'button';
            button.dataset.rummyCard = key;
            button.dataset.red = String(red(card));
            button.dataset.drawn = String(card.id === drawn);
            button.setAttribute('aria-label', describe(card) + (card.id === blocked ? ' · taken from discard' : ''));
            button.setAttribute('aria-pressed', String(selected === card.id));
            button.disabled = pending || !canSelect || card.id === blocked;
            if (!old.has(key)) {
                const index = document.createElement('b');
                index.textContent = face(card);
                button.append(index);
            }
            return button;
        });
        if (next.length !== old.size || next.some((button, index) => hand.children[index] !== button)) hand.replaceChildren(...next);
    }

    function draw() {
        const seat = model?.seat, match = model?.match;
        const name = value => value === seat ? 'You' : side[value];
        let command = '', label = '', message = 'Connecting to the table…';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'The table couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { command = 'retry'; label = 'Reconnect table'; }
        } else if (connection !== 'ready') {
            if (match) message = seat ? 'Reconnecting to the table… Your hand is paused.' : 'Reconnecting to the table…';
        } else if (!model) {
            message = canOpen ? 'Open a head-to-head table for this room.' : 'Waiting for the host to open a table.';
            if (canOpen) { command = 'open'; label = 'Open Rummy table'; }
        } else if (model?.waiting) {
            message = seat ? 'Waiting for an opponent.' : 'One seat is open.';
            command = seat ? 'leave' : 'join';
            label = seat ? 'Close empty table' : 'Join Rummy table';
        } else if (match?.result) {
            const result = match.result;
            message = `${name(result.winner)} won the match${result.reason === 'resigned' ? ' by resignation' : ''}.`;
            if (seat && model.rematch !== seat) {
                command = 'rematch'; label = model.rematch ? 'Accept Rummy rematch' : 'Request Rummy rematch';
            } else if (seat) message += ' Waiting for rematch acceptance.';
        } else if (match?.roundResult) {
            const result = match.roundResult;
            const titles = { gin: 'Gin', knock: 'Knock', undercut: 'Undercut' };
            message = `${titles[result.kind]} · ${name(result.winner)} +${result.points} · Deadwood ${result.knockerDeadwood}–${result.defenderDeadwood}`;
            if (result.laidOff) message += ` · ${result.laidOff} laid off`;
            if (seat) { command = 'next-round'; label = 'Next round'; }
        } else if (match) {
            const turn = match.turn === seat ? (match.phase === 'draw' ? 'Draw a card' : 'Choose your discard') : name(match.turn) + ' to play';
            message = `Round ${match.round} · ${turn}`;
        }
        if (status.textContent !== message) status.textContent = message;
        main.hidden = !command;
        main.textContent = label;
        main.dataset.command = command;
        main.disabled = pending;
        table.hidden = !match;
        if (!match) { showHand([], false); return; }
        for (const player of ['a', 'b']) {
            $(`[data-rummy-score="${player}"]`).textContent = `${name(player)} · ${match.score[player]}/${match.target} pts · ${match.counts[player]} cards`;
        }

        const active = !!seat && !match.roundResult && !match.result;
        const canSelect = active && seat === match.turn && match.phase === 'discard';
        const deadwood = canSelect && selected !== null ? analyzeHand(match.hand.filter(card => card.id !== selected)).deadwoodScore : null;
        $('[data-rummy-hand-label]').textContent = seat
            ? `Your hand · ${match.hand.length} cards${deadwood === null ? '' : ` · ${deadwood} deadwood after discard`}`
            : 'Watching · hands are private';
        const legal = {
            'draw-stock': match.canDrawStock, 'draw-discard': match.canTakeDiscard,
            discard: deadwood !== null, knock: deadwood !== null && deadwood <= match.knockLimit, gin: deadwood === 0,
            resign: !match.result, leave: true
        };
        for (const button of actions) {
            const action = button.dataset.rummyAction;
            const pile = action === 'draw-stock' || action === 'draw-discard';
            button.hidden = !pile && (!seat || (action === 'resign' ? !active : action !== 'leave' && !canSelect));
            button.disabled = connection !== 'ready' || pending || !legal[action];
            if (action === 'draw-stock') button.textContent = `${match.canDrawStock ? 'Draw stock' : 'Stock'} · ${match.stockCount}`;
            if (action === 'draw-discard') {
                button.textContent = match.top ? `${match.canTakeDiscard ? 'Take' : 'Discard'} ${face(match.top)}` : 'Discard pile empty';
                button.setAttribute('aria-label', match.top ? `${match.canTakeDiscard ? 'Take' : 'Discard'} ${describe(match.top)}` : 'Discard pile empty');
            }
        }
        showHand(match.hand, connection === 'ready' && canSelect, match.blocked, match.drawn);
    }

    hand.addEventListener('click', event => {
        const button = event.target.closest('[data-rummy-card]');
        if (!button || button.disabled) return;
        const card = Number(button.dataset.rummyCard);
        selected = selected === card ? null : card;
        draw();
    });
    main.addEventListener('click', () => {
        if (main.dataset.command === 'retry') client.start(scope);
        else if (main.dataset.command) send(main.dataset.command);
    });
    for (const button of actions) button.addEventListener('click', () => {
        const action = button.dataset.rummyAction;
        if (['discard', 'knock', 'gin'].includes(action)) { send(action, { card: selected }); return; }
        if (!['resign', 'leave'].includes(action)) { send(action); return; }
        confirmation = action;
        $('[data-rummy-confirm-yes]').textContent = button.textContent;
        $('#rummy-confirm-title').textContent = action === 'resign' ? 'Resign this match?' : 'Leave this table?';
        $('[data-rummy-confirm-text]').textContent = action === 'resign'
            ? 'Your opponent wins if you resign.' : 'Leaving closes this table for both players.';
        confirm.showModal();
    });
    $('[data-rummy-confirm-yes]').addEventListener('click', () => {
        const action = confirmation;
        clearChoice();
        if (action) send(action);
    });
    $('[data-rummy-confirm-no]').addEventListener('click', clearChoice);

    container.addEventListener('toggle', event => {
        if (event.target !== panel && event.target.open &&
            event.target.matches('.arcade-chess, .arcade-card-table, [data-four]')) panel.open = false;
    }, true);
    panel.addEventListener('toggle', () => {
        if (!panel.open || !scope) { reset(); return; }
        for (const details of container.querySelectorAll(':scope > details[open]')) if (details !== panel) details.open = false;
        container.scrollTop = 0;
        client.start(scope);
    });
    return {
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
