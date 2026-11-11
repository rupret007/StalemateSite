/**
 * Arcade accessibility: colorblind-safe palettes + motion intensity helpers.
 * Wired site-wide through turdsuite.js (toggle + Suite.* bridge).
 */

export const COLORBLIND_STORAGE_KEY = 'turdsuite_colorblind_v1';

export const SHAKE_SCALE_REDUCED = 0.2;
export const PARTICLE_SCALE_REDUCED = 0.15;
export const FLASH_SCALE_REDUCED = 0;

/** WCAG-ish minimum contrast vs default playfield ink. */
export const MIN_PALETTE_CONTRAST = 3;

/** Tol / Okabe–Ito inspired — separable for deuteranopia & protanopia. */
export const CB_SUITE_CSS_VARS = {
  '--suite-card-red': '#d55e00',
  '--suite-card-black': '#1f2528',
  '--suite-accent-safe': '#0072b2',
  '--suite-cb-hearts': '#d55e00',
  '--suite-cb-diamonds': '#e69f00',
  '--suite-cb-spades': '#1f2528',
  '--suite-cb-clubs': '#0072b2'
};

export const TURDTRIS_PIECE_COLORS_CB = {
  I: '#56b4e9',
  O: '#e69f00',
  T: '#cc79a7',
  S: '#0072b2',
  Z: '#d55e00',
  J: '#009e73',
  L: '#f0e442'
};

export const TURDTRIS_PIECE_COLORS_DEFAULT = {
  I: '#7ad7ff',
  O: '#ffd56a',
  T: '#c98bff',
  S: '#7dffb2',
  Z: '#ff8f8f',
  J: '#7f9dff',
  L: '#ffb07a'
};

/** Material top colors when colorblind mode is on (brick / world reads). */
export const BRICK_MATERIAL_TOP_CB = {
  porcelain: '#f0e442',
  sewer: '#0072b2',
  slime: '#009e73',
  candy: '#cc79a7',
  tar: '#6e6e78',
  metal: '#999999',
  gold: '#e69f00'
};

export const TURDOMANIA_KIND_COLORS_CB = [
  '#8c6b3f',
  '#e69f00',
  '#009e73',
  '#d9d9d9',
  '#d55e00',
  '#f0e442'
];

export function safeStorage(storage) {
  try {
    return storage || null;
  } catch {
    return null;
  }
}

export function readColorblindEnabled(storage) {
  const store = safeStorage(storage);
  if (!store) {return false;}
  try {
    return store.getItem(COLORBLIND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeColorblindEnabled(storage, on) {
  const store = safeStorage(storage);
  if (!store) {return false;}
  try {
    store.setItem(COLORBLIND_STORAGE_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {(query: string) => { matches: boolean, addEventListener?: Function } | null | undefined} matchMedia
 */
export function prefersReducedMotion(matchMedia) {
  try {
    const mq = matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
    return !!(mq && mq.matches);
  } catch {
    return false;
  }
}

export function motionIntensity(reduced) {
  const r = !!reduced;
  return {
    reduced: r,
    shakeScale: r ? SHAKE_SCALE_REDUCED : 1,
    flashScale: r ? FLASH_SCALE_REDUCED : 1,
    particleScale: r ? PARTICLE_SCALE_REDUCED : 1,
    allowAutoScroll: !r,
    allowJuice: !r
  };
}

export function parseHexColor(hex) {
  const raw = String(hex || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!m) {return null;}
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function relativeLuminance({ r, g, b }) {
  const srgb = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function contrastRatio(fgHex, bgHex) {
  const fg = parseHexColor(fgHex);
  const bg = parseHexColor(bgHex);
  if (!fg || !bg) {return 0;}
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {string[]} colors hex list
 * @param {string} bgHex
 */
export function minPairwiseContrastOnBg(colors, bgHex = '#061018') {
  let min = Infinity;
  for (const c of colors) {
    min = Math.min(min, contrastRatio(c, bgHex));
  }
  return min === Infinity ? 0 : min;
}

export function turdtrisPieceColors(colorblind) {
  return colorblind ? { ...TURDTRIS_PIECE_COLORS_CB } : { ...TURDTRIS_PIECE_COLORS_DEFAULT };
}

export function turdomaniaKindColor(kindIndex, colorblind, fallback) {
  if (!colorblind) {return fallback;}
  const i = Math.max(0, Math.floor(kindIndex));
  return TURDOMANIA_KIND_COLORS_CB[i % TURDOMANIA_KIND_COLORS_CB.length] || fallback;
}

/**
 * @param {{ c1: string, c2?: string, glow?: string, material?: string }} colors
 */
export function remapBrickColors(colors, colorblind) {
  if (!colorblind || !colors) {return colors;}
  const mat = colors.material;
  const top = mat && BRICK_MATERIAL_TOP_CB[mat];
  if (!top) {return colors;}
  return {
    ...colors,
    c1: top,
    c2: colors.c2 || top,
    glow: colors.glow || top
  };
}

export function applyColorblindCssVars(doc, enabled) {
  if (!doc || !doc.documentElement) {return;}
  const root = doc.documentElement;
  root.classList.toggle('suite-colorblind', !!enabled);
  const vars = enabled ? CB_SUITE_CSS_VARS : CB_SUITE_CSS_VARS;
  for (const [key, value] of Object.entries(vars)) {
    if (enabled) {
      root.style.setProperty(key, value);
    } else {
      root.style.removeProperty(key);
    }
  }
}

export function syncReducedMotionClass(doc, reduced) {
  if (!doc || !doc.documentElement) {return;}
  doc.documentElement.classList.toggle('suite-motion-reduce', !!reduced);
}

export function suitPatternId(suit) {
  const s = String(suit || '').toUpperCase();
  if (s === 'H') {return 'hearts';}
  if (s === 'D') {return 'diamonds';}
  if (s === 'S') {return 'spades';}
  if (s === 'C') {return 'clubs';}
  return 'unknown';
}

/**
 * @param {object} Suite global Suite object
 * @param {Storage|null} storage
 * @param {Document} doc
 * @param {{ onColorblindChange?: (on: boolean) => void }} [hooks]
 */
export function attachSuiteArcadeA11y(Suite, storage, doc, hooks = {}) {
  let colorblind = readColorblindEnabled(storage);
  const matchMediaFn =
    doc.defaultView && doc.defaultView.matchMedia
      ? (q) => doc.defaultView.matchMedia(q)
      : () => null;

  function refreshMotion() {
    const reduced = prefersReducedMotion(matchMediaFn);
    syncReducedMotionClass(doc, reduced);
    return motionIntensity(reduced);
  }

  function publishColorblind() {
    applyColorblindCssVars(doc, colorblind);
    if (typeof hooks.onColorblindChange === 'function') {
      hooks.onColorblindChange(colorblind);
    }
  }

  Suite.isColorblindMode = function () {
    return colorblind;
  };
  Suite.setColorblindMode = function (on) {
    colorblind = !!on;
    writeColorblindEnabled(storage, colorblind);
    publishColorblind();
  };
  Suite.prefersReducedMotion = function () {
    return prefersReducedMotion(matchMediaFn);
  };
  Suite.motionIntensity = function () {
    return refreshMotion();
  };
  Suite.turdtrisPieceColors = function () {
    return turdtrisPieceColors(colorblind);
  };
  Suite.turdomaniaKindColor = function (kindIndex, fallback) {
    return turdomaniaKindColor(kindIndex, colorblind, fallback);
  };
  Suite.remapBrickColors = function (colors) {
    return remapBrickColors(colors, colorblind);
  };

  publishColorblind();
  refreshMotion();

  try {
    const mq = matchMediaFn('(prefers-reduced-motion: reduce)');
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', () => refreshMotion());
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(() => refreshMotion());
    }
  } catch {
    /* ignore */
  }

  return {
    getColorblind: () => colorblind,
    refreshMotion
  };
}

function isSuiteHubPage(doc) {
  return Boolean(doc.querySelector('#hub-games, main.games[aria-label="Choose a game"]'));
}

export function rectsOverlap(a, b, epsilon = 1) {
  if (!a || !b) {
    return false;
  }
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon
  );
}

export function rectInsideViewport(rect, viewportWidth, viewportHeight, epsilon = 0) {
  if (!rect) {
    return false;
  }
  return (
    rect.left >= -epsilon &&
    rect.top >= -epsilon &&
    rect.right <= viewportWidth + epsilon &&
    rect.bottom <= viewportHeight + epsilon
  );
}

function tablePlayMountTarget(doc) {
  const win = doc.defaultView;
  if (!win) {
    return null;
  }
  if (win.innerWidth > 760) {
    return null;
  }
  const pit = doc.getElementById('mobilePit');
  if (pit && win.getComputedStyle(pit).display !== 'none') {
    if (pit.id === 'mobilePit' && !doc.body.classList.contains('jack-table-first')) {
      return null;
    }
    return { parent: pit, slotClass: 'suite-a11y-pit-slot' };
  }
  if (!pit) {
    const dock = doc.querySelector('section.table .action-dock, .table .action-dock');
    if (dock) {
      return { parent: dock, slotClass: 'suite-a11y-table-dock-slot' };
    }
  }
  return null;
}

function ensureMountSlot(doc, target) {
  let slot = target.parent.querySelector(`:scope > #suite-arcade-a11y-mount, :scope > .${target.slotClass}`);
  if (!slot) {
    slot = doc.createElement('div');
    slot.id = 'suite-arcade-a11y-mount';
    slot.className = target.slotClass;
    target.parent.insertBefore(slot, target.parent.firstChild);
  } else if (!slot.id) {
    slot.id = 'suite-arcade-a11y-mount';
  }
  return slot;
}

/**
 * Moves the colorblind toggle into the sticky mobile pit / table dock when that chrome is active.
 * @param {Document} doc
 */
export function syncArcadeA11yMount(doc) {
  if (!doc?.body || isSuiteHubPage(doc)) {
    return null;
  }
  const toggle = doc.getElementById('suite-arcade-a11y-toggle');
  const tableTarget = tablePlayMountTarget(doc);
  if (tableTarget) {
    const slot = ensureMountSlot(doc, tableTarget);
    if (toggle && toggle.parentElement !== slot) {
      slot.appendChild(toggle);
      toggle.className = 'suite-arcade-a11y-toggle suite-arcade-a11y-toggle--inline';
    }
    const bodySlot = doc.querySelector('body > .suite-a11y-body-slot');
    if (bodySlot && bodySlot !== slot && bodySlot.childElementCount === 0) {
      bodySlot.remove();
    }
    return slot;
  }
  if (!toggle) {
    return ensureArcadeA11yMount(doc);
  }
  let bodySlot = doc.querySelector('body > .suite-a11y-body-slot');
  if (!bodySlot) {
    bodySlot = doc.createElement('div');
    bodySlot.id = 'suite-arcade-a11y-mount';
    bodySlot.className = 'suite-a11y-play-shell-slot suite-a11y-body-slot';
    doc.body.appendChild(bodySlot);
  }
  if (toggle.parentElement !== bodySlot) {
    bodySlot.appendChild(toggle);
    toggle.className = 'suite-arcade-a11y-toggle suite-arcade-a11y-toggle--floating';
  }
  const pitSlot = doc.querySelector('.suite-a11y-pit-slot, .suite-a11y-table-dock-slot');
  if (pitSlot && pitSlot !== bodySlot && pitSlot.childElementCount === 0) {
    pitSlot.remove();
  }
  return bodySlot;
}

function resolveA11yToggleMount(doc) {
  if (isSuiteHubPage(doc)) {
    return null;
  }
  const explicit = doc.getElementById('suite-arcade-a11y-mount');
  if (explicit) {
    return { parent: explicit, mode: 'inline' };
  }
  const topActions = doc.querySelector(
    '.topbar .top-actions, .topbar .actions, .topbar .top-links, .table-menu .actions'
  );
  if (topActions) {
    return { parent: topActions, mode: 'inline', insert: 'first' };
  }
  const dock = doc.querySelector('.dock[role="toolbar"]');
  if (dock) {
    return { parent: dock, mode: 'inline', insert: 'first' };
  }
  const topbtns = doc.querySelector('.topbtns');
  if (topbtns) {
    return { parent: topbtns, mode: 'topbtns', insert: 'first' };
  }
  const titleMenu = doc.querySelector('#titleScreen .menu-secondary');
  if (titleMenu) {
    return { parent: titleMenu, mode: 'title' };
  }
  return { parent: doc.body, mode: 'floating' };
}

/**
 * Ensures a visible mount exists on table/arcade pages (mobile hides `.actions`).
 * @param {Document} doc
 */
export function ensureArcadeA11yMount(doc) {
  if (!doc || !doc.body || isSuiteHubPage(doc)) {
    return null;
  }
  if (doc.getElementById('suite-arcade-a11y-mount')) {
    return doc.getElementById('suite-arcade-a11y-mount');
  }
  const playShell = doc.getElementById('playShell');
  if (playShell) {
    const slot = doc.createElement('div');
    slot.id = 'suite-arcade-a11y-mount';
    slot.className = 'suite-a11y-play-shell-slot';
    playShell.appendChild(slot);
    return slot;
  }
  const topbar = doc.querySelector('.topbar');
  if (topbar) {
    const topLinks = topbar.querySelector('.top-links');
    const titleGroup = topbar.querySelector('.title-group');
    // TurdRummy: use a reserved cell in the sticky action dock.
    const actionDock = doc.querySelector('.action-dock');
    if (topLinks && titleGroup && actionDock) {
      const slot = doc.createElement('div');
      slot.id = 'suite-arcade-a11y-mount';
      slot.className = 'suite-a11y-rummy-dock-slot';
      actionDock.appendChild(slot);
      return slot;
    }
    const topActions = topbar.querySelector('.top-actions');
    if (topActions) {
      const slot = doc.createElement('div');
      slot.id = 'suite-arcade-a11y-mount';
      slot.className = 'suite-a11y-topbar-slot';
      const mobileMenu = topbar.querySelector('.mobile-menu, .table-menu');
      if (mobileMenu) {
        topbar.insertBefore(slot, mobileMenu);
      } else {
        topbar.appendChild(slot);
      }
      return slot;
    }
    const tableMenu = topbar.querySelector('.table-menu');
    if (tableMenu) {
      const slot = doc.createElement('div');
      slot.id = 'suite-arcade-a11y-mount';
      slot.className = 'suite-a11y-topbar-slot';
      topbar.insertBefore(slot, tableMenu);
      return slot;
    }
    if (!topbar.querySelector(':scope > .actions')) {
      const slot = doc.createElement('div');
      slot.id = 'suite-arcade-a11y-mount';
      slot.className = 'suite-a11y-topbar-slot';
      const mobileMenu = topbar.querySelector('.mobile-menu, .table-menu');
      if (mobileMenu) {
        topbar.insertBefore(slot, mobileMenu);
      } else {
        topbar.appendChild(slot);
      }
      return slot;
    }
    const tableTarget = tablePlayMountTarget(doc);
    if (tableTarget) {
      return ensureMountSlot(doc, tableTarget);
    }
    // Bottom-right body mount: stays in the viewport (topbar scrolls on tall table pages).
    const slot = doc.createElement('div');
    slot.id = 'suite-arcade-a11y-mount';
    slot.className = 'suite-a11y-play-shell-slot suite-a11y-body-slot';
    doc.body.appendChild(slot);
    return slot;
  }
  const dock = doc.querySelector('.dock[role="toolbar"]');
  if (dock) {
    const slot = doc.createElement('div');
    slot.id = 'suite-arcade-a11y-mount';
    slot.className = 'suite-a11y-dock-slot';
    dock.insertBefore(slot, dock.firstChild);
    return slot;
  }
  const headerHud = doc.querySelector('header.hud');
  if (headerHud) {
    const slot = doc.createElement('div');
    slot.id = 'suite-arcade-a11y-mount';
    slot.className = 'suite-a11y-header-slot';
    headerHud.appendChild(slot);
    return slot;
  }
  return null;
}

export function createArcadeA11yToggle(doc, Suite) {
  if (!doc || !doc.body || !Suite) {
    return null;
  }
  if (doc.getElementById('suite-arcade-a11y-toggle')) {
    return doc.getElementById('suite-arcade-a11y-toggle');
  }
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.id = 'suite-arcade-a11y-toggle';
  ensureArcadeA11yMount(doc);
  const mount = resolveA11yToggleMount(doc);
  if (!mount) {
    return null;
  }
  btn.className = `suite-arcade-a11y-toggle suite-arcade-a11y-toggle--${mount.mode}`;
  function sync() {
    const on = Suite.isColorblindMode();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      on
        ? 'Colorblind-safe colors on, tap to use standard colors'
        : 'Colorblind-safe colors off, tap for high-contrast palettes and suit patterns'
    );
    const chess = doc.body?.dataset.arcadeGame === 'chess';
    btn.textContent = chess ? (on ? 'Contrast on' : 'High contrast') : (on ? 'CB' : 'Clr');
    if (chess) {
      btn.setAttribute('aria-label', on ? 'High contrast board on. Use standard board colors' : 'Use high contrast board colors');
    }
  }
  sync();
  btn.addEventListener('click', () => {
    Suite.setColorblindMode(!Suite.isColorblindMode());
    sync();
  });
  // Keep native button activation, but do not pass it to game shortcuts.
  function containActivationKey(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
    }
  }
  btn.addEventListener('keydown', containActivationKey);
  btn.addEventListener('keyup', containActivationKey);
  if (mount.insert === 'first') {
    mount.parent.insertBefore(btn, mount.parent.firstChild);
  } else {
    mount.parent.appendChild(btn);
  }
  return btn;
}
