// A failed engine chunk used to reject with nobody listening, so the table
// stayed on its last "Connecting…" line. This keeps that promise quiet and
// offers the same Retry line on every game.
export const ENGINE_LOAD_FAILURE = 'Couldn\u2019t load the game. Tap Retry.';

export function loadEngine(slot, start, onFailure, onSuccess) {
    if (!slot.current) {
        slot.current = Promise.resolve()
            .then(start)
            .then(() => {
                try { onSuccess?.(); }
                catch { /* The engine is in memory; the table can keep drawing. */ }
                return true;
            })
            .catch(() => {
                slot.current = null;
                try { onFailure?.(); }
                catch { /* Retry is still on screen if the status update throws. */ }
                return false;
            });
    }
    return slot.current;
}

export function createEngineLoadFailure(status, main) {
    const retry = status.ownerDocument.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--small';
    retry.textContent = 'Retry';
    retry.hidden = true;
    retry.dataset.engineRetry = '';
    status.after(retry);
    const again = new Set();
    let active = false;
    const paint = () => {
        status.textContent = ENGINE_LOAD_FAILURE;
        retry.hidden = false;
        if (main) main.hidden = true;
    };
    retry.addEventListener('click', () => {
        if (!active) return;
        const runs = [...again];
        again.clear();
        active = false;
        retry.hidden = true;
        if (status.textContent === ENGINE_LOAD_FAILURE) status.textContent = '';
        for (const run of runs) run();
    });
    return {
        showing: () => active,
        fail(run) {
            again.add(run);
            active = true;
            paint();
        },
        loaded(run) {
            again.delete(run);
            if (again.size > 0) return;
            active = false;
            retry.hidden = true;
            if (status.textContent === ENGINE_LOAD_FAILURE) status.textContent = '';
        },
        hold() {
            if (!active) return false;
            paint();
            return true;
        },
        button: retry
    };
}
