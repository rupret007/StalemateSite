/**
 * Hub cover idle motion — pauses when off-screen or reduced motion.
 */

export function prefersReducedMotion(doc = document) {
  try {
    return !!doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * @param {Document} doc
 * @param {string} selector default .game-card .cover
 */
export function wireHubCoverIdleMotion(doc, selector = '.game-card .cover') {
  const covers = doc.querySelectorAll(selector);
  if (!covers.length) return () => {};
  const reduced = prefersReducedMotion(doc);
  if (reduced) {
    covers.forEach((c) => c.classList.add('cover-motion-off'));
    return () => {};
  }
  covers.forEach((c) => c.classList.add('cover-motion-on'));
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('cover-in-view', entry.isIntersecting);
        });
      },
      { root: null, rootMargin: '40px', threshold: 0.08 }
    )
    : null;
  if (io) {
    covers.forEach((c) => io.observe(c));
  } else {
    covers.forEach((c) => c.classList.add('cover-in-view'));
  }
  const pauseHidden = () => {
    doc.body.classList.toggle('hub-attract-paused', !!doc.hidden);
  };
  doc.addEventListener('visibilitychange', pauseHidden);
  pauseHidden();
  return () => {
    if (io) io.disconnect();
    doc.removeEventListener('visibilitychange', pauseHidden);
  };
}

/**
 * @param {Document} doc
 */
export function wireHubAttractHeader(doc) {
  const masthead = doc.querySelector('.masthead');
  if (!masthead || prefersReducedMotion(doc)) return;
  masthead.classList.add('hub-attract-on');
  const pauseHidden = () => {
    masthead.classList.toggle('hub-attract-paused', !!doc.hidden);
  };
  doc.addEventListener('visibilitychange', pauseHidden);
  pauseHidden();
}
