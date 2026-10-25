// Repainting connected-session scrollback is navigation, not a new message.
// Give the accessibility tree a frame with the live region off before restoring
// polite announcements. A visitor's pause choice always wins over restoration.
export function createChatAnnouncements(log, {
    frame = (callback) => requestAnimationFrame(callback),
    cancel = (id) => cancelAnimationFrame(id)
} = {}) {
    let enabled = true;
    let rendering = false;
    let pending = null;
    let generation = 0;
    const sync = () => log.setAttribute('aria-live', enabled && !rendering ? 'polite' : 'off');
    const stop = () => { if (pending !== null) cancel(pending); pending = null; };
    sync();
    return {
        setEnabled(value) { enabled = value === true; sync(); },
        replace(render) {
            const current = ++generation;
            stop(); rendering = true; sync(); log.setAttribute('aria-busy', 'true');
            try { render(); }
            finally {
                log.setAttribute('aria-busy', 'false');
                pending = frame(() => {
                    if (current !== generation) return;
                    pending = frame(() => {
                        if (current !== generation) return;
                        pending = null; rendering = false; sync();
                    });
                });
            }
        },
        dispose() { ++generation; stop(); enabled = false; sync(); }
    };
}
