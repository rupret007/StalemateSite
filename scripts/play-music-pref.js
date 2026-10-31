/* /play/ music toggle chrome — injected by scripts/sync-turdanoid.sh */
(function () {
    'use strict';
    var pref = window.StalemateMusicPref;
    if (!pref) return;

    function ensureToggle() {
        if (document.querySelector('[data-music-toggle]')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stalemate-music-toggle';
        btn.setAttribute('data-music-toggle', '');
        btn.setAttribute('aria-label', 'Site music on or off');
        document.body.appendChild(btn);
        pref.bindToggles();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureToggle);
    } else {
        ensureToggle();
    }
}());
