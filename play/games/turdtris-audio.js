/** Quiet synthesized arcade sounds and a gesture-gated, frame-driven music loop. */
const BASE_PROFILES = {
  move: { f: 220, dur: 0.023, wave: 'sine', vol: 0.012, slide: 45 },
  soft: { f: 150, dur: 0.025, wave: 'triangle', vol: 0.012, slide: -40 },
  rotate: { f: 560, dur: 0.05, wave: 'triangle', vol: 0.027, slide: 180 },
  hold: { f: 392, dur: 0.095, wave: 'sine', vol: 0.034, slide: 196 },
  drop: { f: 180, dur: 0.12, wave: 'triangle', vol: 0.065, slide: -135 },
  lock: { f: 130, dur: 0.075, wave: 'triangle', vol: 0.035, slide: -60 },
  clear: { f: 523.25, dur: 0.15, wave: 'triangle', vol: 0.04 },
  level: { f: 660, dur: 0.18, wave: 'triangle', vol: 0.045 },
  pause: { f: 310, dur: 0.08, wave: 'sine', vol: 0.03, slide: -80 },
  victory: { f: 784, dur: 0.22, wave: 'triangle', vol: 0.045 },
  gameover: { f: 196, dur: 0.22, wave: 'triangle', vol: 0.04, slide: -35 },
  heartbeat: { f: 65, dur: 0.09, wave: 'sine', vol: 0.027, slide: -22 }
};
const MUSIC_MELODY = [0, null, 7, 10, 12, null, 10, 7, 3, null, 7, 5, 3, null, 5, 7];
const CLEAR_STEPS = [[0, 7], [0, 4, 7], [0, 4, 7, 12], [0, 4, 7, 12, 16, 19]];

export function isSoundBlocked({ soundEnabled, suiteMuted }) {
  return !soundEnabled || !!suiteMuted;
}

export function musicTempoForLevel(level = 1) {
  const value = Number.isFinite(Number(level)) ? Math.max(1, Number(level)) : 1;
  return Math.min(144, 88 + (value - 1) * 3);
}

export function canPlayTurdtrisMusic({ armed, active, soundEnabled, suiteMuted, musicEnabled }) {
  return !!armed && !!active && !!musicEnabled && !isSoundBlocked({ soundEnabled, suiteMuted });
}

function playTone(ctx, profile, extras = {}) {
  const p = { ...profile, ...extras };
  const now = ctx.currentTime + (p.delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = p.wave;
  osc.frequency.setValueAtTime(p.f, now);
  if (p.slide) {
    osc.frequency.linearRampToValueAtTime(Math.max(20, p.f + p.slide), now + p.dur);
  }
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime?.(p.vol, now + 0.006);
  if (!gain.gain.linearRampToValueAtTime) {
    gain.gain.setValueAtTime(p.vol, now);
  }
  gain.gain.exponentialRampToValueAtTime(0.001, now + p.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  const voice = { osc, gain, end: now + p.dur + 0.025 };
  osc.onended = () => {
    osc.disconnect?.();
    gain.disconnect?.();
  };
  osc.start(now);
  osc.stop(voice.end);
  return voice;
}

/** Playback requires an already running context; the player adds gesture/mute gating. */
export function playTurdtrisSfx(ctx, type, opts = {}) {
  if (!ctx || ctx.state !== 'running') {return [];}
  const base = BASE_PROFILES[type] || BASE_PROFILES.lock;
  const voices = [];
  const tone = (profile, extras) => voices.push(playTone(ctx, profile, extras));
  const clearMatch = /^clear([1-4])$/.exec(type);
  const lines = Math.max(1, Math.min(4, Math.floor(Number(clearMatch?.[1] || opts.linesCleared) || 1)));
  if (type === 'clear' || clearMatch) {
    CLEAR_STEPS[lines - 1].forEach((semitone, index) => tone(BASE_PROFILES.clear, {
      f: BASE_PROFILES.clear.f * Math.pow(2, semitone / 12),
      delay: index * 0.045,
      dur: lines === 4 ? 0.24 : 0.14,
      vol: 0.025 + lines * 0.004
    }));
    return voices;
  }
  if (type === 'level' || type === 'victory') {
    [0, 4, 7, 12].forEach((semitone, index) => tone(base, {
      f: base.f * Math.pow(2, semitone / 12), delay: index * 0.075
    }));
  } else if (type === 'gameover') {
    [0, -3, -7, -12].forEach((semitone, index) => tone(base, {
      f: base.f * Math.pow(2, semitone / 12), delay: index * 0.11
    }));
  } else if (type === 'heartbeat') {
    tone(base);
    tone(base, { delay: 0.14, vol: 0.018, f: 54 });
  } else if (type === 'drop') {
    tone(base);
    tone(BASE_PROFILES.lock, { f: 65, delay: 0.035, dur: 0.15, vol: 0.04, slide: -30 });
  } else {
    tone(base);
  }
  return voices;
}

/**
 * arm() only from a trusted user gesture. update({active, level, danger}) from rAF;
 * active is false while paused, on the title screen and after game over.
 * stop() silences the loop immediately. No timers, samples or network requests.
 */
export function createTurdtrisAudioPlayer(deps) {
  const getCtx = deps.getContext;
  const getSoundEnabled = deps.getSoundEnabled;
  const getSuiteMuted = deps.getSuiteMuted || (() => false);
  const getMusicEnabled = deps.getMusicEnabled || (() => true);
  let armed = false;
  let musicVoices = [];
  let sfxVoices = [];
  let lastContext = null;
  let step = 0;
  let nextBeat = 0;
  let nextHeartbeat = 0;
  let activeLastUpdate = false;
  const lastEffects = new Map();

  function pruneVoices(voices, now) {
    let retained = 0;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].end > now) { voices[retained++] = voices[i]; }
    }
    voices.length = retained;
  }

  function silence(voices) {
    if (!lastContext) { voices.length = 0; return voices; }
    const now = lastContext.currentTime;
    for (let i = 0; i < voices.length; i++) {
      const { osc, gain, end } = voices[i];
      if (end <= now) {continue;}
      gain.gain.cancelScheduledValues?.(now);
      gain.gain.setValueAtTime(0.001, now);
      try {osc.stop(now + 0.005);} catch { /* Already ended on another audio quantum. */ }
    }
    voices.length = 0;
    return voices;
  }

  function stop() {
    musicVoices = silence(musicVoices);
    nextBeat = 0;
    nextHeartbeat = 0;
    step = 0;
    activeLastUpdate = false;
  }

  function soundBlocked() {
    if (!armed || !getSoundEnabled() || getSuiteMuted()) {
      stop();
      sfxVoices = silence(sfxVoices);
      return true;
    }
    return false;
  }

  return {
    arm() { armed = true; },
    stop,
    play(type, opts) {
      if (soundBlocked()) {return;}
      const ctx = getCtx();
      if (!ctx || ctx.state !== 'running') {return;}
      lastContext = ctx;
      // Repeated touch/key drops stay quiet, with bounded oscillator allocation.
      const minimumInterval = type === 'move' ? 0.038 : type === 'soft' ? 0.07 : 0;
      if (minimumInterval && ctx.currentTime - (lastEffects.get(type) ?? -1) < minimumInterval) {return;}
      lastEffects.set(type, ctx.currentTime);
      pruneVoices(sfxVoices, ctx.currentTime);
      if (sfxVoices.length < 32) {
        sfxVoices.push(...playTurdtrisSfx(ctx, type, opts));
      }
    },
    update({ active = false, level = 1, danger = false } = {}) {
      if (soundBlocked()) {return;}
      if (!active) {
        stop();
        return;
      }
      const ctx = getCtx();
      if (!ctx || ctx.state !== 'running') {
        stop();
        return;
      }
      lastContext = ctx;
      const now = ctx.currentTime;
      pruneVoices(musicVoices, now);
      pruneVoices(sfxVoices, now);
      if (danger && now >= nextHeartbeat) {
        musicVoices.push(...playTurdtrisSfx(ctx, 'heartbeat'));
        nextHeartbeat = now + 1.1;
      }
      if (!danger) {nextHeartbeat = 0;}
      if (!getMusicEnabled()) {
        // Heartbeats obey sound settings, independently of the music preference.
        if (activeLastUpdate) {musicVoices = silence(musicVoices);}
        activeLastUpdate = false;
        nextBeat = 0;
        return;
      }
      activeLastUpdate = true;
      if (now < nextBeat) {return;}
      // Advance one step only: a stalled/background tab never causes a catch-up burst.
      nextBeat = now + 30 / musicTempoForLevel(level);
      const note = MUSIC_MELODY[step % MUSIC_MELODY.length];
      if (note !== null) {
        musicVoices.push(playTone(ctx, { f: 261.63 * Math.pow(2, note / 12), dur: 0.15, wave: 'sine', vol: 0.011 }));
      }
      if (step % 4 === 0) {
        const bass = step % 16 < 8 ? 65.41 : 77.78;
        musicVoices.push(playTone(ctx, { f: bass, dur: 0.23, wave: 'triangle', vol: 0.016 }));
      }
      if (step % 2 === 1) {
        musicVoices.push(playTone(ctx, { f: 880, dur: 0.028, wave: 'triangle', vol: 0.003, slide: -440 }));
      }
      step = (step + 1) % MUSIC_MELODY.length;
    }
  };
}
