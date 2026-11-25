/* /play/ music toggle chrome — injected by scripts/sync-turdanoid.sh */
(function () {
    'use strict';
    var pref = window.StalemateMusicPref;
    if (!pref) return;

    function ensureToggle() {
        if (document.getElementById('suite-music-toggle')) {
            var menuToggle = document.querySelector('body[data-arcade-game="turdtris"] #musicToggle');
            if (menuToggle) menuToggle.remove();
            return;
        }
        if (document.querySelector('[data-music-toggle]')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stalemate-music-toggle';
        btn.setAttribute('data-music-toggle', '');
        btn.setAttribute('aria-label', 'Site music on or off');
        var slot = document.querySelector('[data-suite-music-slot]');
        (slot || document.body).appendChild(btn);
        pref.bindToggles();
    }

    // The earlier Suite script mounts its own music control on DOMContentLoaded.
    if (document.readyState === 'complete') {
        ensureToggle();
    } else {
        document.addEventListener('DOMContentLoaded', ensureToggle, { once: true });
    }
}());
