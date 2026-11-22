// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import dgram from 'node:dgram';

const { startLocalTurn, stun } = createRequire(import.meta.url)('../e2e/support/local-turn-server.cjs');
const key = stun.longTermKey(stun.USER, stun.REALM, stun.PASS);
let turn;
const sockets = [];
afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => new Promise((resolve) => socket.close(resolve))));
    await turn?.close();
    turn = null;
});

function openClient() {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => {});
    sockets.push(socket);
    return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind({ address: '127.0.0.1', port: 0 }, () => {
            socket.removeListener('error', reject);
            resolve(socket);
        });
    });
}

function next(socket) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off('message', onMessage);
            reject(new Error('timed out waiting for TURN'));
        }, 1000);
        const onMessage = (message) => {
            clearTimeout(timer);
            resolve(message);
        };
        socket.once('message', onMessage);
    });
}

function send(socket, packet) {
    socket.send(packet, turn.port, '127.0.0.1');
}

function authed(method, attrs) {
    return stun.build({
        method,
        cls: stun.CLASS.request,
        attrs: [
            stun.textAttr(stun.ATTR.username, stun.USER),
            stun.textAttr(stun.ATTR.realm, stun.REALM),
            stun.textAttr(stun.ATTR.nonce, nonceFromLast),
            ...attrs
        ],
        key
    });
}

let nonceFromLast = '';

async function allocate(socket) {
    const bare = stun.build({
        method: stun.METHOD.allocate,
        cls: stun.CLASS.request,
        attrs: [stun.u32(stun.ATTR.requestedTransport, 17 << 24)]
    });
    const challengeWait = next(socket);
    send(socket, bare);
    const challenge = await challengeWait;
    expect(challenge.readUInt16BE(0)).toBe(stun.METHOD.allocate | stun.CLASS.error);
    expect(stun.verifyFingerprint(challenge)).toBe(true);
    const parsed = stun.parse(challenge);
    expect(parsed.attrs.some((item) => item.type === stun.ATTR.messageIntegrity)).toBe(false);
    nonceFromLast = parsed.attrs.find((item) => item.type === stun.ATTR.nonce).value.toString();
    expect(parsed.attrs.find((item) => item.type === stun.ATTR.realm).value.toString()).toBe(stun.REALM);
    const grantedWait = next(socket);
    send(socket, authed(stun.METHOD.allocate, [stun.u32(stun.ATTR.requestedTransport, 17 << 24)]));
    const granted = await grantedWait;
    expect(granted.readUInt16BE(0)).toBe(0x0103);
    expect(stun.verifyFingerprint(granted)).toBe(true);
    expect(stun.verifyIntegrity(granted, key)).toBe(true);
    const relay = stun.readXor(stun.parse(granted).attrs.find((item) => item.type === stun.ATTR.xorRelayed).value);
    expect(relay.address).toBe('127.0.0.1');
    expect(relay.port).toBeGreaterThan(0);
    expect(relay.port).not.toBe(turn.port);
    return relay;
}

it('pins TURN message classes and relays a channelled payload between two allocations', async () => {
    expect(stun.METHOD.allocate | stun.CLASS.request).toBe(0x0003);
    expect(stun.METHOD.allocate | stun.CLASS.success).toBe(0x0103);
    expect(stun.METHOD.allocate | stun.CLASS.error).toBe(0x0113);
    turn = await startLocalTurn();
    const left = await openClient();
    const right = await openClient();
    const leftRelay = await allocate(left);
    const rightRelay = await allocate(right);

    const wrong = next(left);
    send(left, stun.build({
        method: stun.METHOD.allocate,
        cls: stun.CLASS.request,
        attrs: [
            stun.textAttr(stun.ATTR.username, stun.USER),
            stun.textAttr(stun.ATTR.realm, stun.REALM),
            stun.textAttr(stun.ATTR.nonce, nonceFromLast),
            stun.u32(stun.ATTR.requestedTransport, 17 << 24)
        ],
        key: stun.longTermKey(stun.USER, stun.REALM, 'wrong-fixture-pass')
    }));
    const rejected = await wrong;
    expect(rejected.readUInt16BE(0)).toBe(0x0113);
    expect(stun.parse(rejected).attrs.some((item) => item.type === stun.ATTR.xorRelayed)).toBe(false);

    async function permit(socket, peer) {
        const waiting = next(socket);
        send(socket, authed(stun.METHOD.createPermission, [stun.attr(stun.ATTR.xorPeer, stun.xorAddress(peer.port, peer.address))]));
        const response = await waiting;
        expect(response.readUInt16BE(0)).toBe(stun.METHOD.createPermission | stun.CLASS.success);
        expect(stun.verifyIntegrity(response, key)).toBe(true);
    }
    async function bind(socket, channel, peer) {
        const number = Buffer.alloc(4);
        number.writeUInt16BE(channel, 0);
        const waiting = next(socket);
        send(socket, authed(stun.METHOD.channelBind, [
            stun.attr(stun.ATTR.channel, number),
            stun.attr(stun.ATTR.xorPeer, stun.xorAddress(peer.port, peer.address))
        ]));
        const response = await waiting;
        expect(response.readUInt16BE(0)).toBe(stun.METHOD.channelBind | stun.CLASS.success);
    }
    await permit(left, rightRelay);
    await permit(right, leftRelay);
    await bind(left, 0x4000, rightRelay);
    await bind(right, 0x4001, leftRelay);

    const payload = Buffer.from('hangout-relay-ping');
    const heard = next(right);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0x4000, 0);
    header.writeUInt16BE(payload.length, 2);
    send(left, Buffer.concat([header, payload]));
    const inbound = await heard;
    expect(inbound.readUInt16BE(0)).toBe(0x4001);
    expect(inbound.readUInt16BE(2)).toBe(payload.length);
    expect(Buffer.compare(inbound.subarray(4, 4 + payload.length), payload)).toBe(0);
});
