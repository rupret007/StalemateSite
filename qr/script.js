/* Stalemate QR landing: cue Manic, count the scan. */
(function () {
    'use strict';

    function countScan() {
        var gc = window.goatcounter;
        if (gc && typeof gc.count === 'function') {
            gc.count({ path: 'qr-scan', title: 'QR keychain scan', event: true });
            return true;
        }
        return false;
    }

    function init() {
        var audio = document.querySelector('[data-qr-audio]');
        var button = document.querySelector('[data-qr-play]');
        var status = document.querySelector('[data-qr-status]');
        if (!audio || !button) return;

        function render() {
            var playing = !audio.paused && !audio.ended;
            button.textContent = playing ? '❚❚ Pause Manic' : '▶ Play Manic';
            button.setAttribute('aria-pressed', playing ? 'true' : 'false');
        }

        function start() {
            var attempt = audio.play();
            if (attempt && typeof attempt.catch === 'function') {
                attempt.catch(function () {
                    if (status) status.textContent = 'Your phone wants a tap first. Hit play.';
                });
            }
        }

        button.addEventListener('click', function () {
            if (status) status.textContent = '';
            if (audio.paused || audio.ended) start(); else audio.pause();
        });
        audio.addEventListener('play', render);
        audio.addEventListener('pause', render);
        audio.addEventListener('ended', render);

        // Try to start right away; browsers that block autoplay keep the big button.
        start();

        if (!countScan()) {
            var tries = 0;
            var timer = window.setInterval(function () {
                tries += 1;
                if (countScan() || tries > 20) window.clearInterval(timer);
            }, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
