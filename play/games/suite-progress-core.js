/* Optional device progress. Pure catalog, validation and immutable transitions. */
(function attachProgressCore(root) {
  'use strict';
  const KEY = 'arcade_progress_v1';
  const MAX_BYTES = 128 * 1024;
  const MAX_RANGES = 4096;
  const MAX_SCOPES = 64;
  const GAMES = Object.freeze([
    { id: 'turdanoid', title: 'Turdanoid', href: 'TurdAnoid.html' },
    { id: 'turdtris', title: 'Turdtris', href: 'turdtris.html' },
    { id: 'turdjack', title: 'Crapjack 21', href: 'turdjack.html' },
    { id: 'crapeights', title: 'Crappy Eights', href: 'crapeights.html' },
    { id: 'turdrummy', title: 'TurdRummy', href: 'turdrummy.html' },
    { id: 'turdspades', title: 'TurdSpades', href: 'turdspades.html' },
    { id: 'turdomania', title: 'Turdomania', href: 'turdomania.html' },
    { id: 'chess', title: 'Royal Flush Chess', href: 'chess.html' },
    { id: 'turdrush', title: 'Turd Rush', href: 'turdrush.html' }
  ].map(Object.freeze));
  const GOALS = Object.freeze([
    { id: 'ta-stage', game: 'turdanoid', title: 'Wall breaker', description: 'Clear a stage in Classic Turdanoid.', icon: 'wall', target: 1, progressLabel: 'Classic stage clears' },
    { id: 'ta-combo', game: 'turdanoid', title: 'Five in a row', description: 'Reach a 5× combo in Turdanoid.', icon: 'combo', target: 5, progressLabel: 'Best combo' },
    { id: 'tt-lines', game: 'turdtris', title: 'Line maker', description: 'Clear 10 lines in one Classic run.', icon: 'lines', target: 10, progressLabel: 'Classic lines' },
    { id: 'tt-sprint', game: 'turdtris', title: 'Sprint finisher', description: 'Finish the 40-line Sprint.', icon: 'clock', query: '?mode=sprint', target: 40, progressLabel: 'Sprint lines' },
    { id: 'jack-win', game: 'turdjack', title: 'Beat the dealer', description: 'Finish a settled deal with a positive net result.', icon: 'cards' },
    { id: 'jack-natural', game: 'turdjack', title: 'Natural talent', description: 'Finish a natural blackjack deal with a positive net result.', icon: 'ace' },
    { id: 'eights-round', game: 'crapeights', title: 'First out', description: 'Win a round of Crappy Eights.', icon: 'eight' },
    { id: 'eights-match', game: 'crapeights', title: 'Match point', description: 'Win a Crappy Eights match.', icon: 'cup' },
    { id: 'rummy-gin', game: 'turdrummy', title: 'Gin it to win it', description: 'Go gin in TurdRummy.', icon: 'fan' },
    { id: 'spades-contract', game: 'turdspades', title: 'Promise kept', description: 'You + North make a positive team bid in a round.', icon: 'spade' },
    { id: 'mania-clear', game: 'turdomania', title: 'Clean sweep', description: 'Clear a Turdomania board on any difficulty.', icon: 'tiles' },
    { id: 'chess-finish', game: 'chess', title: 'Final move', description: 'Complete a chess game after at least one move.', icon: 'king' },
    { id: 'rush-distance', game: 'turdrush', title: 'Sewer sprinter', description: 'Travel 500 metres in one Turd Rush run.', icon: 'rush', target: 500, progressLabel: 'Best run distance' },
    { id: 'rush-picks', game: 'turdrush', title: 'Pick collector', description: 'Collect 50 guitar picks in one Turd Rush run.', icon: 'pick', target: 50, progressLabel: 'Most picks in a run' }
  ].map(Object.freeze));
  const gameIds = new Set(GAMES.map(game => game.id));
  const goalIds = new Set(GOALS.map(goal => goal.id));
  const numberFields = ['score', 'elapsedMs', 'lines', 'left', 'levelsCleared', 'maxCombo', 'net', 'bid', 'tricks', 'moves', 'hints', 'undos', 'cols', 'rows', 'distance', 'picks'];
  const extraNumbers = ['target', 'rounds', 'playerScore', 'opponentScore', 'wager', 'hands', 'wins', 'losses', 'pushes', 'decks'];
  const booleanFields = ['completed', 'cleared', 'natural', 'roundWon', 'matchWon', 'gin', 'local', 'assisted', 'surrender'];
  const slugFields = ['mode', 'difficulty', 'team'];
  const kinds = new Set(['run', 'round', 'match', 'hand']);
  const outcomes = new Set(['win', 'loss', 'draw', 'complete']);
  const namespacePattern = /^[a-z0-9-]{8,80}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const object = value => !!value && Object.prototype.toString.call(value) === '[object Object]' &&
    !['__proto__', 'prototype', 'constructor'].some(key => Object.prototype.hasOwnProperty.call(value, key));

  function newState(namespace) {
    if (!namespacePattern.test(namespace || '')) {return null;}
    return { version: 1, namespace, next: {}, receipts: {}, history: {}, earned: {}, bests: {}, progress: {}, selectedGoal: null };
  }

  function parseId(id) {
    if (typeof id !== 'string' || id.length > 150) {return null;}
    const parts = id.split('.');
    if (parts.length !== 4 || parts[0] !== 'p1' || !namespacePattern.test(parts[1]) || !gameIds.has(parts[2]) || !/^[1-9][0-9]*$/.test(parts[3])) {return null;}
    const ordinal = Number(parts[3]);
    return Number.isSafeInteger(ordinal) ? { namespace: parts[1], game: parts[2], ordinal, scope: `${parts[1]}:${parts[2]}` } : null;
  }

  function normalizeEvent(value, at) {
    if (!object(value) || !gameIds.has(value.game) || !kinds.has(value.kind) || !outcomes.has(value.outcome) || !integer(at) || at > 8640000000000000) {return null;}
    const parsed = parseId(value.id);
    if (!parsed || parsed.game !== value.game) {return null;}
    const event = { id: value.id, game: value.game, kind: value.kind, outcome: value.outcome, at };
    for (const key of numberFields) {
      if (value[key] === undefined) {continue;}
      if (key === 'net' || (key === 'score' && value.game === 'turdjack')) {
        if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 1e9) {return null;}
      } else if (!Number.isSafeInteger(value[key]) || ((key !== 'score' || value.game === 'turdrush') && value[key] < 0)) {return null;}
      if (['cols', 'rows'].includes(key) && (value[key] < 1 || value[key] > 64)) {return null;}
      event[key] = value[key];
    }
    for (const key of extraNumbers) {
      if (value[key] === undefined) {continue;}
      if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 1e9) {return null;}
      event[key] = value[key];
    }
    for (const key of booleanFields) {
      if (value[key] === undefined) {continue;}
      if (typeof value[key] !== 'boolean') {return null;}
      event[key] = value[key];
    }
    for (const key of slugFields) {
      if (value[key] === undefined) {continue;}
      if (typeof value[key] !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value[key])) {return null;}
      event[key] = value[key];
    }
    if (value.rules !== undefined) {
      if (typeof value.rules !== 'string' || value.rules.length > 240 || /[\u0000-\u001f]/.test(value.rules)) {return null;}
      event.rules = value.rules;
    }
    if (value.winner !== undefined) {
      if (value.game !== 'chess' || !['w', 'b', null].includes(value.winner)) {return null;}
      event.winner = value.winner;
    }
    if (value.reason !== undefined) {
      if (value.game !== 'chess' || typeof value.reason !== 'string' || value.reason.length > 80 || /[<>\u0000-\u001f]/.test(value.reason)) {return null;}
      event.reason = value.reason;
    }
    if (value.history !== undefined && typeof value.history !== 'boolean') {return null;}
    if (value.history === false) {event.history = false;}
    return event;
  }

  function seen(state, parsed) {
    return (state.receipts[parsed.scope] || []).some(([start, end]) => parsed.ordinal >= start && parsed.ordinal <= end);
  }

  function addReceipt(state, parsed) {
    const ranges = [...(state.receipts[parsed.scope] || []), [parsed.ordinal, parsed.ordinal]].sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1] + 1) {last[1] = Math.max(last[1], range[1]);}
      else {merged.push(range.slice());}
    }
    state.receipts[parsed.scope] = merged;
  }

  function withinCapacity(state) {
    return Object.keys(state.receipts).length <= MAX_SCOPES &&
      Object.keys(state.bests).length <= 64 &&
      Object.values(state.receipts).reduce((count, ranges) => count + ranges.length, 0) <= MAX_RANGES &&
      JSON.stringify(state).length <= MAX_BYTES;
  }

  function validateState(value) {
    try {
      if (!object(value) || value.version !== 1 || !namespacePattern.test(value.namespace || '') ||
          !['next', 'receipts', 'history', 'earned', 'bests', 'progress'].every(key => object(value[key])) ||
          (value.selectedGoal !== null && !goalIds.has(value.selectedGoal)) || !withinCapacity(value)) {return null;}
      if (!Object.entries(value.next).every(([game, ordinal]) => gameIds.has(game) && integer(ordinal) && ordinal > 0)) {return null;}
      if (!Object.entries(value.progress).every(([id, amount]) => {
        const goal = GOALS.find(item => item.id === id);
        return goal?.target && integer(amount) && amount <= goal.target;
      })) {return null;}
      for (const [scope, ranges] of Object.entries(value.receipts)) {
        const parts = scope.split(':');
        if (parts.length !== 2 || !namespacePattern.test(parts[0]) || !gameIds.has(parts[1]) || !Array.isArray(ranges) || !ranges.length) {return null;}
        let previous = -1;
        for (const range of ranges) {
          if (!Array.isArray(range) || range.length !== 2 || !range.every(integer) || range[0] < 1 || range[1] < range[0] || range[0] <= previous + 1) {return null;}
          previous = range[1];
        }
      }
      for (const [game, entries] of Object.entries(value.history)) {
        if (!gameIds.has(game) || !Array.isArray(entries) || entries.length > 10 || new Set(entries.map(entry => entry.id)).size !== entries.length) {return null;}
        for (const entry of entries) {
          if (entry.game !== game || !normalizeEvent(entry, entry.at) || entry.history === false || !seen(value, parseId(entry.id))) {return null;}
          if (entry.improvement !== undefined && (typeof entry.improvement !== 'string' || entry.improvement.length > 160 || /[\u0000-\u001f]/.test(entry.improvement))) {return null;}
        }
      }
      for (const [scope, bests] of Object.entries(value.bests)) {
        const parts = scope.split('|');
        const [game, mode, difficulty, dimensions] = parts;
        if (parts.length !== (game === 'turdomania' ? 4 : 3) || !['turdanoid', 'turdtris', 'turdomania', 'turdrush'].includes(game) ||
            !/^[a-z][a-z0-9-]{0,31}$/.test(mode || '') || !/^[a-z][a-z0-9-]{0,31}$/.test(difficulty || '') ||
            !Array.isArray(bests) || bests.length < 1 || bests.length > 2 || new Set(bests.map(best => best.id)).size !== bests.length) {return null;}
        if (game === 'turdomania' && (!/^[1-9][0-9]?x[1-9][0-9]?$/.test(dimensions || '') || !dimensions.split('x').every(size => Number(size) <= 64))) {return null;}
        for (const best of bests) {
          const parsed = parseId(best.id);
          if (!parsed || parsed.game !== game || !integer(best.value) || !seen(value, parsed)) {return null;}
        }
      }
      for (const [goal, earned] of Object.entries(value.earned)) {
        if (!goalIds.has(goal) || !object(earned) || !['event', 'legacy'].includes(earned.source)) {return null;}
        if (earned.source === 'event') {
          const parsed = parseId(earned.eventId);
          if (!parsed || parsed.game !== GOALS.find(item => item.id === goal).game || !integer(earned.at) || !seen(value, parsed)) {return null;}
        }
      }
      return clone(value);
    } catch {return null;}
  }

  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) {return null;}
    try {return validateState(JSON.parse(raw));} catch {return null;}
  }

  function allocate(state, game) {
    if (!gameIds.has(game)) {return null;}
    const ordinal = state.next[game] || 1;
    if (!Number.isSafeInteger(ordinal + 1)) {return null;}
    const next = clone(state);
    next.next[game] = ordinal + 1;
    return { state: next, id: `p1.${state.namespace}.${game}.${ordinal}` };
  }

  function goalMet(goal, event) {
    if (goal.game !== event.game) {return false;}
    switch (goal.id) {
    case 'ta-stage': return event.mode === 'classic' && event.levelsCleared >= 1;
    case 'ta-combo': return event.maxCombo >= 5;
    case 'tt-lines': return event.mode === 'classic' && event.lines >= 10;
    case 'tt-sprint': return event.mode === 'sprint' && event.completed === true && event.lines >= 40;
    case 'jack-win': return event.kind === 'hand' && event.outcome === 'win' && event.net > 0;
    case 'jack-natural': return event.kind === 'hand' && event.outcome === 'win' && event.net > 0 && event.natural === true;
    case 'eights-round': return event.roundWon === true;
    case 'eights-match': return event.matchWon === true;
    case 'rummy-gin': return event.gin === true;
    case 'spades-contract': return event.kind === 'round' && event.bid > 0 && event.tricks >= event.bid;
    case 'mania-clear': return event.cleared === true;
    case 'chess-finish': return event.completed === true && event.moves > 0;
    case 'rush-distance': return event.kind === 'run' && event.distance >= 500;
    case 'rush-picks': return event.kind === 'run' && event.picks >= 50;
    default: return false;
    }
  }

  function compareCompleted(next, entry) {
    if (entry.kind !== 'run' || !['turdanoid', 'turdtris', 'turdomania', 'turdrush'].includes(entry.game)) {return null;}
    if (!entry.difficulty || ['mixed', 'unknown'].includes(entry.difficulty)) {return null;}
    if (entry.game === 'turdomania' && !(entry.cols > 0 && entry.rows > 0)) {return null;}
    const sprint = entry.game === 'turdtris' && entry.mode === 'sprint';
    if (entry.game === 'turdtris' && !['classic', 'ultra', 'sprint'].includes(entry.mode)) {return null;}
    if (sprint && !(entry.completed === true && entry.lines >= 40 && entry.elapsedMs > 0)) {return null;}
    const value = sprint ? entry.elapsedMs : entry.score;
    if (!integer(value)) {return null;}
    const scope = `${entry.game}|${entry.mode || 'standard'}|${entry.difficulty}${entry.game === 'turdomania' ? `|${entry.cols}x${entry.rows}` : ''}`;
    const previous = next.bests[scope] || [];
    const peer = previous.find(best => best.id !== entry.id);
    const better = (a, b) => sprint ? a < b : a > b;
    const existing = previous.find(best => best.id === entry.id);
    const bestValue = existing && better(existing.value, value) ? existing.value : value;
    next.bests[scope] = [...previous.filter(best => best.id !== entry.id), { id: entry.id, value: bestValue }]
      .sort((a, b) => sprint ? a.value - b.value : b.value - a.value).slice(0, 2);
    if (!peer || !better(value, peer.value)) {return null;}
    return sprint ? `${((peer.value - value) / 1000).toFixed(2)} seconds faster than your previous completed Sprint`
      : `${(value - peer.value).toLocaleString('en-US')} points above your previous completed best`;
  }

  function updateGoalProgress(next, entry) {
    const metrics = {
      'ta-stage': entry.game === 'turdanoid' && entry.mode === 'classic' ? entry.levelsCleared : undefined,
      'ta-combo': entry.game === 'turdanoid' ? entry.maxCombo : undefined,
      'tt-lines': entry.game === 'turdtris' && entry.mode === 'classic' ? entry.lines : undefined,
      'tt-sprint': entry.game === 'turdtris' && entry.mode === 'sprint' ? entry.lines : undefined,
      'rush-distance': entry.game === 'turdrush' && entry.kind === 'run' ? entry.distance : undefined,
      'rush-picks': entry.game === 'turdrush' && entry.kind === 'run' ? entry.picks : undefined
    };
    for (const [id, amount] of Object.entries(metrics)) {
      if (!integer(amount)) {continue;}
      const goal = GOALS.find(item => item.id === id);
      next.progress[id] = Math.min(goal.target, Math.max(next.progress[id] || 0, amount));
    }
  }

  function record(state, value, at) {
    const entry = normalizeEvent(value, at);
    if (!entry) {return { state, recorded: false, updated: false, newlyEarned: [], improvement: null, entry: null, error: 'invalid' };}
    const parsed = parseId(entry.id);
    const duplicate = seen(state, parsed);
    const previous = (state.history[entry.game] || []).find(item => item.id === entry.id);
    if (duplicate && entry.game !== 'turdomania') {return { state, recorded: false, updated: false, newlyEarned: [], improvement: null, entry: previous || null };}
    const next = clone(state);
    if (!duplicate) {addReceipt(next, parsed);}
    updateGoalProgress(next, entry);
    const improvement = compareCompleted(next, entry);
    if (improvement) {entry.improvement = improvement;}
    if (entry.history !== false) {
      const history = next.history[entry.game] || [];
      if (!duplicate) {next.history[entry.game] = [...history, entry].slice(-10);}
      else if (previous) {next.history[entry.game] = history.map(item => item.id === entry.id ? entry : item);}
    }
    const newlyEarned = GOALS.filter(goal => !next.earned[goal.id] && goalMet(goal, entry));
    for (const goal of newlyEarned) {next.earned[goal.id] = { source: 'event', eventId: entry.id, at };}
    if (!withinCapacity(next)) {return { state, recorded: false, updated: false, newlyEarned: [], improvement: null, entry: null, error: 'capacity' };}
    return { state: next, recorded: !duplicate, updated: duplicate && !!previous, newlyEarned, improvement, entry };
  }

  function setGoal(state, id) {
    if (id !== null && !goalIds.has(id)) {return null;}
    const next = clone(state); next.selectedGoal = id; return next;
  }

  function recoverLegacy(state, getItem) {
    const json = key => {
      try {const value = JSON.parse(getItem(key) || 'null'); return object(value) ? value : null;} catch {return null;}
    };
    const positive = value => integer(value) && value > 0;
    const jack = json('turdjackStats');
    const eights = json('crapeightsStats');
    const rummy = json('turdrummy_stats_v1');
    let sprint = null;
    try {const raw = getItem('turdtrisSprint40BestMs_v1'); if (/^[1-9][0-9]*$/.test(raw || '')) {sprint = Number(raw);}} catch { /* No proof. */ }
    // Old wins count individual split hands, not a positive net settled deal.
    // A recorded winning natural is the narrower proof available in that store.
    const naturalProved = positive(jack?.wins) && positive(jack?.blackjacks) && jack.blackjacks <= jack.wins;
    const facts = {
      'tt-sprint': positive(sprint),
      'jack-win': naturalProved,
      'jack-natural': naturalProved,
      'eights-round': positive(eights?.roundsWon),
      'eights-match': positive(eights?.matchesWon),
      'rummy-gin': object(rummy?.stats) && positive(rummy.stats.playerGins)
    };
    const next = clone(state);
    const newlyEarned = GOALS.filter(goal => facts[goal.id] && !next.earned[goal.id]);
    for (const goal of newlyEarned) {next.earned[goal.id] = { source: 'legacy' };}
    if (facts['tt-sprint']) {next.progress['tt-sprint'] = 40;}
    return { state: next, newlyEarned };
  }

  root.SuiteProgressCore = Object.freeze({ KEY, MAX_BYTES, MAX_RANGES, MAX_SCOPES, GAMES, GOALS, newState, parse, validateState, parseId, normalizeEvent, allocate, record, setGoal, recoverLegacy });
})(typeof window !== 'undefined' ? window : globalThis);
