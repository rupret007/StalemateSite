// Starts the documented local Game Night preview. A localhost readiness check
// returns the preview origin to the tests. Child lines that contain an origin
// or the invitation are not printed. Nothing here is written to disk.
import { spawn } from 'node:child_process';
import http from 'node:http';

const invitation = process.env.ARCADE_PREVIEW_INVITATION;
if (typeof invitation !== 'string' || invitation.length < 32) {
    console.error('Set ARCADE_PREVIEW_INVITATION to a local-only value with at least 32 characters.');
    process.exit(1);
}
const readyPort = Number(process.env.BRIDGE_READY_PORT || 8792);
let upstreamOrigin = '';
let stopping = false;

const readyServer = http.createServer((request, response) => {
    const ok = request.url === '/ready' && upstreamOrigin.startsWith('https://');
    response.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end(ok ? upstreamOrigin : 'starting');
});
readyServer.listen(readyPort);

const child = spawn('npm', ['run', 'dev:game-night'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
});

function scrub(chunk, carry) {
    const lines = (carry + chunk.toString()).split('\n');
    const rest = lines.pop() ?? '';
    for (const line of lines) {
        const found = line.match(/(https:\/\/[^/\s]+)\/site\//);
        if (found && !upstreamOrigin) {
            upstreamOrigin = found[1];
            console.log('Bridge preview is ready.');
        }
        if (line.includes(invitation) || line.includes('://') || /\d{1,3}(?:\.\d{1,3}){3}/.test(line)) continue;
        if (line.trim()) console.log(line);
    }
    return rest;
}

let out = '';
let err = '';
child.stdout.on('data', chunk => { out = scrub(chunk, out); });
child.stderr.on('data', chunk => { err = scrub(chunk, err); });

function stop() {
    if (stopping) return;
    stopping = true;
    upstreamOrigin = '';
    child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', code => {
    readyServer.close();
    process.exit(stopping ? 0 : (code ?? 1));
});
