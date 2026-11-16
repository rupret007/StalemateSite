/* Presentation only. The room client owns camera and mic consent and capture. */
(() => {
    const room = document.querySelector('[data-room-workspace]');
    if (!room) return;

    const chat = room.querySelector('#room-chat');
    const title = chat.querySelector('#room-chat-title');
    const open = room.querySelector('[data-room-chat-open]');
    const close = chat.querySelector('[data-room-chat-close]');
    const controls = room.querySelector('#room-call-controls');
    const controlsJump = room.querySelector('[data-room-controls-jump]');
    const camera = room.querySelector('[data-cam]');
    const startVideo = room.querySelector('[data-workspace-start-video]');
    const phone = window.matchMedia('(max-width: 820px)');

    open.hidden = false;
    close.hidden = false;
    startVideo.hidden = false;
    controlsJump.hidden = false;

    function syncChat() {
        const callingOnPhone = phone.matches && document.body.classList.contains('faces-on');
        const canShow = !room.hasAttribute('data-room-chat-closed');
        open.setAttribute('aria-expanded', String(canShow &&
            (!callingOnPhone || room.hasAttribute('data-room-chat-shown'))));
    }

    function showChat(show) {
        room.toggleAttribute('data-room-chat-closed', !show);
        room.toggleAttribute('data-room-chat-shown', show);
        (show ? title : open).focus();
        syncChat();
    }

    controlsJump.addEventListener('click', () => controls.focus({ preventScroll: true }));
    startVideo.addEventListener('click', () => {
        camera.focus();
        camera.click();
    });
    open.addEventListener('click', () => showChat(true));
    close.addEventListener('click', () => showChat(false));
    chat.addEventListener('focusin', () => {
        if (!room.hasAttribute('data-room-chat-closed')) room.setAttribute('data-room-chat-shown', '');
    });
    chat.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || document.body.classList.contains('bob-mode')) return;
        event.preventDefault();
        showChat(false);
    });
    phone.addEventListener('change', syncChat);
    new MutationObserver(syncChat).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncChat();
})();
