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
        var failed = false;
        var generation = 0;

        function render() {
            var playing = !audio.paused && !audio.ended && !audio.error;
            button.textContent = playing ? '❚❚ Pause Manic' : (failed || audio.error ? '↻ Retry Manic' : '▶ Play Manic');
            button.setAttribute('aria-pressed', playing ? 'true' : 'false');
        }

        function loadFailed() {
            failed = true;
            if (status) status.textContent = 'Can’t load Manic. Check your connection, then retry.';
            render();
        }

        function start(userInitiated) {
            var request = ++generation;
            function rejected(error) {
                if (request !== generation || error?.name === 'AbortError') return;
                if (!audio.error && error?.name === 'NotAllowedError') {
                    if (status) status.textContent = 'Your phone wants a tap first. Hit play.';
                    render();
                } else loadFailed();
            }
            try {
                // Reset a failed resource only from the retry tap, preserving the
                // gesture for play() and avoiding automatic network retry loops.
                if (userInitiated && (failed || audio.error)) audio.load();
                failed = false;
                render();
                var attempt = audio.play();
                if (attempt && typeof attempt.catch === 'function') attempt.catch(rejected);
            } catch (error) {
                rejected(error);
            }
        }

        button.addEventListener('click', function () {
            if (status) status.textContent = '';
            if (audio.paused || audio.ended || failed || audio.error) start(true);
            else { generation += 1; audio.pause(); }
        });
        audio.addEventListener('play', render);
        audio.addEventListener('pause', render);
        audio.addEventListener('ended', render);
        audio.addEventListener('playing', function () {
            failed = false;
            if (status) status.textContent = '';
            render();
        });
        audio.addEventListener('error', function () { generation += 1; loadFailed(); });

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
