// Independent of the chat module so a failed download is recoverable under CSP.
(() => {
    'use strict';
    const notice = document.querySelector('[data-startup-recovery]');
    const message = document.querySelector('[data-startup-message]');
    const reload = document.querySelector('[data-startup-reload]');
    const enter = document.querySelector('[data-enter]');
    if (!notice || !message || !reload || !enter) return;
    let ready = false;
    const show = text => { message.textContent = text; notice.hidden = false; };
    const timer = setTimeout(() => {
        if (!ready) show('Chat is taking longer than usual. You can keep waiting or reload chat. Your camera and microphone are off.');
    }, 12000);
    const failed = () => {
        if (ready) return;
        clearTimeout(timer);
        // Do not offer a partly initialized client after an evaluation failure.
        enter.disabled = true;
        show('Chat could not load. Check your connection, then reload chat. Your camera and microphone are off.');
    };
    const moduleEvent = event => {
        if (event.target?.matches?.('script[data-lobby-module]')) failed();
    };
    document.addEventListener('error', moduleEvent, true);
    document.addEventListener('load', moduleEvent, true);
    // Download completion is not readiness: imports and initialization must finish.
    document.addEventListener('hangout:lobby-ready', () => {
        ready = true;
        clearTimeout(timer);
        notice.hidden = true;
        document.removeEventListener('error', moduleEvent, true);
        document.removeEventListener('load', moduleEvent, true);
    }, { once: true });
    window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
    reload.addEventListener('click', () => {
        reload.disabled = true;
        message.textContent = 'Reloading chat…';
        location.reload();
    });
})();
