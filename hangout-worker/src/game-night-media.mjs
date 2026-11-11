import { cleanRtc } from './lobby-act.mjs';
import { createGameNightSockets } from './game-night-sockets.mjs';

const TAG = 'game-night-media';
const PROTOCOL = 'game-night-media.v1';
const MAX_PARTICIPANTS = 4;
const FRAME_BYTES = 16384;
const inactive = Object.freeze({ audio: false, video: false });
const encoder = new TextEncoder();
const sameRoom = (a, b) => a?.ref === b?.ref && a?.room === b?.room;

export const mediaPath = path => path === '/beta/game-night-media' || path === '/beta/game-night-media-ticket';
export const mediaEnabled = (env = {}) => env.HANGOUT_BETA_MODE === 'protected' && env.HANGOUT_ARCADE_MEDIA === '1' && env.HANGOUT_OPEN !== '0';
export const isMediaSocket = socket => socket.deserializeAttachment?.()?.kind === TAG;

// SDP can negotiate receive-only tracks before either guest enables capture.
// Check each active media section's effective direction, with a default of
// sendrecv when neither the section nor the session declares a direction.
export function allowedMediaDescription(description, tracks) {
    let media = '', enabled = false, sessionDirection = '', direction = '';
    const allowed = () => !enabled || ['inactive', 'recvonly'].includes(direction || sessionDirection) || tracks[media] === true;
    for (const line of description.split(/\r?\n/)) {
        if (line.startsWith('m=')) {
            if (!allowed()) return false;
            const [kind, port] = line.slice(2).split(/\s+/);
            if (!['audio', 'video'].includes(kind) || !/^\d+$/.test(port || '')) return false;
            media = kind; enabled = Number(port) !== 0; direction = '';
        } else if (line === 'a=bundle-only' && media && !enabled) {
            return false;
        } else if (/^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line)) {
            if (media) {
                if (direction) return false;
                direction = line.slice(2);
            } else {
                if (sessionDirection) return false;
                sessionDirection = line.slice(2);
            }
        }
    }
    return !!media && allowed();
}

export function createGameNightMedia({ state, current, active, approve, charge, allowed }) {
    const { issue, upgrade, member, sockets, send, close } = createGameNightSockets({
        state, current, active, charge, allowed, tag: TAG, protocol: PROTOCOL, readyType: 'media-ready'
    });
    function participants(scope) {
        return sockets().map(ws => ({ ws, scope: ws.deserializeAttachment() }))
            .filter(peer => peer.scope.joined && sameRoom(scope, peer.scope))
            .map(peer => ({ ...peer, member: member(peer.scope) }))
            .filter(peer => peer.member);
    }
    function cameraPolicy(peers) { return peers.some(peer => peer.scope.videoAllowed && peer.member.canOpen && peer.member.canPlay); }
    function save(socket, changes) { socket.serializeAttachment({ ...socket.deserializeAttachment(), ...changes }); }
    function tracksFor(peer, cameraAllowed) {
        return { audio: !!(peer.member.canPlay && peer.scope.tracks?.audio),
            video: !!(cameraAllowed && peer.member.canPlay && peer.scope.tracks?.video) };
    }
    function publish(scope) {
        const peers = participants(scope), cameraAllowed = cameraPolicy(peers);
        for (const peer of peers) {
            const tracks = tracksFor(peer, cameraAllowed);
            if (peer.scope.tracks?.audio !== tracks.audio || peer.scope.tracks?.video !== tracks.video) save(peer.ws, { tracks });
            const view = {
                cameraAllowed,
                canManageCamera: peer.member.canOpen && peer.member.canPlay,
                tracks,
                peers: peers.filter(other => other.ws !== peer.ws && peer.member.canCall(other.scope.actor)).map(other => ({
                    id: other.scope.actor, nick: other.member.nick, ...tracksFor(other, cameraAllowed)
                }))
            };
            const serialized = JSON.stringify(view);
            if (serialized === peer.scope.lastRoster) continue;
            save(peer.ws, { lastRoster: serialized });
            send(peer.ws, { t: 'media-room', version: 1, ...view });
        }
    }
    function error(socket, reason) { send(socket, { t: 'media-error', reason }); }
    async function receive(socket, raw) {
        if (socket.readyState !== 1) return;
        const scope = socket.deserializeAttachment(), binding = member(scope);
        if (!binding || !await active(binding)) { close(socket, 4403, 'room membership ended'); publish(scope); return; }
        if (!await charge(socket, scope.actor)) { close(socket, 4429, 'media allowance exhausted'); publish(scope); return; }
        if (typeof raw !== 'string' || raw.length > FRAME_BYTES || encoder.encode(raw).byteLength > FRAME_BYTES) {
            close(socket, 4400, 'bad media frame'); publish(scope); return;
        }
        let frame;
        try { frame = JSON.parse(raw); } catch { /* protocol refusal below */ }
        if (frame?.version !== 1 || typeof frame.action !== 'string') {
            close(socket, 4400, 'bad media frame'); publish(scope); return;
        }
        const peers = participants(scope);
        if (frame.action === 'join') {
            if (scope.joined) return;
            if (peers.length >= MAX_PARTICIPANTS || !await approve(scope, inactive)) return error(socket, 'call-unavailable');
            save(socket, { joined: true, tracks: inactive, videoAllowed: false });
            publish(scope);
            return;
        }
        if (!scope.joined) return error(socket, 'call-required');
        if (frame.action === 'leave') {
            close(socket, 1000, 'left call');
            publish(scope);
        } else if (frame.action === 'camera-policy') {
            if (!binding.canOpen || !binding.canPlay || typeof frame.on !== 'boolean') return error(socket, 'camera-policy-unavailable');
            save(socket, { videoAllowed: frame.on });
            publish(scope);
        } else if (frame.action === 'tracks') {
            if (typeof frame.audio !== 'boolean' || typeof frame.video !== 'boolean' ||
                frame.video && (!cameraPolicy(peers) || frame.adult18 !== true)) return error(socket, 'tracks-unavailable');
            const tracks = { audio: frame.audio, video: frame.video };
            const raises = tracks.audio && !scope.tracks.audio || tracks.video && !scope.tracks.video;
            if (raises && !await approve(scope, tracks)) return error(socket, 'tracks-unavailable');
            save(socket, { tracks });
            publish(scope);
        } else if (frame.action === 'signal') {
            const rtc = cleanRtc(frame), target = rtc && peers.find(peer => peer.scope.actor === rtc.to);
            if (!target || !binding.canCall(target.scope.actor) || !await active(target.member)) return error(socket, 'peer-unavailable');
            const cameraAllowed = cameraPolicy(peers);
            const tracks = tracksFor({ member: binding, scope }, cameraAllowed);
            if (rtc.sdp && !allowedMediaDescription(rtc.sdp.sdp, tracks)) return error(socket, 'tracks-unavailable');
            if (!await approve(scope, tracks, target.scope, tracksFor(target, cameraAllowed))) return error(socket, 'peer-unavailable');
            send(target.ws, { t: 'media-signal', version: 1, from: scope.actor, ...(rtc.sdp ? { sdp: rtc.sdp } : { ice: rtc.ice }) });
        } else error(socket, 'unknown-action');
    }
    function reconcile() {
        const rooms = new Map();
        for (const ws of sockets()) {
            const scope = ws.deserializeAttachment();
            rooms.set(scope.ref, scope);
            if (!member(scope)) close(ws, 4403, 'room membership ended');
        }
        for (const scope of rooms.values()) publish(scope);
    }
    async function maintain() {
        for (const ws of sockets()) {
            const scope = ws.deserializeAttachment(), binding = member(scope);
            if (!binding || !await active(binding) || scope.joined && !await approve(scope, scope.tracks)) {
                close(ws, 4403, 'call permission ended');
            }
        }
        reconcile();
    }
    return { issue, upgrade, receive, reconcile, maintain };
}
