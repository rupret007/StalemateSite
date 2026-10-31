/* TurdRummy SFX bank.
   Classic script: attaches TurdRummyAudio on globalThis so turdrummy.html can
   use it from a plain <script> tag. games/turdrummy-audio.js re-exports this
   API for unit tests (see games/table-continue-core.js for the same split).

   Sound is opt-out (default on) and stored under its own key, matching the
   independent per-game sound flags already used by turdjack/crapeights/turdtris
   (turdjackSoundOn_v1, crapeightsSoundOn_v1, turdtrisSoundOn_v1) rather than the
   shared turdsuite_muted flag. Both gates now apply to every bank cue. */
(function attachTurdRummyAudio(root) {
  'use strict';

  const SOUND_KEY = 'turdrummySoundOn_v1';

  // [frequency, duration seconds, oscillator type, peak gain] per note; a
  // multi-note array plays as a quick arpeggio (deal riffle, gin fanfare).
  const SFX_TABLE = {
    select: [[520, 0.05, 'triangle', 0.035]],
    drawStock: [[360, 0.07, 'square', 0.04]],
    drawDiscard: [[460, 0.08, 'triangle', 0.045]],
    discard: [[300, 0.07, 'triangle', 0.04]],
    invalid: [[160, 0.12, 'sawtooth', 0.05]],
    deal: [[392, 0.05, 'triangle', 0.03], [494, 0.05, 'triangle', 0.03], [587, 0.06, 'triangle', 0.035]],
    aiMove: [[260, 0.05, 'triangle', 0.025]],
    knock: [[440, 0.1, 'square', 0.05], [330, 0.14, 'square', 0.05]],
    gin: [[523, 0.1, 'triangle', 0.055], [659, 0.1, 'triangle', 0.055], [784, 0.14, 'triangle', 0.06]],
    undercut: [[220, 0.14, 'sawtooth', 0.055], [180, 0.18, 'sawtooth', 0.05]],
    roundWin: [[523, 0.12, 'triangle', 0.05], [659, 0.16, 'triangle', 0.055]],
    roundLose: [[220, 0.16, 'sawtooth', 0.045], [160, 0.2, 'sawtooth', 0.045]],
    matchWin: [[523, 0.12, 'triangle', 0.06], [659, 0.12, 'triangle', 0.06], [784, 0.12, 'triangle', 0.06], [1046, 0.2, 'triangle', 0.065]],
    matchLose: [[260, 0.18, 'sawtooth', 0.05], [220, 0.18, 'sawtooth', 0.05], [160, 0.26, 'sawtooth', 0.05]],
    layoff: [[610, 0.05, 'triangle', 0.035], [740, 0.06, 'triangle', 0.035]],
    tick: [[1200, 0.02, 'square', 0.012]]
  };

  /** @returns {Array<Array>|null} the note list for a known SFX name, or null. */
  function getSfxSpec(name) {
    return SFX_TABLE[name] || null;
  }

  function loadSoundPref(storage) {
    try {
      const raw = (storage || root.localStorage).getItem(SOUND_KEY);
      return raw === null ? true : raw !== '0';
    } catch {
      return true;
    }
  }

  function saveSoundPref(storage, enabled) {
    try {
      (storage || root.localStorage).setItem(SOUND_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  /**
   * Build a lazily-initialized WebAudio player. The AudioContext is created
   * on first use only, so nothing plays before a real user gesture.
   */
  function createPlayer(storage, deps = {}) {
    let enabled = loadSoundPref(storage);
    let ctx = null;
    let unlocked = false;
    const voices = new Set();
    const isMuted = deps.isMuted || (() => {
      try {
        if (typeof root.Suite?.isMuted === 'function') {return !!root.Suite.isMuted();}
        return (storage || root.localStorage)?.getItem('turdsuite_muted') === '1';
      } catch { return false; }
    });
    const isHidden = deps.isHidden || (() => !!root.document?.hidden);
    function allowed() { try { return enabled && !isMuted() && !isHidden(); } catch { return false; } }
    function stop() {
      if (!ctx) {return;}
      const now = ctx.currentTime;
      for (const voice of voices) {
        try {
          voice.gain.gain.cancelScheduledValues?.(now);
          if (voice.gain.gain.setTargetAtTime) {voice.gain.gain.setTargetAtTime(.0001, now, .002);}
          else {voice.gain.gain.setValueAtTime?.(.0001, now);}
          voice.osc.stop(now + .008);
        } catch { /* Already ended. */ }
      }
    }
    function sync() { if (!allowed()) {stop();} }
    root.addEventListener?.('suite:audiochange', sync);
    root.document?.addEventListener?.('visibilitychange', sync);
    root.addEventListener?.('pagehide', stop);

    function ensureCtx() {
      if (ctx) {
        return ctx;
      }
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) {
        return null;
      }
      try {
        ctx = new Ctx();
      } catch {
        ctx = null;
      }
      return ctx;
    }

    return {
      isEnabled() {
        return enabled;
      },
      setEnabled(next) {
        enabled = !!next;
        saveSoundPref(storage, enabled);
        sync();
        root.Suite?.syncSoundState?.();
      },
      unlock() {
        unlocked = true;
        if (!allowed() || root.Suite?.isStudioAudio?.()) {return;}
        const audioCtx = ensureCtx();
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      },
      play(name) {
        if (!unlocked || !allowed()) {
          sync();
          return;
        }
        const notes = getSfxSpec(name);
        if (!notes) {
          return;
        }
        if (root.Suite?.isStudioAudio?.()) {return root.Suite.playSound('rummy.' + name);}
        if (voices.size + notes.length > 32) {return;}
        const audioCtx = ensureCtx();
        if (!audioCtx || audioCtx.state !== 'running') {
          return;
        }
        let when = audioCtx.currentTime;
        for (const [freq, dur, type, vol] of notes) {
          try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, when);
            gain.gain.setValueAtTime(vol, when);
            gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            const voice = { osc, gain };
            voices.add(voice);
            osc.onended = () => { voices.delete(voice); osc.disconnect?.(); gain.disconnect?.(); };
            osc.start(when);
            osc.stop(when + dur);
          } catch {
            /* ignore */
          }
          when += dur * 0.82;
        }
      },
      stop,
      dispose() {
        stop();
        root.removeEventListener?.('suite:audiochange', sync);
        root.document?.removeEventListener?.('visibilitychange', sync);
        root.removeEventListener?.('pagehide', stop);
      }
    };
  }

  root.TurdRummyAudio = {
    SOUND_KEY,
    SFX_TABLE,
    getSfxSpec,
    loadSoundPref,
    saveSoundPref,
    createPlayer
  };
})(typeof window !== 'undefined' ? window : globalThis);
