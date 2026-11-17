/* Presentation only. The room client owns camera and mic consent and capture. */
(() => {
    const room = document.querySelector('[data-room-workspace]');
    if (!room) return;

    const controls = room.querySelector('#room-call-controls');
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
        } else {
            room.style.setProperty('--workspace-controls', `${height}px`);
        }
    }

    phone.addEventListener('change', reserveDesktopControls);
    if (typeof ResizeObserver === 'function') new ResizeObserver(reserveDesktopControls).observe(controls);
    reserveDesktopControls();
})();
