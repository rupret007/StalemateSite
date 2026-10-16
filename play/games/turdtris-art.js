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
  const index = PIECE_NAMES.indexOf(name);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#18333c';
  // The face is deliberately subtle: the color silhouette still leads.
  ctx.globalAlpha = 0.77;
  if (name === 'J' || name === 'T') {
    ctx.beginPath();
    ctx.moveTo(21, 35); ctx.lineTo(26, 34);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#18333c';
    ctx.fillRect(22, 32, 3, 5);
  }
  ctx.fillStyle = '#18333c';
  ctx.fillRect(37, 32, 3, 5);
  ctx.beginPath();
  if (name === 'O') {
    ctx.arc(31, 42, 3.2, 0, TAU);
  } else if (name === 'Z') {
    ctx.moveTo(27, 41); ctx.lineTo(34, 41); ctx.lineTo(36, 39);
  } else {
    ctx.arc(31, 38, 6, 0.2, Math.PI - 0.2);
  }
  ctx.stroke();
  if (index % 2 === 0) {
    circle(ctx, 18, 40, 2.5, 'rgba(255,130,137,0.5)');
    circle(ctx, 44, 40, 2.5, 'rgba(255,130,137,0.5)');
  }
  ctx.globalAlpha = 1;
}

function paintSprite(ctx, name, ghost) {
  const color = PIECES[name];
  if (ghost) {
    roundPath(ctx, 4, 4, 56, 56, 12);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 0.95;
    // A 4px cached stroke remains ~1 CSS pixel on the smallest phone board.
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.setLineDash([7, 5]); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.25;
    ctx.strokeRect(27, 30, 10, 4);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = '#020b11';
  roundPath(ctx, 2, 3, 60, 60, 13); ctx.fill();
  const body = ctx.createLinearGradient(4, 3, 54, 62);
  body.addColorStop(0, shade(color, 36));
  body.addColorStop(0.35, color);
  body.addColorStop(0.78, shade(color, -29));
  body.addColorStop(1, shade(color, -78));
  ctx.fillStyle = body;
  roundPath(ctx, 3, 2, 58, 58, 12); ctx.fill();
  ctx.strokeStyle = shade(color, -44); ctx.lineWidth = 2; ctx.stroke();

  // Inner jelly reservoir with a darker submerged lower edge.
  const inner = ctx.createLinearGradient(8, 10, 8, 57);
  inner.addColorStop(0, 'rgba(255,255,255,0.33)');
  inner.addColorStop(0.48, 'rgba(255,255,255,0.025)');
  inner.addColorStop(1, 'rgba(0,25,41,0.28)');
  ctx.fillStyle = inner;
  roundPath(ctx, 8, 8, 48, 44, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.lineWidth = 1.2; ctx.stroke();

  // A broad curved reflection, rim light, and a tiny porcelain specular.
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath(); ctx.moveTo(12, 11); ctx.quadraticCurveTo(31, 5, 50, 12);
  ctx.quadraticCurveTo(45, 23, 11, 25); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(245,255,255,0.73)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(7, 23); ctx.quadraticCurveTo(6, 7, 20, 6);
  ctx.lineTo(45, 6); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.beginPath(); ctx.moveTo(19, 55); ctx.lineTo(45, 55); ctx.quadraticCurveTo(56, 55, 57, 43); ctx.stroke();
  circle(ctx, 15, 14, 3.4, 'rgba(255,255,255,0.82)');
  circle(ctx, 20, 12, 1.4, 'rgba(255,255,255,0.8)');

  // Deterministic, very low contrast stipple; made once, never per frame.
  const seed = PIECE_NAMES.indexOf(name) + 1;
  for (let i = 0; i < 18; i++) {
    const x = 11 + ((i * 19 + seed * 7) % 43);
    const y = 22 + ((i * 13 + seed * 5) % 27);
    circle(ctx, x, y, i % 3 === 0 ? 1.3 : 0.65, 'rgba(255,255,255,0.13)');
  }
  if (name === 'G') {
    ctx.strokeStyle = '#3b3930'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(22, 12); ctx.lineTo(28, 28); ctx.lineTo(19, 38);
    ctx.lineTo(29, 53); ctx.moveTo(28, 28); ctx.lineTo(46, 32); ctx.stroke();
    circle(ctx, 47, 48, 8, 'rgba(129,191,89,0.25)');
  } else {
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

function paintBackground(ctx, theme) {
  const width = 320, height = 640;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.ink); bg.addColorStop(1, '#030c13');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  if (theme.id === 'bathroom') {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#10343b' : '#113b42';
        roundPath(ctx, c * 64 + 2, r * 64 + 2, 60, 60, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(128,247,223,0.075)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.28; drawToilet(ctx, 210, 51, 84, '#8cefdc'); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#52837c'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(14, 113); ctx.quadraticCurveTo(14, 128, 29, 128);
    ctx.lineTo(51, 128); ctx.stroke();
    ctx.strokeStyle = '#a6d2ba'; ctx.lineWidth = 2; ctx.stroke();
  } else if (theme.id === 'sewer') {
    for (let r = 0; r < 22; r++) {
      for (let c = -1; c < 6; c++) {
        ctx.fillStyle = (r + c) % 3 ? '#203329' : '#25382a';
        roundPath(ctx, c * 72 + (r % 2) * 36 + 2, r * 31 + 2, 68, 27, 3); ctx.fill();
      }
    }
    ctx.strokeStyle = '#426445'; ctx.lineWidth = 19;
    ctx.beginPath(); ctx.moveTo(21, height); ctx.lineTo(21, 141);
    ctx.bezierCurveTo(21, 0, 299, 0, 299, 141); ctx.lineTo(299, height); ctx.stroke();
    ctx.strokeStyle = '#7c9e68'; ctx.lineWidth = 2; ctx.stroke();
    for (const y of [150, 270, 390, 510]) {
      ctx.fillStyle = '#4c6540'; ctx.fillRect(7, y, 28, 10); ctx.fillRect(285, y, 28, 10);
      circle(ctx, 13, y + 5, 2, '#a1b587'); circle(ctx, 307, y + 5, 2, '#a1b587');
    }
    ctx.fillStyle = '#325336'; ctx.fillRect(0, 603, width, 37);
  } else if (theme.id === 'lagoon') {
    const glow = ctx.createRadialGradient(239, 91, 2, 239, 91, 133);
    glow.addColorStop(0, '#1f6271'); glow.addColorStop(1, '#0a182b');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, 240);
    circle(ctx, 240, 88, 30, '#477d89'); circle(ctx, 251, 79, 26, '#153e53');
    for (let i = 0; i < 22; i++) {
      const x = (i * 73) % width;
      ctx.strokeStyle = i % 2 ? '#255b5b' : '#234454'; ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath(); ctx.moveTo(x, 640); ctx.quadraticCurveTo(x + (i % 2 ? 30 : -30), 562, x - 8, 520 + i * 3); ctx.stroke();
      circle(ctx, x - 8, 520 + i * 3, 3 + i % 3, '#327e80');
    }
    ctx.fillStyle = '#103c49';
    ctx.beginPath(); ctx.moveTo(0, 605); ctx.bezierCurveTo(98, 573, 224, 626, 320, 599);
    ctx.lineTo(320, 640); ctx.lineTo(0, 640); ctx.fill();
  } else {
    for (let i = 0; i < 98; i++) {
      const x = (i * 137 + 31) % width, y = (i * 89 + 51) % height;
      circle(ctx, x, y, i % 7 === 0 ? 1.4 : 0.65, i % 3 ? '#6c5f9e' : '#b7a2c8');
    }
    const planet = ctx.createRadialGradient(265, 114, 4, 275, 134, 64);
    planet.addColorStop(0, '#675989'); planet.addColorStop(1, '#251d48');
    circle(ctx, 278, 133, 61, planet);
    ctx.strokeStyle = '#504170'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(276, 133, 90, 20, -0.45, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.52; drawToilet(ctx, 34, 493, 68, '#bb94cc'); ctx.globalAlpha = 1;
  }
  // Center dimming preserves stack/ghost contrast while the scene edges show.
  const veil = ctx.createLinearGradient(0, 0, width, 0);
  veil.addColorStop(0, 'rgba(2,8,14,0.1)'); veil.addColorStop(0.3, 'rgba(2,8,14,0.5)');
  veil.addColorStop(0.7, 'rgba(2,8,14,0.5)'); veil.addColorStop(1, 'rgba(2,8,14,0.1)');
  ctx.fillStyle = veil; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(185,245,240,0.055)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 32; x < width; x += 32) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (let y = 32; y < height; y += 32) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
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
    sprites[name] = makeCanvas(SPRITE_SIZE, SPRITE_SIZE, (ctx) => paintSprite(ctx, name, false));
    ghosts[name] = makeCanvas(SPRITE_SIZE, SPRITE_SIZE, (ctx) => paintSprite(ctx, name, true));
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
    ctx.drawImage(opts.ghost ? ghosts[name] : sprites[name], -size / 2, -size / 2, size, size);
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
