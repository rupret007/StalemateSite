/* Focus for the existing card-table guides and result sheets. No game state. */
(function attachDialogFocus(root) {
  'use strict';
  const doc = root.document;
  if (!doc) {return;}
  let active = null;
  let generation = 0;
  let observer = null;

  function available(node) {
    if (!node?.isConnected || node.disabled || node.closest('[inert]')) {return false;}
    for (let parent = node; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert) {return false;}
      const style = root.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {return false;}
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(node)) {return false;}
    }
    return true;
  }

  function controls(dialog) {
    return [...dialog.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]')]
      .filter(node => node.tabIndex >= 0 && available(node));
  }

  function resolve(value, dialog) {
    if (typeof value === 'function') {return value();}
    if (typeof value === 'string') {return (dialog || doc).querySelector(value);}
    return value;
  }

  function focusInside() {
    if (!active) {return;}
    const desired = resolve(active.options.initialFocus, active.dialog);
    const target = available(desired) ? desired : controls(active.dialog)[0] || active.dialog;
    if (target === active.dialog && !target.hasAttribute('tabindex')) {target.tabIndex = -1;}
    target.focus({ preventScroll: true });
  }

  function restoreBackground(record) {
    for (const [node, previous] of record.background) {node.inert = previous;}
  }

  function isolate(record, parent = doc.body) {
    for (const child of parent.children) {
      if (child === record.dialog) {continue;}
      if (child.contains(record.dialog)) {isolate(record, child);}
      else {
        if (!record.background.has(child)) {record.background.set(child, !!child.inert);}
        child.inert = true;
      }
    }
  }

  function open(dialog, options = {}) {
    if (!dialog || active?.dialog === dialog) {return;}
    // These sheets are mutually exclusive. Restore first so repeated opens do
    // not accidentally make a formerly inert table permanently inert.
    if (active) {restoreBackground(active);}
    const record = { dialog, options, returnFocus: doc.activeElement, background: new Map() };
    active = record;
    generation += 1;
    isolate(record);
    if (!observer) {observer = new root.MutationObserver(() => { if (active) {isolate(active);} });}
    observer.observe(doc.body, { childList: true, subtree: true });
    focusInside();
  }

  function close(dialog) {
    if (!active || active.dialog !== dialog) {return;}
    const record = active;
    active = null;
    observer?.disconnect();
    restoreBackground(record);
    const closedAt = ++generation;
    // A Quick Start/Rematch can redraw and disable its first control in the
    // same task. Restore only after that action has finished.
    root.queueMicrotask(() => {
      if (active || generation !== closedAt) {return;}
      const previous = record.returnFocus;
      const fallback = resolve(record.options.fallbackFocus);
      const menu = previous?.closest('details:not([open])')?.querySelector(':scope > summary');
      const target = previous?.tabIndex >= 0 && available(previous) ? previous
        : available(menu) ? menu : available(fallback) ? fallback : null;
      target?.focus({ preventScroll: true });
    });
  }

  doc.addEventListener('keydown', event => {
    if (!active || event.altKey || event.ctrlKey || event.metaKey) {return;}
    if (event.key === 'Escape' && active.options.onEscape) {
      event.preventDefault();
      event.stopImmediatePropagation();
      active.options.onEscape();
    } else if (event.key === 'Tab') {
      const list = controls(active.dialog);
      const index = list.indexOf(doc.activeElement);
      const next = index < 0 ? (event.shiftKey ? list.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (list.length) {list[next].focus();}
      else {focusInside();}
    }
  }, true);
  doc.addEventListener('focusin', event => {
    if (active && !active.dialog.contains(event.target)) {focusInside();}
  }, true);
  root.SuiteDialogFocus = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
