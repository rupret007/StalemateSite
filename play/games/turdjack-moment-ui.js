/** Moment banner timing + dismiss (reduced-motion aware). */

/**
 * @param {boolean} reducedMotion
 */
export function momentDisplayMs(reducedMotion) {
  return reducedMotion ? 400 : 1200;
}

/**
 * @param {HTMLElement | null} banner
 * @param {number | null} timerId
 */
export function dismissMomentBanner(banner, timerId) {
  if (timerId) {globalThis.clearTimeout(timerId);}
  if (!banner) {return null;}
  banner.classList.remove('show');
  banner.removeAttribute('data-kind');
  banner.textContent = '';
  banner.setAttribute('aria-hidden', 'true');
  return null;
}

/**
 * @param {HTMLElement} banner
 * @param {(kind: string) => string} copyForKind
 * @param {string} kind
 * @param {boolean} reducedMotion
 * @param {{ onDismiss?: () => void }} [opts]
 */
export function showMomentBannerUi(banner, copyForKind, kind, reducedMotion, opts = {}) {
  const copy = copyForKind(kind);
  if (!copy) {return null;}

  let timerId = banner.__momentTimer || null;
  timerId = dismissMomentBanner(banner, timerId);

  banner.textContent = copy;
  banner.dataset.kind = kind;
  banner.setAttribute('aria-hidden', 'false');
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');

  const ms = momentDisplayMs(reducedMotion);
  timerId = globalThis.setTimeout(() => {
    dismissMomentBanner(banner, null);
    banner.__momentTimer = null;
    if (opts.onDismiss) {opts.onDismiss();}
  }, ms);
  banner.__momentTimer = timerId;
  return timerId;
}

/**
 * @param {HTMLElement} banner
 * @param {() => void} [onSkip]
 */
export function wireMomentBannerSkip(banner, onSkip) {
  if (!banner || banner.__momentSkipWired) {return;}
  banner.__momentSkipWired = true;
  banner.setAttribute('role', 'button');
  banner.setAttribute('tabindex', '0');
  banner.setAttribute('aria-label', 'Dismiss celebration');

  const skip = () => {
    dismissMomentBanner(banner, banner.__momentTimer || null);
    banner.__momentTimer = null;
    if (onSkip) {onSkip();}
  };

  banner.addEventListener('click', skip);
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      skip();
    }
  });
}
