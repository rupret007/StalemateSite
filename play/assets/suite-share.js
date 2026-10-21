/* Completed results only. Images are prepared before the share gesture. */
(function (root) {
  'use strict';
  const integer = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)))) : 0;
  const points = value => integer(value).toLocaleString('en-US') + ' points';
  function time(value) {
    const ms = integer(value);
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
  }
  function describe(game, run, href) {
    if (!['turdtris', 'turdomania'].includes(game)) throw new Error('Unsupported result');
    const url = new URL(game + '.html', href);
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
    } else {
      const id = ['easy', 'normal', 'hard'].includes(run.level) ? run.level : 'normal';
      url.searchParams.set('level', id);
      mode = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[id];
      outcome = run.cleared ? 'Board cleared' : 'No moves left';
      detail = `${integer(run.left)} tiles left`;
    }
    const name = game === 'turdtris' ? 'Turdtris' : 'Turdomania';
    const text = `${name} · ${mode}: ${metric}. ${outcome}. ${detail}. Stalemate Arcade.`;
    return Object.freeze({ game, name, mode, metric, detail, outcome, text, url: url.href });
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
    line(result.name.toUpperCase(), 365, 108, '#ed2765');
    line(result.mode, 440, 52, '#f4f0e6');
    line(result.metric, 575, 112, '#f4f0e6');
    line(result.outcome, 665, 48, '#b5dc08');
    line(result.detail, 740, 36, '#f4f0e6');
    line(result.url.replace(/^https?:\/\//, ''), 840, 27, '#f4f0e6');
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
    button.type = 'button'; button.textContent = 'Share score';
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
