/** WebAudio SFX for Crapjack — honours per-game mute + turdsuite_muted. */

export const SFX_PROFILES = {
  chip: { f: 420, dur: 0.06, wave: 'triangle', vol: 0.035 },
  deal: { f: 560, dur: 0.08, wave: 'square', vol: 0.04 },
  hit: { f: 480, dur: 0.06, wave: 'triangle', vol: 0.04 },
  stand: { f: 320, dur: 0.06, wave: 'triangle', vol: 0.035 },
  split: { f: 700, dur: 0.08, wave: 'triangle', vol: 0.045 },
  double: { f: 780, dur: 0.09, wave: 'sawtooth', vol: 0.045 },
  surrender: { f: 190, dur: 0.1, wave: 'sawtooth', vol: 0.045 },
  shuffle: { f: 260, dur: 0.12, wave: 'square', vol: 0.04 },
  win: { f: 920, dur: 0.14, wave: 'triangle', vol: 0.05 },
  lose: { f: 150, dur: 0.16, wave: 'sawtooth', vol: 0.05 },
  push: { f: 360, dur: 0.08, wave: 'triangle', vol: 0.035 },
  blackjack: { f: 1060, dur: 0.2, wave: 'triangle', vol: 0.06 },
  bust: { f: 130, dur: 0.14, wave: 'sawtooth', vol: 0.05 },
  drumroll: { f: 88, dur: 0.55, wave: 'square', vol: 0.028 },
  fanfare: { f: 880, dur: 0.22, wave: 'triangle', vol: 0.055 }
};

/**
 * @param {object} opts
 * @param {() => boolean} opts.getSoundEnabled turdjackSoundOn_v1
 * @param {() => boolean} [opts.getSuiteMuted] turdsuite_muted
 */
export function createTurdjackAudio(opts) {
  const getSoundEnabled = opts.getSoundEnabled;
  const getSuiteMuted = opts.getSuiteMuted || (() => false);
  let audioCtx = null;

  function ensureAudio() {
    if (audioCtx) {return audioCtx;}
    const Ctx = typeof globalThis.AudioContext === 'function' ? globalThis.AudioContext : null;
    if (!Ctx) {return null;}
    try {
      audioCtx = new Ctx();
    } catch {
      audioCtx = null;
    }
    return audioCtx;
  }

  function unlock() {
    if (!getSoundEnabled() || getSuiteMuted()) {return;}
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function shouldPlay() {
    return getSoundEnabled() && !getSuiteMuted();
  }

  function tone(ctx, profile, time, freqMul = 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = profile.wave;
    osc.frequency.setValueAtTime(profile.f * freqMul, time);
    gain.gain.setValueAtTime(profile.vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + profile.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + profile.dur);
  }

  function play(type) {
    if (!shouldPlay()) {return;}
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== 'running') {return;}
    const p = SFX_PROFILES[type] || SFX_PROFILES.chip;
    const now = ctx.currentTime;
    try {
      if (type === 'blackjack') {
        tone(ctx, p, now, 1);
        tone(ctx, { ...p, dur: 0.16, vol: p.vol * 0.85 }, now + 0.1, 1.32);
        tone(ctx, { ...p, dur: 0.18, vol: p.vol * 0.7 }, now + 0.2, 1.58);
        return;
      }
      if (type === 'win') {
        tone(ctx, p, now, 1);
        tone(ctx, { ...p, dur: 0.1, vol: p.vol * 0.75 }, now + 0.08, 1.25);
        return;
      }
      if (type === 'chip') {
        tone(ctx, p, now, 1);
        tone(ctx, { ...p, dur: 0.04, vol: p.vol * 0.6 }, now + 0.03, 1.45);
        return;
      }
      if (type === 'drumroll') {
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          tone(ctx, p, now + i * 0.08, 1 + i * 0.04);
        }
        return;
      }
      if (type === 'fanfare') {
        tone(ctx, p, now, 1);
        tone(ctx, { ...p, dur: 0.18, vol: p.vol * 0.8 }, now + 0.12, 1.35);
        tone(ctx, { ...p, dur: 0.2, vol: p.vol * 0.65 }, now + 0.22, 1.62);
        return;
      }
      tone(ctx, p, now, 1);
    } catch {
      /* ignore */
    }
  }

  return { play, unlock, ensureAudio, shouldPlay };
}
