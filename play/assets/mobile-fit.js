/* Shared phone layout plumbing. Game rules, input handlers and audio stay game-owned. */
(() => {
  'use strict';
  const root = document.documentElement;
  const game = root.dataset.mobileGame;
  const phone = matchMedia('(max-width: 980px)');
  const pagers = [];
  const placements = new Map();
  function move(element, parent) {
    if (!element || !parent || element.parentNode === parent || element.contains(parent)) return;
    if (!placements.has(element)) placements.set(element, {parent:element.parentNode, next:element.nextSibling});
    parent.append(element);
  }
  let frame;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
  function canvasFit(canvas, host, aspect, reserve = 0) {
    if (!canvas || !host) return;
    const height = Math.max(1, host.clientHeight - reserve);
    const width = Math.max(1, Math.min(host.clientWidth - 12, height * aspect));
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${width / aspect}px`, 'important');
    if (game === 'neon-arkanoid') canvas.parentElement.style.width = `${width}px`;
  }
  function fit() {
    placeSettings();
    const strip = document.querySelector('.stalemate-strip');
    const musicStatus = document.getElementById('suite-music-status');
    const footer = `${(strip ? strip.getBoundingClientRect().height : 0) + (musicStatus ? musicStatus.getBoundingClientRect().height : 0)}px`;
    if (root.style.getPropertyValue('--mobile-footer') !== footer) {
      root.style.setProperty('--mobile-footer', footer);
      window.dispatchEvent(new Event('resize'));
    }
    pagers.forEach(update => update());
    if (!phone.matches) return;
    if (game === 'turdtris') canvasFit(document.querySelector('#game'), document.querySelector('.game-grid'), 0.5, 14);
    if (game === 'neon-arkanoid') canvasFit(document.querySelector('#gameCanvas'), document.querySelector('.play-area'), 1.5, 4);
  }
  function handPager(hand) {
    if (!hand) return;
    const nav = document.createElement('nav');
    nav.className = 'mobile-hand-pager mobile-hand-pages';
    nav.setAttribute('aria-label', 'Browse your hand');
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    prev.type = next.type = 'button';
    prev.textContent = '‹'; next.textContent = '›';
    prev.setAttribute('aria-label', 'Previous cards'); next.setAttribute('aria-label', 'Next cards');
    nav.append(prev, label, next);
    hand.before(nav);
    let start = 0;
    let size = 5;
    function update() {
      const cards = [...hand.querySelectorAll('button, .card')];
      const fitted = phone.matches && window.innerWidth >= 360;
      const paginate = game === 'crapeights';
      hand.classList.toggle('mobile-hand', fitted);
      // Width comes from the hand, since landscape tables use side-by-side columns.
      size = Math.max(1, Math.min(8, Math.floor((hand.clientWidth - 4) / 48)));
      start = Math.min(start, Math.max(0, Math.ceil(cards.length / size) - 1) * size);
      nav.hidden = !fitted || !paginate || cards.length <= size;
      hand.style.setProperty('--mobile-hand-height', `${paginate ? 88 : Math.max(1, Math.ceil(cards.length / size)) * 68}px`);
      hand.style.setProperty('--mobile-card-height', paginate ? '84px' : '64px');
      hand.style.setProperty('--hand-columns', size);
      const text = `${Math.min(start + 1, cards.length)}–${Math.min(start + size, cards.length)} / ${cards.length}`;
      if (label.textContent !== text) label.textContent = text;
      prev.disabled = start === 0; next.disabled = start + size >= cards.length;
      cards.forEach((card, i) => {
        const hidden = fitted && paginate && (i < start || i >= start + size);
        card.classList.toggle('mobile-card-hidden', hidden);
        card.hidden = hidden;
      });
    }
    prev.addEventListener('click', () => { start = Math.max(0, start - size); update(); });
    next.addEventListener('click', () => { start += size; update(); });
    // Keyboard navigation in the game can move focus to another page.
    hand.addEventListener('focusin', event => {
      const index = [...hand.querySelectorAll('button, .card')].indexOf(event.target);
      if (index >= 0 && (index < start || index >= start + size)) { start = Math.floor(index / size) * size; update(); }
    });
    new MutationObserver(schedule).observe(hand, { childList:true, subtree:true });
    pagers.push(update);
  }
  function placeSettings() {
    if (!phone.matches) {
      [...placements.entries()].reverse().forEach(([element, place]) => place.parent.insertBefore(element, place.next?.parentNode === place.parent ? place.next : null));
      placements.clear();
      return;
    }
    document.querySelectorAll('.welcome-card, .guide-card, #welcomeGuide .overlay-card, #guideOverlay .overlay-card, #howToPlay .how-card').forEach(card => {
      let details = card.querySelector(':scope > .mobile-guide-details');
      if (!details) {
        details = document.createElement('details');
        details.className = 'mobile-guide-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Rules & tips';
        const body = document.createElement('div');
        details.append(summary, body);
        card.append(details);
      }
      const intro = card.querySelector(':scope > p');
      [...card.children].forEach(child => {
        if (child === details || child === intro || child.matches('h1, h2, .welcome-actions, .overlay-actions, .guide-actions, .attract-modes')) return;
        move(child, details.lastElementChild);
      });
    });
    let menu = document.querySelector('.mobile-menu-actions, .table-menu .actions');
    if (game === 'turdrummy' && !document.querySelector('.mobile-settings')) {
      const details = document.createElement('details');
      details.className = 'mobile-settings';
      const summary = document.createElement('summary');
      summary.textContent = 'Table menu';
      const panel = document.createElement('div');
      panel.className = 'mobile-settings-panel';
      details.append(summary, panel);
      document.querySelector('.topbar').append(details);
      ['.tr-difficulty-topbar'].forEach(selector => {
        const element = document.querySelector(selector);
        if (element) move(element, panel);
      });
    }
    menu = document.querySelector('.mobile-settings-panel') || menu;
    if (game === 'turdrummy') ['.tr-difficulty-topbar'].forEach(selector => move(document.querySelector(selector), menu));
    if (menu) {
      const settings = game === 'turdtris' ? ['#suite-difficulty-mount', '.run-settings']
        : game === 'crapeights' ? ['#suite-difficulty-mount']
        : game === 'turdjack' ? ['.mobile-pit-extra']
        : game === 'neon-arkanoid' ? ['.suite-difficulty'] : [];
      settings.forEach(selector => {
        const element = document.querySelector(selector);
        move(element, menu);
      });
    }
    move(document.querySelector('#suite-music-toggle'), document.body);
    move(document.querySelector('#suite-arcade-a11y-mount'), document.body);

  }
  function init() {
    placeSettings();
    new MutationObserver(() => { placeSettings(); }).observe(document.body, { childList:true, subtree:true });
    if (['crapeights', 'turdrummy'].includes(game)) handPager(document.querySelector('#playerHand'));
    if (game === 'turdspades') handPager(document.querySelector('#youCards'));
    const host = document.querySelector(game === 'turdtris' ? '.game-grid' : '.play-area');
    if (host) new ResizeObserver(schedule).observe(host);
    const strip = document.querySelector('.stalemate-strip');
    if (strip) new ResizeObserver(schedule).observe(strip);
    fit();
    // The suite can insert controls after dynamic imports; refit after its first layout.
    setTimeout(schedule, 500);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  phone.addEventListener('change', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
