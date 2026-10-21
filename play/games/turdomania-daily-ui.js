/** Browser presentation for Daily Dump; the game keeps its existing renderer and controls. */
import * as Daily from './turdomania-daily.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) { node.textContent = text; }
  if (className) { node.className = className; }
  return node;
}

function shareImage(result) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) { return null; }
  ctx.fillStyle = '#17131d';
  ctx.fillRect(0, 0, 1200, 630);
  for (let x = 0; x < 1200; x += 40) {
    ctx.fillStyle = x % 80 ? '#17131d' : '#fff5df';
    ctx.fillRect(x, 0, 40, 40);
    ctx.fillStyle = x % 80 ? '#fff5df' : '#17131d';
    ctx.fillRect(x, 40, 40, 40);
  }
  ctx.fillStyle = '#ffdf6d';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('STALEMATE ARCADE', 64, 148);
  ctx.fillStyle = '#fff5df';
  ctx.font = 'bold 76px sans-serif';
  ctx.fillText('THE DAILY DUMP', 60, 248);
  ctx.font = '32px sans-serif';
  ctx.fillText(`${result.challenge.date} · Turdomania · rules v${result.challenge.rules}`, 64, 310);
  ctx.fillStyle = '#ff80b6';
  ctx.font = 'bold 92px sans-serif';
  ctx.fillText(`${result.score} POINTS`, 60, 425);
  ctx.fillStyle = '#fff5df';
  ctx.font = '32px sans-serif';
  ctx.fillText(`${result.moves} pops · ${result.cleared ? 'Board flushed!' : `${result.left} tiles left`}`, 64, 490);
  ctx.font = '25px sans-serif';
  ctx.fillText(result.practice ? 'PRACTICE REPLAY · Try the same puzzle at the link in this post.' : 'FIRST RESULT · Try the same puzzle at the link in this post.', 64, 562);
  const raw = window.atob(canvas.toDataURL('image/png').split(',')[1]);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  return new window.File([bytes], `stalemate-daily-dump-${result.challenge.date}.png`, { type: 'image/png' });
}

export function createDailyUI({ params, storage, gameURL, announce }) {
  const request = Daily.parseChallengeRequest(params);
  const ui = {
    enabled: Boolean(request.challenge), run: null, firstResult: null,
    storageAvailable: true, request, storage, onPractice: null
  };
  const header = document.querySelector('header.hud');
  const panel = element('div', '', 'daily-info');
  panel.id = 'dailyInfo';
  const todayLink = Daily.challengeLink(Daily.makeChallenge(), gameURL);
  if (!ui.enabled) {
    // The hub is the daily entry point. Keep free play's established compact HUD.
    if (!request.requested) { return ui; }
    document.body.classList.add('daily-entry');
    panel.classList.add('daily-cta');
    const link = element('a', 'Play The Daily Dump →');
    link.href = todayLink;
    if (request.error) {
      const error = element('p', request.error);
      error.setAttribute('role', 'status');
      panel.appendChild(error);
    }
    panel.appendChild(link);
    header.appendChild(panel);
    return ui;
  }

  document.body.classList.add('daily-entry');
  const challenge = request.challenge;
  const latest = Daily.loadActive(storage);
  const previousRun = Daily.readDailyStatus(storage).previous;
  const active = Daily.loadActive(storage, challenge);
  const completed = Daily.loadCompletedRun(storage, challenge);
  ui.firstResult = completed ? Daily.summarize(completed.run, completed.completedAt) : null;
  ui.run = active.run && active.run.challenge.id === challenge.id
    ? active.run : completed ? completed.run : Daily.createRun(challenge);
  // A stored first result always wins over an unfinished ranked run in another tab.
  if (completed && !ui.run.practice && !ui.run.state.over) { ui.run = completed.run; }
  ui.storageAvailable = active.status !== 'unavailable';

  document.body.classList.add('daily-dump');
  document.querySelector('h1').textContent = 'The Daily Dump';
  document.title = `The Daily Dump · ${challenge.date} · Stalemate Arcade`;
  const tagline = document.getElementById('tagline');
  if (tagline) { tagline.textContent = 'Turdomania · One puzzle. Same board for everyone.'; }
  const heading = element('p', '', 'daily-identity');
  heading.id = 'dailyIdentity';
  const rules = element('details', '', 'daily-rules');
  rules.appendChild(element('summary', 'Rules, saving & reset'));
  const rulesBody = element('div', '', 'daily-rules-body');
  rulesBody.appendChild(element('p', '8 × 10 tiles · Log difficulty · 4 kinds · rules 1 / generator 1. Pop touching groups of 2+. Score (group − 2)²; clear bonus +1000.'));
  rulesBody.appendChild(element('p', 'First completed result counts. No undo or restart during that run. Practice replays allow undo and never replace it.'));
  rulesBody.appendChild(element('p', 'Progress and results stay on this browser and device. This is a friendly, device-local challenge, without server-verified scores.'));
  const reset = element('p');
  reset.id = 'dailyReset';
  rulesBody.appendChild(reset);
  rules.appendChild(rulesBody);
  const storageNote = element('p', '', 'daily-storage-note');
  storageNote.id = 'dailyStorageNote';
  storageNote.setAttribute('role', 'status');
  if (active.status === 'invalid') { storageNote.textContent = 'An unreadable or outdated daily save was ignored. Your free-play records are safe.'; }
  const free = element('a', 'Free play');
  const freeURL = new globalThis.URL(gameURL);
  freeURL.search = '';
  freeURL.hash = '';
  free.href = freeURL.href;
  free.id = 'dailyFreePlay';
  const today = element('a', 'Today’s puzzle');
  today.href = todayLink;
  today.hidden = challenge.date === Daily.challengeDate();
  const links = element('div', '', 'daily-links');
  links.append(free, today);
  const pendingRun = latest.run && !latest.run.practice && !latest.run.state.over && latest.run.challenge.id !== challenge.id
    ? latest.run : previousRun && previousRun.challenge.id !== challenge.id ? previousRun : null;
  if (pendingRun) {
    const previous = element('a', `Continue ${pendingRun.challenge.date}`);
    previous.id = 'dailyPrevious';
    previous.href = Daily.challengeLink(pendingRun.challenge, gameURL);
    links.appendChild(previous);
  }
  panel.append(heading, rules, storageNote, links);
  header.appendChild(panel);

  // Dated URLs preserve the challenge on refresh after midnight.
  try {
    const frozenURL = new globalThis.URL(gameURL);
    frozenURL.searchParams.set('daily', challenge.date);
    frozenURL.searchParams.set('v', String(challenge.rules));
    window.history.replaceState(null, '', frozenURL.href);
  } catch { /* The game still works in restricted embedded previews. */ }

  const best = document.getElementById('best');
  if (best?.parentNode?.firstChild?.nodeType === 3) { best.parentNode.firstChild.textContent = 'First result'; }
  const difficulty = document.getElementById('suite-difficulty-mount');
  if (difficulty) { difficulty.hidden = true; }
  document.getElementById('levelSel').disabled = true;
  document.getElementById('levelSel').hidden = true;
  const help = document.querySelector('.help');
  if (help) { help.textContent = 'Pop matching groups of 2+. Arrows aim, Enter/Space pops. First run has no undo; practice does. Your challenge stays fixed at midnight.'; }

  const shareRow = element('div', '', 'row daily-share');
  const shareButton = element('button', 'Share result');
  shareButton.type = 'button';
  shareButton.id = 'dailyShare';
  const copyButton = element('button', 'Copy result');
  copyButton.type = 'button';
  copyButton.id = 'dailyCopy';
  shareRow.append(shareButton, copyButton);
  const shareStatus = element('p', '', 'daily-share-status');
  shareStatus.id = 'dailyShareStatus';
  shareStatus.setAttribute('role', 'status');
  const manual = element('textarea');
  manual.id = 'dailyShareFallback';
  manual.setAttribute('aria-label', 'Result text and challenge link to copy');
  manual.readOnly = true;
  manual.hidden = true;
  const firstNote = element('p');
  firstNote.id = 'dailyResultNote';
  const resultFree = element('a', 'Keep playing in free play →');
  resultFree.href = free.href;
  resultFree.className = 'daily-result-free';
  document.querySelector('#overlay > div').append(firstNote, shareRow, shareStatus, manual, resultFree);

  function message(text) { shareStatus.textContent = text; announce(text); }
  function payload() {
    const result = ui.run.practice ? Daily.summarize(ui.run) : ui.firstResult || Daily.summarize(ui.run);
    return { result, text: Daily.shareText(result, Daily.challengeLink(ui.run.challenge, gameURL)) };
  }
  async function copy() {
    const { text } = payload();
    try {
      if (!window.navigator.clipboard?.writeText) { throw new Error('Clipboard unavailable'); }
      await window.navigator.clipboard.writeText(text);
      manual.hidden = true;
      message('Result and challenge link copied.');
    } catch {
      manual.value = text;
      manual.hidden = false;
      manual.focus();
      manual.select();
      message('Select and copy the result text below.');
    }
  }
  shareButton.addEventListener('click', async () => {
    const { result, text } = payload();
    if (!window.navigator.share) { await copy(); return; }
    try {
      let file = null;
      try { file = shareImage(result); } catch { /* Share text if image export is unavailable. */ }
      const data = { title: 'Stalemate Arcade · The Daily Dump', text };
      if (file && window.navigator.canShare?.({ files: [file] })) { data.files = [file]; }
      await window.navigator.share(data);
      message('Result shared.');
    } catch (error) {
      if (error.name === 'AbortError') { message('Share canceled. Your result is still here.'); }
      else { await copy(); }
    }
  });
  copyButton.addEventListener('click', copy);

  function updateClock() {
    const now = Date.now();
    const next = Daily.nextResetAt(now);
    const remaining = Math.max(1, Math.ceil((next - now) / 60000));
    const hours = Math.floor(remaining / 60);
    const minutes = remaining % 60;
    reset.textContent = `Next puzzle in ${hours ? `${hours}h ` : ''}${minutes}m, at midnight America/Chicago (including daylight saving). Your active puzzle stays ${challenge.date}.`;
    today.hidden = challenge.date === Daily.challengeDate(now);
    today.href = Daily.challengeLink(Daily.makeChallenge(Daily.challengeDate(now)), gameURL);
  }

  ui.persist = () => {
    if (!Daily.saveActive(storage, ui.run)) { ui.storageAvailable = false; }
    if (ui.run.state.over && !ui.run.practice && !ui.firstResult) {
      const recorded = Daily.recordCompletion(storage, ui.run);
      ui.firstResult = recorded.result;
      if (!recorded.saved) { ui.storageAvailable = false; }
    }
    if (!ui.storageAvailable) {
      storageNote.textContent = 'Saving is unavailable. This run and its result last only while this page stays open.';
    }
  };
  ui.update = () => {
    const mode = ui.run.practice ? 'PRACTICE · undo allowed' : ui.run.state.over ? 'FIRST RESULT' : ui.run.moves.length ? 'FIRST RUN · resumed' : 'FIRST RUN · no undo';
    heading.textContent = `The Daily Dump · ${challenge.date} · ${mode}`;
    document.body.classList.toggle('daily-practice', ui.run.practice);
    best.textContent = ui.firstResult ? String(ui.firstResult.score) : '—';
    const undo = document.getElementById('undoBtn');
    const overUndo = document.getElementById('overUndoBtn');
    undo.disabled = !ui.run.practice || !ui.run.moves.length;
    undo.textContent = ui.run.practice ? '↶ Undo' : 'No daily undo';
    undo.title = ui.run.practice ? 'Undo a practice pop' : 'First daily run: every pop is final';
    overUndo.hidden = !ui.run.practice;
    overUndo.disabled = !ui.run.moves.length;
    const newButton = document.getElementById('newBtn');
    newButton.textContent = ui.run.practice ? 'Restart practice' : 'Practice after finish';
    newButton.disabled = !ui.run.practice && !ui.run.state.over;
    document.getElementById('againBtn').textContent = 'Replay as practice';
    document.getElementById('board').setAttribute('aria-label', `Daily Dump ${challenge.date} board. Arrows move, Enter pops.${ui.run.practice ? ' U undoes practice.' : ' No undo in the first daily run.'}`);
    firstNote.textContent = ui.run.practice
      ? `Practice replay. First result ${ui.firstResult ? `${ui.firstResult.score} points` : 'is unchanged'}; this score will not replace it.`
      : `First completed result${ui.storageAvailable ? ' saved on this device' : ' for this visit'}. Replay for practice or try free play.`;
    updateClock();
  };
  ui.startPractice = () => {
    if (!ui.run.state.over && !ui.run.practice) { announce('Finish your first daily run before starting practice.'); return false; }
    ui.run = Daily.createRun(challenge, true);
    manual.hidden = true;
    shareStatus.textContent = '';
    ui.persist();
    return true;
  };
  ui.persist();
  updateClock();
  window.setInterval(updateClock, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateClock(); } });
  return ui;
}
