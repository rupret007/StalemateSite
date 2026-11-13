// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    ASK_HOST_TOAST, BLACK_OPEN, EXPIRED_SENTENCE, GAME_GUEST_RETURN, JOIN_AS_BLACK, LOBBY_RETURN, RETURN_LABEL,
    expiredLinkRecovery, recoverPanel, renderExpiredRecovery, renderRecovery
} from '../../r/45662413410ed051/lobby/bridge-offer-recovery.mjs';

describe('bridge offer recovery', () => {
    it('hides the ask-the-host toast when the panel already offers Join as Black', () => {
        const view = recoverPanel({ toast: ASK_HOST_TOAST, action: JOIN_AS_BLACK, status: BLACK_OPEN });
        expect(view.toast).toBeNull();
        expect(view.actions).toEqual([JOIN_AS_BLACK]);
        const root = renderRecovery(document, { toast: ASK_HOST_TOAST, action: JOIN_AS_BLACK, status: BLACK_OPEN });
        document.body.append(root);
        expect(root.querySelector('[data-toast]')).toBeNull();
        expect(root.querySelector('[data-panel-status]').textContent).toBe(BLACK_OPEN);
        const buttons = root.querySelectorAll('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe(JOIN_AS_BLACK);
        expect(buttons[0].style.minHeight).toBe('44px');
        expect(root.textContent).not.toContain('Ask the host');
    });

    it('keeps a toast when Join as Black is not the action', () => {
        const view = recoverPanel({ toast: ASK_HOST_TOAST, action: 'Close waiting match', status: 'You’re White · Waiting for an opponent.' });
        expect(view.toast).toBe(ASK_HOST_TOAST);
        expect(view.actions).toEqual([]);
        const other = recoverPanel({ toast: 'Reconnecting to Chess…', action: JOIN_AS_BLACK, status: BLACK_OPEN });
        expect(other.toast).toBe('Reconnecting to Chess…');
        expect(other.actions).toEqual([JOIN_AS_BLACK]);
    });

    it('gives a guest who already has a lobby session one return to the room', () => {
        expect(expiredLinkRecovery({ hasLobbySession: false }).actions).toEqual([]);
        const model = expiredLinkRecovery({ hasLobbySession: true, returnTo: GAME_GUEST_RETURN });
        expect(model.sentence).toBe(EXPIRED_SENTENCE);
        expect(model.actions).toEqual([{ label: RETURN_LABEL, href: GAME_GUEST_RETURN, minHeightPx: 44 }]);
        const page = renderExpiredRecovery(document, { hasLobbySession: true, returnTo: 'https://example.invalid/away' });
        document.body.append(page);
        const links = page.querySelectorAll('a, button');
        expect(links).toHaveLength(1);
        expect(links[0].textContent).toBe(RETURN_LABEL);
        expect(links[0].getAttribute('href')).toBe(LOBBY_RETURN);
        expect(links[0].style.minHeight).toBe('44px');
        expect(page.querySelector('h1').textContent).toBe('');
        expect(page.querySelector('p').textContent).toBe(EXPIRED_SENTENCE);
        const plain = renderExpiredRecovery(document, { hasLobbySession: false });
        expect(plain.querySelectorAll('a, button')).toHaveLength(0);
    });
});
