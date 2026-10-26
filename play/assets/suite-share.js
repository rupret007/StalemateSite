/* Completed results only. Images are prepared before the share gesture. */
(function (root) {
  'use strict';
  const integer = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)))) : 0;
  const points = value => integer(value).toLocaleString('en-US') + ' points';
  const units = (value, single, multiple = single + 's') => `${integer(value).toLocaleString('en-US')} ${integer(value) === 1 ? single : multiple}`;
  const SHARE_ACCENT = '#ed2765';
  const signed = value => (Number.isFinite(value) ? Math.max(-1e9, Math.min(1e9, value)) : 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const strength = value => ({ easy: 'Easy', normal: 'Normal', hard: 'Hard', mixed: 'Mixed strength', unknown: 'Strength not recorded', house: 'House rules', friendly: 'Friendly', casual: 'Casual', club: 'Club', sharp: 'Sharp' })[value] || 'Strength not recorded';
  function time(value) {
    const ms = integer(value);
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
  }
  function describe(game, run, href) {
    const names = { turdanoid: 'Turdanoid', turdtris: 'Turdtris', turdomania: 'Turdomania', turdjack: 'Crapjack 21', crapeights: 'Crappy Eights', turdrummy: 'TurdRummy', turdspades: 'TurdSpades', chess: 'Royal Flush Chess' };
    if (!Object.hasOwn(names, game) || !run || typeof run !== 'object') throw new Error('Unsupported result');
    if (!['turdtris', 'turdomania'].includes(game) && !['win', 'loss', 'draw', 'complete'].includes(run.outcome)) throw new Error('A completed result is required');
    const url = new URL(game === 'turdanoid' ? 'TurdAnoid.html' : game + '.html', href);
    let mode, metric = points(run.score), detail, outcome;
    if (game === 'turdtris') {
      const id = ['classic', 'sprint', 'ultra'].includes(run.mode) ? run.mode : 'classic';
      url.searchParams.set('mode', id);
      mode = { classic: 'Classic', sprint: 'Sprint 40L', ultra: 'Ultra 2:00' }[id];
      outcome = run.completed ? 'Run complete' : 'Game over';
      detail = `${integer(run.lines)} lines · ${time(run.elapsedMs)}`;
      if (id === 'sprint') {
        outcome = run.completed ? '40 lines cleared' : 'Sprint unfinished';
        if (run.completed) { metric = time(run.elapsedMs); detail = points(run.score); }
      } else if (id === 'ultra') outcome = run.completed ? 'Two minutes complete' : 'Ultra ended early';
    } else if (game === 'turdomania') {
      const id = ['easy', 'normal', 'hard'].includes(run.level || run.mode) ? run.level || run.mode : 'normal';
      url.searchParams.set('level', id);
      mode = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[id];
      outcome = run.cleared ? 'Board cleared' : 'No moves left';
      detail = `${integer(run.left)} tiles left`;
      if (Number.isSafeInteger(run.cols) && run.cols > 0 && Number.isSafeInteger(run.rows) && run.rows > 0) detail += ` · ${run.cols}×${run.rows} board`;
    } else if (game === 'turdanoid') {
      const id = run.mode === 'boss' ? 'boss' : 'classic';
      url.searchParams.set('mode', id);
      mode = id === 'boss' ? 'Boss Flush' : 'Classic';
      outcome = run.outcome === 'win' ? 'Victory' : 'Run complete';
      detail = `${units(run.levelsCleared, 'stage')} cleared · Best combo ${integer(run.maxCombo)}`;
    } else if (game === 'turdjack') {
      mode = 'House rules';
      const net = Number.isFinite(run.net) ? run.net : null;
      metric = net === null ? 'Deal complete' : `Net ${net < 0 ? '-' : '+'}$${signed(Math.abs(net))}`;
      outcome = run.natural && run.outcome === 'win' ? 'Natural blackjack' : 'Deal settled';
      const rules = typeof run.rules === 'string' ? run.rules.replace(/[<>\r\n]/g, '').slice(0, 70) : '';
      detail = `${net === null ? 'Net not recorded · ' : ''}${units(run.wins, 'win')} · ${units(run.losses, 'loss', 'losses')} · ${units(run.pushes, 'push', 'pushes')}${rules ? ' · ' + rules : ''}`;
    } else if (game === 'chess') {
      const local = run.local === true || run.mode === 'local';
      url.searchParams.set('mode', local ? 'local' : 'computer');
      const level = ['friendly', 'casual', 'club', 'sharp'].includes(run.difficulty || run.level) ? run.difficulty || run.level : 'friendly';
      if (!local) url.searchParams.set('level', level);
      mode = local ? 'Two players · Untimed' : `${strength(level)} computer · ${run.assisted ? 'Assisted' : 'No aids used'}`;
      metric = local ? run.winner === 'w' ? 'White wins' : run.winner === 'b' ? 'Black wins' : 'Draw' : { win: 'You won', loss: 'Computer won', draw: 'Draw', complete: 'Game complete' }[run.outcome];
      outcome = local ? 'Local two-player game' : 'Casual computer practice';
      detail = `${units(run.moves, 'half-move')} · ${units(run.hints, 'hint')} · ${units(run.undos, 'takeback')}`;
    } else {
      const unit = run.kind === 'round' ? 'Round' : 'Match';
      mode = `${game === 'turdspades' ? 'Team ' : ''}${unit.toLowerCase()} · ${strength(run.difficulty)}`;
      metric = { win: `${unit} won`, loss: `${unit} lost`, draw: `${unit} drawn`, complete: `${unit} complete` }[run.outcome];
      outcome = game === 'crapeights' ? `First to ${integer(run.target) || 200} points` : game === 'turdrummy' ? 'Gin Rummy' : 'Partner Spades';
      detail = game === 'turdspades' ? `Your team ${signed(run.playerScore ?? run.score)} · Opponents ${signed(run.opponentScore)}` : `Your score ${signed(run.playerScore ?? run.score)}`;
      if (Number.isFinite(run.target)) detail += ` · Target ${integer(run.target)}`;
      if (Number.isFinite(run.rounds)) detail += ` · ${integer(run.rounds)} rounds`;
    }
    const name = names[game];
    const improvement = typeof run.improvement === 'string' && run.improvement.length <= 160 ? run.improvement : '';
    const text = `${name} · ${mode}: ${metric}. ${outcome}. ${detail}.${improvement ? ' ' + improvement + '.' : ''} Stalemate Arcade.`;
    return Object.freeze({ game, name, mode, metric, detail, outcome, text, url: url.href, improvement });
  }
  function drawCard(result, document) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#111111' : '#f4f0e6';
      ctx.fillRect(col * 90, row * 90, 90, 90);
    }
    ctx.fillStyle = '#171410'; ctx.fillRect(60, 150, 960, 780);
    ctx.textAlign = 'center';
    function line(text, y, size, color) {
      ctx.fillStyle = color;
      ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
      ctx.fillText(text, 540, y, 880);
    }
    line('STALEMATE ARCADE', 245, 54, '#b5dc08');
    line(result.name.toUpperCase(), 365, result.name.length > 14 ? 76 : 108, SHARE_ACCENT);
    line(result.mode, 440, result.mode.length > 30 ? 36 : 52, '#f4f0e6');
    line(result.metric, 575, result.metric.length > 16 ? 78 : 112, '#f4f0e6');
    line(result.outcome, 665, 48, '#b5dc08');
    const words = result.detail.split(' '), details = [''];
    for (const word of words) {
      const last = details.length - 1;
      if ((details[last] + ' ' + word).trim().length > 50) details.push(word);
      else details[last] = (details[last] + ' ' + word).trim();
    }
    details.slice(0, 3).forEach((text, index) => line(text, 730 + index * 35, 30, '#f4f0e6'));
    line(result.url.replace(/^https?:\/\//, ''), 840, 27, '#f4f0e6');
    if (result.improvement) line(result.improvement, 895, 28, '#b5dc08');
    return canvas;
  }
  function create({ host, game }) {
    const document = host.ownerDocument;
    const box = document.createElement('div');
    box.className = 'suite-result-share';
    box.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'suite-result-share-actions';
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = ['turdtris', 'turdomania', 'turdanoid'].includes(game) ? 'Share score' : 'Share result';
    const save = document.createElement('a');
    save.textContent = 'Save image'; save.hidden = true;
    save.download = game + '-score.png';
    const status = document.createElement('p');
    status.className = 'suite-result-share-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const fallback = document.createElement('textarea');
    fallback.readOnly = true; fallback.hidden = true;
    fallback.setAttribute('aria-label', 'Score and game link to copy');
    actions.append(button, save); box.append(actions, status, fallback); host.append(box);
    // Keep Enter/Space and copy shortcuts inside sharing, away from game replay.
    box.addEventListener('keydown', event => event.stopPropagation());
    let result = null, signature = '', file = null, imageUrl = null, version = 0;
    function setResult(run) {
      const next = run ? describe(game, run, root.location.href) : null;
      const key = next ? JSON.stringify(next) : '';
      if (key === signature) return;
      signature = key; result = next; file = null; version++;
      if (imageUrl) root.URL.revokeObjectURL(imageUrl);
      imageUrl = null; save.hidden = true; save.removeAttribute('href');
      status.textContent = ''; fallback.hidden = true; button.disabled = false;
      box.hidden = !result;
      if (!result) return;
      const current = version;
      try {
        const canvas = drawCard(result, document);
        canvas.toBlob(blob => {
          if (!blob || current !== version) return;
          if (typeof root.File === 'function') file = new root.File([blob], game + '-score.png', { type: 'image/png' });
          if (root.URL.createObjectURL) {
            imageUrl = root.URL.createObjectURL(blob);
            save.href = imageUrl; save.hidden = false;
          }
        }, 'image/png');
      } catch (error) { /* Text sharing remains available if canvas is unavailable. */ }
    }
    button.addEventListener('click', async () => {
      if (!result || button.disabled) return;
      const current = version, snapshot = result;
      const fullText = snapshot.text + '\n' + snapshot.url;
      status.textContent = ''; fallback.hidden = true; button.disabled = true;
      const update = text => {
        if (current !== version) return;
        status.textContent = text;
        status.scrollIntoView?.({ block: 'nearest' });
      };
      try {
        let payload = { title: snapshot.name + ' · Stalemate Arcade', text: snapshot.text, url: snapshot.url };
        if (file && root.navigator.canShare) {
          const withFile = { title: payload.title, text: fullText, files: [file] };
          try { if (root.navigator.canShare(withFile)) payload = withFile; } catch (error) { /* Use text. */ }
        }
        if (root.navigator.share) {
          try {
            // No await before this call: browsers require the original user gesture.
            await root.navigator.share(payload);
            update('Shared.'); return;
          } catch (error) {
            if (error && error.name === 'AbortError') { update('Sharing cancelled.'); return; }
          }
        }
        if (current !== version) return;
        try {
          if (!root.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await root.navigator.clipboard.writeText(fullText);
          update('Score and game link copied.');
        } catch (error) {
          if (current !== version) return;
          fallback.value = fullText; fallback.hidden = false; fallback.focus(); fallback.select();
          update('Select and copy the score and game link below.');
        }
      } finally { if (current === version) button.disabled = false; }
    });
    return Object.freeze({ setResult });
  }
  root.SuiteShare = Object.freeze({ create, describe, drawCard });
})(window);
