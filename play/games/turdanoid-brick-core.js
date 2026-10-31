/* Brick materials, palettes, and crack stages for TurdAnoid rendering. */
(function attachTurdanoidBrick(root) {
  'use strict';

  const MATERIALS = ['porcelain', 'sewer', 'slime', 'candy', 'tar', 'metal', 'gold'];

  const theme = root.TurdanoidTheme;
  const MATERIAL_PALETTES = theme
    ? theme.materialPalettes()
    : {
      porcelain: ['#e8f4ef', '#b8d4c8', 'rgba(232,244,239,.42)'],
      sewer: ['#3ecf9a', '#1a7a58', 'rgba(62,207,154,.44)'],
      slime: ['#3ecf9a', '#246a38', 'rgba(62,207,154,.46)'],
      candy: ['#e878b8', '#882058', 'rgba(232,120,184,.44)'],
      tar: ['#3a3a44', '#050507', 'rgba(150,150,170,.30)'],
      metal: ['#c4d0dc', '#4a5a68', 'rgba(196,208,220,.4)'],
      gold: ['#f0d478', '#a87818', 'rgba(240,212,120,.5)']
    };

  const ROW_PALETTES = theme
    ? theme.rowPalettes()
    : [
      ['#3ecf9a', '#1a7a58', 'rgba(62,207,154,.46)'],
      ['#5ec8e0', '#1a6a88', 'rgba(94,200,224,.46)'],
      ['#e4bc48', '#8a6410', 'rgba(228,188,72,.46)'],
      ['#e07a4a', '#8a3418', 'rgba(224,122,74,.46)'],
      ['#d878a8', '#7a2858', 'rgba(216,120,168,.46)'],
      ['#8a82d8', '#343078', 'rgba(138,130,216,.46)']
    ];

  /** Rotates rainbow rows per campaign world so walls read differently in play. */
  const WORLD_ROW_ROTATIONS = [0, 1, 2, 3, 4];

  const DISTINCT_MATERIALS = new Set(['metal', 'gold', 'porcelain', 'slime', 'candy', 'tar']);

  /**
   * 0 = pristine, 3 = heavily cracked (hp nearly gone).
   */
  function crackStage(hp, maxHp) {
    const max = Math.max(1, maxHp || 1);
    const h = Math.max(0, hp || 0);
    const dmg = 1 - h / max;
    if (dmg <= 0.2) {
      return 0;
    }
    if (dmg <= 0.45) {
      return 1;
    }
    if (dmg <= 0.7) {
      return 2;
    }
    return 3;
  }

  function pickMaterial(row, col, level, rng = Math.random) {
    if (level >= 10 && rng() < 0.08) {
      return 'tar';
    }
    if (level >= 6 && row === 0 && rng() < 0.35) {
      return 'porcelain';
    }
    if (level >= 4 && (row + col) % 5 === 0 && rng() < 0.55) {
      return 'slime';
    }
    if (level >= 8 && rng() < 0.12) {
      return 'candy';
    }
    if (rng() < 0.25) {
      return 'sewer';
    }
    return 'sewer';
  }

  function rowPaletteIndex(row, rows, col, worldIndex) {
    const bands = ROW_PALETTES.length;
    const rowBand = Math.min(bands - 1, Math.floor((row / Math.max(1, rows - 1)) * bands));
    const rot = WORLD_ROW_ROTATIONS[Math.abs(worldIndex | 0) % WORLD_ROW_ROTATIONS.length] || 0;
    const zig = (col % 2) * (rows > 4 ? 1 : 0);
    return (rowBand + rot + zig) % bands;
  }

  function applyColorblindBrick(colors) {
    try {
      if (root.Suite && typeof root.Suite.remapBrickColors === 'function') {
        return root.Suite.remapBrickColors(colors);
      }
      if (root.SuiteArcadeA11y && root.SuiteArcadeA11y.remapBrickColors) {
        const on = root.Suite && root.Suite.isColorblindMode && root.Suite.isColorblindMode();
        return root.SuiteArcadeA11y.remapBrickColors(colors, on);
      }
    } catch { /* ignore */ }
    return colors;
  }

  function brickColors(row, rows, material, col = 0, worldIndex = 0) {
    let out;
    if (material && DISTINCT_MATERIALS.has(material) && MATERIAL_PALETTES[material]) {
      const p = MATERIAL_PALETTES[material];
      out = { c1: p[0], c2: p[1], glow: p[2], material };
    } else {
      const pal = ROW_PALETTES[rowPaletteIndex(row, rows, col, worldIndex)];
      out = { c1: pal[0], c2: pal[1], glow: pal[2], material: material || 'sewer' };
    }
    return applyColorblindBrick(out);
  }

  function assignBrickStyle(row, rows, col, level, rng, worldIndex = 0) {
    const material = pickMaterial(row, col, level, rng);
    const colors = brickColors(row, rows, material, col, worldIndex);
    return colors;
  }

  /**
   * Colorblind-only hatch on heavy bricks (not generic multi-HP).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ heavy?: boolean }} b
   * @param {number} px
   * @param {number} py
   * @param {number} pw
   * @param {number} ph
   * @param {boolean} colorblind
   * @param {(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => void} [roundRectFn]
   */
  function paintCbHeavyBrickMark(ctx, b, px, py, pw, ph, colorblind, roundRectFn) {
    if (!b || !b.heavy) {
      return;
    }
    if (!colorblind) {
      return;
    }
    const strokeRound = roundRectFn || function strokeRectFallback(c, x, y, w, h) {
      c.rect(x, y, w, h);
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.72)';
    ctx.lineWidth = 2;
    strokeRound(ctx, px + 1.5, py + 1.5, pw - 3, ph - 3, 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1;
    for (let d = -ph; d < pw + ph; d += 7) {
      ctx.beginPath();
      ctx.moveTo(px + d, py + ph - 1);
      ctx.lineTo(px + d + ph * 0.65, py + 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function distinctRowHueCount(rows, worldIndex = 0) {
    const seen = new Set();
    const cols = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { c1 } = brickColors(r, rows, 'sewer', c, worldIndex);
        seen.add(c1);
      }
    }
    return seen.size;
  }

  root.TurdanoidBrick = {
    MATERIALS,
    MATERIAL_PALETTES,
    ROW_PALETTES,
    WORLD_ROW_ROTATIONS,
    crackStage,
    pickMaterial,
    rowPaletteIndex,
    brickColors,
    assignBrickStyle,
    distinctRowHueCount,
    paintCbHeavyBrickMark
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
