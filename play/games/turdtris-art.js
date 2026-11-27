/** Cached procedural art. Rendering never changes the board or scoring. */
const TAU = Math.PI * 2;
const SPRITE_SIZE = 64;
const PIECES = Object.freeze({
  I: '#72dbff', J: '#7f9dff', L: '#ffb274', O: '#ffe181',
  S: '#83f7ae', Z: '#ff8f99', T: '#d6a2ff', G: '#6f5d4f'
});
const PIECE_NAMES = Object.freeze(Object.keys(PIECES));
const PIECE_LOOKUP = Object.create(null);
for (const name of PIECE_NAMES) {
  PIECE_LOOKUP[name] = name;
  PIECE_LOOKUP[PIECES[name]] = name;
  PIECE_LOOKUP[PIECES[name].toUpperCase()] = name;
}
Object.freeze(PIECE_LOOKUP);
const EMPTY_OPTIONS = Object.freeze({});
const EMPTY_CELLS = Object.freeze([]);
const THEMES = Object.freeze([
  Object.freeze({ id: 'bathroom', name: 'Porcelain Palace', accent: '#8ff4e5', ink: '#071d26', index: 0 }),
  Object.freeze({ id: 'sewer', name: 'Midnight Sewer', accent: '#9ef58b', ink: '#101c16', index: 1 }),
  Object.freeze({ id: 'lagoon', name: 'Biolume Lagoon', accent: '#62e8ff', ink: '#0a182b', index: 2 }),
  Object.freeze({ id: 'space', name: 'Cosmic Commode', accent: '#dfa5ff', ink: '#130e28', index: 3 })
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function motionIsReduced(value) {
  return value === true || value?.matches === true;
}

/** Four legible chapters, each lasting four levels; space stays at level 13+. */
export function themeForLevel(level = 1) {
  return THEMES[Math.min(3, Math.floor((Math.max(1, Number(level) || 1) - 1) / 4))];
}

/** All moving effects have a single, testable accessibility policy. */
export function effectPolicy(reducedMotion = false) {
  const moving = !motionIsReduced(reducedMotion);
  return {
    ambient: moving, shimmer: moving, spawn: moving, squash: moving,
    trail: moving, dust: moving, flush: moving, takeover: moving,
    flash: moving, dangerPulse: moving, particleLimit: moving ? 72 : 0
  };
}

/** Normalized progress makes animation independent of the display frame rate. */
export function effectEnvelope(kind, progress, reducedMotion = false) {
  return writeEffectEnvelope(kind, progress, reducedMotion, {});
}

// The public helper returns independent values; the renderer reuses its scratch
// envelopes so hundreds of settled tiles do not create garbage every frame.
function writeEffectEnvelope(kind, progress, reducedMotion, out) {
  const p = clamp(progress);
  const moving = !motionIsReduced(reducedMotion);
  out.alpha = 1; out.scaleX = 1; out.scaleY = 1; out.rotation = 0; out.offsetY = 0;
  if (p === 1 && (kind === 'spawn' || kind === 'lock')) { return out; }
  if (kind === 'spawn' && moving) {
    const scale = 1 - 0.24 * Math.pow(1 - p, 2) + Math.sin(p * Math.PI) * 0.1;
    out.scaleX = out.scaleY = scale;
  } else if (kind === 'lock' && moving) {
    const squash = Math.sin(p * Math.PI) * Math.pow(1 - p, 0.5) * 0.15;
    out.scaleX = 1 + squash * 0.7;
    out.scaleY = 1 - squash;
    out.offsetY = squash * 0.5;
  } else if (kind === 'flush') {
    out.alpha = 1 - p;
    if (moving) {
      out.scaleX = out.scaleY = Math.max(0.02, 1 - p * p);
      out.rotation = p * p * TAU;
      out.offsetY = p * p * 0.7;
    }
  } else if (kind === 'trail' || kind === 'dust') {
    out.alpha = moving ? (1 - p) * (1 - p) : 0;
  } else if (kind === 'takeover') {
    out.alpha = Math.min(1, p * 10, (1 - p) * 6);
    if (moving) {
      out.scaleX = out.scaleY = 0.86 + Math.min(1, p * 5) * 0.14;
    }
  }
  return out;
}

function roundPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function shade(color, amount) {
  const raw = color.replace('#', '');
  const rgb = [0, 2, 4].map((i) => clamp(parseInt(raw.slice(i, i + 2), 16) + amount, 0, 255));
  return `rgb(${rgb.join(',')})`;
}

function resolvePiece(value) {
  return PIECE_LOOKUP[value] || PIECE_LOOKUP[String(value).toLowerCase()] || 'G';
}

function drawFace(ctx, name) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#102830';
  ctx.fillStyle = '#102830';
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.86;
  const eye = (x, y, wink) => {
    if (wink) {
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.quadraticCurveTo(x, y + 2.6, x + 4, y);
      ctx.stroke();
    } else {
      ctx.fillRect(x - 2.1, y - 3.4, 4.2, 6.6);
    }
  };
  if (name === 'O') {
    eye(23, 31); eye(41, 31);
    ctx.beginPath(); ctx.arc(32, 43, 3.2, 0, TAU); ctx.stroke();
  } else if (name === 'I') {
    eye(23, 32); eye(41, 32);
    ctx.beginPath(); ctx.moveTo(26, 43); ctx.lineTo(38, 43); ctx.stroke();
  } else if (name === 'J') {
    ctx.beginPath(); ctx.moveTo(19, 27); ctx.quadraticCurveTo(24, 24, 29, 28); ctx.stroke();
    eye(23, 33); eye(41, 32);
    ctx.beginPath(); ctx.moveTo(26, 43); ctx.quadraticCurveTo(33, 47, 40, 41); ctx.stroke();
  } else if (name === 'T') {
    eye(23, 32, true); eye(41, 32);
    ctx.beginPath(); ctx.moveTo(26, 43); ctx.quadraticCurveTo(32, 46, 39, 42); ctx.stroke();
  } else if (name === 'Z') {
    eye(23, 32); eye(41, 32, true);
    ctx.beginPath(); ctx.moveTo(25, 42); ctx.lineTo(32, 45); ctx.lineTo(40, 41); ctx.stroke();
  } else if (name === 'S') {
    eye(23, 33, true); eye(41, 33, true);
    ctx.beginPath(); ctx.moveTo(26, 44); ctx.quadraticCurveTo(32, 40, 39, 44); ctx.stroke();
  } else {
    eye(23, 31); eye(41, 31);
    ctx.beginPath(); ctx.moveTo(25, 41); ctx.quadraticCurveTo(32, 48, 41, 41); ctx.stroke();
  }
  ctx.restore();
}

// A small value mark in the upper panel. It stays off the foot and the ring,
// so locked, active and ghost still separate by structure at 8 CSS pixels.
function paintMaterialMark(ctx, name) {
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#1a100c';
  ctx.strokeStyle = '#fff8ee';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  if (name === 'I') {
    ctx.fillRect(30, 15, 3, 16);
  } else if (name === 'O') {
    ctx.beginPath(); ctx.arc(32, 24, 5.5, 0, TAU); ctx.stroke();
  } else if (name === 'T') {
    ctx.fillRect(22, 15, 20, 2.6);
    ctx.fillRect(30.5, 15, 3, 10);
  } else if (name === 'J') {
    ctx.fillRect(20, 15, 4, 12);
  } else if (name === 'L') {
    ctx.fillRect(40, 15, 4, 12);
  } else if (name === 'S' || name === 'Z') {
    ctx.beginPath();
    ctx.moveTo(22, 16); ctx.lineTo(42, 16); ctx.lineTo(42, 21); ctx.lineTo(22, 27); ctx.lineTo(22, 22);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Three cached variants tell piece states apart by structure, not hue, so
// they still separate under any colour-vision deficiency and at 8 CSS pixels:
//   ghost   - dark hollow: almost no fill, dashed colour, long light corner ticks
//   settled - solid enamel with a heavy dark foot and no bright outline
//   active  - the same slab plus a thick light ring, and no dark foot
function paintSprite(ctx, name, variant) {
  const color = PIECES[name];
  ctx.lineJoin = 'round';
  if (variant === 'ghost') {
    roundPath(ctx, 4, 4, 56, 56, 10);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.04; ctx.fill();
    // The hollow frame is most of the cell. Thick strokes survive an 8px blit.
    ctx.globalAlpha = 0.94; ctx.strokeStyle = '#02121a'; ctx.lineWidth = 10; ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.setLineDash([8, 5]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,252,246,0.98)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, 28); ctx.lineTo(10, 10); ctx.lineTo(28, 10);
    ctx.moveTo(36, 10); ctx.lineTo(54, 10); ctx.lineTo(54, 28);
    ctx.moveTo(54, 36); ctx.lineTo(54, 54); ctx.lineTo(36, 54);
    ctx.moveTo(28, 54); ctx.lineTo(10, 54); ctx.lineTo(10, 36);
    ctx.stroke();
    ctx.lineCap = 'butt';
    return;
  }
  const active = variant === 'active';
  ctx.fillStyle = '#140e0c';
  roundPath(ctx, 1, 2, 62, 62, 12); ctx.fill();
  const body = ctx.createLinearGradient(6, 4, 40, 60);
  body.addColorStop(0, shade(color, active ? 28 : 12));
  body.addColorStop(0.58, color);
  body.addColorStop(1, shade(color, -68));
  ctx.fillStyle = body;
  roundPath(ctx, 3, 2, 58, 58, 11); ctx.fill();
  // One flat enamel panel. The old glass blob is gone; value does the work.
  const panel = ctx.createLinearGradient(10, 10, 10, 48);
  panel.addColorStop(0, 'rgba(255,248,236,0.3)');
  panel.addColorStop(0.2, 'rgba(255,248,236,0.04)');
  panel.addColorStop(1, 'rgba(20,10,8,0.16)');
  ctx.fillStyle = panel;
  roundPath(ctx, 11, 11, 42, 36, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,248,236,0.62)';
  ctx.fillRect(14, 13, 26, 3);
  ctx.strokeStyle = '#1a100c';
  ctx.lineWidth = active ? 4 : 5;
  roundPath(ctx, 3, 2, 58, 58, 11); ctx.stroke();
  if (active) {
    roundPath(ctx, 6, 5, 52, 52, 10);
    ctx.strokeStyle = 'rgba(255,252,246,0.98)'; ctx.lineWidth = 8; ctx.stroke();
    roundPath(ctx, 13, 12, 38, 38, 7);
    ctx.strokeStyle = 'rgba(12,8,6,0.9)'; ctx.lineWidth = 3; ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(8,6,4,0.66)';
    roundPath(ctx, 5, 46, 54, 14, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,220,0.22)';
    ctx.fillRect(12, 47, 22, 2);
  }
  if (name === 'G') {
    ctx.strokeStyle = '#2a241c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, 16); ctx.lineTo(30, 30); ctx.lineTo(22, 46);
    ctx.moveTo(30, 30); ctx.lineTo(46, 34); ctx.stroke();
  } else {
    paintMaterialMark(ctx, name);
    drawFace(ctx, name);
  }
}

function drawToilet(ctx, x, y, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 64, size / 64);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  roundPath(ctx, 34, 3, 22, 27, 4); ctx.stroke();
  roundPath(ctx, 7, 28, 46, 11, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(10, 40); ctx.quadraticCurveTo(17, 54, 32, 52);
  ctx.lineTo(30, 61); ctx.lineTo(50, 61); ctx.lineTo(44, 41); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(46, 12); ctx.lineTo(52, 12); ctx.stroke();
  ctx.restore();
}

function paintLagoonJelly(ctx, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  const glow = ctx.createRadialGradient(0, 4, 4, 0, 4, 66);
  glow.addColorStop(0, '#5ec7c744'); glow.addColorStop(1, '#5ec7c700');
  ctx.fillStyle = glow; ctx.fillRect(-66, -62, 132, 132);
  ctx.beginPath(); ctx.moveTo(-37, 9);
  ctx.bezierCurveTo(-35, -32, 34, -39, 38, 9);
  ctx.bezierCurveTo(25, 24, -24, 24, -37, 9); ctx.closePath();
  const cap = ctx.createLinearGradient(0, -24, 0, 18);
  cap.addColorStop(0, '#407c97'); cap.addColorStop(1, '#195164');
  ctx.fillStyle = cap; ctx.fill();
  ctx.strokeStyle = '#60aec1'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#5ba6aa'; ctx.lineWidth = 1.6;
  for (const offset of [-22, -11, 0, 11, 22]) {
    ctx.beginPath(); ctx.moveTo(offset, 16);
    ctx.bezierCurveTo(offset - 16, 36, offset + 15, 49, offset - 6, 67 + Math.abs(offset / 3));
    ctx.stroke();
  }
  for (const [dx, dy] of [[-18, 6], [-7, -4], [6, -5], [19, 1], [27, 8]]) circle(ctx, dx, dy, 2, '#83c6c7');
  ctx.restore();
}

function paintSewerValve(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = '#263827'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(0, 0, 27, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#aa7d49'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = '#715e3e'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-23, 0); ctx.lineTo(23, 0);
  ctx.moveTo(0, -23); ctx.lineTo(0, 23); ctx.stroke();
  circle(ctx, 0, 0, 7, '#ac905f'); circle(ctx, 0, 0, 3, '#493f2b');
  ctx.restore();
}

function paintBackground(ctx, theme) {
  const width = 320, height = 640;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.ink); bg.addColorStop(1, '#030c13');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  // Each room keeps its focal shapes in the outer columns and the top and
  // bottom margins. The centre, where pieces fall, stays the dim tray.
  if (theme.id === 'bathroom') {
    ctx.fillStyle = '#102830';
    roundPath(ctx, 6, 36, 52, 168, 8); ctx.fill();
    ctx.fillStyle = '#183848';
    roundPath(ctx, 12, 48, 40, 64, 4); ctx.fill();
    roundPath(ctx, 12, 122, 40, 66, 4); ctx.fill();
    ctx.fillStyle = '#d7ebe4';
    roundPath(ctx, 16, 56, 10, 22, 3); ctx.fill();
    roundPath(ctx, 32, 62, 8, 16, 3); ctx.fill();
    ctx.fillStyle = '#8eaea6';
    ctx.fillRect(29, 96, 7, 7);
    ctx.fillRect(29, 148, 7, 7);
    ctx.fillStyle = '#0c242c';
    roundPath(ctx, 262, 40, 50, 40, 5); ctx.fill();
    ctx.fillStyle = '#16343c';
    ctx.beginPath(); ctx.ellipse(286, 118, 26, 18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0e2830';
    ctx.beginPath(); ctx.ellipse(286, 114, 13, 8, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c5ddd6'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(286, 104, 22, 9, 0, Math.PI, TAU); ctx.stroke();
    ctx.fillStyle = '#efe4d0';
    roundPath(ctx, 8, 548, 46, 22, 3); ctx.fill();
    ctx.fillStyle = '#d9c8ae';
    ctx.fillRect(12, 554, 38, 3); ctx.fillRect(12, 562, 38, 3);
    ctx.fillStyle = '#c4b496';
    roundPath(ctx, 8, 568, 46, 12, 3); ctx.fill();
    ctx.fillStyle = '#6e5434';
    ctx.fillRect(268, 520, 6, 70);
    ctx.fillStyle = '#8eaea6';
    ctx.beginPath(); ctx.ellipse(271, 592, 16, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#16343c';
    ctx.beginPath(); ctx.ellipse(271, 592, 8, 5, 0, 0, TAU); ctx.fill();
  } else if (theme.id === 'sewer') {
    ctx.fillStyle = '#101610';
    ctx.fillRect(0, 0, width, 26);
    ctx.fillStyle = '#141c16';
    ctx.fillRect(0, 0, 40, height);
    ctx.fillRect(width - 40, 0, 40, height);
    for (let y = 26; y < height; y += 22) {
      ctx.fillStyle = y % 44 ? '#1e2a22' : '#28342c';
      ctx.fillRect(0, y, 40, 16);
      ctx.fillRect(width - 40, y, 40, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, y + 14, 40, 4);
      ctx.fillRect(width - 40, y + 14, 40, 4);
    }
    paintSewerValve(ctx, 20, 188);
    paintSewerValve(ctx, 300, 456);
    ctx.fillStyle = '#c4b48a';
    for (const [x, y] of [[6, 96], [6, 320], [308, 140], [308, 560]]) ctx.fillRect(x, y, 6, 6);
    ctx.fillStyle = '#101610';
    ctx.fillRect(0, 604, width, 36);
  } else if (theme.id === 'lagoon') {
    ctx.fillStyle = '#0c2030';
    ctx.beginPath();
    ctx.moveTo(248, 0); ctx.quadraticCurveTo(286, 48, 320, 16);
    ctx.lineTo(320, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#163848';
    ctx.beginPath(); ctx.ellipse(292, 34, 20, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a1824';
    ctx.beginPath(); ctx.ellipse(298, 32, 9, 6, 0, 0, TAU); ctx.fill();
    for (const [top, spread, alpha] of [[16, 14, 0.08], [304, 14, 0.07]]) {
      const shaft = ctx.createLinearGradient(0, 0, 0, 360);
      shaft.addColorStop(0, `rgba(186,220,214,${alpha})`); shaft.addColorStop(1, 'rgba(186,220,214,0)');
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(top - 5, 0); ctx.lineTo(top + 5, 0);
      ctx.lineTo(top + spread, 360); ctx.lineTo(top - spread, 360); ctx.closePath(); ctx.fill();
    }
    paintLagoonJelly(ctx, 28, 156, 0.78);
    paintLagoonJelly(ctx, 294, 348, 0.52);
    ctx.strokeStyle = '#1c4450'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const x of [14, 36, 284, 306]) {
      const lean = x < 160 ? 12 : -12;
      ctx.beginPath(); ctx.moveTo(x, 640); ctx.quadraticCurveTo(x + lean, 604, x, 572); ctx.stroke();
      circle(ctx, x, 570, 4, '#3a8890');
    }
    ctx.fillStyle = '#0c2834';
    ctx.beginPath();
    ctx.moveTo(0, 612); ctx.lineTo(0, 640); ctx.lineTo(108, 640);
    ctx.bezierCurveTo(70, 590, 24, 624, 0, 612); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(320, 608); ctx.lineTo(320, 640); ctx.lineTo(212, 640);
    ctx.bezierCurveTo(260, 586, 300, 620, 320, 608); ctx.fill();
  } else {
    for (let i = 0; i < 18; i++) {
      const x = (i * 97 + 20) % width, y = (i * 131 + 24) % height;
      if (x > 56 && x < 264 && y > 36 && y < 584) continue;
      circle(ctx, x, y, i % 3 === 0 ? 2.4 : 1.3, i % 2 ? '#6a5c86' : '#d8cce8');
    }
    const planet = ctx.createRadialGradient(268, 70, 5, 276, 92, 52);
    planet.addColorStop(0, '#7a6e98'); planet.addColorStop(1, '#161228');
    circle(ctx, 276, 88, 44, planet);
    ctx.strokeStyle = '#241c40'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.ellipse(276, 90, 68, 11, -0.42, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ddd0f0'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(276, 90, 76, 15, -0.42, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#d4c6e4'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(26, 500, 16, Math.PI * 1.08, Math.PI * 1.95); ctx.stroke();
    ctx.fillStyle = '#d4c6e4';
    ctx.fillRect(24, 500, 4, 26);
    ctx.fillRect(16, 524, 20, 3);
    ctx.globalAlpha = 0.9; drawToilet(ctx, 6, 548, 50, '#e4d8f4'); ctx.globalAlpha = 1;
  }
  // Center dimming preserves stack/ghost contrast while the scene edges show.
  const veil = ctx.createLinearGradient(0, 0, width, 0);
  veil.addColorStop(0, 'rgba(2,8,14,0.1)'); veil.addColorStop(0.3, 'rgba(2,8,14,0.5)');
  veil.addColorStop(0.7, 'rgba(2,8,14,0.5)'); veil.addColorStop(1, 'rgba(2,8,14,0.1)');
  ctx.fillStyle = veil; ctx.fillRect(0, 0, width, height);
  // Recessed cell wells: each 32px slot (one board cell after scaling) gets a
  // shaded floor and a faint lit lip, so the playfield reads as a tray with
  // depth instead of a flat painting behind thin lines.
  for (let y = 0; y < height; y += 32) {
    for (let x = 0; x < width; x += 32) {
      ctx.fillStyle = 'rgba(0,8,14,0.14)'; ctx.fillRect(x + 2, y + 2, 28, 28);
      ctx.fillStyle = 'rgba(0,4,8,0.14)'; ctx.fillRect(x + 2, y + 2, 28, 3);
      ctx.fillStyle = 'rgba(255,236,210,0.06)'; ctx.fillRect(x + 2, y + 28.5, 28, 1.5);
    }
  }
  // Solid (never dashed) grid lines: a dark groove plus a pale hairline,
  // thick enough to survive the 0.375x rival-board downscale.
  ctx.beginPath();
  for (let x = 32; x < width; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let y = 32; y < height; y += 32) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.strokeStyle = 'rgba(0,6,12,0.5)'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,236,210,0.16)'; ctx.lineWidth = 1; ctx.stroke();
  // Side walls frame the tray at the board edges.
  ctx.fillStyle = 'rgba(255,236,210,0.08)'; ctx.fillRect(0, 0, 1.5, height); ctx.fillRect(width - 1.5, 0, 1.5, height);
  // Sewer drain is a persistent destination for the row-flush animation.
  ctx.strokeStyle = theme.accent; ctx.globalAlpha = 0.2; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(160, 630, 34, 8, 0, 0, TAU); ctx.stroke();
  for (let x = 138; x <= 182; x += 11) { ctx.beginPath(); ctx.moveTo(x, 625); ctx.lineTo(x, 635); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

/** Factory injection keeps rendering testable without a browser or canvas package. */
export function createTurdtrisArt(canvasFactory = () => document.createElement('canvas')) {
  const sprites = Object.create(null), ghosts = Object.create(null), trails = Object.create(null);
  const backgrounds = [];
  const tileEnvelope = {}, flushEnvelope = {}, takeoverEnvelope = {};

  function makeCanvas(width, height, paint) {
    const canvas = canvasFactory(); canvas.width = width; canvas.height = height;
    paint(canvas.getContext('2d'));
    return canvas;
  }

  // Fixed resolution assets are warmed once. Resizing only changes drawImage
  // destination sizes; a scene change or the first hard drop never rasterizes art.
  for (const name of PIECE_NAMES) {
    // Pair the solid states on one canvas at native resolution.
    sprites[name] = makeCanvas(2 * SPRITE_SIZE, SPRITE_SIZE, (ctx) => {
      ctx.save();
      paintSprite(ctx, name, 'settled');
      ctx.restore();
      ctx.translate(SPRITE_SIZE, 0);
      paintSprite(ctx, name, 'active');
    });
    ghosts[name] = makeCanvas(SPRITE_SIZE, SPRITE_SIZE, (ctx) => paintSprite(ctx, name, 'ghost'));
    trails[name] = makeCanvas(8, 256, (ctx) => {
      const streak = ctx.createLinearGradient(0, 0, 0, 256);
      streak.addColorStop(0, 'rgba(255,255,255,0)');
      streak.addColorStop(0.72, PIECES[name]); streak.addColorStop(1, '#edffff');
      ctx.fillStyle = streak; ctx.fillRect(0, 0, 8, 256);
    });
  }
  for (const theme of THEMES) {
    backgrounds[theme.index] = makeCanvas(320, 640, (ctx) => paintBackground(ctx, theme));
  }
  const dangerVignette = makeCanvas(320, 640, (ctx) => {
    const glow = ctx.createLinearGradient(0, 0, 0, 320);
    glow.addColorStop(0, '#ff555a'); glow.addColorStop(1, 'rgba(255,40,55,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 320, 320);
  });

  function drawTile(ctx, x, y, size, colorOrName, alpha = 1, opts = EMPTY_OPTIONS) {
    if (!ctx || size < 2 || alpha <= 0) { return; }
    const name = resolvePiece(colorOrName);
    const moving = !motionIsReduced(opts.reducedMotion);
    const envelope = opts.spawnProgress !== undefined
      ? writeEffectEnvelope('spawn', opts.spawnProgress, opts.reducedMotion, tileEnvelope)
      : writeEffectEnvelope('lock', opts.lockProgress ?? 1, opts.reducedMotion, tileEnvelope);
    ctx.save(); ctx.globalAlpha *= clamp(alpha);
    ctx.translate(x + size / 2, y + size / 2 + envelope.offsetY * size);
    ctx.scale(envelope.scaleX, envelope.scaleY);
    if (opts.ghost) {
      ctx.drawImage(ghosts[name], -size / 2, -size / 2, size, size);
    } else {
      const active = opts.active || opts.spawnProgress !== undefined;
      const sourceX = active ? SPRITE_SIZE : 0;
      ctx.drawImage(sprites[name], sourceX, 0, SPRITE_SIZE, SPRITE_SIZE, -size / 2, -size / 2, size, size);
    }
    if (opts.ghost && moving) {
      const p = (((Number(opts.time) || 0) + y * 8) % 1600) / 1600;
      ctx.globalAlpha *= Math.sin(p * Math.PI) * 0.32;
      ctx.fillStyle = '#e5ffff';
      ctx.fillRect(-size * 0.34, size * (p * 0.7 - 0.35), size * 0.68, 1.5);
    } else if (opts.flash > 0 && moving) {
      ctx.globalAlpha *= clamp(opts.flash) * 0.38;
      ctx.fillStyle = '#e5fff7'; roundPath(ctx, -size / 2 + 2, -size / 2 + 2, size - 4, size - 4, size / 6); ctx.fill();
    }
    ctx.restore();
  }

  function drawBackground(ctx, { level = 1, time = 0, danger = 0, reducedMotion = false, width = 320, height = 640 } = EMPTY_OPTIONS) {
    const theme = themeForLevel(level), moving = !motionIsReduced(reducedMotion);
    ctx.drawImage(backgrounds[theme.index], 0, 0, width, height);
    if (moving) {
      const count = Math.min(14, 5 + Math.floor(level / 2));
      const speed = 0.008 + Math.min(20, level) * 0.0004 + clamp(danger) * 0.006;
      ctx.save(); ctx.strokeStyle = theme.accent; ctx.fillStyle = theme.accent; ctx.lineWidth = 1;
      for (let i = 0; i < count; i++) {
        const x = ((i * 97 + 17) % 320) / 320 * width;
        const y = height - ((time * speed + i * 73) % (height + 20));
        ctx.globalAlpha = 0.075 + Math.sin(i + time / 2300) * 0.035;
        ctx.beginPath(); ctx.arc(x + Math.sin(time / 1600 + i) * 4, y, 2 + i % 4, 0, TAU);
        if (theme.id === 'space') { ctx.fill(); } else { ctx.stroke(); }
      }
      ctx.restore();
    }
    if (danger > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(danger) * (moving ? 0.14 + Math.sin(time / 480) * 0.065 : 0.14);
      ctx.drawImage(dangerVignette, 0, 0, width, height); ctx.restore();
    }
    return theme;
  }

  function drawDropTrail(ctx, { cells = EMPTY_CELLS, distance = 0, size = 32, color = 'I', progress = 0, reducedMotion = false } = EMPTY_OPTIONS) {
    const p = clamp(progress), alpha = (1 - p) * (1 - p);
    if (motionIsReduced(reducedMotion) || !alpha || distance <= 0) { return; }
    ctx.save(); ctx.globalAlpha = alpha * 0.55;
    const name = resolvePiece(color), hue = PIECES[name], trail = trails[name];
    const height = Math.min(distance, 640);
    for (let i = 0; i < Math.min(4, cells.length); i++) {
      const cell = cells[i], x = cell.x, y = cell.y;
      // Crop the cached gradient to preserve the original tail's color stops.
      ctx.drawImage(trail, 0, 0, 8, 256 * (height + size * 0.9) / (height + size),
        x + size * 0.15, y - height, size * 0.7, height + size * 0.9);
      ctx.fillStyle = '#e7ffff'; ctx.globalAlpha *= 0.7;
      ctx.fillRect(x + size * 0.46, y - height * 0.72, size * 0.08, height * 0.72 + size);
      ctx.globalAlpha = alpha * 0.55;
    }
    // Twelve deterministic dust motes, bounded regardless of drop distance.
    for (let i = 0; i < Math.min(12, cells.length * 3); i++) {
      const cell = cells[i % cells.length];
      const side = i % 2 ? 1 : -1;
      const spread = p * (12 + (i % 4) * 8);
      circle(ctx, cell.x + size / 2 + side * spread, cell.y + size - Math.sin(p * Math.PI) * (5 + i % 5 * 3), 1.4 + i % 3, hue);
    }
    ctx.restore();
  }

  function drawFlush(ctx, { rowY = 0, colors = EMPTY_CELLS, progress = 0, size = 32, width = 320, reducedMotion = false } = EMPTY_OPTIONS) {
    const p = clamp(progress), envelope = writeEffectEnvelope('flush', p, reducedMotion, flushEnvelope);
    if (!envelope.alpha) { return; }
    const moving = !motionIsReduced(reducedMotion);
    const center = width / 2, centerY = rowY + size * 0.55;
    ctx.save();
    if (moving) {
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.55; ctx.strokeStyle = '#b4fff1'; ctx.lineWidth = 1.5;
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath(); ctx.ellipse(center, centerY, Math.max(2, (1 - p) * width * 0.44 - ring * 10), 3 + ring * 4, p * Math.PI, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (let col = 0; col < Math.min(10, colors.length); col++) {
      const startX = col * size + size / 2;
      const x = moving ? startX + (center - startX) * p * p : startX;
      const y = centerY + (moving ? Math.sin(col * 0.9 + p * TAU) * p * (1 - p) * 35 + p * p * size : 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(envelope.rotation * (col % 2 ? 1 : -1));
      const tileSize = size * envelope.scaleX;
      drawTile(ctx, -tileSize / 2, -tileSize / 2, tileSize, colors[col] || 'O', envelope.alpha);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTakeover(ctx, { progress = 0, width = 320, height = 640, reducedMotion = false, text = 'TURDTRIS!' } = EMPTY_OPTIONS) {
    const envelope = writeEffectEnvelope('takeover', progress, reducedMotion, takeoverEnvelope);
    if (!envelope.alpha) { return; }
    ctx.save(); ctx.globalAlpha = envelope.alpha; ctx.translate(width / 2, height * 0.4);
    ctx.scale(envelope.scaleX, envelope.scaleY);
    ctx.fillStyle = 'rgba(3,19,30,0.95)';
    roundPath(ctx, -width * 0.46, -48, width * 0.92, 96, 17); ctx.fill();
    ctx.strokeStyle = '#94fff1'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#c6fff0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 32px system-ui, sans-serif'; ctx.fillText(text, 0, -7, width * 0.84);
    ctx.fillStyle = '#9bbdc6'; ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(text === 'TURDTRIS!' ? 'FOUR LINES. ONE ROYAL FLUSH.' : 'THE PIPES ARE SPOTLESS.', 0, 24, width * 0.82);
    ctx.restore();
  }

  return { drawTile, drawBackground, drawDropTrail, drawFlush, drawTakeover };
}
