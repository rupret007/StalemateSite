import { createGameNightMatchClient, matchConnectionErrors } from './game-night-match-client.mjs';
import { suggestSpadesBid } from '/play/games/turdspades-engine.js';

const seats = ['south', 'west', 'north', 'east'];
const names = { south: 'South', west: 'West', north: 'North', east: 'East' };
const partnerships = ['South + North', 'West + East'];
const suits = { S: ['♠', 'Spades'], H: ['♥', 'Hearts'], D: ['♦', 'Diamonds'], C: ['♣', 'Clubs'] };
const cardLabel = card => card.rank + ' of ' + suits[card.suit][1];
const face = card => card.rank + suits[card.suit][0];
const errors = {
    'seat-unavailable': 'That seat is unavailable. Pick an open seat.',
    'illegal-card': 'Follow the led suit if you can. Lead spades after they’re broken or when you hold only spades.',
    'wrong-turn': 'Wait for your turn.',
    'invalid-bid': 'Choose a bid from 0 to 13.',
    'storage-unavailable': 'The move was not confirmed. Try again.'
};
const markup = `
<summary>TurdSpades</summary>
<p class="small arcade-card-status" data-spades-status role="status" tabindex="-1"></p>
<p class="small arcade-card-error" data-spades-error role="status"></p>
<div class="arcade-card-actions">
    <button class="btn btn--small" type="button" data-spades-partners hidden>Open 2-player Spades</button>
    <button class="btn btn--small" type="button" data-spades-main hidden></button>
</div>
<div class="arcade-card-actions" data-spades-seats hidden></div>
<div data-card-table data-spades-table hidden>
    <div class="arcade-card-score" aria-label="Partnership scores"><span data-spades-score="0"></span><span data-spades-score="1"></span></div>
    <ul class="spades-trick" aria-label="Bids and trick cards" data-spades-trick></ul>
    <div class="arcade-card-actions" data-spades-bid hidden>
        <label for="spades-bid">Your bid</label><select id="spades-bid"></select>
        <button class="btn btn--small" type="button" data-spades-action="bid">Bid for me</button>
    </div>
    <p class="small arcade-card-hand-label" data-spades-hand-label></p>
    <div class="arcade-card-hand" role="group" aria-label="Your hand" data-spades-hand></div>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-spades-action="next-round" hidden>Next round</button>
        <button class="btn btn--small btn--ghost" type="button" data-spades-action="resign" hidden>Resign</button>
        <button class="btn btn--small btn--ghost" type="button" data-spades-action="leave" hidden>Leave table</button>
    </div>
</div>
<dialog class="sheet" aria-labelledby="spades-confirm-title" data-spades-confirm>
    <h3 id="spades-confirm-title"></h3><p class="small" data-spades-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-spades-confirm-yes>Confirm</button>
        <button class="btn btn--small btn--ghost" type="button" data-spades-confirm-no>Cancel</button>
    </div>
</dialog>`;

export function mountArcadeTurdSpades(container, onMatch) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-spades';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-spades-status]'), feedback = $('[data-spades-error]'), main = $('[data-spades-main]');
    const partnerButton = $('[data-spades-partners]');
    const table = $('[data-spades-table]'), seatsHost = $('[data-spades-seats]'), hand = $('[data-spades-hand]');
    const bid = $('#spades-bid'), confirm = $('[data-spades-confirm]');
    const actions = [...panel.querySelectorAll('[data-spades-action]')];
    let scope = null, model = null, canOpen = false, partnersSupported = false, connection = 'connecting', connectionError, matchEnded = false;
    let pending = false, timer, confirmation = '';
    let suggestedBidKey = '', bidEdited = false, applyingBid = false;

    function clearPending() { clearTimeout(timer); pending = false; }
    function closeConfirmation() { confirmation = ''; if (confirm.open) confirm.close(); }
    const client = createGameNightMatchClient({
        onMatch,
        prefix: '/beta/arcade-turdspades',
        onStatus(next, reason) {
            connection = next;
            connectionError = reason;
            if (reason && reason !== 'rate-limited') model = null;
            clearPending();
            closeConfirmation();
            draw();
        },
        onState({ state, canOpen: host, partners }) {
            if (state && (state.game !== 'turdspades' || state.version !== 1)) return;
            const hadGame = !!model;
            const revealing = state?.match && (!model?.match || model.id !== state.id);
            if (state?.id !== model?.id || state?.match?.revision !== model?.match?.revision) {
                closeConfirmation();
                feedback.textContent = '';
            }
            model = state;
            canOpen = host;
            if (model || canOpen) matchEnded = false;
            else if (hadGame) matchEnded = true;
            partnersSupported = partners === true;
            connection = 'ready';
            connectionError = undefined;
            clearPending();
            draw();
            if (revealing) container.scrollTop = 0;
        },
        onError(reason) {
            clearPending();
            feedback.textContent = errors[reason] || 'The table could not confirm that action.';
            draw();
        }
    });
    function send(action, fields = {}) {
        if (connection !== 'ready' || pending || !client.send({ action, id: model?.id, revision: model?.match?.revision, ...fields })) return;
        pending = true;
        feedback.textContent = '';
        timer = setTimeout(() => {
            pending = false;
            feedback.textContent = 'Checking the table…';
            client.send({ action: 'sync' });
            draw();
        }, 6000);
        draw();
    }
    function reset() {
        matchEnded = false;
        client.stop();
        model = null;
        canOpen = false;
        partnersSupported = false;
        connection = 'connecting';
        connectionError = undefined;
        feedback.textContent = '';
        clearPending();
        closeConfirmation();
        draw();
    }
    const seatButtons = seats.map(seat => {
        const button = document.createElement('button');
        button.className = 'btn btn--small btn--ghost';
        button.type = 'button';
        button.textContent = `Join ${names[seat]}`;
        button.addEventListener('click', () => send('join', { seat }));
        seatsHost.append(button);
        return button;
    });
    const trickSlots = seats.map(seat => {
        const row = document.createElement('li');
        const label = document.createElement('span'), card = document.createElement('b');
        label.textContent = names[seat];
        row.append(label, card);
        $('[data-spades-trick]').append(row);
        return { row, label, card };
    });
    for (let value = 0; value <= 13; value++) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value ? String(value) : '0 · Nil';
        bid.append(option);
    }
    bid.value = '3';
    bid.addEventListener('change', () => { if (!applyingBid) bidEdited = true; });

    function showHand(cards) {
        const old = new Map([...hand.children].map(button => [button.dataset.spadesCard, button]));
        const next = cards.map(card => {
            const key = String(card.id);
            const button = old.get(key) || document.createElement('button');
            button.type = 'button';
            button.dataset.spadesCard = key;
            button.dataset.red = String('HD'.includes(card.suit));
            button.setAttribute('aria-label', cardLabel(card));
            button.disabled = connection !== 'ready' || pending || !card.playable;
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
        const match = model?.match, seat = model?.seat, occupied = model?.occupied || [];
        const paired = model?.mode === 'partners', people = paired ? 2 : 4;
        const computer = position => paired && ['north', 'east'].includes(position);
        const nameFor = position => names[position] + (computer(position) ? ' (CPU)' : '');
        const teams = paired ? ['South + North CPU', 'West + East CPU'] : partnerships;
        let command = '', label = '', message = 'Connecting to the table…';
        if (connection === 'unavailable') {
            message = matchConnectionErrors[connectionError] || 'The table couldn’t reconnect. Try again from this room.';
            if (!connectionError || connectionError === 'rate-limited') { command = 'retry'; label = 'Reconnect table'; }
        } else if (connection !== 'ready') {
            if (match) message = seat ? 'Reconnecting to the table… Your hand is paused.' : 'Reconnecting to the table…';
        } else if (!model) {
            if (matchEnded && !canOpen) {
                message = 'This match ended. Wait here for the next game.';
                command = 'stay';
                label = 'Stay for the next game';
            } else {
                message = canOpen ? (partnersSupported ? 'Play with one friend and a CPU partner on each team, or fill all four seats with friends.'
                    : 'Open a partnership table for four players.') : 'Waiting for the host to open a table.';
                if (canOpen) { command = 'open'; label = partnersSupported ? 'Open 4-player Spades' : 'Open Spades table'; }
            }
        } else if (model?.waiting) {
            message = `${occupied.length}/${people} seated${seat ? ` · You’re ${nameFor(seat)}` : ''} · ${teams.join(' vs ')}`;
            if (seat) { command = 'leave'; label = seat === 'south' ? 'Close table' : 'Release seat'; }
        } else if (match?.result) {
            if (!seat) {
                message = `${teams[match.result.winner]} win. You’re watching.`;
                command = 'watch';
                label = 'Watch for the rematch';
            } else {
                message = `${teams[match.result.winner]} win${match.result.reason === 'resigned' ? ' by resignation' : ''}.`;
                const votes = model.rematchVotes ?? (model.rematch ? [model.rematch] : []);
                message += ` ${votes.length}/${people} ready for a rematch.`;
                if (!votes.includes(seat)) { command = 'rematch'; label = votes.length ? 'Accept Spades rematch' : 'Request Spades rematch'; }
            }
        } else if (match?.roundResult) {
            message = match.roundResult.map((result, team) => {
                const signed = result.delta > 0 ? '+' + result.delta : result.delta;
                const nil = result.nil.map(entry => `${nameFor(entry.seat)} ${entry.succeeded ? 'made' : 'missed'} Nil`);
                if (result.bagPenalties) nil.push('bag penalty');
                return `${teams[team]} ${signed}${nil.length ? ' · ' + nil.join(', ') : ''}`;
            }).join(' / ');
        } else if (match) {
            const yourTurn = seat === match.turn;
            if (paired && match.phase === 'bid' && yourTurn && seat === 'west') {
                message = 'You and a computer partner vs the host and a computer · tap Bid for me';
            } else if (paired && match.phase === 'bid' && yourTurn && seat === 'south') {
                message = 'You and a computer partner vs your friend and a computer · tap Bid for me';
            } else if (paired && match.phase === 'bid' && seat === 'west') {
                message = 'Waiting for the host to bid';
            } else {
                const turnName = `${nameFor(match.turn)} to ${match.phase === 'bid' ? 'bid' : 'play'}`;
                if (!seat) {
                    message = `Table full. You’re watching. ${turnName}`;
                    command = 'watch';
                    label = 'Keep watching';
                } else {
                    const turn = yourTurn ? (match.phase === 'bid' ? 'Your bid' : 'Your play') : turnName;
                    message = `Round ${match.round} · ${turn}`;
                    if (yourTurn && match.phase === 'play' && !match.trick.length && !match.lastTrick.length) message += ' · tap a card';
                    if (match.lastWinner && (paired || !match.trick.length)) message += ` · ${nameFor(match.lastWinner)} won the last trick`;
                }
            }
        }
        if (status.textContent !== message) status.textContent = message;
        main.hidden = !command;
        main.textContent = label;
        main.dataset.command = command;
        main.disabled = pending;
        partnerButton.hidden = command !== 'open' || !partnersSupported;
        partnerButton.disabled = pending;
        seatsHost.hidden = connection !== 'ready' || !model?.waiting || !!seat;
        seatButtons.forEach((button, index) => { button.hidden = computer(seats[index]) || occupied.includes(seats[index]); button.disabled = pending; });
        table.hidden = !match;
        if (!match) { showHand([]); return; }
        table.dataset.phase = match.phase;
        table.dataset.mode = paired ? 'partners' : 'four';

        for (let team = 0; team < 2; team++) {
            $(`[data-spades-score="${team}"]`).textContent = `${teams[team]} · ${match.scores[team]}/${match.target} · ${match.bags[team]} bags`;
        }
        $('.arcade-card-score').hidden = paired && match.phase !== 'round-end' && match.lastTrick.length !== 4;
        $('[data-spades-trick]').hidden = paired && match.phase === 'bid';
        const shown = match.trick.length ? match.trick : match.lastTrick;
        trickSlots.forEach(({ row, label, card }, index) => {
            const position = seats[index], entry = shown.find(value => value.seat === position);
            const called = match.bids[position];
            label.textContent = `${nameFor(position)}${seat === position ? ' (you)' : ''} · ${called === null ? '—' : called || 'Nil'}`;
            card.textContent = entry ? face(entry) : '—';
            card.setAttribute('aria-label', entry ? cardLabel(entry) : 'No card played');
            row.dataset.active = String(!match.result && match.phase !== 'round-end' && match.turn === position);
            row.dataset.red = String(!!entry && 'HD'.includes(entry.suit));
        });
        $('[data-spades-bid]').hidden = !match.canBid;
        if (match.canBid) {
            const bidKey = `${model.id}:${match.revision}`;
            if (bidKey !== suggestedBidKey) {
                suggestedBidKey = bidKey;
                bidEdited = false;
            }
            if (!bidEdited) {
                const suggestion = String(suggestSpadesBid(match.hand));
                if (bid.value !== suggestion) {
                    applyingBid = true;
                    bid.value = suggestion;
                    applyingBid = false;
                }
            }
        }
        bid.disabled = connection !== 'ready' || pending;
        $('[data-spades-hand-label]').textContent = seat
            ? `Your hand · ${match.hand.length} cards${match.phase === 'play' && match.spadesBroken ? ' · Spades broken' : ''}`
            : 'Watching · hands are private';
        for (const control of actions) {
            const action = control.dataset.spadesAction;
            control.hidden = !seat || (action === 'bid' ? !match.canBid
                : action === 'next-round' ? match.phase !== 'round-end' || !!match.result
                    : action === 'resign' && !!match.result);
            control.disabled = connection !== 'ready' || pending;
        }
        showHand(match.hand);
    }

    hand.addEventListener('click', event => {
        const button = event.target.closest('[data-spades-card]');
        if (button && !button.disabled) send('play', { card: Number(button.dataset.spadesCard) });
    });
    main.addEventListener('click', () => {
        const action = main.dataset.command;
        if (action === 'retry') client.start(scope);
        else if (action === 'stay') { matchEnded = false; draw(); status.focus(); }
        else if (action === 'watch') status.focus();
        else if (action) send(action);
    });
    partnerButton.addEventListener('click', () => send('open', { mode: 'partners' }));
    for (const control of actions) control.addEventListener('click', () => {
        const action = control.dataset.spadesAction;
        if (action === 'bid') send(action, { bid: Number(bid.value) });
        else if (action === 'next-round') send(action);
        else {
            confirmation = action;
            $('[data-spades-confirm-yes]').textContent = control.textContent;
            $('#spades-confirm-title').textContent = action === 'resign' ? 'Resign for your team?' : 'Leave this table?';
            $('[data-spades-confirm-text]').textContent = action === 'resign'
                ? 'The other partnership wins if you resign.' : model?.mode === 'partners'
                    ? 'Leaving ends this match for both players.' : 'Leaving closes the table for all four players.';
            confirm.showModal();
        }
    });
    $('[data-spades-confirm-yes]').addEventListener('click', () => {
        const action = confirmation;
        closeConfirmation();
        if (action) send(action);
    });
    $('[data-spades-confirm-no]').addEventListener('click', closeConfirmation);
    container.addEventListener('toggle', event => {
        if (event.target !== panel && event.target.open &&
            event.target.matches('.arcade-chess, .arcade-card-table')) panel.open = false;
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
