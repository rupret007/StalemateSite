/* Phone viewport fitting and secondary settings placement.
 * Eights pagination changes presentation only: every card stays in the engine hand. */
function setupMobileFit() {
  const phone = matchMedia('(max-width:980px)');
  // Keep music and accessibility reachable without covering the playfield.
  const topbar = document.querySelector('.topbar, .title-row');
  const menu = document.querySelector('.mobile-menu-actions, #tsTableMenu .actions');
  let destination = document.querySelector('.top-links, [data-mobile-game="turdomania"] .dock');
  let positionTools = () => {};
  if (!destination && topbar) {
    destination = document.createElement('div');
    destination.className = 'mobile-fit-tools';
    const spacer = document.createElement('div');
    spacer.className = 'mobile-fit-tools-space';
    topbar.append(spacer);
    document.body.append(destination);
    const tools = destination;
    positionTools = () => {
      if (!phone.matches) return;
      const count = tools.children.length;
      spacer.style.width = (count * 44 + Math.max(0, count - 1) * 3) + 'px';
      const rect = spacer.getBoundingClientRect();
      tools.style.left = rect.left + 'px';
      tools.style.top = rect.top + 'px';
    };
    new ResizeObserver(positionTools).observe(topbar);
    window.addEventListener('resize', positionTools);
  }
  if (destination) {
    const originals = new Map();
    function placeUtilities() {
      for (const setting of document.querySelectorAll('#suite-arcade-a11y-mount, body > .suite-arcade-a11y-toggle, body > .suite-difficulty--fallback, [data-mobile-game="neon-arkanoid"] > #suite-music-toggle, [data-mobile-game="turdomania"] > #suite-music-toggle, body[data-mobile-game] > #suite-music-toggle, .jack-difficulty-bar > .suite-difficulty, [data-mobile-game="crapeights"] .hud #suite-difficulty-mount > .suite-difficulty, [data-mobile-game="neon-arkanoid"] .play-area > .sidebar')) {
        if (!originals.has(setting)) originals.set(setting, setting.parentNode);
      }
      for (const [setting, original] of originals) {
        const secondary = setting.matches('#newRoundBtn, #resetMatchBtn')
          ? document.querySelector('#tableDrawer .tr-drawer-body')
          : (setting.matches('.suite-difficulty, .sidebar') ? menu : null);
        const parent = phone.matches ? (secondary || destination) : original;
        if (setting.parentNode !== parent) parent.append(setting);
      }
      positionTools();
    }
    phone.addEventListener('change', placeUtilities);
    const utilitySelector = '#suite-arcade-a11y-mount, .suite-arcade-a11y-toggle, .suite-difficulty--fallback, #suite-music-toggle';
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches(utilitySelector) || node.querySelector(utilitySelector))))) placeUtilities();
    }).observe(document.body, { childList:true, subtree:true });
    placeUtilities();
  }
  const well = document.querySelector('[data-mobile-game="turdtris"] .board-column');
  if (well) {
    const layout = document.querySelector('[data-mobile-game="turdtris"] > .layout');
    const wrap = well.querySelector('.board-wrap');
    function fitWell() {
      if (!phone.matches) { layout.style.removeProperty('--well-height'); return; }
      const style = getComputedStyle(wrap);
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const caption = wrap.querySelector('.well-caption').getBoundingClientRect().height;
      const stage = well.parentElement;
      const rail = stage.querySelector('.cabinet-rail');
      const railHeight = rail.getBoundingClientRect().height;
      const gap = railHeight ? parseFloat(getComputedStyle(stage).gap) || 0 : 0;
      const height = Math.max(0, Math.floor(Math.min(stage.clientHeight - railHeight - gap - vertical - caption - 4, (well.clientWidth - 16) * 2)));
      layout.style.setProperty('--well-height', height + 'px');
    }
    new ResizeObserver(fitWell).observe(well.parentElement);
    phone.addEventListener('change', fitWell);
    fitWell();
  }
  const legacyArea = document.querySelector('[data-mobile-game="neon-arkanoid"] .play-area');
  if (legacyArea) {
    const wrap = legacyArea.querySelector('.canvas-wrap');
    function fitLegacyCanvas() {
      if (!phone.matches) { wrap.style.removeProperty('width'); return; }
      wrap.style.width = Math.max(0, Math.min(legacyArea.clientWidth, (legacyArea.clientHeight - 4) * 1.5 + 4)) + 'px';
    }
    new ResizeObserver(fitLegacyCanvas).observe(legacyArea);
    phone.addEventListener('change', fitLegacyCanvas);
    fitLegacyCanvas();
  }
  const hand = document.querySelector('[data-mobile-game="crapeights"] #playerHand');
  if (!hand) return;
  let page = 0;
  const pager = document.createElement('span');
  pager.className = 'mobile-hand-pages';
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const count = document.createElement('span');
  previous.type = next.type = 'button';
  previous.textContent = '‹'; next.textContent = '›';
  previous.setAttribute('aria-label', 'Previous cards');
  next.setAttribute('aria-label', 'Next cards');
  count.setAttribute('aria-live', 'polite');
  pager.append(previous, count, next);
  document.querySelector('.hand-head').append(pager);
  function fit() {
    const cards = [...hand.querySelectorAll('[data-card-id]')];
    if (!phone.matches) {
      pager.hidden = true;
      cards.forEach(card => { card.hidden = false; });
      return;
    }
    const columns = Math.max(1, Math.floor((hand.clientWidth - 12) / 48));
    const capacity = columns * 2;
    const pages = Math.max(1, Math.ceil(cards.length / capacity));
    page = Math.min(page, pages - 1);
    pager.hidden = pages === 1;
    previous.disabled = page === 0; next.disabled = page === pages - 1;
    count.textContent = `${page + 1}/${pages}`;
    hand.style.height = '144px';
    hand.style.setProperty('--fan-w', '44px');
    hand.style.setProperty('--fan-h', '64px');
    cards.forEach((card, index) => {
      const local = index - page * capacity;
      card.hidden = local < 0 || local >= capacity;
      if (card.hidden) return;
      const row = Math.floor(local / columns);
      const rowCount = Math.min(columns, cards.length - page * capacity - row * columns);
      card.style.setProperty('--fan-x', `${(hand.clientWidth - rowCount * 48) / 2 + (local % columns) * 48}px`);
      card.style.setProperty('--fan-y', `${10 + row * 68}px`);
      card.style.setProperty('--fan-angle', '0deg');
    });
  }
  previous.addEventListener('click', () => { page--; fit(); });
  next.addEventListener('click', () => { page++; fit(); });
  new MutationObserver(fit).observe(hand, { childList: true });
  new ResizeObserver(fit).observe(hand);
  window.addEventListener('orientationchange', fit);
  phone.addEventListener('change', fit);
  fit();
 }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupMobileFit, { once:true });
else setupMobileFit();
