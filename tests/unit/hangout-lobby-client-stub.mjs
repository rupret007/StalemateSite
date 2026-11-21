import * as gameNightFunctions from '../../r/45662413410ed051/lobby/game-night.mjs';
import * as entryFunctions from '../../r/45662413410ed051/entry-sites.mjs';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';
import { createIdleHeartbeat } from '../../r/45662413410ed051/lobby/idle-heartbeat.mjs';
import { createChatAnnouncements } from '../../r/45662413410ed051/lobby/chat-announcements.mjs';
import { vi } from 'vitest';

export { entryFunctions, gameNightFunctions };

/** Partial ESM stand-in for jsdom lobby.js boots (see hangout-lobby-client-context.test.js). */
export function createHangoutClientTestModules(window, extras = {}) {
    const announcements = extras.createChatAnnouncements ?? ((log) => createChatAnnouncements(log, {
        frame: (fn) => window.setTimeout(fn, 16),
        cancel: (id) => window.clearTimeout(id),
    }));
    return {
        ...entryFunctions,
        mountGameNightSound: vi.fn(),
        unlockGameNightAudio: vi.fn(),
        ...gameNightFunctions,
        createEntrySharing,
        createIdleHeartbeat,
        createChatAnnouncements: announcements,
        ...extras,
    };
}