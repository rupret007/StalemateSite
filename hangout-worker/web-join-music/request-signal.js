// Older Safari supports AbortController but lacks AbortSignal.any.
export function musicSignal(...signals) {
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) { controller.abort(signal.reason); break; }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true, signal: controller.signal });
    }
    return controller.signal;
}
