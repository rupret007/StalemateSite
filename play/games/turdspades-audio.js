/**
 * TurdSpades WebAudio SFX — honors turdsuite_muted, no autoplay before gesture.
 */

const MUTE_KEY = 'turdsuite_muted';

export function readSuiteMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function createTurdspadesAudio(options = {}) {
  const isMuted = options.isMuted || readSuiteMuted;
  let ctx = null;
  let unlocked = false;

  function ensureContext() {
    if (isMuted()) {
      return null;
    }
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) {
        return null;
      }
      ctx = new AC();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, duration, type = 'triangle', volume = 0.06, detune = 0) {
    if (isMuted()) {
      return;
    }
    const audio = ensureContext();
    if (!audio || !unlocked) {
      return;
    }
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) {
      osc.detune.setValueAtTime(detune, t0);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noise(duration, volume = 0.04) {
    if (isMuted()) {
      return;
    }
    const audio = ensureContext();
    if (!audio || !unlocked) {
      return;
    }
    const t0 = audio.currentTime;
    const bufferSize = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = audio.createBufferSource();
    src.buffer = buffer;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(gain);
    gain.connect(audio.destination);
    src.start(t0);
  }

  return {
    unlockFromGesture() {
      unlocked = true;
      ensureContext();
    },
    isMuted,
    playCardPlay(card) {
      const trump = card?.suit === 'S';
      tone(trump ? 220 : 340, trump ? 0.09 : 0.06, trump ? 'square' : 'triangle', trump ? 0.07 : 0.05, trump ? -80 : 0);
      if (trump) {
        noise(0.04, 0.025);
      }
    },
    playTrickWin() {
      tone(520, 0.08, 'sine', 0.06);
      tone(780, 0.1, 'sine', 0.05, 120);
    },
    playSpadesBroken() {
      tone(180, 0.14, 'sawtooth', 0.06, -200);
      tone(360, 0.12, 'square', 0.05, 100);
    },
    playBidTick() {
      tone(640, 0.04, 'triangle', 0.04);
    },
    playBidLock(nil) {
      if (nil) {
        tone(300, 0.1, 'sine', 0.06);
        tone(240, 0.12, 'sine', 0.05, -40);
      } else {
        tone(440, 0.07, 'triangle', 0.06);
        tone(660, 0.09, 'triangle', 0.04, 80);
      }
    },
    playBagPenalty() {
      tone(120, 0.18, 'sawtooth', 0.07);
      tone(90, 0.22, 'square', 0.06, -50);
    },
    playMatchFanfare(won) {
      if (won) {
        tone(523, 0.12, 'sine', 0.06);
        tone(659, 0.12, 'sine', 0.05);
        tone(784, 0.16, 'sine', 0.05);
      } else {
        tone(220, 0.2, 'triangle', 0.05);
      }
    }
  };
}
