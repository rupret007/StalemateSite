/**
 * Crapjack page integrations (imported dynamically from turdjack.html).
 */
import { buildChipStackHtml } from './turdjack-chips.js';
import { buildFeltInlay } from './turdjack-felt.js';
import { createTurdjackAudio } from './turdjack-audio.js';
import { createTableFx } from './turdjack-fx.js';
import { handMeterState, renderHandMeterHtml } from './turdjack-hand-meter.js';
import {
  coachButtonIdForAction,
  coachWhyLine
} from './turdjack-coach.js';
import {
  dealFlightDurationMs,
  flightDelta,
  dealerRevealPauseMs,
  useDealFlight
} from './turdjack-deal-anim.js';
import { buildFeltChipStackHtml, feltBetLabel } from './turdjack-table-chips.js';
import { clearFlyingChips, FLYING_CHIP_CLASS, FLYING_CHIP_MAX_MS } from './turdjack-chip-flight.js';
import {
  momentKindFromStatus,
  momentBannerCopy,
  bankrollTweenSteps,
  tableEdgeStreakLabel
} from './turdjack-moments.js';
import {
  dismissMomentBanner,
  showMomentBannerUi,
  wireMomentBannerSkip
} from './turdjack-moment-ui.js';
import { formatHandTotalBadge, renderTotalBadgeHtml } from './turdjack-totals.js';
import {
  chipSettlementKind,
  shouldAnimateChipSettlement
} from './turdjack-chip-motion.js';
import {
  announceLive,
  dealerHitDelayMs,
  dealerHitAnnouncement,
  dealerRevealAnnouncement,
  roundResultAnnouncement
} from './turdjack-a11y.js';

const PRACTICE_KEY = 'turdjack_practice_v1';
const INTEL_SEEN_KEY = 'turdjack_intel_seen_v1';

function suiteMuted() {
  try {
    return localStorage.getItem('turdsuite_muted') === '1';
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function readPracticeMode() {
  try {
    return localStorage.getItem(PRACTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePracticeMode(on) {
  try {
    localStorage.setItem(PRACTICE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * @param {Window} win
 */
export function installTurdjackKit(win) {
  const doc = win.document;
  const table = doc.querySelector('.table');
  const canvas = doc.getElementById('tableFxCanvas');
  const ruleSummary = doc.getElementById('ruleSummary');
  let reducedMotion = prefersReducedMotion();

  const audio = createTurdjackAudio({
    getSoundEnabled: () => !!win.__turdjackSoundEnabled,
    getSuiteMuted: suiteMuted
  });

  win.__turdjackAudio = audio;
  win.__turdjackPracticeMode = readPracticeMode();

  let fx = null;
  if (canvas && table) {
    fx = createTableFx(canvas, { reducedMotion });
    win.addEventListener('resize', () => fx.resize());
    try {
      win.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
        reducedMotion = e.matches;
        fx.setReducedMotion(e.matches);
      });
    } catch {
      /* ignore */
    }
  }

  let displayedBankroll = null;
  let bankrollTweenTimer = null;
  let lastCardCounts = { dealer: 0, player: 0, split: 0 };
  let coachPulseTimer = null;

  function paintFeltInlay() {
    if (!table) {return;}
    const note = ruleSummary ? String(ruleSummary.textContent || '') : '';
    const payout = note.includes('6:5') ? '6:5' : '3:2';
    const stands = !note.includes('hits soft 17');
    table.style.setProperty('--felt-inlay', buildFeltInlay(payout, stands));
  }

  paintFeltInlay();
  if (ruleSummary && win.MutationObserver) {
    new win.MutationObserver(paintFeltInlay).observe(ruleSummary, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function flyChipToBet(btn) {
    if (reducedMotion || !btn) {return;}
    const betZone = doc.getElementById('betCircle');
    if (!betZone) {return;}
    const tableSection = doc.querySelector('.table');
    if (tableSection?.dataset?.phase === 'playing') {return;}
    clearFlyingChips(betZone);
    const chip = doc.createElement('span');
    chip.className = FLYING_CHIP_CLASS;
    const denom = btn.dataset.chip || '10';
    chip.dataset.denom = denom;
    const from = btn.getBoundingClientRect();
    const to = betZone.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    chip.style.setProperty('--fly-dx', `${dx}px`);
    chip.style.setProperty('--fly-dy', `${dy}px`);
    betZone.appendChild(chip);
    const remove = () => chip.remove();
    chip.addEventListener('animationend', remove, { once: true });
    globalThis.setTimeout(remove, FLYING_CHIP_MAX_MS);
    audio.play('chip');
  }

  function animateChipSettlement(statusText) {
    const kind = chipSettlementKind(statusText);
    if (!shouldAnimateChipSettlement(reducedMotion, kind)) {return;}
    const zone = doc.getElementById('betCircle');
    if (!zone) {return;}
    zone.classList.remove('chips-pay-player', 'chips-sweep-away');
    void zone.offsetWidth;
    zone.classList.add(kind === 'pay' ? 'chips-pay-player' : 'chips-sweep-away');
    if (kind === 'pay') {audio.play('chip');}
    globalThis.setTimeout(() => {
      zone.classList.remove('chips-pay-player', 'chips-sweep-away');
    }, reducedMotion ? 0 : 720);
  }

  doc.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) {return;}
      flyChipToBet(btn);
      btn.classList.remove('tossed');
      void btn.offsetWidth;
      btn.classList.add('tossed');
    });
    btn.addEventListener('animationend', () => btn.classList.remove('tossed'));
  });

  function animateDealCards() {
    if (!useDealFlight(reducedMotion)) {return;}
    const shoe = doc.getElementById('shoeLane');
    if (!shoe || !table) {return;}
    const shoeRect = shoe.getBoundingClientRect();
    doc.querySelectorAll('.cards .playing-card').forEach((card) => {
      if (card.dataset.flew === '1') {return;}
      card.dataset.flew = '1';
      const to = card.getBoundingClientRect();
      const { dx, dy, dist } = flightDelta(shoeRect, to);
      const ms = dealFlightDurationMs(dist, reducedMotion);
      card.style.setProperty('--deal-dx', `${dx}px`);
      card.style.setProperty('--deal-dy', `${dy}px`);
      card.style.setProperty('--deal-ms', `${ms}ms`);
      card.classList.add('deal-from-shoe');
    });
  }

  function clearDealFlags() {
    doc.querySelectorAll('.playing-card.deal-from-shoe').forEach((el) => {
      el.classList.remove('deal-from-shoe');
      delete el.dataset.flew;
    });
  }

  function updateBetCircle(amount) {
    const zone = doc.getElementById('betCircle');
    const stack = doc.getElementById('betCircleStack');
    const label = doc.getElementById('betCircleLabel');
    if (!zone) {return;}
    const n = Number.isFinite(amount) ? amount : 0;
    if (label) {label.textContent = feltBetLabel(n);}
    if (stack) {stack.innerHTML = buildFeltChipStackHtml(n);}
    zone.classList.toggle('has-bet', n >= 10);
  }

  function updateTotalBadges(state) {
    if (!state || typeof state.handValue !== 'function') {return;}
    const dealerEl = doc.getElementById('dealerTotalBadge');
    const playerEl = doc.getElementById('playerTotalBadge');
    const splitEl = doc.getElementById('splitTotalBadge');
    const dealerHidden = !!state.dealerHoleHidden;
    const dTotal = dealerHidden
      ? (state.dealerHand && state.dealerHand[0] ? state.handValue([state.dealerHand[0]]) : 0)
      : state.handValue(state.dealerHand || []);
    const dSoft = !dealerHidden && typeof state.isSoftHand === 'function' && state.isSoftHand(state.dealerHand || []);
    if (dealerEl) {
      dealerEl.innerHTML = renderTotalBadgeHtml(formatHandTotalBadge(dTotal, dSoft, dealerHidden));
    }
    if (playerEl) {
      const pTotal = state.handValue(state.playerHand || []);
      const pSoft = typeof state.isSoftHand === 'function' && state.isSoftHand(state.playerHand || []);
      playerEl.innerHTML = renderTotalBadgeHtml(formatHandTotalBadge(pTotal, pSoft, false));
    }
    if (splitEl) {
      const show = state.splitRound || (state.splitHand && state.splitHand.length);
      splitEl.hidden = !show;
      if (show) {
        const sTotal = state.handValue(state.splitHand || []);
        const sSoft = typeof state.isSoftHand === 'function' && state.isSoftHand(state.splitHand || []);
        splitEl.innerHTML = renderTotalBadgeHtml(formatHandTotalBadge(sTotal, sSoft, false));
      }
    }
  }

  function updateTableEdgeStreak(hot, cold) {
    const edge = doc.getElementById('tableEdgeStreak');
    if (!edge) {return;}
    const label = tableEdgeStreakLabel(hot || 0, cold || 0);
    edge.textContent = label;
    edge.hidden = !label;
    edge.classList.toggle('hot', hot >= 3);
    edge.classList.toggle('cold', cold >= 3);
  }

  function tweenBankroll(toValue, snap) {
    const el = doc.getElementById('bankrollText');
    if (!el || reducedMotion || snap) {
      if (el) {el.textContent = `$${toValue.toLocaleString()}`;}
      if (bankrollTweenTimer) {
        globalThis.clearInterval(bankrollTweenTimer);
        bankrollTweenTimer = null;
      }
      displayedBankroll = toValue;
      return;
    }
    const from = displayedBankroll === null || displayedBankroll === undefined ? toValue : displayedBankroll;
    if (from === toValue) {
      displayedBankroll = toValue;
      return;
    }
    if (bankrollTweenTimer) {globalThis.clearInterval(bankrollTweenTimer);}
    const steps = bankrollTweenSteps(from, toValue, 14);
    let i = 0;
    bankrollTweenTimer = globalThis.setInterval(() => {
      if (i >= steps.length) {
        globalThis.clearInterval(bankrollTweenTimer);
        bankrollTweenTimer = null;
        displayedBankroll = toValue;
        return;
      }
      el.textContent = `$${steps[i].toLocaleString()}`;
      el.classList.add('bankroll-tween');
      i++;
    }, 40);
    setTimeout(() => el.classList.remove('bankroll-tween'), steps.length * 40 + 80);
    displayedBankroll = toValue;
  }

  const momentBannerEl = doc.getElementById('momentBanner');
  if (momentBannerEl) {
    wireMomentBannerSkip(momentBannerEl);
  }

  function showMomentBanner(kind) {
    const banner = doc.getElementById('momentBanner');
    if (!banner || !kind) {return;}
    showMomentBannerUi(banner, momentBannerCopy, kind, reducedMotion);
    if (kind === 'blackjack') {audio.play('fanfare');}
    if (kind === 'bust') {audio.play('bust');}
    if (kind === 'split' || kind === 'double') {audio.play('chip');}
  }

  function flashActionMoment(kind) {
    showMomentBanner(kind);
  }

  function highlightCoachAction(action) {
    doc.querySelectorAll('.coach-pulse').forEach((b) => b.classList.remove('coach-pulse'));
    const id = coachButtonIdForAction(action);
    if (!id) {return;}
    const btn = doc.getElementById(id);
    if (!btn || btn.disabled) {return;}
    btn.classList.add('coach-pulse');
    if (coachPulseTimer) {clearTimeout(coachPulseTimer);}
    coachPulseTimer = setTimeout(() => btn.classList.remove('coach-pulse'), reducedMotion ? 800 : 2200);
  }

  function setCoachWhy(advice) {
    const line = doc.getElementById('coachWhyLine');
    if (!line) {return;}
    const text = coachWhyLine(advice);
    if (!text) {
      line.hidden = true;
      line.textContent = '';
      return;
    }
    line.hidden = false;
    line.textContent = text;
  }

  function dealerRevealBeat(done) {
    const pause = dealerRevealPauseMs(reducedMotion);
    announceLive(doc, 'Dealer reveals the hole card.');
    if (!pause) {
      done();
      return;
    }
    audio.play('drumroll');
    const hole = doc.querySelector('#dealerCards .playing-card:nth-child(2)');
    if (hole) {hole.classList.add('hole-suspense');}
    setTimeout(() => {
      if (hole) {hole.classList.remove('hole-suspense');}
      done();
    }, pause);
  }

  function bustCrumble(handKey) {
    if (reducedMotion) {return;}
    const id = handKey === 'split' ? 'splitCards' : 'playerCards';
    const wrap = doc.getElementById(id);
    if (!wrap) {return;}
    wrap.classList.add('hand-bust-crumble');
    setTimeout(() => wrap.classList.remove('hand-bust-crumble'), 700);
  }

  function markHoleFlipOnCard(cardEl) {
    if (reducedMotion || !cardEl) {return;}
    cardEl.classList.add('hole-flip-reveal');
    cardEl.addEventListener(
      'animationend',
      () => cardEl.classList.remove('hole-flip-reveal'),
      { once: true }
    );
  }

  function wireIntelDrawer() {
    const panel = doc.getElementById('intelSlide');
    const toggle = doc.getElementById('intelToggleBtn');
    const backdrop = doc.getElementById('intelBackdrop');
    const practice = doc.getElementById('practiceModeToggle');

    function setOpen(open) {
      if (!panel) {return;}
      panel.classList.toggle('open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (toggle) {toggle.setAttribute('aria-expanded', open ? 'true' : 'false');}
      if (backdrop) {
        backdrop.classList.toggle('show', open);
        backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      if (open) {
        try {localStorage.setItem(INTEL_SEEN_KEY, '1');} catch { /* ignore */ }
      }
    }

    if (toggle) {
      toggle.addEventListener('click', () => setOpen(!panel?.classList.contains('open')));
    }
    if (backdrop) {
      backdrop.addEventListener('click', () => setOpen(false));
    }
    if (practice) {
      practice.checked = readPracticeMode();
      practice.addEventListener('change', () => {
        win.__turdjackPracticeMode = practice.checked;
        writePracticeMode(practice.checked);
      });
    }

    try {
      const seen = localStorage.getItem(INTEL_SEEN_KEY) === '1';
      if (!seen && panel && win.matchMedia('(min-width: 981px)').matches) {
        setOpen(false);
      }
    } catch {
      /* ignore */
    }
  }

  wireIntelDrawer();

  function afterHud(state) {
    try {
      const betEl = doc.getElementById('betText');
      if (betEl && state) {
        const amount = state.splitRound
          ? (state.currentBet || 0) + (state.splitBet || 0)
          : (state.currentBet || 0);
        betEl.innerHTML = '$' + amount.toLocaleString() + buildChipStackHtml(amount);
        updateBetCircle(amount);
      }
      if (state && Number.isFinite(state.bankroll)) {
        tweenBankroll(state.bankroll, !!state.roundActive);
      }
      updateHandMeters(doc, state);
      updateTotalBadges(state);
      if (state) {
        updateTableEdgeStreak(state.hotStreak, state.coldStreak);
      }

      const d = state?.dealerHand?.length || 0;
      const p = state?.playerHand?.length || 0;
      const s = state?.splitHand?.length || 0;
      if (d > lastCardCounts.dealer || p > lastCardCounts.player || s > lastCardCounts.split) {
        globalThis.setTimeout(() => animateDealCards(), 0);
      }
      lastCardCounts = { dealer: d, player: p, split: s };
    } catch {
      /* ignore */
    }
  }

  function afterStatus(text) {
    try {
      const raw = String(text || '');
      const lower = raw.toLowerCase();
      const liveMsg = lower.includes('hand') && (
        lower.includes('wins')
        || lower.includes('loses')
        || lower.includes('push')
        || lower.includes('bust')
      )
        ? roundResultAnnouncement(raw)
        : raw;
      announceLive(doc, liveMsg);
      if (!fx) {return;}
      fx.burstFromStatus(text);
      if (lower.includes('bust') || (lower.includes('blackjack') && !lower.includes('dealer'))) {
        fx.shakeTable(table);
      }
      const moment = momentKindFromStatus(text);
      if (moment) {showMomentBanner(moment);}
      if (lower.includes('bust') && !lower.includes('dealer bust')) {
        bustCrumble(lower.includes('hand 2') ? 'split' : 'player');
      }
      if (moment || chipSettlementKind(text)) {
        animateChipSettlement(text);
      }
    } catch {
      /* ignore */
    }
  }

  function coachHint(advice) {
    if (!advice) {return;}
    setCoachWhy(advice);
    highlightCoachAction(advice.action);
  }

  function onNewRound() {
    clearDealFlags();
    lastCardCounts = { dealer: 0, player: 0, split: 0 };
    setCoachWhy(null);
    doc.querySelectorAll('.coach-pulse').forEach((b) => b.classList.remove('coach-pulse'));
    clearFlyingChips(doc.getElementById('betCircle'));
    clearFlyingChips(doc.querySelector('.table'));
  }

  function onSplit() {
    const splitWrap = doc.getElementById('splitHandWrap');
    if (splitWrap && !reducedMotion) {
      splitWrap.classList.add('split-slide-in');
      setTimeout(() => splitWrap.classList.remove('split-slide-in'), 500);
    }
  }

  win.__turdjackKit = {
    audio,
    fx,
    coachHint,
    dealerRevealBeat,
    onNewRound,
    onSplit,
    markHoleFlipOnCard,
    flashActionMoment,
    dismissMoment: () => dismissMomentBanner(momentBannerEl, momentBannerEl?.__momentTimer || null),
    isPracticeMode: () => !!win.__turdjackPracticeMode,
    announceLive: (message) => announceLive(doc, message),
    dealerHitDelayMs: () => dealerHitDelayMs(reducedMotion),
    dealerRevealAnnouncement,
    dealerHitAnnouncement
  };

  return {
    audio,
    fx,
    paintFeltInlay,
    afterHud,
    afterStatus,
    coachHint,
    dealerRevealBeat,
    onNewRound,
    onSplit,
    markHoleFlipOnCard
  };
}

function updateHandMeters(doc, state) {
  if (!state || typeof state.handValue !== 'function') {return;}
  const playerMeter = doc.getElementById('playerHandMeter');
  const splitMeter = doc.getElementById('splitHandMeter');
  if (!playerMeter) {return;}

  const pTotal = state.handValue(state.playerHand || []);
  const pSoft = typeof state.isSoftHand === 'function' && state.isSoftHand(state.playerHand || []);
  const pMeter = handMeterState(pTotal, pSoft);
  playerMeter.innerHTML = renderHandMeterHtml(pMeter);
  playerMeter.classList.toggle('meter-danger-pulse', pMeter.danger && pMeter.filled < 21);

  if (splitMeter) {
    const show = state.splitRound || (state.splitHand && state.splitHand.length);
    splitMeter.hidden = !show;
    if (show) {
      const sTotal = state.handValue(state.splitHand || []);
      const sSoft = typeof state.isSoftHand === 'function' && state.isSoftHand(state.splitHand || []);
      const sMeter = handMeterState(sTotal, sSoft);
      splitMeter.innerHTML = renderHandMeterHtml(sMeter);
      splitMeter.classList.toggle('meter-danger-pulse', sMeter.danger && sMeter.filled < 21);
    }
  }
}
