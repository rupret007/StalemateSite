/**
 * In-page Yes/No confirm for insurance, even money, and bankroll reset.
 */

export const JACK_CONFIRM_IDS = {
  overlay: 'jackConfirmOverlay',
  title: 'jackConfirmTitle',
  message: 'jackConfirmMessage',
  accept: 'jackConfirmYes',
  decline: 'jackConfirmNo'
};

/**
 * @param {KeyboardEvent | { key: string, preventDefault?: () => void }} event
 * @param {{ onAccept: () => void, onDecline: () => void }} handlers
 * @returns {boolean} true if handled
 */
export function handleConfirmKeydown(event, handlers) {
  const key = event.key;
  if (key === 'Escape') {
    event.preventDefault?.();
    handlers.onDecline();
    return true;
  }
  return false;
}

/**
 * @param {HTMLElement[]} focusables
 * @param {HTMLElement} current
 * @param {1 | -1} direction
 */
export function nextFocusable(focusables, current, direction) {
  if (!focusables.length) {return null;}
  const idx = focusables.indexOf(current);
  const start = idx < 0 ? 0 : idx;
  const next = (start + direction + focusables.length) % focusables.length;
  return focusables[next];
}

/**
 * @param {HTMLElement} node
 */
export function isFocusableButton(node) {
  return node && node.tagName === 'BUTTON' && !node.disabled;
}

/**
 * @param {Document} doc
 * @param {Window} win
 */
export function createJackConfirmAsk(doc, win) {
  const overlay = doc.getElementById(JACK_CONFIRM_IDS.overlay);
  const titleEl = doc.getElementById(JACK_CONFIRM_IDS.title);
  const messageEl = doc.getElementById(JACK_CONFIRM_IDS.message);
  const acceptBtn = doc.getElementById(JACK_CONFIRM_IDS.accept);
  const declineBtn = doc.getElementById(JACK_CONFIRM_IDS.decline);

  if (!overlay || !titleEl || !messageEl || !acceptBtn || !declineBtn) {
    throw new Error('jack confirm modal markup missing');
  }

  /** @type {((value: boolean) => void) | null} */
  let pending = null;
  /** @type {HTMLElement | null} */
  let restoreFocus = null;

  function focusables() {
    return [declineBtn, acceptBtn].filter((el) => isFocusableButton(el));
  }

  function closeModal(result) {
    if (!pending) {return;}
    const resolve = pending;
    pending = null;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    doc.removeEventListener('keydown', onKeydown, true);
    acceptBtn.removeEventListener('click', onAccept);
    declineBtn.removeEventListener('click', onDecline);
    if (restoreFocus && typeof restoreFocus.focus === 'function') {
      try {
        restoreFocus.focus({ preventScroll: true });
      } catch {
        restoreFocus.focus();
      }
    }
    restoreFocus = null;
    resolve(result);
  }

  function onAccept() {
    closeModal(true);
  }

  function onDecline() {
    closeModal(false);
  }

  function onKeydown(event) {
    if (!pending) {return;}
    if (handleConfirmKeydown(event, { onAccept, onDecline })) {return;}
    if (event.key === 'Tab') {
      const list = focusables();
      if (!list.length) {return;}
      event.preventDefault();
      const active = doc.activeElement;
      const current =
        active && active.tagName === 'BUTTON' && !active.disabled ? active : list[0];
      const next = nextFocusable(list, current, event.shiftKey ? -1 : 1);
      next?.focus();
    }
  }

  /**
   * @param {{ title?: string, message: string, acceptLabel?: string, declineLabel?: string }} options
   * @returns {Promise<boolean>}
   */
  function ask(options) {
    if (pending) {
      return Promise.reject(new Error('confirm already open'));
    }
    const message = String(options.message || '').trim();
    if (!message) {
      return Promise.resolve(false);
    }
    titleEl.textContent = options.title ? String(options.title) : 'Pit decision';
    messageEl.textContent = message;
    acceptBtn.textContent = options.acceptLabel || 'Yes';
    declineBtn.textContent = options.declineLabel || 'No';

    restoreFocus = doc.activeElement;
    if (restoreFocus && typeof restoreFocus.focus !== 'function') {
      restoreFocus = null;
    }

    return new Promise((resolve) => {
      pending = resolve;
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      doc.addEventListener('keydown', onKeydown, true);
      acceptBtn.addEventListener('click', onAccept);
      declineBtn.addEventListener('click', onDecline);
      win.requestAnimationFrame(() => {
        declineBtn.focus();
      });
    });
  }

  return ask;
}
