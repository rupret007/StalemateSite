import { describe, expect, it } from 'vitest';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';

function setup() {
    document.body.innerHTML = '<ol role="log" aria-live="polite" aria-label="Conversation"></ol>';
    const log = document.querySelector('[role=log]');
    const callbacks = new Map(); let id = 0;
    const controller = createChatAnnouncements(log, {
        frame: (fn) => { callbacks.set(++id, fn); return id; }, cancel: (key) => callbacks.delete(key)
    });
    const paint = () => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach((fn) => fn()); };
    return { log, controller, paint, callbacks };
}
describe('controllable chat announcements', () => {
    it('keeps existing scrollback quiet throughout replacement and one full render frame', () => {
        const { log, controller, paint } = setup();
        controller.replace(() => {
            expect(log.getAttribute('aria-live')).toBe('off'); expect(log.getAttribute('aria-busy')).toBe('true');
            const old = document.createElement('li'); old.textContent = 'Previously received in this session'; log.replaceChildren(old);
        });
        expect(log.textContent).toContain('Previously received'); expect(log.getAttribute('aria-busy')).toBe('false');
        paint(); expect(log.getAttribute('aria-live')).toBe('off');
        paint(); expect(log.getAttribute('aria-live')).toBe('polite');
        expect(log.getAttribute('role')).toBe('log'); expect(log.getAttribute('aria-label')).toBe('Conversation');
    });
    it('lets visitors pause and resume announcements without clearing messages or changing navigation', () => {
        const { log, controller } = setup();
        const message = document.createElement('li'); message.textContent = 'Still readable'; log.append(message);
        controller.setEnabled(false); expect(log.getAttribute('aria-live')).toBe('off'); expect(log.firstChild).toBe(message);
        const another = document.createElement('li'); another.textContent = 'Another live message'; log.append(another);
        expect(log.children.length).toBe(2); expect(log.getAttribute('aria-live')).toBe('off');
        controller.setEnabled(true); expect(log.getAttribute('aria-live')).toBe('polite'); expect(log.children.length).toBe(2);
    });
    it('does not undo a pause during channel navigation, or reactivate announcements before replay finishes', () => {
        const { log, controller, paint } = setup();
        controller.replace(() => { log.textContent = 'Other channel'; });
        controller.setEnabled(false); paint(); paint(); expect(log.getAttribute('aria-live')).toBe('off');
        controller.replace(() => { log.textContent = 'First channel'; });
        controller.setEnabled(true); expect(log.getAttribute('aria-live')).toBe('off');
        paint(); expect(log.getAttribute('aria-live')).toBe('off'); paint(); expect(log.getAttribute('aria-live')).toBe('polite');
    });
    it('cancels stale navigation restoration and all pending work on dispose', () => {
        const { log, controller, paint, callbacks } = setup();
        controller.replace(() => { log.textContent = 'A'; }); paint();
        controller.replace(() => { log.textContent = 'B'; }); paint();
        expect(log.getAttribute('aria-live')).toBe('off'); paint(); expect(log.getAttribute('aria-live')).toBe('polite');
        controller.replace(() => { log.textContent = 'C'; }); controller.dispose(); expect(callbacks.size).toBe(0);
        paint(); paint(); expect(log.getAttribute('aria-live')).toBe('off'); expect(log.textContent).toBe('C');
    });
});
