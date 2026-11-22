// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import dgram from 'node:dgram';
import os from 'node:os';

const { startLocalTurn, stun } = createRequire(import.meta.url)('../e2e/support/local-turn-server.cjs');
const key = stun.longTermKey(stun.USER, stun.REALM, stun.PASS);
let turn;
const sockets = [];
afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => new Promise((resolve) => socket.close(resolve))));
    await turn?.close();
    turn = null;
});

function openClient(address = '127.0.0.1') {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => {});
    sockets.push(socket);
    return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind({ address, port: 0 }, () => {
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

function send(socket, packet, host = '127.0.0.1') {
    socket.send(packet, turn.port, host);
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

async function allocate(socket, host = '127.0.0.1') {
    const bare = stun.build({
        method: stun.METHOD.allocate,
        cls: stun.CLASS.request,
        attrs: [stun.u32(stun.ATTR.requestedTransport, 17 << 24)]
    });
    const challengeWait = next(socket);
    send(socket, bare, host);
    const challenge = await challengeWait;
    expect(challenge.readUInt16BE(0)).toBe(stun.METHOD.allocate | stun.CLASS.error);
    expect(stun.verifyFingerprint(challenge)).toBe(true);
    const parsed = stun.parse(challenge);
    expect(parsed.attrs.some((item) => item.type === stun.ATTR.messageIntegrity)).toBe(false);
    nonceFromLast = parsed.attrs.find((item) => item.type === stun.ATTR.nonce).value.toString();
    expect(parsed.attrs.find((item) => item.type === stun.ATTR.realm).value.toString()).toBe(stun.REALM);
    const grantedWait = next(socket);
    send(socket, authed(stun.METHOD.allocate, [stun.u32(stun.ATTR.requestedTransport, 17 << 24)]), host);
    const granted = await grantedWait;
    expect(granted.readUInt16BE(0)).toBe(0x0103);
    expect(stun.verifyFingerprint(granted)).toBe(true);
    expect(stun.verifyIntegrity(granted, key)).toBe(true);
    const relay = stun.readXor(stun.parse(granted).attrs.find((item) => item.type === stun.ATTR.xorRelayed).value);
    expect(relay.address).toBe(host);
    expect(relay.port).toBeGreaterThan(0);
    expect(relay.port).not.toBe(turn.port);
    return relay;
}

function hostIPv4s() {
    const found = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const net of list || []) {
            if (net && (net.family === 'IPv4' || net.family === 4) && net.address && !found.includes(net.address)) found.push(net.address);
        }
    }
    return found;
}

async function permit(socket, peer, host = '127.0.0.1') {
    const waiting = next(socket);
    send(socket, authed(stun.METHOD.createPermission, [stun.attr(stun.ATTR.xorPeer, stun.xorAddress(peer.port, peer.address))]), host);
    const response = await waiting;
    expect(response.readUInt16BE(0)).toBe(stun.METHOD.createPermission | stun.CLASS.success);
    expect(stun.verifyIntegrity(response, key)).toBe(true);
}

async function bind(socket, channel, peer, host = '127.0.0.1') {
    const number = Buffer.alloc(4);
    number.writeUInt16BE(channel, 0);
    const waiting = next(socket);
    send(socket, authed(stun.METHOD.channelBind, [
        stun.attr(stun.ATTR.channel, number),
        stun.attr(stun.ATTR.xorPeer, stun.xorAddress(peer.port, peer.address))
    ]), host);
    const response = await waiting;
    expect(response.readUInt16BE(0)).toBe(stun.METHOD.channelBind | stun.CLASS.success);
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

it('relays a fingerprint-free Send indication between NIC-bound clients on the advertised host', async () => {
    turn = await startLocalTurn();
    const locals = hostIPv4s();
    expect(locals).toContain(turn.host);
    expect(turn.url).toBe(`turn:${turn.host}:${turn.port}?transport=udp`);
    if (locals.some((ip) => ip !== '127.0.0.1')) expect(turn.host).not.toBe('127.0.0.1');

    // Chrome's TURN socket is bound to this address and sends to the URL host, not to 127.0.0.1.
    const left = await openClient(turn.host);
    const right = await openClient(turn.host);
    const leftRelay = await allocate(left, turn.host);
    const rightRelay = await allocate(right, turn.host);
    await permit(left, rightRelay, turn.host);
    await permit(right, leftRelay, turn.host);

    const inner = stun.build({ method: stun.METHOD.binding, cls: stun.CLASS.request, attrs: [] });
    const indication = stun.build({
        method: stun.METHOD.send,
        cls: stun.CLASS.indication,
        fingerprint: false,
        attrs: [
            stun.attr(stun.ATTR.xorPeer, stun.xorAddress(rightRelay.port, rightRelay.address)),
            stun.attr(stun.ATTR.data, inner)
        ]
    });
    expect(stun.parse(indication).attrs.some((item) => item.type === stun.ATTR.fingerprint)).toBe(false);
    const heard = next(right);
    send(left, indication, turn.host);
    const inbound = await heard;
    const parsed = stun.parse(inbound);
    expect(parsed.method).toBe(stun.METHOD.data);
    expect(parsed.cls).toBe(stun.CLASS.indication);
    expect(stun.verifyFingerprint(inbound)).toBe(true);
    expect(stun.readXor(parsed.attrs.find((item) => item.type === stun.ATTR.xorPeer).value)).toEqual(leftRelay);
    const data = parsed.attrs.find((item) => item.type === stun.ATTR.data).value;
    expect(Buffer.compare(data, inner)).toBe(0);

    await bind(left, 0x4000, rightRelay, turn.host);
    await bind(right, 0x4001, leftRelay, turn.host);
    const payload = Buffer.from('nic-relay-ping');
    const channelHeard = next(right);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0x4000, 0);
    header.writeUInt16BE(payload.length, 2);
    send(left, Buffer.concat([header, payload]), turn.host);
    const channelled = await channelHeard;
    expect(channelled.readUInt16BE(0)).toBe(0x4001);
    expect(Buffer.compare(channelled.subarray(4, 4 + payload.length), payload)).toBe(0);
});
