/**
 * Thumb-friendly segmented difficulty control (in HUD / title flow, never fixed overlay).
 */

const LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

function resolveDifficultyMount(doc) {
  const explicit = doc.getElementById('suite-difficulty-mount');
  if (explicit) {
    return { parent: explicit, mode: 'inline' };
  }
  const settings = doc.querySelector('.suite-hud-settings:not(:has(.suite-difficulty))');
  if (settings) {
    return { parent: settings, mode: 'settings' };
  }
  const masthead = doc.querySelector('.masthead .meta-row');
  if (masthead) {
    return { parent: masthead, mode: 'hub' };
  }
  const topbtns = doc.querySelector('.topbtns');
  if (topbtns) {
    return { parent: topbtns, mode: 'topbtns', insert: 'first' };
  }
  const titleMenu = doc.querySelector('#titleScreen .menu-secondary');
  if (titleMenu) {
    return { parent: titleMenu, mode: 'title' };
  }
  const topbar = doc.querySelector('.topbar');
  if (topbar) {
    return { parent: topbar, mode: 'topbar' };
  }
  const hud = doc.querySelector('header.hud');
  if (hud) {
    return { parent: hud, mode: 'hud' };
  }
  const hudRail = doc.querySelector('.hud');
  if (hudRail) {
    return { parent: hudRail, mode: 'hud' };
  }
  const dock = doc.querySelector('.dock[role="toolbar"]');
  if (dock) {
    return { parent: dock, mode: 'dock', insert: 'first' };
  }
  return { parent: doc.body, mode: 'fallback' };
}

export function mountDifficultyPicker(document, api) {
  if (!document || !document.body || document.querySelector('.suite-difficulty')) {
    return null;
  }
  if (document.body.dataset && document.body.dataset.suiteNoDifficulty === '1') {
    return null;
  }
  if (document.getElementById('hub-games')) {
    return null;
  }

  const mount = resolveDifficultyMount(document);

  const wrap = document.createElement('div');
  wrap.className = `suite-difficulty suite-difficulty--${mount.mode}`;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Game difficulty');

  const fieldset = document.createElement('div');
  fieldset.className = 'suite-difficulty-seg';

  const buttons = {};
  for (const id of ['easy', 'normal', 'hard']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suite-difficulty-btn';
    btn.dataset.level = id;
    btn.textContent = LABELS[id];
    btn.setAttribute('aria-pressed', id === api.get() ? 'true' : 'false');
    btn.addEventListener('click', () => {
      api.set(id);
    });
    fieldset.appendChild(btn);
    buttons[id] = btn;
  }

  wrap.appendChild(fieldset);
  if (mount.insert === 'first') {
    mount.parent.insertBefore(wrap, mount.parent.firstChild);
  } else {
    mount.parent.appendChild(wrap);
  }

  function sync(level) {
    for (const id of Object.keys(buttons)) {
      buttons[id].setAttribute('aria-pressed', id === level ? 'true' : 'false');
    }
  }

  api.onChange(sync);
  sync(api.get());

  return { root: wrap, sync };
}
