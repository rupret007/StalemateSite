/* WebAudio pitch helpers — combo ladder matches TurdAnoid.html sfx.combo. */
(function attachTurdanoidAudio(root) {
  'use strict';

  function comboHitFrequency(comboHits, baseHz = 440, stepHz = 30) {
    const hits = Math.max(0, Math.floor(comboHits || 0));
    return baseHz + hits * stepHz;
  }

  function brickBreakFrequency(level, comboHits = 0) {
    const lv = Math.max(1, Math.floor(level || 1));
    return 300 + lv * 8 + comboHitFrequency(comboHits, 0, 12);
  }

  const SFX_PROFILES = {
    wall: { freq: 320, dur: 0.035, type: 'square', vol: 0.04, slide: 60 },
    paddle: { freq: 480, dur: 0.05, type: 'triangle', vol: 0.05, slide: 120 },
    metal: { freq: 880, dur: 0.07, type: 'square', vol: 0.05, slide: -120 },
    gold: { freq: 1046, dur: 0.1, type: 'triangle', vol: 0.06, slide: 40 },
    power: { freq: 660, dur: 0.08, type: 'triangle', vol: 0.07, slide: 0 },
    clear: { freq: 523, dur: 0.14, type: 'triangle', vol: 0.07, slide: 80 },
    lifeLost: { freq: 200, dur: 0.2, type: 'sawtooth', vol: 0.06, slide: -60 },
    gameOver: { freq: 140, dur: 0.35, type: 'sawtooth', vol: 0.07, slide: -40 }
  };

  function sfxProfile(name) {
    return SFX_PROFILES[name] || SFX_PROFILES.paddle;
  }

  root.TurdanoidAudio = {
    comboHitFrequency,
    brickBreakFrequency,
    SFX_PROFILES,
    sfxProfile
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
