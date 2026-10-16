/* Midnight Porcelain Arcade — TurdAnoid art-direction tokens (render only). */
(function attachTurdanoidTheme(root) {
  'use strict';

  const THEME_ID = 'midnight-porcelain';
  const THEME_NAME = 'Midnight Porcelain Arcade';

  /**
   * Shared suite palette. Worlds tint these tokens; they do not invent
   * a second rainbow. Contrast is measured against inkDeep.
   */
  const TOKENS = {
    ink: '#0a1820',
    inkDeep: '#061018',
    inkMid: '#123040',
    porcelain: '#e8f4ef',
    porcelainDim: '#b8d4c8',
    brass: '#e8c56a',
    brassDeep: '#a8781c',
    slime: '#3ecf9a',
    slimeDeep: '#1a7a58',
    aqua: '#5ec8e0',
    aquaDeep: '#1a6a88',
    honey: '#e4bc48',
    honeyDeep: '#8a6410',
    terracotta: '#e07a4a',
    terracottaDeep: '#8a3418',
    rose: '#d878a8',
    roseDeep: '#7a2858',
    indigo: '#8a82d8',
    indigoDeep: '#343078',
    coral: '#ff6d5a',
    coralDeep: '#a82820',
    metal: '#c4d0dc',
    metalDeep: '#4a5a68',
    gold: '#f0d478',
    goldDeep: '#a87818',
    tar: '#7a7a88',
    tarDeep: '#22222c',
    candy: '#e878b8',
    candyDeep: '#882058',
    inkText: '#eaf6f0',
    mutedText: '#9ab4aa',
    glass: 'rgba(6,16,22,.78)',
    glassBorder: 'rgba(232,197,106,.32)',
    font: '"Segoe UI","Avenir Next","Trebuchet MS",system-ui,sans-serif'
  };

  const CSS_VAR_MAP = {
    '--ta-ink': 'ink',
    '--ta-ink-deep': 'inkDeep',
    '--ta-ink-mid': 'inkMid',
    '--ta-porcelain': 'porcelain',
    '--ta-porcelain-dim': 'porcelainDim',
    '--ta-brass': 'brass',
    '--ta-brass-deep': 'brassDeep',
    '--ta-slime': 'slime',
    '--ta-slime-deep': 'slimeDeep',
    '--ta-aqua': 'aqua',
    '--ta-honey': 'honey',
    '--ta-terracotta': 'terracotta',
    '--ta-rose': 'rose',
    '--ta-indigo': 'indigo',
    '--ta-coral': 'coral',
    '--ta-metal': 'metal',
    '--ta-gold': 'gold',
    '--ta-ink-text': 'inkText',
    '--ta-muted': 'mutedText',
    '--ta-glass': 'glass',
    '--ta-glass-border': 'glassBorder',
    '--ta-font': 'font'
  };

  function glow(hex, alpha) {
    const rgb = hexToRgb(hex);
    const a = alpha === undefined || alpha === null ? 0.48 : alpha;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  }

  function triple(top, bot, glowAlpha) {
    return [top, bot, glow(top, glowAlpha === undefined || glowAlpha === null ? 0.46 : glowAlpha)];
  }

  function materialPalettes() {
    return {
      porcelain: triple(TOKENS.porcelain, TOKENS.porcelainDim, 0.42),
      sewer: triple(TOKENS.slime, TOKENS.slimeDeep, 0.44),
      slime: triple(TOKENS.slime, '#246a38', 0.46),
      candy: triple(TOKENS.candy, TOKENS.candyDeep, 0.44),
      tar: triple(TOKENS.tar, TOKENS.tarDeep, 0.36),
      metal: triple(TOKENS.metal, TOKENS.metalDeep, 0.4),
      gold: triple(TOKENS.gold, TOKENS.goldDeep, 0.5)
    };
  }

  function rowPalettes() {
    return [
      triple(TOKENS.slime, TOKENS.slimeDeep),
      triple(TOKENS.aqua, TOKENS.aquaDeep),
      triple(TOKENS.honey, TOKENS.honeyDeep),
      triple(TOKENS.terracotta, TOKENS.terracottaDeep),
      triple(TOKENS.rose, TOKENS.roseDeep),
      triple(TOKENS.indigo, TOKENS.indigoDeep)
    ];
  }

  function worlds() {
    return [
      {
        id: 'bathroom',
        name: 'Bathroom Tiles',
        sky: [TOKENS.inkDeep, TOKENS.ink, TOKENS.inkMid],
        accent: TOKENS.porcelainDim,
        wallMortar: TOKENS.inkDeep,
        pipe: [TOKENS.inkMid, TOKENS.aqua, '#2a5560'],
        playWallTint: glow(TOKENS.aqua, 0.12),
        stage: { tile: 'square', rail: 'brass' }
      },
      {
        id: 'sewer',
        name: 'Sewer Pipes',
        sky: ['#05141a', TOKENS.ink, '#15394a'],
        accent: TOKENS.slime,
        wallMortar: TOKENS.inkDeep,
        pipe: ['#0f2b24', TOKENS.slimeDeep, '#1d4a3c'],
        playWallTint: glow(TOKENS.slime, 0.11),
        stage: { tile: 'bond', rail: 'slime' }
      },
      {
        id: 'toxic',
        name: 'Toxic Lagoon',
        sky: ['#061610', '#102818', '#1a3824'],
        accent: '#86d86a',
        wallMortar: '#061208',
        pipe: ['#1a3020', '#3d7a48', '#254a30'],
        playWallTint: glow('#86d86a', 0.1),
        stage: { tile: 'algae', rail: 'hazard' }
      },
      {
        id: 'candy',
        name: 'Candy Clog',
        sky: ['#140c18', '#241428', '#341838'],
        accent: TOKENS.rose,
        wallMortar: '#120810',
        pipe: [TOKENS.roseDeep, TOKENS.candy, '#6a2860'],
        playWallTint: glow(TOKENS.rose, 0.12),
        stage: { tile: 'diamond', rail: 'rose' }
      },
      {
        id: 'throne',
        name: 'Golden Throne',
        sky: ['#141008', '#241c10', '#342814'],
        accent: TOKENS.brass,
        wallMortar: '#100c08',
        pipe: [TOKENS.brassDeep, TOKENS.gold, '#5a4018'],
        playWallTint: glow(TOKENS.brass, 0.12),
        stage: { tile: 'slab', rail: 'gold' }
      }
    ];
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string' || hex[0] !== '#') {
      return { r: 0, g: 0, b: 0 };
    }
    const raw = hex.slice(1);
    const n = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    if (n.length !== 6) {
      return { r: 0, g: 0, b: 0 };
    }
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16)
    };
  }

  function channel(c) {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(a, b) {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function meetsContrast(fg, bg, min) {
    return contrastRatio(fg, bg) >= (min === undefined || min === null ? 4.5 : min);
  }

  function applyCssVars(el) {
    if (!el || !el.style) {
      return 0;
    }
    let n = 0;
    Object.keys(CSS_VAR_MAP).forEach((cssName) => {
      const token = CSS_VAR_MAP[cssName];
      el.style.setProperty(cssName, TOKENS[token]);
      n += 1;
    });
    return n;
  }

  function cssVarNames() {
    return Object.keys(CSS_VAR_MAP);
  }

  function tokenNames() {
    return Object.keys(TOKENS);
  }

  root.TurdanoidTheme = {
    THEME_ID,
    THEME_NAME,
    TOKENS,
    CSS_VAR_MAP,
    glow,
    triple,
    materialPalettes,
    rowPalettes,
    worlds,
    hexToRgb,
    relativeLuminance,
    contrastRatio,
    meetsContrast,
    applyCssVars,
    cssVarNames,
    tokenNames
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
