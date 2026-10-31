/* Privacy-safe GoatCounter event helper for stalemate.band */
(function () {
  'use strict';
  var queue = [];
  var MAX_QUEUE = 5;
  var onceKeys = Object.create(null);

  function sanitize(name) {
    if (name == null) return '';
    var s = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');
    if (s.length > 60) s = s.slice(0, 60);
    if (s.charAt(0) === '-') s = s.slice(1);
    if (s.charAt(s.length - 1) === '-') s = s.slice(0, -1);
    return s;
  }

  function deliver(path) {
    try {
      window.goatcounter.count({ path: path, title: path, event: true });
    } catch (e) {
      // Analytics is best-effort: drop failed events without interrupting the site.
    }
  }

  function send(name) {
    var path = sanitize(name);
    if (!path) return;
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      deliver(path);
      return;
    }
    if (queue.length < MAX_QUEUE) queue.push(path);
  }

  function flush() {
    if (!window.goatcounter || typeof window.goatcounter.count !== 'function') return;
    while (queue.length) {
      var n = queue.shift();
      deliver(n);
    }
  }

  function durBucket(seconds) {
    var s = Number(seconds);
    if (!isFinite(s) || s < 0) s = 0;
    if (s < 30) return 'lt30s';
    if (s < 120) return '30s-2m';
    if (s < 300) return '2-5m';
    if (s < 900) return '5-15m';
    return '15m+';
  }

  function levelCap(n) {
    var v = Math.floor(Number(n));
    if (!isFinite(v) || v < 1) return '1';
    if (v >= 10) return '10plus';
    return String(v);
  }

  function once(name, fn) {
    var key = sanitize(name);
    if (!key || onceKeys[key]) return;
    onceKeys[key] = 1;
    if (typeof fn === 'function') fn();
  }

  window.smTrack = send;
  window.smDurBucket = durBucket;
  window.smLevelCap = levelCap;
  window.smOnce = once;
  window.smTrackFlush = flush;

  window.addEventListener('load', flush);
  var poll = setInterval(function () {
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      flush();
      clearInterval(poll);
    }
  }, 50);
  setTimeout(function () { clearInterval(poll); }, 15000);
})();
