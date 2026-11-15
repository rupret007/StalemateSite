// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';
import { GAME_INVITE_UNAVAILABLE } from '../../r/45662413410ed051/lobby/game-night.mjs';

const INVITES = [
    ['Chess', 'chess'],
    ['partners Spades', 'turdspades'],
    ['four-player Spades', 'turdspades'],
    ['Turdanoid', 'turdanoid']
];
const NOW = 1_900_000_000_000;
const ROOM = '#game-1acbefx23acbe';
const CODE = 'a'.repeat(32);
const MATCH = '11111111-1111-4111-8111-111111111111';
const HASH = createHash('sha256').update(CODE).digest('hex');

function fixture(game, { expired = false, mode = 'partners' } = {}) {
    const until = NOW + DEMO_INVITE_TTL;
    const scope = { game, match: MATCH, room: ROOM, ref: 'c'.repeat(32), host: 'host-session-fixture', nameSeed: 7,
        ...(game === 'turdspades' && mode === 'four-player' ? { watch: true } : {}) };
    const key = `game-night-invitation:${HASH}`;
    const record = { scope, until: expired ? NOW - 1 : until, version: '1' };
    const rows = new Map([[key, record]]);
    const storage = {
        get: async name => rows.get(name),
        put: async (name, value) => rows.set(name, value),
        list: async ({ prefix = '' } = {}) => new Map([...rows].filter(([name]) => name.startsWith(prefix))),
        delete: async names => { for (const name of Array.isArray(names) ? names : [names]) rows.delete(name); }
    };
    const table = {
        guestTableId: async () => MATCH,
        watchTableId: async () => MATCH,
        guestNightEndsAt: async () => NOW + 60_000,
        reserveGuestSeat: vi.fn(async () => true)
    };
    const lobby = {
        env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
        state: { storage },
        engine: { invitedGameHost: () => 'actor-fixture' },
        arcadeBinding: () => ({ betaSid: 'host-session-fixture', nick: 'Host', betaInviteVersion: '1', canPlay: true }),
        sessionActive: async () => true,
        arcadeAvailable: () => true,
        arcade: new Map([[game, table]])
    };
    return { lobby, rows, record, until, key, table };
}

async function guestPage(game, expired, mode) {
    const pagePath = '/beta/game-night/guest';
    const config = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_HMAC_KEY: 'h'.repeat(40), HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40),
        HANGOUT_PREVIEW_KEY: 'p'.repeat(40), HANGOUT_GAME_NIGHT_GUESTS: '1', LOBBY: {}, QUOTA: {}, ROOMS: {}, BETA_SESSIONS: {},
        ASSETS: { fetch: vi.fn(request => new Response(readFileSync(new URL('../..' + new URL(request.url).pathname, import.meta.url), 'utf8'))) }
    };
    const request = path => new Request('https://example.test' + path);
    const html = await (await betaFetch(request(pagePath), config)).text();
    const client = readFileSync(new URL('../../r/45662413410ed051/lobby/game-night-guest.js', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: `https://example.test${pagePath}#invite=${CODE}`, runScripts: 'outside-only' });
    const { window } = dom;
    const share = vi.fn().mockResolvedValue(undefined);
    const item = fixture(game, { expired, mode });
    const details = async () => {
        const result = await gameInvitationRequest(item.lobby, 'details', { code: CODE });
        // Feed this client the invitation result while retaining the real expiry response.
        return result;
    };
    try {
        window.sharedGameNight = { GAME_INVITE_UNAVAILABLE, unlockGameNightAudio: vi.fn() };
        window.TextEncoder = TextEncoder;
        Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: crypto.subtle });
        Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
        window.fetch = vi.fn(async () => details());
        window.eval(client.replace(/^import \{ ([A-Za-z_]+) \} from '[^']+';/gm, 'const { $1 } = sharedGameNight;'));
        const status = window.document.querySelector('[data-guest-status]');
        await vi.waitFor(() => expect(status.textContent).not.toBe('Checking your invitation…'));
        return { dom, status, share, item, ask: window.document.querySelector('[data-guest-fresh]') };
    } catch (error) {
        window.close();
        throw error;
    }
}

it.each(INVITES)('%s expired invite offers a safe way to ask for a fresh link', async (_label, game) => {
    vi.setSystemTime(NOW);
    const mode = game === 'turdspades' ? 'partners' : undefined;
    const { dom, status, share, item, ask } = await guestPage(game, true, mode);
    try {
        expect(status.textContent).toBe(GAME_INVITE_UNAVAILABLE);
        expect(ask.hidden).toBe(false);
        expect(ask.textContent).toMatch(/ask the host for a fresh link/i);
        ask.click();
        await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        expect(share.mock.calls[0][0]).toEqual({ title: 'Game Night', text: expect.stringMatching(/ask the host for a fresh link/i) });
        expect(JSON.stringify(share.mock.calls)).not.toContain(CODE);
        expect(JSON.stringify(share.mock.calls)).not.toContain(ROOM);
        expect(JSON.stringify(share.mock.calls)).not.toContain('host-session-fixture');
        expect(item.record.until).toBe(NOW - 1);
        expect(item.table.reserveGuestSeat).not.toHaveBeenCalled();
    } finally {
        dom.window.close();
        vi.useRealTimers();
    }
});

it.each(INVITES)('%s still-valid invite remains available with the same expiry', async (_label, game) => {
    vi.setSystemTime(NOW);
    const mode = game === 'turdspades' ? 'partners' : undefined;
    const { dom, status, item, ask } = await guestPage(game, false, mode);
    try {
        expect(dom.window.document.querySelector('[data-guest-game]').textContent)
            .toBe(game === 'chess' ? 'Royal Flush Chess' : game === 'turdanoid' ? 'Turdanoid Brick Race' : 'TurdSpades');
        expect(dom.window.document.querySelector('[data-guest-invite]').hidden).toBe(false);
        expect(ask.hidden).toBe(true);
        expect(item.record.until).toBe(item.until);
        expect(item.record.until - NOW).toBe(DEMO_INVITE_TTL);
    } finally {
        dom.window.close();
        vi.useRealTimers();
    }
});

it('keeps a four-player Spades watch invitation read-only and preserves its expiry at the boundary', async () => {
    vi.setSystemTime(NOW);
    const item = fixture('turdspades', { mode: 'four-player' });
    try {
        const details = await gameInvitationRequest(item.lobby, 'details', { code: CODE });
        expect(details.status).toBe(200);
        expect(await details.json()).toMatchObject({ game: 'TurdSpades', watch: true, inviteExpiresAt: item.until });
        vi.setSystemTime(item.until);
        const expired = await gameInvitationRequest(item.lobby, 'details', { code: CODE });
        expect(expired.status).toBe(410);
        expect((await expired.json()).error).toBe(GAME_INVITE_UNAVAILABLE);
        expect(item.record.until).toBe(item.until);
        expect(item.table.reserveGuestSeat).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
});
