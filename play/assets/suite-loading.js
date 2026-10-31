/* Each game reports ready only after its controls and required modules bind.
   Slow/failed boot offers a deliberate reload, never an automatic retry loop. */
(function attachGameLoading(root) {
  'use strict';
  if (root.SuiteLoading) return;
  const doc = root.document;
  let phase = 'pending';
  let timer = 0;
  let dialog = null;
  let previousFocus = null;

  function clearDeadline() {
    root.clearTimeout(timer);
    timer = 0;
  }

  function returnToHub() {
    root.location.assign(new URL('./', root.location.href).href);
  }

  function showFailure() {
    if (phase !== 'failed' || dialog) return;
    const style = doc.createElement('style');
    style.textContent = `
      #suite-load-state { box-sizing:border-box; width:min(440px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow:auto; margin:auto; padding:24px; border:2px solid #8ee8c7; border-radius:16px; background:#10251e; color:#fff2d5; font:16px/1.5 system-ui,sans-serif; text-align:left; }
      #suite-load-state::backdrop { background:rgba(0,0,0,.82); }
      #suite-load-state h2 { font:700 24px/1.2 system-ui,sans-serif; margin:0 0 12px; color:#fff2d5; }
      #suite-load-state p { margin:0 0 16px; }
      #suite-load-state .suite-load-actions { display:flex; flex-wrap:wrap; gap:12px; }
      #suite-load-state button,#suite-load-state a { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; min-width:44px; min-height:44px; padding:10px 14px; border:2px solid #8ee8c7; border-radius:8px; font:700 15px/1.2 system-ui,sans-serif; cursor:pointer; }
      #suite-load-state button { color:#10251e; background:#8ee8c7; }
      #suite-load-state a { color:#fff2d5; background:#10251e; text-decoration:underline; }
      #suite-load-state :focus-visible { outline:3px solid #fff2b8; outline-offset:4px; }
    `;
    doc.head.append(style);
    dialog = doc.createElement('dialog');
    dialog.id = 'suite-load-state';
    dialog.setAttribute('aria-labelledby', 'suite-load-title');
    dialog.setAttribute('aria-describedby', 'suite-load-description');
    const heading = doc.createElement('h2');
    heading.id = 'suite-load-title';
    heading.textContent = "The game couldn't finish loading";
    const description = doc.createElement('p');
    description.id = 'suite-load-description';
    description.textContent = 'Check your connection, then try again. Your saved games and records will stay on this device.';
    const actions = doc.createElement('div');
    actions.className = 'suite-load-actions';
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => root.location.reload());
    const back = doc.createElement('a');
    back.href = './';
    back.textContent = 'Back to arcade';
    actions.append(retry, back);
    dialog.append(heading, description, actions);
    // Let the browser's modal focus loop run without a game's shortcuts
    // intercepting Tab, Enter or Escape in this recovery dialog.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      returnToHub();
    });
    previousFocus = doc.activeElement;
    // A parser-blocking download in <head> may not have created the body yet.
    // Waiting for DOMContentLoaded would also wait forever for that download.
    (doc.body || doc.documentElement).append(dialog);
    dialog.showModal();
    retry.focus();
  }

  function fail() {
    if (phase !== 'pending') return;
    phase = 'failed';
    clearDeadline();
    showFailure();
  }

  function startDeadline() {
    clearDeadline();
    if (phase === 'pending') timer = root.setTimeout(fail, 12000);
  }

  root.SuiteLoading = {
    get state() { return phase; },
    ready() {
      if (phase === 'ready') return;
      phase = 'ready';
      clearDeadline();
      if (dialog) {
        dialog.close();
        dialog.remove();
        dialog = null;
        if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
      }
    }
  };
  root.addEventListener('error', event => {
    if (event.target === root || event.target?.matches?.('script[data-game-required],link[data-game-required]')) fail();
  }, true);
  root.addEventListener('pagehide', clearDeadline);
  root.addEventListener('pageshow', startDeadline);
  startDeadline();
})(window);
