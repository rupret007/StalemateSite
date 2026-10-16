/**
 * Shared WebAudio synth presets — honours turdsuite_muted via injected getters.
 *
 * API (via Suite.audio() promise):
 *   audio.playPreset('snap'|'chip'|'shuffle'|'win'|'lose'|'tick'|'card'|'blip'|'ding')
 *   audio.playTone(freq, dur, type, vol, slide)
 *   audio.masterVolume — 0..1
 */

export const MUTE_STORAGE_KEY = 'turdsuite_muted';

export const AUDIO_PRESETS = {
  blip: { freq: 660, dur: 0.06, type: 'triangle', vol: 0.05 },
  ding: { freq: 880, dur: 0.1, type: 'triangle', vol: 0.06 },
  tick: { freq: 1200, dur: 0.04, type: 'sine', vol: 0.035, slide: -200 },
  chip: { freq: 520, dur: 0.06, type: 'square', vol: 0.045, slide: 120, kind: 'chip' },
  snap: { freq: 280, dur: 0.05, type: 'triangle', vol: 0.05, slide: -60, kind: 'snap' },
  card: { freq: 320, dur: 0.07, type: 'sine', vol: 0.045, slide: -40, kind: 'card' },
  shuffle: { freq: 180, dur: 0.22, type: 'sawtooth', vol: 0.04, kind: 'shuffle' },
  win: { freq: 523, dur: 0.16, type: 'triangle', vol: 0.07, kind: 'win' },
  lose: { freq: 180, dur: 0.28, type: 'sawtooth', vol: 0.06, slide: -120, kind: 'lose' }
};

/** @deprecated alias */
export const PRESET_ALIASES = { fanfare: 'win', wah: 'lose' };

/**
 * @param {{ isMuted: () => boolean, getContext: () => AudioContext | null, masterVolume?: number }} deps
 */
export function createSuiteAudio(deps) {
  const master = Math.max(0, Math.min(1, deps.masterVolume ?? 1));

  function playTone(freq, dur, type, vol, slide) {
    if (deps.isMuted()) return;
    const a = deps.getContext();
    if (!a) return;
    try {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || 'triangle';
      o.frequency.value = freq;
      if (slide) {
        o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
      }
      const v = (vol || 0.05) * master;
      g.gain.setValueAtTime(v, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch {
      /* ignore */
    }
  }

  function playNoiseBurst(dur, vol) {
    if (deps.isMuted()) return;
    const a = deps.getContext();
    if (!a) return;
    try {
      const bufferSize = Math.max(1, Math.floor(a.sampleRate * dur));
      const buffer = a.createBuffer(1, bufferSize, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = a.createBufferSource();
      src.buffer = buffer;
      const g = a.createGain();
      const v = (vol || 0.03) * master;
      g.gain.setValueAtTime(v, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      const filter = a.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.6;
      src.connect(filter).connect(g).connect(a.destination);
      src.start();
      src.stop(a.currentTime + dur);
    } catch {
      /* ignore */
    }
  }

  function playChipClack() {
    playTone(680, 0.04, 'square', 0.035, -80);
    setTimeout(() => playTone(420, 0.05, 'triangle', 0.03, 40), 18);
  }

  function playCardSnap() {
    playTone(240, 0.04, 'triangle', 0.04, -30);
    setTimeout(() => playNoiseBurst(0.025, 0.02), 8);
  }

  function playShuffle() {
    playNoiseBurst(0.12, 0.028);
    [140, 165, 190, 210].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.05, 'sawtooth', 0.022, 30), i * 42);
    });
  }

  function playWinFanfare() {
    [523, 659, 784, 988, 1046].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.18, 'triangle', 0.065, i === 4 ? 40 : 0), i * 95);
    });
  }

  function playLoseWah() {
    playTone(220, 0.35, 'sawtooth', 0.055, -140);
    setTimeout(() => playTone(160, 0.25, 'triangle', 0.04, -60), 120);
  }

  return {
    masterVolume: master,
    playPreset(name) {
      const key = PRESET_ALIASES[name] || name;
      const p = AUDIO_PRESETS[key];
      if (!p) return;
      if (p.kind === 'chip') {
        playChipClack();
        return;
      }
      if (p.kind === 'snap' || key === 'card') {
        playCardSnap();
        return;
      }
      if (p.kind === 'shuffle') {
        playShuffle();
        return;
      }
      if (p.kind === 'win') {
        playWinFanfare();
        return;
      }
      if (p.kind === 'lose') {
        playLoseWah();
        return;
      }
      playTone(p.freq, p.dur, p.type, p.vol, p.slide);
      if (key === 'ding') {
        setTimeout(() => playTone(990, 0.1, 'triangle', 0.05 * master), 60);
      }
    },
    playTone
  };
}

export function shouldPlaySound(isMuted) {
  return !isMuted;
}

export function resolvePresetName(name) {
  return PRESET_ALIASES[name] || name;
}
