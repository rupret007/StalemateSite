/* Public lobby discovery. Presence describes the server's current member list, never speaking activity.
 * A confirmed gathering or approved past creation is shown only from a supplied record.
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
                cams: source.cams === true, persistent: source.persistent === true, mine: source.mine === true, hostPresent: source.hostPresent === true,
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

    // Equipment-free on purpose. A jam needs a WebJam host, so it cannot be the
    // activity shown for a gathering someone can join with nothing to bring.
    const EQUIPMENT_FREE = Object.freeze({
        chat: 'Talk in #stalemate. A camera, microphone, and instrument are optional and stay off unless you choose them.',
        draw: 'Draw on the shared canvas or on paper. A camera is not required.',
        write: 'Write one line together in chat. Nothing to install.',
        listen: 'Read along, or listen if you want. Headphones are optional.',
        watch: 'Watch a shared video together. A camera is not required.'
    });
    const ACTIVITY_SUMMARY = Object.freeze({
        chat: 'text chat', draw: 'drawing', write: 'one-line writing', listen: 'reading together', watch: 'a shared video'
    });
    const QUIET_PROMPT = Object.freeze({
        label: 'Offer a one-line idea',
        draft: 'One line is enough, and no gear is needed: what should we make together? '
    });
    const MIN_GATHERING_MS = 15 * 60 * 1000;
    const MAX_GATHERING_MS = 4 * 60 * 60 * 1000;
    const MAX_LEAD_MS = 14 * 24 * 60 * 60 * 1000;
    const TIME_FORMAT = Object.freeze({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

    function serviceCopy(connection) {
        if (connection === 'reconnecting') {
            return {
                headline: 'Reconnecting to the lobby',
                detail: 'The people list from before the drop is not proof the room is empty. Your unsent draft stays in this tab.',
                welcomeTitle: 'Reconnecting. This is not an empty room.'
            };
        }
        if (connection === 'connecting') {
            return {
                headline: 'Connecting to the lobby',
                detail: 'People, rooms, and gatherings appear after the connection is up. Nothing shown yet means the lobby has not answered.',
                welcomeTitle: 'Connecting. The lobby has not answered yet.'
            };
        }
        if (connection === 'offline') {
            return {
                headline: 'The lobby is offline',
                detail: 'Hang Out cannot show who is here or whether a gathering is confirmed until you reconnect. Your unsent draft stays in this tab. This is not an empty room.',
                welcomeTitle: 'Hang Out is not connected.'
            };
        }
        if (connection === 'ended') {
            return {
                headline: 'This session has ended',
                detail: 'Hang Out cannot show who is here or whether a gathering is confirmed in a closed session. Your unsent draft stays in this tab. This is not an empty room.',
                welcomeTitle: 'This session is closed. Your draft can be copied.'
            };
        }
        return {
            headline: 'The lobby connection is not available',
            detail: 'Hang Out will not describe the room as empty until a connection says who is here. Your unsent draft stays in this tab.',
            welcomeTitle: 'Hang Out is not connected.'
        };
    }

    function formatLocal(instant, timeZone) {
        const format = (name) => new Intl.DateTimeFormat('en-US', { ...TIME_FORMAT, timeZone: name }).format(new Date(instant));
        const zone = typeof timeZone === 'string' && timeZone ? timeZone : '';
        if (!zone) return { text: format('UTC'), timeZone: 'UTC', assumed: true };
        try { return { text: format(zone), timeZone: zone, assumed: false }; }
        catch { return { text: format('UTC'), timeZone: 'UTC', assumed: true }; }
    }

    function gatheringOf(source, now) {
        if (!object(source) || source.confirmed !== true || source.requiresBand === true) return null;
        if (source.recurrence != null && source.recurrence !== false) return null;
        if (typeof source.host !== 'string' || !NICK.test(source.host)) return null;
        if (!Number.isSafeInteger(source.startsAt) || !Number.isSafeInteger(source.endsAt) || !Number.isSafeInteger(now)) return null;
        const duration = source.endsAt - source.startsAt;
        if (duration < MIN_GATHERING_MS || duration > MAX_GATHERING_MS || source.endsAt <= now) return null;
        if (source.startsAt > now && source.startsAt - now > MAX_LEAD_MS) return null;
        if (typeof source.activity !== 'string' || !Object.prototype.hasOwnProperty.call(EQUIPMENT_FREE, source.activity)) return null;
        return {
            host: source.host, startsAt: source.startsAt, endsAt: source.endsAt,
            activity: source.activity, activityLabel: EQUIPMENT_FREE[source.activity]
        };
    }

    function nextGathering(source, now) {
        const list = Array.isArray(source) ? source : source == null ? [] : [source];
        const valid = [];
        for (const item of list) {
            const gathering = gatheringOf(item, now);
            if (gathering) valid.push(gathering);
        }
        valid.sort((a, b) => a.startsAt - b.startsAt || (fold(a.host) < fold(b.host) ? -1 : fold(a.host) > fold(b.host) ? 1 : 0) || (a.activity < b.activity ? -1 : a.activity > b.activity ? 1 : 0));
        return valid[0] || null;
    }

    function creationOf(source) {
        if (!object(source) || source.approved !== true) return null;
        if (typeof source.title !== 'string' || typeof source.detail !== 'string') return null;
        const title = source.title.trim();
        const detail = source.detail.trim();
        if (!title || title.length > 80 || !detail || detail.length > 240) return null;
        if (/[\u0000-\u001f\u007f]/.test(title) || /[\u0000-\u001f\u007f]/.test(detail)) return null;
        let room = null;
        if (source.room != null) {
            if (typeof source.room !== 'string' || !ROOM_NAME.test(source.room)) return null;
            room = source.room;
        }
        return Object.freeze({ title, detail, room });
    }

    function presentGathering(next, now, timeZone) {
        const start = formatLocal(next.startsAt, timeZone);
        const end = formatLocal(next.endsAt, timeZone);
        return Object.freeze({
            host: next.host,
            startsAt: next.startsAt,
            endsAt: next.endsAt,
            activity: next.activity,
            activityLabel: next.activityLabel,
            localStart: start.text,
            localEnd: end.text,
            timeZone: start.assumed || end.assumed ? 'UTC' : start.timeZone,
            timeZoneAssumed: start.assumed || end.assumed,
            timing: next.startsAt <= now ? 'Happening now' : 'Upcoming',
            note: `Hosting this gathering does not make ${next.host} a site moderator. The host name is a label for who offered to host, not proof that person is in the room. This is one confirmed time, not a weekly commitment. Saving a reminder on this device is not an RSVP, and a connected tab is not attendance.`
        });
    }

    function describeVisit({ connection, channel, me, gathering, creation, now, timeZone } = {}) {
        const state = ['connected', 'connecting', 'reconnecting', 'offline', 'ended'].includes(connection) ? connection : 'unavailable';
        if (state !== 'connected') {
            const service = serviceCopy(state);
            return Object.freeze({
                connection: state, quiet: false, known: false, others: 0, available: 0, band: 0,
                headline: service.headline, detail: service.detail, welcomeTitle: service.welcomeTitle,
                gatheringStatus: 'unavailable', gathering: null, creation: null, quietPrompt: null
            });
        }
        const summary = summarizeLobby(channel, me);
        const known = object(channel) && Array.isArray(channel.names);
        const clock = Number.isSafeInteger(now) ? now : null;
        const next = clock === null ? null : nextGathering(gathering, clock);
        const shown = next ? presentGathering(next, clock, timeZone) : null;
        const quiet = known && summary.others === 0;
        const detail = shown
            ? `${summary.detail} Next confirmed gathering: ${shown.host}, ${shown.timing.toLowerCase()}, ${shown.localStart} to ${shown.localEnd}. ${shown.activityLabel}`
            : quiet
                ? `${summary.detail} No confirmed gathering was supplied. Anyone visiting can host one.`
                : summary.detail;
        return Object.freeze({
            connection: 'connected',
            quiet,
            known,
            selfPresent: typeof me === 'string' && me.length > 0,
            others: summary.others,
            available: summary.available,
            band: summary.band,
            headline: summary.headline,
            detail,
            welcomeTitle: known ? (quiet ? 'First one here? Make yourself at home.' : 'A good conversation starts with a hello.') : 'Waiting for the lobby',
            gatheringStatus: shown ? 'confirmed' : known && clock !== null ? 'none' : 'unavailable',
            gathering: shown,
            creation: quiet ? creationOf(creation) : null,
            quietPrompt: quiet ? QUIET_PROMPT : null
        });
    }

    function lobbyCount(visit) {
        const others = visit && Number.isSafeInteger(visit.others) && visit.others >= 0 ? visit.others : null;
        if (!visit || visit.connection !== 'connected' || !visit.known || others === null) return 'Main conversation';
        return `${others + (visit.selfPresent === true ? 1 : 0)} here · chat`;
    }

    function visitView(visit) {
        const confirmed = !!(visit && visit.gatheringStatus === 'confirmed' && visit.gathering);
        const none = !!(visit && visit.gatheringStatus === 'none');
        const quiet = !!(visit && visit.quiet);
        const past = quiet ? visit.creation : null;
        return Object.freeze({
            presenceTitle: visit && typeof visit.headline === 'string' ? visit.headline : 'Waiting for the lobby',
            presenceDetail: visit && typeof visit.detail === 'string' ? visit.detail : '',
            lobbyCount: lobbyCount(visit),
            welcomeTitle: visit && typeof visit.welcomeTitle === 'string' ? visit.welcomeTitle : 'Waiting for the lobby',
            showGathering: confirmed || none,
            gatheringHeading: confirmed ? 'Next confirmed gathering' : 'Confirmed gathering',
            gatheringHost: confirmed ? `Host: ${visit.gathering.host}` : '',
            gatheringWhen: confirmed ? `${visit.gathering.timing}: ${visit.gathering.localStart} to ${visit.gathering.localEnd}${visit.gathering.timeZoneAssumed ? ' (shown in UTC)' : ''}` : '',
            gatheringActivity: confirmed
                ? visit.gathering.activityLabel
                : none ? 'No confirmed gathering was supplied. Anyone visiting can host one. This screen does not invent a time or a weekly cadence, and it does not require a band member to be present.' : '',
            gatheringNote: confirmed ? visit.gathering.note : '',
            showSave: confirmed,
            showCreation: quiet,
            creationHeading: past ? 'Approved past creation' : 'Past creation',
            creationTitle: past ? past.title : '',
            creationDetail: past ? (past.room ? `${past.detail} It was made in ${past.room}.` : past.detail) : '',
            creationMissing: quiet && !past ? 'No approved past creation was supplied for this quiet visit.' : '',
            showQuietPrompt: !!(visit && visit.quietPrompt),
            quietPromptLabel: visit && visit.quietPrompt ? visit.quietPrompt.label : '',
            quietPromptDraft: visit && visit.quietPrompt ? visit.quietPrompt.draft : ''
        });
    }

    function icsStamp(ms) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    }

    // RFC 5545 §3.3.11 TEXT. Escape a backslash first, then CR, LF, and CRLF
    // as the two-character sequence \n, then comma and semicolon. A colon
    // stays literal: that section says a COLON in a TEXT value SHALL NOT be
    // escaped. DQUOTE is also unescaped in the TEXT grammar.
    function icsText(value) {
        return String(value)
            .replace(/\\/g, '\\\\')
            .replace(/\r\n|\r|\n/g, '\\n')
            .replace(/,/g, '\\,')
            .replace(/;/g, '\\;');
    }

    function foldLine(line) {
        const units = [];
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '\\' && i + 1 < line.length) { units.push(line.slice(i, i + 2)); i += 1; }
            else units.push(line[i]);
        }
        const lines = [];
        let current = '';
        let limit = 75;
        for (const unit of units) {
            if (current.length + unit.length > limit) {
                lines.push(current);
                current = unit;
                limit = 74;
            } else current += unit;
        }
        if (current) lines.push(current);
        return lines.map((part, index) => (index ? ` ${part}` : part)).join('\r\n');
    }

    function calendarReminder(gathering, now) {
        if (!object(gathering) || typeof gathering.host !== 'string' || !NICK.test(gathering.host)) return '';
        if (!Number.isSafeInteger(gathering.startsAt) || !Number.isSafeInteger(gathering.endsAt) || !Number.isSafeInteger(now)) return '';
        if (typeof gathering.activity !== 'string' || !Object.prototype.hasOwnProperty.call(EQUIPMENT_FREE, gathering.activity)) return '';
        if (gathering.activityLabel !== EQUIPMENT_FREE[gathering.activity]) return '';
        if (!Object.prototype.hasOwnProperty.call(ACTIVITY_SUMMARY, gathering.activity)) return '';
        const duration = gathering.endsAt - gathering.startsAt;
        if (duration < MIN_GATHERING_MS || duration > MAX_GATHERING_MS) return '';
        const description = `Local reminder only. This file is not an RSVP and does not record attendance. ${gathering.activityLabel} Host ${gathering.host} is not a site moderator because of this gathering. One confirmed time and not a weekly commitment.`;
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Stalemate Hang Out//Quiet Visit//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:hangout-${fold(gathering.host)}-${gathering.startsAt}-${gathering.activity}@hangout.invalid`,
            `DTSTAMP:${icsStamp(now)}`,
            `DTSTART:${icsStamp(gathering.startsAt)}`,
            `DTEND:${icsStamp(gathering.endsAt)}`,
            `SUMMARY:${icsText(`Hang Out with ${gathering.host}: ${ACTIVITY_SUMMARY[gathering.activity]}`)}`,
            `DESCRIPTION:${icsText(description)}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ];
        return `${lines.map(foldLine).join('\r\n')}\r\n`;
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

    const api = Object.freeze({
        ACTIVITY, EQUIPMENT_FREE, QUIET_PROMPT, describeRooms, summarizeLobby, isMention, describeVisit, visitView, calendarReminder, icsText
    });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.HangoutDiscovery = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this));
