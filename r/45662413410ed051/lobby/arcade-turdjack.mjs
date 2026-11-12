import { createGameNightMatchClient } from './game-night-match-client.mjs';

const seats = ['one', 'two', 'three', 'four'];
const seatName = seat => 'Seat ' + (seats.indexOf(seat) + 1);
const suits = { S: ['♠', 'Spades'], H: ['♥', 'Hearts'], D: ['♦', 'Diamonds'], C: ['♣', 'Clubs'] };
const names = { win: 'Win', blackjack: 'Blackjack', push: 'Push', lose: 'Loss', bust: 'Bust', surrender: 'Surrendered' };
const errors = {
    'start-unavailable': 'The host can start once at least two players are seated.',
    'seat-unavailable': 'Choose an open seat.',
    'invalid-wager': 'Choose a table stake you can cover.',
    'action-unavailable': 'That action is unavailable for your current hand.',
    stale: 'The table changed. Check the current turn and try again.',
    'storage-unavailable': 'The action was not confirmed. Try again.'
};
const markup = `
<summary>Crapjack 21</summary>
<p class="small arcade-card-status" data-jack-status role="status"></p>
<p class="small arcade-card-error" data-jack-error role="status"></p>
<div class="arcade-card-actions" data-jack-lobby>
    <button class="btn btn--small" type="button" data-jack-main hidden></button>
    <button class="btn btn--small btn--ghost" type="button" data-jack-lobby-leave hidden></button>
    <div class="arcade-card-actions" data-jack-seats hidden></div>
</div>
<div data-card-table data-jack-table hidden>
    <p class="small arcade-card-hand-label" data-jack-bank></p>
    <div class="jack-dealer" aria-label="Dealer hand" data-jack-dealer></div>
    <ul class="jack-seats" aria-label="Table seats" data-jack-players></ul>
    <div class="arcade-card-actions" data-jack-wager hidden>
        <label for="jack-chips">Play chips</label><select id="jack-chips"></select>
        <button class="btn btn--small" type="button" data-jack-action="wager">Ready</button>
    </div>
    <div data-jack-hands></div>
    <div class="arcade-card-actions jack-controls">
        <button class="btn btn--small" type="button" data-jack-action="hit" hidden>Hit</button>
        <button class="btn btn--small" type="button" data-jack-action="stand" hidden>Stand</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="double" hidden>Double</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="split" hidden>Split</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="surrender" hidden>Surrender</button>
        <button class="btn btn--small" type="button" data-jack-action="cover" hidden>Insurance</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="skip-cover" hidden>Decline insurance</button>
        <button class="btn btn--small" type="button" data-jack-action="next-round" hidden>Next round</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="recharge" hidden>Refill play chips</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="finish" hidden>End session</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-action="leave" hidden>Leave table</button>
    </div>
</div>
<dialog class="sheet" aria-labelledby="jack-confirm-title" data-jack-confirm>
    <h3 id="jack-confirm-title"></h3><p class="small" data-jack-confirm-text></p>
    <div class="arcade-card-actions">
        <button class="btn btn--small" type="button" data-jack-confirm-yes>Confirm</button>
        <button class="btn btn--small btn--ghost" type="button" data-jack-confirm-no>Cancel</button>
    </div>
</dialog>`;

function face(document, card) {
    const label = document.createElement('span');
    label.className = 'jack-face';
    label.dataset.red = String(!!card && 'HD'.includes(card.suit));
    label.textContent = card ? card.rank + suits[card.suit][0] : '?';
    label.setAttribute('aria-label', card ? card.rank + ' of ' + suits[card.suit][1] : 'Hidden dealer card');
    return label;
}

export function mountArcadeTurdJack(container) {
    const document = container.ownerDocument, panel = document.createElement('details');
    panel.className = 'arcade-card-table arcade-jack';
    panel.hidden = true;
    panel.innerHTML = markup;
    container.append(panel);
    const $ = selector => panel.querySelector(selector);
    const status = $('[data-jack-status]'), feedback = $('[data-jack-error]'), main = $('[data-jack-main]');
    const table = $('[data-jack-table]'), seatsHost = $('[data-jack-seats]'), chips = $('#jack-chips'), confirm = $('[data-jack-confirm]');
    const controls = [...panel.querySelectorAll('[data-jack-action]')];
    let scope = null, model = null, canOpen = false, connection = 'connecting', pending = false, timer, confirmation = '';

    function clearPending() { clearTimeout(timer); pending = false; }
    function closeConfirmation() { confirmation = ''; if (confirm.open) confirm.close(); }
    const client = createGameNightMatchClient({
        prefix: '/beta/arcade-turdjack',
        onStatus(next) {
            connection = next;
            model = null;
            clearPending();
            closeConfirmation();
            draw();
        },
        onState({ state, canOpen: host }) {
            if (state && (state.game !== 'turdjack' || state.version !== 1)) return;
            const reveal = state?.match && (!model?.match || model.id !== state.id);
            if (state?.id !== model?.id || state?.match?.revision !== model?.match?.revision) {
                closeConfirmation();
                feedback.textContent = '';
            }
            model = state;
            canOpen = host;
            connection = 'ready';
            clearPending();
            draw();
            if (reveal) container.scrollTop = 0;
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
        client.stop();
        model = null;
        canOpen = false;
        connection = 'connecting';
        feedback.textContent = '';
        clearPending();
        closeConfirmation();
        draw();
    }

    const seatButtons = seats.map(seat => {
        const button = document.createElement('button');
        button.className = 'btn btn--small btn--ghost';
        button.type = 'button';
        button.textContent = 'Join ' + seatName(seat);
        button.addEventListener('click', () => send('join', { seat }));
        seatsHost.append(button);
        return button;
    });

    function renderMatch(match, seat) {
        table.dataset.phase = match.phase;
        const actions = match.actions, own = match.self, dealer = $('[data-jack-dealer]'), players = $('[data-jack-players]');
        const headline = document.createElement('b');
        headline.textContent = match.dealerTotal === null ? 'Dealer' : 'Dealer · ' + match.dealerTotal;
        dealer.replaceChildren(headline, ...match.dealer.map(card => face(document, card)), ...(match.dealerHidden ? [face(document, null)] : []));
        players.replaceChildren(...match.players.map(position => {
            const item = document.createElement('li'), value = match.table[position];
            const label = position === seat ? 'You' : seatName(position);
            const current = match.phase === 'insurance' ? (value.ready ? 'Ready' : 'Choosing')
                : value.wager === null ? 'Choosing chips' : value.wager ? value.wager + ' chips' : 'Sitting out';
            const outcomes = match.phase === 'settled' ? value.hands.map(hand => names[hand.outcome]) : [];
            item.textContent = [label, current, ...outcomes].join(' · ');
            item.dataset.active = String(position === match.active);
            return item;
        }));
        $('[data-jack-bank]').textContent = own ? own.chips + ' play chips' : 'Watching · hands are private';
        $('[data-jack-hands]').replaceChildren(...(own?.hands || []).map((hand, index) => {
            const row = document.createElement('div'), info = document.createElement('b');
            row.className = 'jack-hand';
            row.dataset.active = String(hand.active);
            info.textContent = (own.hands.length > 1 ? 'Hand ' + (index + 1) : 'Your hand') + ' · ' + hand.total +
                (hand.outcome ? ' · ' + names[hand.outcome] + ' · ' + hand.returned + ' returned' : '');
            row.append(info, ...hand.cards.map(card => face(document, card)));
            return row;
        }));
        const wager = actions.includes('wager');
        $('[data-jack-wager]').hidden = !wager;
        if (wager) {
            const prior = chips.value;
            const choices = [0, ...match.stakes].filter(value => value <= own.chips);
            if (choices.length !== chips.length || choices.some((value, index) => String(value) !== chips.options[index].value)) {
                chips.replaceChildren(...choices.map(value => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value ? String(value) : 'Sit out';
                    return option;
                }));
                chips.value = choices.includes(Number(prior)) && prior ? prior : String(choices[1] ?? 0);
            }
        }
        chips.disabled = pending;
        for (const button of controls) {
            const action = button.dataset.jackAction;
            button.hidden = action === 'leave' ? !seat : !actions.includes(action);
            button.disabled = pending;
            if (action === 'wager') button.textContent = own?.wager === null ? 'Ready' : 'Update wager';
            if (action === 'cover') {
                const evenMoney = own?.hands[0]?.total === 21;
                button.textContent = evenMoney ? 'Take even money' : `Insurance · ${(own?.wager || 0) / 2} chips`;
            }
        }
    }

    function draw() {
        const seat = model?.seat, match = model?.match, occupied = model?.occupied || [];
        let action = '', label = '', message = 'Connecting to the table…';
        if (connection === 'unavailable') { message = 'The table is unavailable.'; action = 'retry'; label = 'Reconnect table'; }
        else if (connection === 'ready' && !model) {
            message = canOpen ? 'Open a shared dealer table for two to four players. Play chips only.' : 'Waiting for the host to open a table.';
            if (canOpen) { action = 'open'; label = 'Open Crapjack table'; }
        } else if (model?.waiting) {
            message = `${occupied.length}/4 seated${seat ? ' · You’re ' + seatName(seat) : ''} · Play chips only`;
            if (model.canStart && canOpen) { action = 'start'; label = 'Start table'; }
        } else if (match?.result) {
            message = 'Session ended.';
            if (seat) {
                const votes = model.rematchVotes;
                message += ` ${votes.length}/${occupied.length} ready for a fresh session.`;
                if (!votes.includes(seat)) { action = 'rematch'; label = votes.length ? 'Accept fresh session' : 'Request fresh session'; }
            }
        } else if (match) {
            const ready = match.players.filter(position => match.table[position].ready).length;
            const prompt = match.phase === 'wager' ? `Choose a stake · ${ready}/${match.players.length} ready`
                : match.phase === 'insurance' ? 'Dealer shows an ace · Insurance choices'
                    : match.phase === 'settled' ? 'Dealer settled the round'
                        : match.active === seat ? 'Your turn' : seatName(match.active) + ' to play';
            message = `Round ${match.round} · ${prompt}`;
        }
        if (status.textContent !== message) status.textContent = message;
        main.hidden = !action;
        main.dataset.command = action;
        main.textContent = label;
        main.disabled = pending;
        const leave = $('[data-jack-lobby-leave]');
        leave.hidden = !model?.waiting || !seat;
        leave.textContent = seat === 'one' ? 'Close table' : 'Release seat';
        leave.disabled = pending;
        seatsHost.hidden = !model?.waiting || !!seat;
        seatButtons.forEach((button, index) => { button.hidden = occupied.includes(seats[index]); button.disabled = pending; });
        table.hidden = !match;
        if (match) renderMatch(match, seat);
    }

    main.addEventListener('click', () => {
        const action = main.dataset.command;
        if (action === 'retry') client.start(scope);
        else if (action) send(action);
    });
    $('[data-jack-lobby-leave]').addEventListener('click', () => send('leave'));
    for (const button of controls) button.addEventListener('click', () => {
        const action = button.dataset.jackAction;
        if (action === 'wager') send(action, { chips: Number(chips.value) });
        else if (['finish', 'leave', 'surrender'].includes(action)) {
            confirmation = action;
            $('[data-jack-confirm-yes]').textContent = button.textContent;
            const copy = {
                finish: ['End this session?', 'Everyone can vote to start a fresh session with new play chips.'],
                leave: ['Leave this table?', 'This closes the table for the group.'],
                surrender: ['Surrender your hand?', 'You’ll recover half your stake.']
            }[action];
            $('#jack-confirm-title').textContent = copy[0];
            $('[data-jack-confirm-text]').textContent = copy[1];
            confirm.showModal();
        } else send(action);
    });
    $('[data-jack-confirm-yes]').addEventListener('click', () => {
        const action = confirmation;
        closeConfirmation();
        if (action) send(action);
    });
    $('[data-jack-confirm-no]').addEventListener('click', closeConfirmation);
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
