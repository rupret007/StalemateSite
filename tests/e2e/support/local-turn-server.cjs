'use strict';

// Loopback TURN fixture for relay-only tests. One fixture user. Not a public relay.
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const zlib = require('node:zlib');

const MAGIC = 0x2112A442;
const ATTR = Object.freeze({
    username: 0x0006,
    messageIntegrity: 0x0008,
    errorCode: 0x0009,
    channel: 0x000c,
    lifetime: 0x000d,
    xorPeer: 0x0012,
    data: 0x0013,
    realm: 0x0014,
    nonce: 0x0015,
    xorRelayed: 0x0016,
    requestedTransport: 0x0019,
    xorMapped: 0x0020,
    fingerprint: 0x8028
});
const METHOD = Object.freeze({
    binding: 0x001,
    allocate: 0x003,
    refresh: 0x004,
    send: 0x006,
    data: 0x007,
    createPermission: 0x008,
    channelBind: 0x009
});
const CLASS = Object.freeze({ request: 0x000, indication: 0x010, success: 0x100, error: 0x110 });
const USER = 'hangout-fixture-user';
const PASS = 'hangout-fixture-pass';
const REALM = 'hangout.fixture';
const MAX_ALLOCATIONS = 32;

function attr(type, value) {
    const pad = (4 - (value.length % 4)) % 4;
    const out = Buffer.alloc(4 + value.length + pad);
    out.writeUInt16BE(type, 0);
    out.writeUInt16BE(value.length, 2);
    value.copy(out, 4);
    return out;
}

function textAttr(type, text) {
    return attr(type, Buffer.from(text));
}

function u32(type, value) {
    const body = Buffer.alloc(4);
    body.writeUInt32BE(value >>> 0);
    return attr(type, body);
}

function errorAttr(code, reason) {
    const phrase = Buffer.from(reason);
    const body = Buffer.alloc(4 + phrase.length);
    body[2] = Math.floor(code / 100);
    body[3] = code % 100;
    phrase.copy(body, 4);
    return attr(ATTR.errorCode, body);
}

function xorAddress(port, address) {
    const cookie = Buffer.alloc(4);
    cookie.writeUInt32BE(MAGIC);
    const parts = address.split('.').map(Number);
    const body = Buffer.alloc(8);
    body[1] = 0x01;
    body.writeUInt16BE((port ^ (MAGIC >>> 16)) & 0xffff, 2);
    for (let i = 0; i < 4; i += 1) body[4 + i] = parts[i] ^ cookie[i];
    return body;
}

function readXor(value) {
    if (!value || value.length < 8 || value[1] !== 0x01) return null;
    const cookie = Buffer.alloc(4);
    cookie.writeUInt32BE(MAGIC);
    const port = (value.readUInt16BE(2) ^ (MAGIC >>> 16)) & 0xffff;
    const address = [0, 1, 2, 3].map((i) => value[4 + i] ^ cookie[i]).join('.');
    return { address, port };
}

function longTermKey(username, realm, credential) {
    return crypto.createHash('md5').update(`${username}:${realm}:${credential}`).digest();
}

function parse(packet) {
    if (!packet || packet.length < 20 || packet.readUInt32BE(4) !== MAGIC) return null;
    const type = packet.readUInt16BE(0);
    const length = packet.readUInt16BE(2);
    if (20 + length > packet.length) return null;
    const attrs = [];
    let cursor = 20;
    const end = 20 + length;
    while (cursor + 4 <= end) {
        const attrType = packet.readUInt16BE(cursor);
        const attrLength = packet.readUInt16BE(cursor + 2);
        const start = cursor + 4;
        if (start + attrLength > end) return null;
        attrs.push({ type: attrType, value: packet.subarray(start, start + attrLength), offset: cursor });
        cursor = start + ((attrLength + 3) & ~3);
    }
    return { type, method: type & ~0x0110, cls: type & 0x0110, tid: Buffer.from(packet.subarray(8, 20)), attrs };
}

function verifyIntegrity(packet, key) {
    const parsed = parse(packet);
    const mi = parsed?.attrs.find((item) => item.type === ATTR.messageIntegrity);
    if (!mi || mi.value.length !== 20) return false;
    const copy = Buffer.from(packet.subarray(0, mi.offset));
    copy.writeUInt16BE(mi.offset + 24 - 20, 2);
    const mac = crypto.createHmac('sha1', key).update(copy).digest();
    return crypto.timingSafeEqual(mac, Buffer.from(mi.value));
}

function verifyFingerprint(packet) {
    const parsed = parse(packet);
    const fp = parsed?.attrs.find((item) => item.type === ATTR.fingerprint);
    if (!fp || fp.value.length !== 4) return false;
    const copy = Buffer.from(packet.subarray(0, fp.offset));
    copy.writeUInt16BE(fp.offset + 8 - 20, 2);
    return ((zlib.crc32(copy) ^ 0x5354554e) >>> 0) === fp.value.readUInt32BE(0);
}

function build({ method, cls, tid, attrs = [], key = null }) {
    const id = tid || crypto.randomBytes(12);
    const body = attrs.length ? Buffer.concat(attrs) : Buffer.alloc(0);
    let packet = Buffer.alloc(20 + body.length);
    packet.writeUInt16BE(method | cls, 0);
    packet.writeUInt16BE(body.length, 2);
    packet.writeUInt32BE(MAGIC, 4);
    id.copy(packet, 8);
    if (body.length) body.copy(packet, 20);
    if (key) {
        const next = Buffer.alloc(packet.length + 24);
        packet.copy(next);
        next.writeUInt16BE(packet.readUInt16BE(2) + 24, 2);
        const mac = crypto.createHmac('sha1', key).update(next.subarray(0, packet.length)).digest();
        next.writeUInt16BE(ATTR.messageIntegrity, packet.length);
        next.writeUInt16BE(20, packet.length + 2);
        mac.copy(next, packet.length + 4);
        packet = next;
    }
    const finger = Buffer.alloc(packet.length + 8);
    packet.copy(finger);
    finger.writeUInt16BE(packet.readUInt16BE(2) + 8, 2);
    const crc = (zlib.crc32(finger.subarray(0, packet.length)) ^ 0x5354554e) >>> 0;
    finger.writeUInt16BE(ATTR.fingerprint, packet.length);
    finger.writeUInt16BE(4, packet.length + 2);
    finger.writeUInt32BE(crc, packet.length + 4);
    return finger;
}

function text(parsed, type) {
    const found = parsed.attrs.find((item) => item.type === type);
    return found ? found.value.toString('utf8') : '';
}

function channelData(channel, payload) {
    const pad = (4 - (payload.length % 4)) % 4;
    const out = Buffer.alloc(4 + payload.length + pad);
    out.writeUInt16BE(channel, 0);
    out.writeUInt16BE(payload.length, 2);
    payload.copy(out, 4);
    return out;
}

function normalize(address) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address || '');
    return mapped ? mapped[1] : address;
}

function bindUdp() {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => {});
    return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind({ address: '127.0.0.1', port: 0 }, () => {
            socket.removeListener('error', reject);
            resolve(socket);
        });
    });
}

async function startLocalTurn() {
    const nonce = crypto.randomBytes(12).toString('hex');
    const key = longTermKey(USER, REALM, PASS);
    const allocations = new Map();
    const lanes = new Map();
    const socket = await bindUdp();
    let closed = false;

    const send = (client, packet) => {
        if (!closed) socket.send(packet, client.port, client.address);
    };
    const fail = (method, tid, code, reason, extra = [], integrity = null) => build({
        method, cls: CLASS.error, tid, attrs: [errorAttr(code, reason), ...extra], key: integrity
    });
    const auth = (packet, parsed) => {
        const username = text(parsed, ATTR.username);
        const realm = text(parsed, ATTR.realm);
        const hasIntegrity = parsed.attrs.some((item) => item.type === ATTR.messageIntegrity);
        if (!hasIntegrity || username !== USER || realm !== REALM || !verifyIntegrity(packet, key)) return 401;
        if (text(parsed, ATTR.nonce) !== nonce) return 438;
        return 0;
    };
    function reply(client, packet) { send(client, packet); }

    function success(method, tid, attrs) {
        return build({ method, cls: CLASS.success, tid, attrs, key });
    }

    function allocationSuccess(alloc, tid) {
        return success(METHOD.allocate, tid, [
            attr(ATTR.xorRelayed, xorAddress(alloc.relayPort, '127.0.0.1')),
            u32(ATTR.lifetime, 600),
            attr(ATTR.xorMapped, xorAddress(alloc.client.port, alloc.client.address))
        ]);
    }

    async function openAllocation(client) {
        if (allocations.size >= MAX_ALLOCATIONS) return null;
        const relay = await bindUdp();
        const alloc = {
            client,
            relay,
            relayPort: relay.address().port,
            permissions: new Set(),
            channelsByNumber: new Map(),
            channelsByPeer: new Map()
        };
        relay.on('message', (payload, from) => {
            const source = normalize(from.address);
            if (!alloc.permissions.has(source)) return;
            const peerKey = `${source}:${from.port}`;
            const channel = alloc.channelsByPeer.get(peerKey);
            if (channel) reply(client, channelData(channel, payload));
            else reply(client, build({
                method: METHOD.data,
                cls: CLASS.indication,
                attrs: [attr(ATTR.xorPeer, xorAddress(from.port, source)), attr(ATTR.data, payload)]
            }));
        });
        allocations.set(`${client.address}:${client.port}`, alloc);
        return alloc;
    }

    function closeAllocation(id) {
        const alloc = allocations.get(id);
        if (!alloc) return;
        allocations.delete(id);
        alloc.relay.close();
    }

    async function onPacket(msg, client) {
        const id = `${client.address}:${client.port}`;
        if ((msg[0] & 0xc0) === 0x40) {
            if (msg.length < 4) return;
            const channel = msg.readUInt16BE(0);
            const len = msg.readUInt16BE(2);
            if (4 + len > msg.length) return;
            const alloc = allocations.get(id);
            const peer = alloc?.channelsByNumber.get(channel);
            if (!peer) return;
            alloc.relay.send(msg.subarray(4, 4 + len), peer.port, peer.address);
            return;
        }
        if ((msg[0] & 0xc0) !== 0) return;
        const parsed = parse(msg);
        if (!parsed || parsed.cls === CLASS.success || parsed.cls === CLASS.error) return;
        const { method, cls, tid } = parsed;
        if (method === METHOD.binding && cls === CLASS.request) {
            reply(client, build({
                method, cls: CLASS.success, tid,
                attrs: [attr(ATTR.xorMapped, xorAddress(client.port, client.address))]
            }));
            return;
        }
        if (cls === CLASS.indication && method === METHOD.send) {
            const alloc = allocations.get(id);
            const peerAttr = parsed.attrs.find((item) => item.type === ATTR.xorPeer);
            const dataAttr = parsed.attrs.find((item) => item.type === ATTR.data);
            const peer = readXor(peerAttr?.value);
            if (!alloc || !peer || !dataAttr || !alloc.permissions.has(peer.address)) return;
            alloc.relay.send(Buffer.from(dataAttr.value), peer.port, peer.address);
            return;
        }
        if (cls !== CLASS.request) return;
        const code = auth(msg, parsed);
        if (code) {
            reply(client, fail(method, tid, code, code === 438 ? 'Stale Nonce' : 'Unauthorized', [
                textAttr(ATTR.realm, REALM), textAttr(ATTR.nonce, nonce)
            ], code === 438 ? key : null));
            return;
        }
        if (method === METHOD.allocate) {
            const existing = allocations.get(id);
            if (existing) {
                reply(client, allocationSuccess(existing, tid));
                return;
            }
            const transport = parsed.attrs.find((item) => item.type === ATTR.requestedTransport);
            if (!transport) {
                reply(client, fail(method, tid, 400, 'Bad Request', [], key));
                return;
            }
            if (transport.value[0] !== 17) {
                reply(client, fail(method, tid, 442, 'Unsupported Transport Protocol', [], key));
                return;
            }
            const alloc = await openAllocation(client);
            if (!alloc) {
                reply(client, fail(method, tid, 486, 'Allocation Quota Reached', [], key));
                return;
            }
            reply(client, allocationSuccess(alloc, tid));
            return;
        }
        const alloc = allocations.get(id);
        if (!alloc) {
            reply(client, fail(method, tid, 437, 'Allocation Mismatch', [], key));
            return;
        }
        if (method === METHOD.refresh) {
            const life = parsed.attrs.find((item) => item.type === ATTR.lifetime);
            const seconds = life && life.value.length >= 4 ? life.value.readUInt32BE(0) : 600;
            if (seconds === 0) closeAllocation(id);
            reply(client, success(method, tid, [u32(ATTR.lifetime, seconds === 0 ? 0 : 600)]));
            return;
        }
        if (method === METHOD.createPermission) {
            const peers = parsed.attrs.map((item) => item.type === ATTR.xorPeer ? readXor(item.value) : null).filter(Boolean);
            if (!peers.length) {
                reply(client, fail(method, tid, 400, 'Bad Request', [], key));
                return;
            }
            for (const peer of peers) alloc.permissions.add(peer.address);
            reply(client, success(method, tid, []));
            return;
        }
        if (method === METHOD.channelBind) {
            const channelAttr = parsed.attrs.find((item) => item.type === ATTR.channel);
            const peer = readXor(parsed.attrs.find((item) => item.type === ATTR.xorPeer)?.value);
            const channel = channelAttr && channelAttr.value.length >= 2 ? channelAttr.value.readUInt16BE(0) : 0;
            if (!peer || channel < 0x4000 || channel > 0x7fff) {
                reply(client, fail(method, tid, 400, 'Bad Request', [], key));
                return;
            }
            if (!alloc.permissions.has(peer.address)) {
                reply(client, fail(method, tid, 403, 'Forbidden', [], key));
                return;
            }
            const previous = alloc.channelsByNumber.get(channel);
            if (previous && (previous.address !== peer.address || previous.port !== peer.port)) {
                reply(client, fail(method, tid, 400, 'Bad Request', [], key));
                return;
            }
            alloc.channelsByNumber.set(channel, peer);
            alloc.channelsByPeer.set(`${peer.address}:${peer.port}`, channel);
            reply(client, success(method, tid, []));
        }
    }

    socket.on('message', (msg, rinfo) => {
        const address = normalize(rinfo.address);
        if (address !== '127.0.0.1' || closed) return;
        const client = { address, port: rinfo.port };
        const id = `${address}:${rinfo.port}`;
        const prev = lanes.get(id) || Promise.resolve();
        const run = prev.then(() => onPacket(msg, client), () => onPacket(msg, client));
        lanes.set(id, run.then(() => {}, () => {}));
    });

    const port = socket.address().port;
    return {
        port,
        username: USER,
        credential: PASS,
        url: `turn:127.0.0.1:${port}?transport=udp`,
        async close() {
            closed = true;
            for (const alloc of allocations.values()) alloc.relay.close();
            allocations.clear();
            await new Promise((resolve) => socket.close(resolve));
        }
    };
}

module.exports = {
    startLocalTurn,
    stun: {
        MAGIC, ATTR, METHOD, CLASS, USER, PASS, REALM,
        attr, textAttr, u32, xorAddress, readXor, longTermKey, parse, build, verifyIntegrity, verifyFingerprint
    }
};
