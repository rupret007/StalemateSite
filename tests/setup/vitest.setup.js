import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
    globalThis.__testObserverInstances = [];

    class MockResizeObserver {
        constructor(callback) {
            this.callback = callback;
            this.observedElements = [];
            globalThis.__testObserverInstances.push(this);
        }

        observe(element) {
            this.observedElements.push(element);
        }

        unobserve(element) {
            this.observedElements = this.observedElements.filter((entry) => entry !== element);
        }

        disconnect() {
            this.observedElements = [];
        }
    }

    globalThis.ResizeObserver = MockResizeObserver;
    globalThis.requestAnimationFrame = vi.fn((callback) => setTimeout(() => callback(0), 0));
    globalThis.cancelAnimationFrame = vi.fn((handle) => clearTimeout(handle));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.__testObserverInstances;
});
