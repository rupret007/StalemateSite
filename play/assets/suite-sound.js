/** Original, sample-free percussion for the optional studio effects profile.
 * No melodies, recordings, network requests or third-party sound assets.
 * Shared with the live player and the offline audition renderer.
 */
const tone = (f, end, dur, amp, delay = 0, wave = 'sine') => ({ kind: 'tone', f, end, dur, amp, delay, wave });
const noise = (f, dur, amp, delay = 0, q = 0.7) => ({ kind: 'noise', f, dur, amp, delay, q });
export const STUDIO_CUES = Object.freeze({
  soft: { group: 'touch', gap: .045, voices: [noise(2300, .022, .055), tone(370, 300, .027, .04)] },
  tap: { group: 'touch', gap: .045, voices: [noise(2500, .026, .08), tone(410, 330, .032, .05)] },
  card: { group: 'card', gap: .035, voices: [noise(3600, .045, .11), tone(230, 170, .038, .045)] },
  chip: { group: 'chip', gap: .04, voices: [tone(1180, 1050, .045, .07, 0, 'triangle'), noise(4700, .018, .055)] },
  piece: { group: 'piece', gap: .05, voices: [tone(185, 120, .065, .15), noise(1500, .025, .075)] },
  capture: { group: 'piece', gap: .06, voices: [tone(125, 76, .11, .18), noise(2300, .05, .12)] },
  paddle: { group: 'impact', gap: .035, voices: [tone(340, 190, .055, .13), noise(1700, .02, .065)] },
  wall: { group: 'wall', gap: .035, voices: [tone(510, 350, .032, .075), noise(2900, .014, .04)] },
  brick: { group: 'impact', gap: .025, voices: [tone(290, 160, .06, .12, 0, 'triangle'), noise(2100, .045, .11)] },
  break: { group: 'impact', gap: .035, voices: [noise(1450, .075, .15), tone(130, 72, .095, .15)] },
  metal: { group: 'impact', gap: .045, voices: [tone(830, 760, .07, .07, 0, 'triangle'), noise(3200, .025, .055)] },
  drop: { group: 'drop', gap: .055, voices: [tone(110, 48, .15, .23), noise(820, .065, .12)] },
  lock: { group: 'lock', gap: .04, voices: [tone(155, 88, .065, .12), noise(1600, .025, .065)] },
  rotate: { group: 'touch', gap: .055, voices: [noise(2900, .035, .07), tone(440, 350, .035, .04)] },
  shuffle: { group: 'card', gap: .15, voices: [noise(2900, .055, .08), noise(3800, .05, .065, .045), noise(2400, .04, .05, .085)] },
  swipe: { group: 'touch', gap: .075, voices: [noise(1800, .08, .09), tone(220, 160, .05, .045)] },
  pop: { group: 'pop', gap: .03, voices: [tone(480, 190, .055, .13), noise(2200, .02, .055)] },
  accent: { group: 'accent', gap: .1, priority: 1, voices: [tone(330, 330, .12, .07, 0, 'triangle'), tone(495, 495, .1, .045, .015), noise(3300, .03, .04)] },
  clear: { group: 'clear', gap: .15, priority: 1, voices: [noise(1800, .11, .11), tone(220, 220, .16, .095), tone(330, 330, .12, .065, .02)] },
  power: { group: 'accent', gap: .18, priority: 1, voices: [tone(165, 220, .15, .095, 0, 'triangle'), tone(330, 440, .13, .05, .025), noise(3000, .035, .04)] },
  success: { group: 'result', gap: .24, priority: 2, voices: [tone(220, 220, .19, .1, 0, 'triangle'), tone(330, 330, .16, .065, .018), noise(2400, .055, .065)] },
  milestone: { group: 'result', gap: .28, priority: 3, voices: [tone(220, 220, .24, .1, 0, 'triangle'), tone(330, 330, .21, .065, .025), tone(440, 440, .17, .04, .045), noise(2200, .07, .07)] },
  failure: { group: 'result', gap: .2, priority: 2, voices: [tone(100, 70, .12, .16), noise(650, .065, .085)] },
  invalid: { group: 'invalid', gap: .18, voices: [tone(170, 130, .06, .07), noise(900, .025, .04)] },
  neutral: { group: 'result', gap: .18, priority: 1, voices: [tone(190, 180, .075, .085), noise(1600, .03, .045)] },
  warning: { group: 'warning', gap: .8, voices: [tone(78, 60, .085, .085), noise(700, .025, .035)] },
  laser: { group: 'laser', gap: .055, voices: [noise(4200, .04, .065), tone(720, 320, .055, .055)] },
  pause: { group: 'touch', gap: .12, voices: [tone(260, 230, .05, .06), noise(1400, .02, .04)] }
});

const banks = {
  shared: { beep: 'tap', ding: 'accent', buzz: 'invalid', fart: 'failure', win: 'success' },
  ta: { hit: 'paddle', brick: 'brick', break: 'break', power: 'power', bad: 'failure', life: 'milestone', death: 'failure', win: 'success', laser: 'laser', combo: 'accent', launch: 'piece', bounce: 'wall', metal: 'metal', gold: 'chip', flushWarp: 'power', chord: 'milestone' },
  tris: { move: 'soft', soft: 'soft', rotate: 'rotate', hold: 'swipe', drop: 'drop', lock: 'lock', clear: 'clear', clear1: 'clear', clear2: 'clear', clear3: 'clear', clear4: 'milestone', level: 'accent', pause: 'pause', victory: 'success', gameover: 'failure', heartbeat: 'warning' },
  jack: { chip: 'chip', card: 'card', deal: 'card', hit: 'card', stand: 'piece', twentyOne: 'accent', split: 'accent', double: 'accent', surrender: 'failure', shuffle: 'shuffle', win: 'success', lose: 'failure', push: 'neutral', blackjack: 'milestone', bust: 'failure', drumroll: 'shuffle', fanfare: 'milestone' },
  eights: { select: 'soft', pass: 'neutral', ui: 'tap', deal: 'card', play: 'card', draw: 'shuffle', wild: 'accent', reverse: 'swipe', skip: 'piece', penalty: 'failure', win: 'success', lose: 'failure' },
  rummy: { select: 'soft', drawStock: 'card', drawDiscard: 'card', discard: 'card', invalid: 'invalid', deal: 'shuffle', aiMove: 'card', knock: 'piece', gin: 'milestone', undercut: 'accent', roundWin: 'success', roundLose: 'failure', matchWin: 'milestone', matchLose: 'failure', layoff: 'card', tick: 'soft' },
  spades: { card: 'card', trump: 'capture', trick: 'accent', broken: 'power', bid: 'soft', lock: 'piece', nil: 'neutral', bag: 'failure', win: 'milestone', lose: 'failure' },
  mania: { shuffle: 'shuffle', invalid: 'invalid', tick: 'invalid', blip: 'pop', ding: 'accent', snap: 'swipe', win: 'success', lose: 'failure', card: 'piece', chip: 'chip' },
  chess: { move: 'piece', capture: 'capture', check: 'accent', win: 'success', lose: 'failure', draw: 'neutral' }
};
export const STUDIO_EVENTS = Object.freeze(Object.fromEntries(Object.entries(banks).flatMap(([bank, entries]) => Object.entries(entries).map(([event, cue]) => [`${bank}.${event}`, cue]))));
export function resolveStudioCue(event, options = {}) {
  if (event === 'tris.clear' && Number(options.linesCleared) >= 4) return 'milestone';
  return STUDIO_EVENTS[event] || null;
}

const noiseBuffers = new WeakMap();
function noiseBuffer(context) {
  if (noiseBuffers.has(context)) return noiseBuffers.get(context);
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .3), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x52ad314f;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

/** The exact renderer used by the live scene and the listening sampler. */
export function scheduleStudioCue(context, destination, name, when, options = {}, observe = () => {}) {
  const cue = STUDIO_CUES[name];
  if (!cue || !context || !destination) return [];
  const pitch = 1 + Math.max(0, Math.min(8, Number(options.strength) || 0)) * .012;
  return cue.voices.map(part => {
    const start = when + part.delay;
    const source = part.kind === 'noise' ? context.createBufferSource() : context.createOscillator();
    const gain = context.createGain();
    let filter = null;
    if (part.kind === 'noise') {
      source.buffer = noiseBuffer(context);
      filter = context.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = part.f; filter.Q.value = part.q;
      source.connect(filter).connect(gain);
    } else {
      source.type = part.wave;
      source.frequency.setValueAtTime(part.f * pitch, start);
      source.frequency.exponentialRampToValueAtTime(part.end * pitch, start + part.dur);
      source.connect(gain);
    }
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(part.amp, start + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, start + part.dur);
    gain.connect(destination);
    const voice = { source, gain, filter, start, group: cue.group, end: start + part.dur + .012 };
    source.onended = () => {
      source.disconnect(); gain.disconnect(); filter?.disconnect();
      observe(voice, 'ended');
    };
    observe(voice, 'started');
    source.start(start); source.stop(voice.end);
    return voice;
  });
}

export function createStudioOutput(context, destination = context.destination) {
  const limiter = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 2 - 1) * .8;
  limiter.curve = curve;
  limiter.oversample = '2x';
  const master = context.createGain();
  master.gain.value = 0;
  limiter.connect(master).connect(destination);
  return { input: limiter, master, disconnect() { limiter.disconnect(); master.disconnect(); } };
}

export function createStudioAudio(deps) {
  const voices = new Set();
  const recent = new Map();
  const counts = { accepted: 0, dropped: 0, peakVoices: 0 };
  let context = null, output = null, lastEvent = '', unavailable = false;
  const level = () => Math.max(0, Math.min(1, Number(deps.getVolume?.() ?? .65) || 0));
  const allowed = () => {
    try { return !deps.isMuted?.() && (deps.canPlay?.() ?? true) && level() > 0; } catch { return false; }
  };
  function stop() {
    recent.clear();
    if (!context) return;
    const now = context.currentTime;
    if (output) {
      output.master.gain.cancelScheduledValues(now);
      output.master.gain.setTargetAtTime(0, now, .003);
    }
    for (const voice of voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(.0001, now, .002);
        voice.source.stop(now + (context.state === 'running' ? .008 : 0));
      } catch { /* Already ended. */ }
    }
  }
  function sync() {
    if (!allowed()) { stop(); return false; }
    if (context && output) {
      output.master.gain.cancelScheduledValues(context.currentTime);
      output.master.gain.setTargetAtTime(level(), context.currentTime, .008);
    }
    return true;
  }
  function playEvent(event, options = {}) {
    const name = resolveStudioCue(event, options);
    if (!name || !allowed()) { counts.dropped++; return false; }
    let audio;
    try { audio = deps.getContext(); } catch { unavailable = true; counts.dropped++; return false; }
    if (!audio) { unavailable = true; counts.dropped++; return false; }
    if (audio.state !== 'running') { counts.dropped++; return false; }
    if (context && audio !== context) { stop(); output?.disconnect(); }
    if (audio !== context) {
      try { output = createStudioOutput(audio); context = audio; unavailable = false; }
      catch { unavailable = true; counts.dropped++; return false; }
    }
    const cue = STUDIO_CUES[name], now = context.currentTime;
    const prior = recent.get(cue.group);
    if (prior && now - prior.at < cue.gap && (cue.priority || 0) <= prior.priority) { counts.dropped++; return false; }
    // Four slots are reserved for a meaningful result during a collision burst.
    const cap = (cue.priority || 0) >= 2 ? 16 : 12;
    if (voices.size + cue.voices.length > cap) { counts.dropped++; return false; }
    if (prior && now - prior.at < cue.gap && (cue.priority || 0) > prior.priority) {
      for (const voice of voices) {
        if (voice.group !== cue.group) continue;
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setTargetAtTime(.0001, now, .002);
          voice.source.stop(voice.start > now ? now : now + .008);
        } catch { /* Already ended. */ }
      }
    }
    recent.set(cue.group, { at: now, priority: cue.priority || 0 });
    sync();
    scheduleStudioCue(context, output.input, name, now + .004, options, (voice, state) => {
      if (state === 'ended') voices.delete(voice); else voices.add(voice);
      counts.peakVoices = Math.max(counts.peakVoices, voices.size);
    });
    lastEvent = event; counts.accepted++; return true;
  }
  return {
    playEvent,
    playPreset(name) { return playEvent(`mania.${name}`); },
    playTone() { return playEvent('shared.beep'); },
    stop, sync,
    getState() { return { profile: 'studio', volume: level(), allowed: allowed(), unavailable, activeVoices: voices.size, maxVoices: 16, lastEvent, ...counts }; }
  };
}
