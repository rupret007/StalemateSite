(() => {
    'use strict';

    // Resource errors do not bubble. Keep recovery independent of the lobby module.
    document.addEventListener('error', (event) => {
        if (!event.target.matches?.('script[data-lobby-module]')) return;
        const status = document.querySelector('[data-gate-status]');
        status.textContent = 'Hang Out couldn’t load. Reload the page to try again.';
        document.querySelector('[data-lobby-reload]').hidden = false;
    }, true);
})();
