/* Public lobby discovery. Presence describes the server's current member list, never speaking activity.
 * This helper has no DOM, storage or network access; callers render its strings with textContent. */
(function (root) {
    'use strict';

    const ACTIVITY = Object.freeze({
        chat: Object.freeze({ label: 'Chat channel', description: 'A named conversation hosted by the person who starts it.' }),
        bobross: Object.freeze({ label: 'Bob Ross paint-along', description: 'Watch and paint on a shared canvas. Camera optional.' }),
        watch: Object.freeze({ label: 'Watch together', description: 'Share a YouTube video and chat. Camera optional.' }),
        art: Object.freeze({ label: 'Draw together', description: 'Make something on a shared canvas. Camera optional.' }),
        jam: Object.freeze({ label: 'Jam together', description: 'Meet musicians and share a WebJam invite. Audio needs a host and a supported WebJam setup.' })
    });
    const ROOM_NAME = /^#[a-z0-9-]{2,30}$/i;
    const NICK = /^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/;
    const NICK_CHARACTER = /[A-Za-z0-9_\-[\]{}^`|]/;
    // The server treats ASCII nicks case-insensitively. Do not equate [] with {} or ^ with ~:
    // those traditional IRC mappings would merge distinct nicknames on this server.
    const fold = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const validCount = (n) => Number.isSafeInteger(n) && n >= 0;

    function describeRooms(rooms, joinedNames = []) {
        if (!Array.isArray(rooms)) return [];
        const joined = new Set((Array.isArray(joinedNames) ? joinedNames : joinedNames instanceof Set ? [...joinedNames] : [])
            .filter((name) => typeof name === 'string').map(fold));
        const seen = new Set();
        const result = [];
        for (const source of rooms) {
            // Invalid presence/capacity data must not turn into an invented empty or available room.
            if (!object(source) || typeof source.name !== 'string' || !ROOM_NAME.test(source.name)
                || typeof source.kind !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIVITY, source.kind)
                || !validCount(source.count) || !validCount(source.max) || source.max === 0
                || typeof source.locked !== 'boolean' || typeof source.key !== 'boolean') continue;
            const nameKey = fold(source.name);
            if (seen.has(nameKey)) continue;
            seen.add(nameKey);
            const room = {
                name: source.name,
                kind: source.kind,
                title: typeof source.title === 'string' && source.title.trim() ? source.title : ACTIVITY[source.kind].label,
                count: source.count,
                max: source.max,
                locked: source.locked,
                key: source.key,
                cams: source.cams === true,
                joined: joined.has(nameKey)
            };
            room.state = room.joined ? 'joined' : room.count >= room.max ? 'full' : room.locked ? 'invite' : room.key ? 'key' : room.count > 0 ? 'open' : 'empty';
            room.statusLabel = {
                joined: 'You are here', full: 'Full', invite: 'Invite-only or locked',
                key: 'Key required', open: 'Open', empty: 'No one here yet'
            }[room.state];
            room.actionLabel = {
                joined: 'Return to room', full: 'Room full', invite: 'Try joining',
                key: 'Enter room key', open: 'Join room', empty: 'Enter room'
            }[room.state];
            // This is a button affordance, not permission: the server still checks invites, keys,
            // locks, bans and capacity. The public directory does not expose who was invited.
            room.canJoin = room.state !== 'full';
            result.push(room);
        }
        const rank = (room) => room.joined ? 0 : room.locked || room.key || !room.canJoin ? 3 : room.count > 0 ? 1 : 2;
        return result.sort((a, b) => rank(a) - rank(b) || (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0));
    }

    function summarizeLobby(channel, me) {
        if (!object(channel) || !Array.isArray(channel.names)) {
            return { others: 0, available: 0, band: 0, headline: 'Waiting for the lobby', detail: 'The people list will appear when the lobby connects.' };
        }
        const self = typeof me === 'string' ? fold(me) : '';
        const visitors = new Map();
        for (const person of channel.names) {
            if (!object(person) || typeof person.nick !== 'string' || !NICK.test(person.nick)) continue;
            const nick = fold(person.nick);
            if (nick === self || visitors.has(nick)) continue;
            visitors.set(nick, person);
        }
        const others = visitors.size;
        let available = 0;
        let band = 0;
        for (const person of visitors.values()) {
            if (person.away === false) available += 1;
            if (person.band === true) band += 1;
        }
        const headline = others ? `${others} other visitor${others === 1 ? '' : 's'} in #stalemate` : 'It is quiet in #stalemate';
        const detail = others
            ? `${available} not marked away${band ? ` · ${band} band member${band === 1 ? '' : 's'} present` : ''}. Presence does not mean someone is reading or talking.`
            : 'Say hello, try /help, or start a room while you wait for someone to join.';
        return { others, available, band, headline, detail };
    }

    function isMention(text, nick) {
        if (typeof text !== 'string' || typeof nick !== 'string' || !NICK.test(nick)) return false;
        const message = fold(text);
        const target = fold(nick);
        let start = message.indexOf(target);
        while (start !== -1) {
            const end = start + target.length;
            if ((start === 0 || !NICK_CHARACTER.test(message[start - 1]))
                && (end === message.length || !NICK_CHARACTER.test(message[end]))) return true;
            start = message.indexOf(target, start + 1);
        }
        return false;
    }

    const api = Object.freeze({ ACTIVITY, describeRooms, summarizeLobby, isMention });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.HangoutDiscovery = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this));
