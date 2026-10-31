/* Optional local progress. Completion persistence is synchronous; views never auto-open. */
(function attachProgress(root) {
  'use strict';
  const Core = root.SuiteProgressCore;
  if (!Core) return;
  const doc = root.document;
  const randomNamespace = () => {
    try { return root.crypto.randomUUID().toLowerCase(); }
    catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`; }
  };
  let storage = null, available = true, readable = true, issue = '', current;
  try { storage = root.localStorage; } catch { available = false; readable = false; issue = 'unavailable'; }
  try {
    const raw = storage?.getItem(Core.KEY);
    current = raw ? Core.parse(raw) : null;
    if (raw && !current) issue = 'corrupt';
  } catch { available = false; readable = false; issue = 'unavailable'; }
  current ||= Core.newState(randomNamespace());
  if (!storage) { available = false; readable = false; issue = 'unavailable'; }

  function save(next) {
    current = next;
    try {
      if (!storage || !readable) throw new Error('No readable device storage');
      storage.setItem(Core.KEY, JSON.stringify(current));
      available = true;
    } catch { available = false; readable = false; issue = 'unavailable'; }
  }
  function refresh() {
    if (!storage || !available) return;
    try {
      const value = Core.parse(storage.getItem(Core.KEY));
      if (value) current = value;
    } catch { available = false; readable = false; issue = 'unavailable'; }
  }
  function recover() {
    const recovered = Core.recoverLegacy(current, key => storage?.getItem(key));
    if (recovered.newlyEarned.length) save(recovered.state);
  }
  recover();
  function newRunId(game) {
    refresh();
    const allocation = Core.allocate(current, game);
    if (!allocation) return null;
    save(allocation.state);
    return allocation.id;
  }
  function record(event) {
    try {
      refresh();
      const result = Core.record(current, event, Date.now());
      if (result.error === 'capacity') { available = false; issue = 'full'; }
      else if (result.state !== current) save(result.state);
      return { recorded: result.recorded, updated: result.updated, storageAvailable: available, newlyEarned: result.newlyEarned, improvement: result.improvement, entry: result.entry, error: result.error };
    } catch { return { recorded: false, updated: false, storageAvailable: available, newlyEarned: [], improvement: null, entry: null, error: 'invalid' }; }
  }
  function chooseGoal(id) {
    refresh();
    const next = Core.setGoal(current, id);
    if (!next) return false;
    save(next); return true;
  }
  function snapshot() { refresh(); return JSON.parse(JSON.stringify(current)); }
  const gameFor = id => Core.GAMES.find(game => game.id === id);
  const integer = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '0';
  function describeEvent(event) {
    const parts = [];
    if (event.game === 'chess') {
      parts.push(event.local ? 'Local two-player' : 'Computer game');
      parts.push(event.local && Object.prototype.hasOwnProperty.call(event, 'winner')
        ? event.winner === 'w' ? 'White wins' : event.winner === 'b' ? 'Black wins' : 'Draw'
        : { win: 'Win', loss: 'Loss', draw: 'Draw', complete: 'Complete' }[event.outcome]);
      parts.push(`${integer(event.moves)} ${event.moves === 1 ? 'half-move' : 'half-moves'}`);
      if (event.reason) parts.push(event.reason);
      if (event.assisted || event.hints || event.undos) parts.push('Hints / takebacks used');
    } else if (event.game === 'turdspades') {
      parts.push(event.kind === 'round' ? 'You + North' : 'Match');
      if (event.bid !== undefined && event.tricks !== undefined) parts.push(`${integer(event.tricks)} tricks · team bid ${integer(event.bid)}`);
      else parts.push(event.matchWon ? 'Team won' : 'Finished');
    } else if (event.game === 'turdjack') {
      if (event.natural) parts.push('Natural blackjack');
      parts.push({ win: 'Won deal', loss: event.surrender ? 'Surrendered deal' : 'Lost deal', draw: 'Push', complete: 'Deal complete' }[event.outcome]);
      if (event.net !== undefined) parts.push(`Net ${event.net > 0 ? '+' : ''}${integer(event.net)}`);
    } else if (event.game === 'turdomania') {
      parts.push(event.cleared ? 'Board cleared' : 'No moves left');
      if (event.cols && event.rows) parts.push(`${event.cols}×${event.rows} board`);
      if (event.left !== undefined) parts.push(`${integer(event.left)} tiles left`);
    } else if (event.game === 'turdrummy') parts.push(event.gin ? 'Gin' : event.outcome === 'win' ? 'Won' : event.outcome === 'draw' ? 'Draw' : 'Finished');
    else if (event.game === 'crapeights') parts.push(event.matchWon ? 'Match won' : event.roundWon ? 'Round won' : event.kind === 'match' ? 'Match finished' : 'Round finished');
    else if (event.game === 'turdtris') {
      parts.push({ classic: 'Classic', sprint: 'Sprint 40L', ultra: 'Ultra 2:00' }[event.mode] || 'Run');
      if (event.lines !== undefined) parts.push(`${integer(event.lines)} lines`);
      if (event.mode === 'sprint' && event.completed) {
        const seconds = (event.elapsedMs || 0) / 1000;
        parts.push(`${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`);
      }
    } else if (event.game === 'turdrush') {
      parts.push('Endless run');
      parts.push(`${integer(event.distance)} metres · ${integer(event.picks)} guitar picks`);
      if (event.elapsedMs !== undefined) {
        const seconds = Math.floor(event.elapsedMs / 1000);
        parts.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      }
    } else if (event.game === 'turdanoid') {
      parts.push(event.mode === 'boss' ? 'Boss run' : 'Arcade run');
      if (event.levelsCleared !== undefined) parts.push(`${integer(event.levelsCleared)} stages cleared`);
      if (event.maxCombo !== undefined) parts.push(`${integer(event.maxCombo)}× best combo`);
    }
    if (event.score !== undefined && event.game !== 'chess') parts.push(`${integer(event.score)} points`);
    if (event.difficulty && !(event.game === 'chess' && event.local === true)) parts.push(`Difficulty: ${event.difficulty}`);
    return parts.filter(Boolean).join(' · ');
  }

  // Original SVG line artwork. Badges remain named and described in real text.
  const iconPaths = {
    wall: ['M11 18h42v29H11z M11 28h42 M11 38h42 M25 18v10 M39 28v10 M25 38v9'],
    combo: ['m15 40 8-20 9 20 9-20 8 20 M16 48h32', 'M10 14h6 M48 14h6 M32 9v6'],
    lines: ['M13 16h38v8H13z M13 29h38v8H13z M13 42h38v8H13z'],
    clock: ['M32 16a18 18 0 1 0 0 36 18 18 0 0 0 0-36 M32 22v13l9 5 M25 9h14 M32 9v7'],
    cards: ['m15 14 23-3 5 37-23 3z M31 18l17 4-7 30-17-4', 'm25 29 5 7-4 6-5-6z'],
    ace: ['M17 11h30v42H17z M25 43l7-23 7 23 M28 35h8'],
    eight: ['M17 11h30v42H17z', 'M32 19c-12 0-12 13 0 13s12-13 0-13 M32 32c-13 0-13 14 0 14s13-14 0-14'],
    cup: ['M21 12h22v17c0 15-22 15-22 0z M21 17H12v10c0 7 5 10 12 10 M43 17h9v10c0 7-5 10-12 10 M32 41v10 M23 52h18'],
    fan: ['m12 23 20-10 20 10-9 29H21z M32 13v39 M12 23l20 29 20-29 M21 18l11 34 11-34'],
    spade: ['M32 12c-5 9-19 15-19 26 0 11 13 14 19 5 6 9 19 6 19-5 0-11-14-17-19-26z M32 43l-5 10h10z'],
    tiles: ['M12 13h17v17H12z M35 13h17v17H35z M12 36h17v17H12z', 'm35 44 6 6 12-15'],
    king: ['M32 9v15 M26 15h12 M18 29l8 6 6-9 6 9 8-6-4 17H22z M21 52h22'],
    rush: ['m13 52 13-38h12l13 38 M22 36h20 M32 15v9 M32 30v8 M32 44v8'],
    pick: ['M32 11c-18 0-24 8-20 18 5 12 15 24 20 24s15-12 20-24c4-10-2-18-20-18z M24 23h16 M27 30h10']
  };
  function badge(goal, earned) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 72 80'); svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('suite-progress-badge');
    if (earned) svg.classList.add('is-earned');
    const shield = doc.createElementNS(ns, 'path');
    shield.setAttribute('d', 'M4 5h64v40c0 17-18 27-32 32C22 72 4 62 4 45z');
    shield.classList.add('badge-shield'); svg.append(shield);
    const art = doc.createElementNS(ns, 'g'); art.setAttribute('transform', 'translate(4 6)');
    for (const path of iconPaths[goal.icon]) { const line = doc.createElementNS(ns, 'path'); line.setAttribute('d', path); art.append(line); }
    svg.append(art); return svg;
  }
  function element(name, className, text) {
    const node = doc.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function mountHub({ host, recordFor } = {}) {
    if (!host || host.querySelector('.suite-progress-open')) return null;
    const opener = element('button', 'suite-progress-open', 'Your progress'); opener.type = 'button';
    const dialog = element('dialog', 'suite-progress-dialog');
    dialog.setAttribute('aria-labelledby', 'suite-progress-heading');
    const header = element('div', 'suite-progress-header');
    const heading = element('h2', '', 'Your progress'); heading.id = 'suite-progress-heading';
    const close = element('button', 'suite-progress-close', 'Close'); close.type = 'button';
    header.append(heading, close);
    const content = element('div', 'suite-progress-content');
    const status = element('p', 'suite-progress-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    dialog.append(header, content, status); host.append(opener, dialog);
    let panel = 'badges', gameFilter = 'all';
    const closeDialog = () => { dialog.close(); opener.focus({ preventScroll: true }); };
    close.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    function goalProgress(goal) {
      if (!goal.target) return null;
      const group = element('div', 'suite-progress-meter');
      const amount = current.earned[goal.id] ? goal.target : current.progress[goal.id] || 0;
      const label = `${goal.progressLabel}: ${amount} / ${goal.target}`;
      group.append(element('p', '', label));
      const meter = element('progress'); meter.max = goal.target; meter.value = amount;
      meter.setAttribute('aria-label', `${label}, from completed runs`); group.append(meter);
      group.append(element('small', '', current.earned[goal.id]?.source === 'legacy' ? 'Proved by your existing Sprint record' : 'Best from completed runs'));
      if (goal.id === 'tt-sprint' && amount === 40 && !current.earned[goal.id]) group.append(element('small', '', 'A completed Sprint is still required.'));
      return group;
    }
    function render(focusId) {
      refresh(); recover(); content.replaceChildren();
      content.append(element('p', 'suite-progress-local', 'Only on this browser and this site. Your game records stay separate; no account or leaderboard.'));
      const notice = issue === 'full' ? 'Progress storage is full. Existing progress is kept; new results cannot be saved here.'
        : !available ? 'Browser storage is unavailable. Progress is kept for this visit only.'
          : issue === 'corrupt' ? 'Saved progress could not be read. Existing game records are unchanged.' : '';
      if (notice) content.append(element('p', 'suite-progress-notice', notice));
      const selected = Core.GOALS.find(goal => goal.id === current.selectedGoal);
      const target = element('section', 'suite-progress-target');
      if (selected) {
        target.append(element('h3', '', current.earned[selected.id] ? 'Goal earned' : 'Your next goal'), element('p', '', `${selected.title} — ${selected.description}`));
        const meter = goalProgress(selected); if (meter) target.append(meter);
        const play = element('a', '', `Play ${gameFor(selected.game).title}`); play.href = gameFor(selected.game).href + (selected.query || '');
        const clear = element('button', '', 'Clear goal'); clear.type = 'button';
        clear.addEventListener('click', () => { chooseGoal(null); render('progress-panel-badges'); status.textContent = 'Goal cleared.'; });
        target.append(play, clear);
      } else target.append(element('p', '', 'Pick a goal below, or keep playing your way.'));
      content.append(target);
      const navigation = element('div', 'suite-progress-tabs'); navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Progress views');
      for (const [id, title] of [['badges', 'Badges & goals'], ['recent', 'Recent results'], ['records', 'Game records']]) {
        const button = element('button', '', title); button.type = 'button'; button.id = `progress-panel-${id}`;
        button.setAttribute('aria-pressed', String(panel === id));
        button.addEventListener('click', () => { panel = id; render(button.id); }); navigation.append(button);
      }
      content.append(navigation);
      const body = element('section', 'suite-progress-view');
      if (panel === 'badges') {
        body.append(element('h3', '', `${Object.keys(current.earned).length} of ${Core.GOALS.length} badges earned`));
        const grid = element('ul', 'suite-progress-goals');
        for (const goal of Core.GOALS) {
          const earned = current.earned[goal.id];
          const item = element('li', earned ? 'is-earned' : '');
          item.append(badge(goal, !!earned), element('h4', '', goal.title), element('p', '', goal.description), element('small', '', gameFor(goal.game).title));
          const meter = goalProgress(goal); if (meter) item.append(meter);
          if (earned) item.append(element('p', 'suite-progress-earned', earned.source === 'legacy' ? 'Earned · from existing records' : 'Earned'));
          else {
            item.append(element('p', 'suite-progress-state', 'Not earned'));
            const choose = element('button', '', current.selectedGoal === goal.id ? 'Goal selected' : 'Choose goal');
            choose.type = 'button'; choose.id = `progress-goal-${goal.id}`; choose.setAttribute('aria-pressed', String(current.selectedGoal === goal.id));
            choose.setAttribute('aria-label', `Choose goal: ${goal.title}`);
            choose.addEventListener('click', () => { chooseGoal(goal.id); render(choose.id); status.textContent = `Goal selected: ${goal.title}.`; }); item.append(choose);
          }
          grid.append(item);
        }
        body.append(grid);
      } else if (panel === 'recent') {
        body.append(element('h3', '', 'Recent completed results'));
        body.append(element('p', '', 'Up to 10 results per game, starting with this update. Earlier records stay in Game records. Finishing a Turdomania board again after Undo updates its result.'));
        const label = element('label', 'suite-progress-filter', 'Game '); const select = element('select');
        for (const game of [{ id: 'all', title: 'All games' }, ...Core.GAMES]) { const option = element('option', '', game.title); option.value = game.id; select.append(option); }
        select.value = gameFilter; select.id = 'progress-game-filter'; label.append(select); body.append(label);
        select.addEventListener('change', () => { gameFilter = select.value; render(select.id); });
        const entries = Object.values(current.history).flat().filter(entry => gameFilter === 'all' || entry.game === gameFilter).sort((a, b) => b.at - a.at);
        if (!entries.length) body.append(element('p', 'suite-progress-empty', 'No completed results here yet. Your next finish will appear here.'));
        else {
          const list = element('ol', 'suite-progress-history');
          for (const entry of entries) {
            const item = element('li'); const time = element('time', '', new Date(entry.at).toLocaleString()); time.dateTime = new Date(entry.at).toISOString();
            item.append(element('h4', '', gameFor(entry.game).title), element('p', '', describeEvent(entry)), time); list.append(item);
            if (entry.improvement) item.append(element('p', 'suite-progress-earned', entry.improvement));
          }
          body.append(list);
        }
      } else {
        body.append(element('h3', '', 'Your existing game records'), element('p', '', 'Read from the same records shown on the arcade cards. No scores are reset or combined.'));
        const list = element('dl', 'suite-progress-records');
        for (const game of Core.GAMES) {
          const group = element('div'); let text = null;
          try { text = recordFor?.(game.id); } catch { /* Existing game storage may be denied. */ }
          group.append(element('dt', '', game.title), element('dd', '', text || 'No saved record yet')); list.append(group);
        }
        body.append(list);
      }
      content.append(body);
      if (focusId) {
        const focus = doc.getElementById(focusId);
        focus?.focus({ preventScroll: true });
        focus?.scrollIntoView?.({ block: 'nearest' });
      }
    }
    opener.addEventListener('click', () => {
      render(); status.textContent = '';
      dialog.showModal(); close.focus({ preventScroll: true });
    });
    return Object.freeze({ dialog, opener, close: closeDialog });
  }
  root.SuiteProgress = Object.freeze({ newRunId, record, chooseGoal, snapshot, describeEvent, mountHub, catalog: Core.GOALS, games: Core.GAMES });
})(typeof window !== 'undefined' ? window : globalThis);
