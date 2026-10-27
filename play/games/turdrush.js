import { createRun, startRun, pauseRun, resumeRun, act, advance } from './turdrush-core.js?v=6120b7f3c87dd2c2';
import { TurdRushRenderer } from './turdrush-renderer.js?v=3f4caf204b692b96';

const $ = id => document.getElementById(id);
const suite = globalThis.Suite;
const controls = [...document.querySelectorAll('[data-rush-action]')];
const panels = ['rush-intro', 'rush-paused', 'rush-results', 'rush-unavailable'];
const motion = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
const share = globalThis.SuiteShare?.create({ host: $('rush-share'), game: 'turdrush' });
const format = value => Math.max(0, Math.floor(value)).toLocaleString('en-US');
let state = createRun(seed()), renderer = null, previousTime = 0, raf = 0;
let runId = null, recorded = false, overAt = 0, available = false, gesture = null, soundGeneration = 0;
let lastOrientation = globalThis.innerWidth > globalThis.innerHeight;
let feedback = '', feedbackUntil = 0, lastLesson = '', lastHud = '', result = null;
let best = readBest(), lastContrast = null, contrastReady = null;
let renderDirty = true, lastDrawTime = 0;

function seed() {
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; }
  catch { return Date.now(); }
}
function readBest() {
  try {
    const entries = globalThis.SuiteProgress?.snapshot().bests?.['turdrush|endless|standard'] || [];
    return Math.max(0, Number(entries.find(entry => entry.metric === 'score')?.value ?? entries[0]?.value) || 0);
  } catch { return 0; }
}
function announce(text) { suite?.announce?.(text); }
function showPanel(id) {
  for (const name of panels) {$(name).hidden = name !== id;}
  $('rush-lesson').hidden = !!id;
}
function sound(event) {
  const studio = { jump: 'ta.launch', slide: 'tris.hold', lane: 'tris.move', pick: 'ta.gold', shield: 'ta.power', magnet: 'ta.power', hit: 'ta.break', over: 'ta.death' };
  const classic = { jump: 'snap', slide: 'shuffle', lane: 'tick', pick: 'chip', shield: 'ding', magnet: 'ding', hit: 'snap', over: 'lose' };
  if (suite?.isStudioAudio?.()) { suite.playSound?.(studio[event] || 'shared.beep'); }
  else {
    const cueState = state, cueGeneration = soundGeneration;
    const allowOnResults = state.phase === 'over' && ['hit', 'over'].includes(event);
    suite?.audio?.().then(audio => {
      if (state !== cueState || cueGeneration !== soundGeneration || !available || document.hidden || $('rush-guide').open || (state.phase !== 'running' && !allowOnResults)) {return;}
      audio?.playPreset(classic[event] || 'tick');
    }).catch(() => {});
  }
}
function gates() {
  const running = available && state.phase === 'running';
  suite?.setSoundPaused?.(!available || state.phase === 'ready' || state.phase === 'paused' || $('rush-guide').open);
  suite?.setMusicGameBlocked?.(() => !available || state.phase !== 'running' || $('rush-guide').open);
  $('rush-pause').disabled = !running;
  for (const button of controls) {button.disabled = !running;}
  document.body.dataset.rushPhase = state.phase;
  renderDirty = true;
}
function muteLabel() {
  const muted = suite?.isMuted?.() || false;
  $('rush-mute').textContent = muted ? 'Sound off' : 'Sound on';
  $('rush-mute').setAttribute('aria-pressed', String(muted));
  $('rush-mute').setAttribute('aria-label', muted ? 'Sound off. Unmute game sounds' : 'Sound on. Mute game sounds');
}
function hud() {
  const highContrast = !!suite?.isColorblindMode?.();
  const ready = typeof suite?.setColorblindMode === 'function';
  if (ready !== contrastReady) { contrastReady = ready; $('rush-contrast').disabled = !ready; }
  if (highContrast !== lastContrast) {
    lastContrast = highContrast;
    if (renderer) { renderer.highContrast = highContrast; renderDirty = true; }
    $('rush-contrast').textContent = highContrast ? 'High contrast on' : 'High contrast off';
    $('rush-contrast').setAttribute('aria-pressed', String(highContrast));
  }
  const key = `${Math.floor(state.score)}:${Math.floor(state.distance)}:${state.picks}:${best}`;
  if (key !== lastHud) {
    lastHud = key;
    $('rush-score').textContent = format(state.score);
    $('rush-distance').replaceChildren(document.createTextNode(`${format(state.distance)} `));
    const units = document.createElement('small'); units.textContent = 'm'; $('rush-distance').append(units);
    $('rush-picks').textContent = format(state.picks);
    $('rush-best').textContent = best ? format(best) : '—';
  }
  const powers = [];
  if (state.player.shield > 0) {powers.push(`<span>SHIELD ${Math.ceil(state.player.shield)}s</span>`);}
  if (state.player.magnet > 0) {powers.push(`<span class="magnet">MAGNET ${Math.ceil(state.player.magnet)}s</span>`);}
  const powerText = powers.join('');
  if ($('rush-powers').innerHTML !== powerText) {$('rush-powers').innerHTML = powerText;}
  let lesson = '';
  if (state.phase === 'running') {
    if (state.elapsed < 2.8) {lesson = '←  Swipe left / right to dodge  →';}
    else if (state.elapsed < 5.5) {lesson = '↑  Jump high. Slide low.  ↓';}
    else if (state.elapsed < 8.0) {lesson = 'Golden picks = bonus points';}
    if (state.elapsed >= 8) {
      const upcoming = state.entities.filter(entity => ['crate', 'beam'].includes(entity.kind) && entity.at - state.distance > 6 && entity.at - state.distance < 55);
      const required = upcoming.find(entity => upcoming.filter(other => other.at === entity.at && other.kind === entity.kind).length === 3);
      if (required) {lesson = required.kind === 'crate' ? 'FULL ROW · JUMP ↑' : 'LOW PIPE · SLIDE ↓';}
    }
    if (feedback && state.elapsed < feedbackUntil) {lesson = feedback;}
  }
  if (lesson !== lastLesson) { lastLesson = lesson; $('rush-lesson').textContent = lesson; }
}
function consume(events) {
  for (const event of events) {
    if (event.type === 'pickup') {
      sound(event.kind);
      if (event.kind !== 'pick') {
        feedback = event.kind === 'shield' ? 'SHIELD ON · One crash covered' : 'MAGNET ON · Grab the good stuff';
        feedbackUntil = state.elapsed + 2.3;
      }
    } else if (event.type === 'shield') {
      feedback = 'CLOSE ONE! Shield used.'; feedbackUntil = state.elapsed + 2;
    } else if (event.type === 'over') {sound('over');}
    else if (event.type === 'hit') {sound('hit');}
    else if (['jump', 'slide', 'lane'].includes(event.type)) {sound(event.type);}
  }
}
function begin() {
  if (!available || !['ready', 'over', 'paused'].includes(state.phase)) {return;}
  if (state.phase === 'over' && globalThis.performance.now() - overAt < 550) {return;}
  soundGeneration++;
  state = createRun(seed());
  renderer.resetRun();
  startRun(state);
  runId = globalThis.SuiteProgress?.newRunId('turdrush') || null;
  recorded = false; result = null; previousTime = 0; gesture = null;
  feedback = ''; feedbackUntil = 0; lastLesson = ''; share?.setResult(null);
  showPanel(null); gates(); hud();
  // The SDK's capture-phase unlock sees the ready screen paused. Open/resume
  // the existing effects context now, inside this real Start gesture, after
  // running gates are set; do not sacrifice the player's first cue to unlock it.
  suite?.getSoundContext?.();
  $('rush-canvas').focus({ preventScroll: true });
  announce('Run started. Swipe left or right to dodge, up to jump, down to slide.');
}
function pause(reason = 'Your run is right where you left it.') {
  gesture = null;
  if (!available || state.phase !== 'running') {return;}
  soundGeneration++;
  pauseRun(state); previousTime = 0;
  $('rush-pause-reason').textContent = reason;
  showPanel('rush-paused'); gates(); announce('Run paused. Choose Keep running to resume.');
  if (!$('rush-guide').open && !document.hidden) {$('rush-resume').focus({ preventScroll: true });}
}
function resume() {
  if (!available || state.phase !== 'paused' || document.hidden || $('rush-guide').open) {return;}
  resumeRun(state); previousTime = 0; gesture = null;
  showPanel(null); gates(); $('rush-canvas').focus({ preventScroll: true });
}
function finish() {
  if (recorded || state.phase !== 'over') {return;}
  recorded = true; overAt = globalThis.performance.now();
  result = { id: runId, game: 'turdrush', kind: 'run', mode: 'endless', difficulty: 'standard',
    outcome: 'complete', completed: true, score: Math.floor(state.score),
    distance: Math.floor(state.distance), picks: Math.floor(state.picks), elapsedMs: Math.floor(state.elapsed * 1000) };
  let receipt;
  try { if (runId) {receipt = globalThis.SuiteProgress?.record(result);} } catch { /* Optional device storage. */ }
  const previousBest = best;
  best = Math.max(best, result.score, readBest());
  $('rush-result-kicker').textContent = result.score > previousBest ? 'NEW PERSONAL BEST' : 'THAT WAS A RUN.';
  const tips = { barrier: 'Speakers win the staring contest. Dodge left or right.', crate: 'Paperwork piled up. Jump crates or take the open lane.', beam: 'That pipe runs low. Slide under it or dodge.' };
  $('rush-result-reason').textContent = tips[state.reason] || 'Keep finding your flow. The next run is a fresh course.';
  $('rush-final-score').textContent = format(result.score);
  $('rush-final-distance').textContent = `${format(result.distance)} m`;
  $('rush-final-picks').textContent = format(result.picks);
  const goals = receipt?.newlyEarned?.map(goal => goal.title) || [];
  const notes = [goals.length ? `Goal earned: ${goals.join(' · ')}` : '', receipt?.improvement || '', receipt && !receipt.storageAvailable ? 'Progress could not be saved on this device.' : ''];
  $('rush-progress-result').textContent = notes.filter(Boolean).join(' ');
  $('rush-again').disabled = true; share?.setResult(result);
  showPanel('rush-results'); gates(); hud();
  announce(`Run finished. ${result.score} points, ${result.distance} metres and ${result.picks} picks.`);
}
function input(action) {
  if (!available || state.phase !== 'running' || $('rush-guide').open) {return;}
  const events = act(state, action); consume(events); hud();
}
function unavailable(message) {
  if (state.phase === 'running') {pauseRun(state);}
  soundGeneration++; available = false; gesture = null;
  $('rush-unavailable-text').textContent = message;
  showPanel('rush-unavailable'); gates();
  globalThis.SuiteLoading?.ready();
}
function resize() {
  const reserved = [...document.querySelectorAll('#suite-music-status,.stalemate-strip')]
    .filter(node => globalThis.getComputedStyle(node).position === 'fixed')
    .reduce((height, node) => Math.max(height, node.getBoundingClientRect().height), 0);
  if (reserved) {document.body.style.setProperty('--rush-music-inset', `${Math.ceil(reserved + 7)}px`);}
  const landscape = globalThis.innerWidth > globalThis.innerHeight;
  if (landscape !== lastOrientation) { lastOrientation = landscape; pause('Your screen turned. Tap Keep running when you are ready.'); }
  if (renderer?.resize()) {renderDirty = true;}
}
function frame(time) {
  raf = globalThis.requestAnimationFrame(frame);
  const dt = previousTime ? Math.max(0, (time - previousTime) / 1000) : 0;
  previousTime = time;
  if (!available) {return;}
  // Only active play consumes simulation time. A still pause/result or a
  // reduced-motion title needs no repeated GPU work while controls stay live.
  const wasRunning = state.phase === 'running';
  const events = wasRunning ? advance(state, Math.min(dt, 0.12)) : [];
  consume(events);
  if (state.phase === 'over') {
    finish();
    if ($('rush-again').disabled && time - overAt >= 550) { $('rush-again').disabled = false; $('rush-again').focus({ preventScroll: true }); }
  }
  const settingsChanged = contrastReady !== (typeof suite?.setColorblindMode === 'function') || lastContrast !== !!suite?.isColorblindMode?.();
  if (wasRunning || renderDirty || settingsChanged) {hud();}
  const preview = state.phase === 'ready' && !motion.matches && !$('rush-guide').open;
  if (wasRunning || renderDirty || (preview && time - lastDrawTime >= 1000 / 15)) {
    const visualDelta = wasRunning ? dt : preview ? Math.min(0.1, (time - lastDrawTime) / 1000) : 0;
    renderer.render(state, visualDelta, events);
    renderDirty = false; lastDrawTime = time;
  }
}

$('rush-start').addEventListener('click', begin);
$('rush-again').addEventListener('click', begin);
$('rush-restart-paused').addEventListener('click', begin);
$('rush-pause').addEventListener('click', () => pause());
$('rush-resume').addEventListener('click', resume);
$('rush-reload').addEventListener('click', () => globalThis.location.reload());
$('rush-contrast').addEventListener('click', () => { suite?.setColorblindMode?.(!suite.isColorblindMode()); hud(); });
$('rush-mute').addEventListener('click', () => { suite?.setMuted?.(!suite.isMuted()); muteLabel(); });
globalThis.addEventListener('suite:audiochange', muteLabel);
$('rush-help').addEventListener('click', () => {
  pause('How to play is open. Your run is waiting.'); $('rush-guide').showModal(); gates();
});
$('rush-close-help').addEventListener('click', () => $('rush-guide').close());
$('rush-guide').addEventListener('close', () => {
  gates();
  if (state.phase === 'paused') {$('rush-resume').focus({ preventScroll: true });}
  else {$('rush-help').focus({ preventScroll: true });}
});
$('rush-guide').addEventListener('keydown', event => event.stopPropagation());
const keys = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'jump', w: 'jump', ' ': 'jump', ArrowDown: 'slide', s: 'slide' };
globalThis.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey || $('rush-guide').open) {return;}
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.repeat) { if (state.phase === 'running' && (keys[key] || key === 'p' || key === 'Escape')) {event.preventDefault();} return; }
  if ((key === 'p' || key === 'Escape') && state.phase === 'running') { event.preventDefault(); pause(); return; }
  if (state.phase !== 'running' || !keys[key] || event.target.closest?.('button,a,input,select,textarea,summary')) {return;}
  event.preventDefault(); input(keys[key]);
});
for (const button of controls) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || button.disabled) {return;}
    event.preventDefault(); input(button.dataset.rushAction);
  });
  button.addEventListener('click', event => { if (event.detail === 0) {input(button.dataset.rushAction);} });
}
const canvas = $('rush-canvas');
canvas.addEventListener('pointerdown', event => {
  if (state.phase !== 'running' || gesture || event.button !== 0) {return;}
  event.preventDefault(); gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, consumed: false };
  canvas.setPointerCapture?.(event.pointerId);
});
function swipe(event) {
  if (!gesture || gesture.id !== event.pointerId || gesture.consumed || state.phase !== 'running') {return;}
  const x = event.clientX - gesture.x, y = event.clientY - gesture.y;
  if (Math.max(Math.abs(x), Math.abs(y)) < 18) {return;}
  if (Math.abs(x) > Math.abs(y) * 1.12) { input(x > 0 ? 'right' : 'left'); gesture.consumed = true; }
  else if (Math.abs(y) > Math.abs(x) * 1.12) { input(y > 0 ? 'slide' : 'jump'); gesture.consumed = true; }
}
canvas.addEventListener('pointermove', swipe);
canvas.addEventListener('pointerup', event => { swipe(event); if (gesture?.id === event.pointerId) {gesture = null;} });
canvas.addEventListener('pointercancel', () => { gesture = null; });
canvas.addEventListener('lostpointercapture', () => { gesture = null; });
globalThis.addEventListener('blur', () => pause('You stepped away. Tap Keep running when you are ready.'));
document.addEventListener('visibilitychange', () => { if (document.hidden) {pause('Welcome back. Tap Keep running when you are ready.');} });
globalThis.addEventListener('orientationchange', () => pause('Your screen turned. Tap Keep running when you are ready.'));
globalThis.addEventListener('resize', resize);
globalThis.visualViewport?.addEventListener('resize', resize);
motion.addEventListener('change', () => { if (renderer) { renderer.reducedMotion = motion.matches; renderDirty = true; } });
globalThis.addEventListener('pagehide', event => {
  pause(); suite?.stopSounds?.(); gesture = null;
  if (!event.persisted) { globalThis.cancelAnimationFrame(raf); renderer?.dispose(); }
});
suite?.setSoundSettingsPause?.(() => { pause('Sound settings are open. Your run is waiting.'); return null; });

try {
  renderer = new TurdRushRenderer(canvas, { reducedMotion: motion.matches, onLost: () => unavailable('The 3D view lost its connection to your device. Try again to start a fresh run. Your arcade records are safe.') });
  available = true; renderer.render(state); $('rush-start').disabled = false; $('rush-start').textContent = 'Let’s run →';
  const layoutObserver = new globalThis.ResizeObserver(resize);
  layoutObserver.observe($('rush-arena'));
  const watchFooter = () => { for (const node of document.querySelectorAll('#suite-music-status,.stalemate-strip')) {layoutObserver.observe(node);} resize(); };
  new globalThis.MutationObserver(watchFooter).observe(document.body, { childList: true });
  watchFooter();
  showPanel('rush-intro'); gates(); muteLabel(); hud();
  raf = globalThis.requestAnimationFrame(frame);
} catch {
  unavailable('This browser could not start the 3D game. Try another browser or return to the arcade. Your records are safe.');
}
globalThis.__turdrush = {
  get state() { return JSON.parse(JSON.stringify(state)); },
  get diagnostics() { return { available, reducedMotion: motion.matches, highContrast: renderer?.highContrast || false, drawCalls: renderer?.renderer.info.render.calls || 0, triangles: renderer?.renderer.info.render.triangles || 0, geometries: renderer?.renderer.info.memory.geometries || 0, renderedFrames: renderer?.renderedFrames || 0, pixelRatio: renderer?.pixelRatio || 0 }; }
};
globalThis.SuiteLoading?.ready();
