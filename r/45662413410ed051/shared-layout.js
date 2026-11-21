/* Presentation policy for shared-video rooms. Room markup and all behavior remain
 * owned by room.js; this module selects the shared frame and exposes mode options. */
(function sharedRoomLayout(win, doc) {
    'use strict';
    const modes = Object.freeze({
        watch: Object.freeze({ stage: '.watch .screen', controls: ['mic', 'camera', 'music', 'chat', 'more', 'leave'], activity: 'synced-video' }),
        paint: Object.freeze({ stage: '.watch .screen', controls: ['mic', 'camera', 'music', 'chat', 'more', 'leave'], activity: 'paint-along' })
    });
    win.SharedRoomLayout = Object.freeze({
        options(mode) { return modes[mode] || modes.watch; },
        set(mode, active) {
            const selected = modes[mode] ? mode : 'watch';
            doc.body.classList.toggle('shared-layout', Boolean(active));
            doc.body.dataset.sharedLayout = active ? selected : '';
            return modes[selected];
        }
    });
}(window, document));
