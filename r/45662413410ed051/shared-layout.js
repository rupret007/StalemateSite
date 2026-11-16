/* Shared video room layout policy. Keeps the stage, camera strip, chat and consent
 * markup owned by the room while allowing each activity to choose its stage source
 * and optional controls. */
(function sharedRoomLayout(win, doc) {
    'use strict';
    const modes = {
        watch: { stage: '.watch .screen', controls: ['mic', 'camera', 'music', 'chat', 'more', 'leave'] },
        paint: { stage: '.watch .screen', controls: ['mic', 'camera', 'music', 'chat', 'more', 'leave'] },
        art: { stage: '[data-canvas]', controls: ['mic', 'camera', 'chat', 'more', 'leave'] }
    };
    win.SharedRoomLayout = {
        options(mode) { return modes[mode] || modes.watch; },
        set(mode, active) {
            doc.body.classList.toggle('shared-layout', Boolean(active));
            doc.body.dataset.sharedLayout = active ? mode : '';
        }
    };
}(window, document));
