/* Main-site click, scroll, and video events (home + 404). */
(function () {
  'use strict';
  var track = window.smTrack;
  if (!track) return;

  var page = document.body.classList.contains('lost-page-body') ? '404' : 'home';

  function host(href) {
    try { return new URL(href, location.href).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function socialNetwork(h) {
    if (h.indexOf('instagram.') !== -1) return 'instagram';
    if (h.indexOf('youtube.') !== -1 || h === 'youtu.be') return 'youtube';
    if (h.indexOf('facebook.') !== -1) return 'facebook';
    if (h.indexOf('bandcamp.') !== -1) return 'bandcamp';
    if (h.indexOf('spotify.') !== -1) return 'spotify';
    return '';
  }

  function musicEvent(h) {
    if (h.indexOf('music.apple.') !== -1) return 'music-apple';
    if (h.indexOf('spotify.') !== -1) return 'music-spotify';
    if (h.indexOf('youtube.') !== -1 || h === 'youtu.be') return 'music-youtube';
    if (h.indexOf('bandcamp.') !== -1) return 'music-bandcamp';
    return '';
  }

  function navTarget(href) {
    if (!href || href.charAt(0) !== '#') return '';
    var id = href.slice(1).toLowerCase();
    if (id === 'top' || id === 'home') return 'home';
    if (id === 'games') return 'games';
    if (id === 'listen') return 'listen';
    if (id === 'about' || id === 'about-link') return 'about';
    if (id === 'contact') return 'contact';
    return id.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'link';
  }

  function venueSlug(href) {
    try {
      var u = new URL(href, location.href);
      var parts = u.pathname.split('/').filter(Boolean);
      return (parts[parts.length - 1] || u.hostname.split('.')[0] || 'venue').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    } catch (e) { return 'venue'; }
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!el) return;

    var href = el.getAttribute('href') || '';
    var h = host(href);

    if (el.classList.contains('social-link')) {
      var sn = socialNetwork(h);
      if (sn) { track('social-' + sn); return; }
    }

    var inListen = el.closest('#listen, .listen-list, .listen-album');
    if (inListen || musicEvent(h)) {
      var me = musicEvent(h);
      if (me) { track(me); return; }
    }

    if (h.indexOf('rockinoctober.') !== -1) {
      var label = (el.textContent || '').trim().toLowerCase();
      if (label.indexOf('ticket') !== -1) {
        track('show-ticket-' + venueSlug(href));
      } else {
        track('show-details');
      }
      return;
    }

    if (el.closest('.site-nav, footer nav[aria-label]')) {
      var nt = navTarget(href);
      if (nt) track('nav-' + nt);
    }
  }, true);

  var video = document.querySelector('video.hero-video__player');
  if (video) {
    video.addEventListener('play', function () { track('manic-video-play'); }, { passive: true });
  }

  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
  var scrollTimer = 0;
  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = window.setTimeout(function () {
      scrollTimer = 0;
      var doc = document.documentElement;
      var max = Math.max(1, doc.scrollHeight - doc.clientHeight);
      var pct = Math.min(100, Math.round((window.scrollY / max) * 100));
      [25, 50, 75, 100].forEach(function (mark) {
        if (pct >= mark && !scrollMarks[mark]) {
          scrollMarks[mark] = true;
          track('scroll-' + page + '-' + mark);
        }
      });
    }, 200);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
