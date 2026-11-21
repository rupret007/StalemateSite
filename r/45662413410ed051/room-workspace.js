/* Presentation only. The room client owns camera and mic consent and capture. */
(() => {
    const room = document.querySelector('[data-room-workspace]');
    if (!room) return;

    const controls = room.querySelector('#room-call-controls');
    const chat = room.querySelector('#room-chat');
    const controlsJump = room.querySelector('[data-room-controls-jump]');
    const camera = room.querySelector('[data-cam]');
    const startVideo = room.querySelector('[data-workspace-start-video]');
    const phone = window.matchMedia('(max-width: 820px)');

    startVideo.hidden = false;
    controlsJump.hidden = false;

    controlsJump.addEventListener('click', () => controls.focus({ preventScroll: true }));
    startVideo.addEventListener('click', () => {
        camera.focus();
        camera.click();
    });
    function reserveDesktopControls() {
        const height = Math.ceil(controls.getBoundingClientRect().height);
        if (phone.matches || document.body.classList.contains('shared-layout') || !height) {
            room.style.removeProperty('--workspace-controls');
            room.style.removeProperty('--workspace-chat-height');
            room.style.removeProperty('--workspace-stage-height');
        } else {
            room.style.setProperty('--workspace-controls', `${height}px`);
            const speaker = room.querySelector('.tiles[data-view=speaker] .tile--big');
            const hostTools = room.querySelector('.host-call');
            if (speaker && hostTools && hostTools.getClientRects().length) {
                const available = Math.floor(speaker.getBoundingClientRect().height + controls.getBoundingClientRect().top - hostTools.getBoundingClientRect().bottom - 8);
                room.style.setProperty('--workspace-stage-height', `${Math.max(0, available)}px`);
            } else {
                room.style.removeProperty('--workspace-stage-height');
            }
            // Use actual geometry: desktop fonts and wrapped controls vary by platform.
            if (chat && chat.getClientRects().length) {
                const available = Math.floor(controls.getBoundingClientRect().top - chat.getBoundingClientRect().top - 8);
                room.style.setProperty('--workspace-chat-height', `${Math.max(0, available)}px`);
            }
        }
    }

    phone.addEventListener('change', reserveDesktopControls);
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(reserveDesktopControls);
        observer.observe(controls);
        if (chat) observer.observe(chat);
        const call = room.querySelector('.call');
        if (call) observer.observe(call);
        const header = room.querySelector('.bar');
        if (header) observer.observe(header);
    }
    window.addEventListener('resize', reserveDesktopControls);
    reserveDesktopControls();
})();
