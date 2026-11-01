// Separate loopback-only, ephemeral and synthetic launcher; never a public API.
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createIncidentReviewFixture } from './incident-review-fixture.mjs';

export async function startIncidentReviewPreview({ port = 4397 } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid loopback preview port.');
    const fixture = await createIncidentReviewFixture(), csrf = crypto.randomUUID(), streams = new Set(); let origin;
    const assets = new URL('./incident-review-ui/', import.meta.url), headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
    const send = (res, status, body, type = 'application/json; charset=utf-8') => { res.writeHead(status, { ...headers, 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
    const server = http.createServer(async (req, res) => {
        try {
            if (req.headers.host !== new URL(origin).host) return send(res, 403, { ok: false, error: 'forbidden' });
            const url = new URL(req.url, origin);
            if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(new URL('index.html', assets), 'utf8').replace('__LOCAL_CSRF__', csrf), 'text/html; charset=utf-8');
            if (req.method === 'GET' && ['/controller.mjs', '/client.mjs', '/style.css'].includes(url.pathname))
                return send(res, 200, fs.readFileSync(new URL(url.pathname.slice(1), assets)), url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
            if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-local-csrf'] !== csrf) return send(res, 403, { ok: false, error: 'forbidden' });
            let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) return send(res, 413, { ok: false, error: 'invalid-request' }); }
            if (url.pathname === '/session') {
                const body = JSON.parse(raw); if (Object.keys(body).length !== 1 || typeof body.profile !== 'string') return send(res, 400, { ok: false, error: 'invalid-request' });
                return send(res, 200, { ok: true, session: await fixture.open(body.profile) });
            }
            const session = req.headers['x-local-session'];
            if (!(await fixture.call(session, 'status')).ok) return send(res, 403, { ok: false, error: 'forbidden' });
            if (url.pathname === '/events') {
                res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); res.write(': local updates only\n\n'); streams.add(res);
                const stop = fixture.subscribe(session, event => { res.write(`data: ${JSON.stringify(event)}\n\n`); if (event.type === 'disconnect') res.end(); });
                res.on('close', () => { stop(); streams.delete(res); }); return;
            }
            if (url.pathname === '/logout') { await fixture.disconnect(session); return send(res, 200, { ok: true }); }
            if (url.pathname === '/call') {
                const body = JSON.parse(raw); if (!body || Object.keys(body).length !== 2 || typeof body.method !== 'string') return send(res, 400, { ok: false, error: 'invalid-request' });
                return send(res, 200, await fixture.call(session, body.method, body.args));
            }
            send(res, 404, { ok: false, error: 'not-found' });
        } catch { send(res, 503, { ok: false, error: 'storage-unavailable' }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { url: `${origin}/`, fixture, close: async () => { await fixture.stop(); for (const stream of streams) stream.end(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
    const preview = await startIncidentReviewPreview({ port: Number(process.env.HANGOUT_INCIDENT_PREVIEW_PORT || 4397) });
    console.log(`Synthetic local incident review: ${preview.url}`);
    console.log('Explicit role fixtures only. Benign messages, ephemeral memory/key, no real evidence or deployments.');
    let closing = false; for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await preview.close(); process.exit(0); });
}
