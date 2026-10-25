// @vitest-environment node
import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createHangoutRelay } from '../../scripts/hangout-relay-dev.mjs';

describe('local relay aborted admission', () => {
    it.each(['malformed', 'destroyed'])('retires a %s handshake without a ghost member or real network calls', async kind => {
        const writes = [];
        const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { writes.push(String(chunk)); callback(); } });
        socket.remoteAddress = '127.0.0.1';
        if (kind === 'destroyed') socket.destroy();
        const relay = createHangoutRelay({ origins: 'http://127.0.0.1:4320' });
        try {
            const url = new URL('http://local/lobby?preview=local-preview-key-0001');
            const req = { method: 'GET', socket, headers: { origin: 'http://127.0.0.1:4320', upgrade: 'websocket', 'sec-websocket-version': '13' } };
            await relay.handleUpgrade(req, socket, Buffer.alloc(0), url); await relay.settled();
            expect(relay.lobby._debug.conns.size).toBe(0);
            expect(relay.metrics().work.cleanup).toBe(0);
            if (kind === 'malformed') expect(writes.join('')).toContain('400 Bad Request');
        } finally { socket.destroy(); await relay.close(); }
    });
});
