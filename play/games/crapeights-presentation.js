/* Crappy Eights: local, gesture-gated table sounds and compositor-only effects. */
(function () {
  'use strict';

  function soundAllowed({ unlocked, localEnabled, masterMuted, hidden }) {
    return !!unlocked && !!localEnabled && !masterMuted && !hidden;
  }

  function reduced(value) {
    if (typeof value === 'function') { return !!value(); }
    if (typeof value === 'boolean') { return value; }
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function effectPolicy(reducedMotion) {
    const quiet = reduced(reducedMotion);
    return {
      flightDuration: quiet ? 0 : 260,
      celebrationDuration: quiet ? 0 : 900,
      particleCount: quiet ? 0 : 18,
      maxFlights: 4
    };
  }

  function stored(key) {
    try { return globalThis.localStorage?.getItem(key); } catch { return null; }
  }

  // [frequency, delay, duration, volume, waveform, final frequency]
  const SCORES = {
    select: [[660, 0, 0.045, 0.045, 'sine', 790]],
    pass: [[320, 0, 0.075, 0.055, 'triangle', 230]],
    ui: [[540, 0, 0.05, 0.04, 'sine', 620]],
    deal: [[510, 0, 0.055, 0.11, 'triangle', 290]],
    play: [[380, 0, 0.07, 0.13, 'triangle', 175], [920, 0.025, 0.045, 0.045, 'sine']],
    draw: [[240, 0, 0.08, 0.095, 'triangle', 410]],
    wild: [[440, 0, 0.13, 0.09, 'sine'], [554.37, 0.045, 0.16, 0.085, 'sine'], [659.25, 0.09, 0.2, 0.09, 'triangle'], [880, 0.14, 0.24, 0.055, 'sine']],
    reverse: [[620, 0, 0.12, 0.07, 'triangle', 260], [260, 0.09, 0.14, 0.08, 'triangle', 620]],
    skip: [[740, 0, 0.075, 0.08, 'triangle'], [740, 0.11, 0.065, 0.06, 'triangle']],
    penalty: [[150, 0, 0.18, 0.075, 'sawtooth', 65], [92, 0.13, 0.12, 0.05, 'triangle', 54]],
    win: [[523.25, 0, 0.21, 0.09, 'triangle'], [659.25, 0.1, 0.23, 0.09, 'triangle'], [783.99, 0.2, 0.25, 0.09, 'triangle'], [1046.5, 0.32, 0.5, 0.1, 'sine'], [659.25, 0.32, 0.42, 0.045, 'sine'], [783.99, 0.32, 0.44, 0.045, 'sine']],
    lose: [[330, 0, 0.2, 0.07, 'triangle'], [277.18, 0.16, 0.23, 0.065, 'triangle'], [220, 0.33, 0.35, 0.065, 'sine']]
  };

  function createAudio({ readLocalEnabled = () => stored('crapeightsSoundOn_v1') !== '0' } = {}) {
    let unlocked = false;
    let context = null;
    let output = null;
    const voices = new Set();

    function allowed() {
      let localEnabled = false;
      try { localEnabled = readLocalEnabled(); } catch { /* Storage may be blocked. */ }
      return soundAllowed({
        unlocked,
        localEnabled,
        masterMuted: stored('turdsuite_muted') === '1' || !!globalThis.Suite?.isMuted?.(),
        hidden: !!globalThis.document?.hidden
      });
    }

    function syncMute() {
      const enabled = allowed();
      if (output && context) {
        output.gain.cancelScheduledValues(context.currentTime);
        output.gain.setValueAtTime(enabled ? 0.55 : 0, context.currentTime);
      }
      if (!enabled) {
        voices.forEach(voice => {
          try { voice.stop(); } catch { /* A completed source cannot be stopped twice. */ }
        });
      }
      return enabled;
    }

    function ensureContext() {
      if (!allowed()) { return null; }
      try {
        if (!context) {
          const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!AudioContext) { return null; }
          context = new AudioContext();
          output = context.createGain();
          output.gain.value = 0.55;
          output.connect(context.destination);
        }
        if (context.state === 'suspended') { context.resume()?.catch?.(() => {}); }
      } catch { return null; }
      return context;
    }

    function unlock() {
      // This method must be called by a pointer/keyboard handler, never at boot.
      unlocked = true;
      ensureContext();
      return syncMute();
    }

    function play(type) {
      if (!syncMute() || !SCORES[type]) { return false; }
      const audio = ensureContext();
      if (!audio) { return false; }
      const now = audio.currentTime + 0.008;
      SCORES[type].forEach(([frequency, delay, duration, volume, wave, end]) => {
        if (voices.size >= 32) { return; }
        try {
          const oscillator = audio.createOscillator();
          const envelope = audio.createGain();
          const start = now + delay;
          oscillator.type = wave;
          oscillator.frequency.setValueAtTime(frequency, start);
          if (end) { oscillator.frequency.exponentialRampToValueAtTime(end, start + duration); }
          envelope.gain.setValueAtTime(0.0001, start);
          envelope.gain.exponentialRampToValueAtTime(volume, start + 0.008);
          envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          oscillator.connect(envelope);
          envelope.connect(output);
          voices.add(oscillator);
          oscillator.onended = () => {
            voices.delete(oscillator);
            oscillator.disconnect();
            envelope.disconnect();
          };
          oscillator.start(start);
          oscillator.stop(start + duration + 0.02);
        } catch { /* Missing audio support must never interrupt a turn. */ }
      });
      return true;
    }

    globalThis.document?.addEventListener?.('visibilitychange', syncMute);
    globalThis.addEventListener?.('storage', syncMute);
    return { unlock, play, syncMute };
  }

  let layer = null;
  let motionQuery = null;
  const flights = new Set();
  const particles = new Set();

  function motionChanged(event) {
    if (event.matches) { clearEffects(); }
  }

  function effectsLayer() {
    const doc = globalThis.document;
    if (!doc?.body) { return null; }
    if (!layer || !layer.isConnected) {
      if (motionQuery?.removeEventListener) { motionQuery.removeEventListener('change', motionChanged); }
      else { motionQuery?.removeListener?.(motionChanged); }
      motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (motionQuery?.addEventListener) { motionQuery.addEventListener('change', motionChanged); }
      else { motionQuery?.addListener?.(motionChanged); }
      layer = doc.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.className = 'crapeights-effects';
      layer.style.cssText = 'position:fixed;inset:0;z-index:10030;overflow:hidden;pointer-events:none;contain:strict;';
      doc.body.appendChild(layer);
    }
    return layer;
  }

  function rectOf(source) {
    return source?.getBoundingClientRect ? source.getBoundingClientRect() : source;
  }

  function animateNode(node, frames, options, collection) {
    if (typeof node.animate !== 'function') { node.remove(); return false; }
    const animation = node.animate(frames, options);
    let done = false;
    const record = {
      cancel() {
        if (done) { return; }
        done = true;
        clearTimeout(timer);
        collection.delete(record);
        node.remove();
        animation.cancel();
      }
    };
    collection.add(record);
    animation.onfinish = record.cancel;
    animation.oncancel = record.cancel;
    const timer = setTimeout(record.cancel, options.duration + 150);
    return true;
  }

  function flyCard({ source, target, card, reducedMotion } = {}) {
    const policy = effectPolicy(reducedMotion);
    if (!policy.flightDuration) { return false; }
    const from = rectOf(source);
    const to = rectOf(target);
    if (!from || !to || !from.width || !to.width) { return false; }
    const overlay = effectsLayer();
    if (!overlay) { return false; }
    while (flights.size >= policy.maxFlights) { flights.values().next().value.cancel(); }
    const node = globalThis.document.createElement('div');
    const width = Math.max(32, Math.min(80, from.width));
    const height = width * 1.4;
    const isRed = card && (card.suit === 'H' || card.suit === 'D');
    node.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;box-sizing:border-box;border:2px solid #eadbab;border-radius:9px;box-shadow:0 7px 14px #0005;font:bold ${Math.round(width * 0.25)}px Georgia,serif;padding:6px;color:${isRed ? '#b53650' : '#243f38'};background:${card ? 'linear-gradient(145deg,#fffdf2,#e9e1cb)' : 'repeating-linear-gradient(45deg,#143f39 0 7px,#205c4d 7px 9px)'};will-change:transform,opacity;`;
    node.textContent = card ? `${card.rank}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit] || ''}` : '✦';
    if (!card) { node.style.color = '#e6c77e'; }
    overlay.appendChild(node);
    const startX = from.left + (from.width - width) / 2;
    const startY = from.top + (from.height - height) / 2;
    const endX = to.left + (to.width - width) / 2;
    const endY = to.top + (to.height - height) / 2;
    return animateNode(node, [
      { transform: `translate(${startX}px,${startY}px) rotate(-7deg) scale(.96)`, opacity: 0.85 },
      { transform: `translate(${(startX + endX) / 2}px,${(startY + endY) / 2 - 28}px) rotate(5deg) scale(1.06)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${endX}px,${endY}px) rotate(0deg) scale(1)`, opacity: 0.15 }
    ], { duration: policy.flightDuration, easing: 'cubic-bezier(.2,.65,.3,1)' }, flights);
  }

  function celebrate({ target, reducedMotion } = {}) {
    const policy = effectPolicy(reducedMotion);
    if (!policy.particleCount) { return false; }
    const overlay = effectsLayer();
    if (!overlay) { return false; }
    particles.forEach(particle => particle.cancel());
    const rect = rectOf(target) || { left: 0, top: 0, width: globalThis.innerWidth || 320, height: (globalThis.innerHeight || 600) * 0.65 };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const colors = ['#ffe5a0', '#6eddb0', '#fb8f88', '#b1bbff'];
    for (let i = 0; i < policy.particleCount; i++) {
      const node = globalThis.document.createElement('i');
      const angle = (i / policy.particleCount) * Math.PI * 2;
      const distance = 70 + (i % 4) * 24;
      node.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:7px;height:${i % 2 ? 10 : 7}px;border-radius:${i % 2 ? 2 : 50}%;background:${colors[i % colors.length]};will-change:transform,opacity;`;
      overlay.appendChild(node);
      animateNode(node, [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance + 65}px) rotate(${i * 47}deg)`, opacity: 0 }
      ], { duration: policy.celebrationDuration, easing: 'cubic-bezier(.15,.55,.4,1)' }, particles);
    }
    return true;
  }

  function clearEffects() {
    flights.forEach(flight => flight.cancel());
    particles.forEach(particle => particle.cancel());
  }

  globalThis.CrapeightsPresentation = { soundAllowed, effectPolicy, createAudio, flyCard, celebrate, clearEffects };
})();
