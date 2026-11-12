import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const GAME_NIGHT = '/beta/?game-night=1&amp;via=stalemate';
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff' };
const onlineAction = `<style>
    a.private-online { display: inline-flex; align-items: center; min-height: 44px; padding: .4em .8em;
        border: 1px solid currentColor; border-radius: .5em; font-weight: 700; text-decoration: none; }
</style>`;

function insertBefore(html, marker, content) {
    if (!html.includes(marker)) throw new Error('The private Game Night preview lost its insertion point.');
    return html.replace(marker, () => content + marker);
}

function previewHtml(name, html) {
    html = html.replace(/<script\b[^>]*data-goatcounter[^>]*>[\s\S]*?<\/script>/gi, '');
    if (name === 'index.html') {
        html = html.replace('href="play/#hub-games"', 'href="play/"');
        return insertBefore(html, '<div class="hero-show">',
            `<p class="hero-video__play"><a class="button button--hot" href="${GAME_NIGHT}">Play online with friends</a></p>`);
    }
    if (name === 'play/index.html') return insertBefore(insertBefore(html, '</head>', onlineAction), '<div class="arcade-grid-heading">',
        `<p class="arcade-mode-shortcut"><a class="private-online" href="${GAME_NIGHT}">Play online with friends →</a></p>`);
    if (name === 'play/chess.html') return insertBefore(insertBefore(html, '</head>', onlineAction), '<p>Challenge the computer',
        `<p><a class="chess-hub private-online" href="${GAME_NIGHT}&amp;table=chess">Play chess online with a friend</a></p>`);
    return html;
}

// Keep the mirror in the loopback fixture. It serves only tracked public site files.
export function createArcadePreviewSite(root) {
    const names = new Set(execFileSync('git', ['ls-files', '-z', '--', 'index.html', 'styles.css', 'site-base.js', 'script.js',
        'countdown.js', 'show-state.js', 'assets/', 'js/', 'play/', 'events/', 'tap/', 'qr/'], { cwd: root, encoding: 'utf8' }).split('\0'));
    return async request => {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers });
        const path = decodeURIComponent(new URL(request.url).pathname).slice('/site/'.length);
        const name = !path || path.endsWith('/') ? path + 'index.html' : path;
        if (!names.has(name)) return new Response('Not found.', { status: 404, headers });
        const type = TYPES[extname(name)] || 'application/octet-stream';
        const file = await readFile(join(root, name));
        const body = type.startsWith('text/html') ? Buffer.from(previewHtml(name, file.toString('utf8'))) : file;
        const assetHeaders = { ...headers, 'Content-Type': type, 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' };
        const range = request.method === 'GET' && /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
        if (range) {
            const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
            if (start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${body.length}` } });
            return new Response(body.subarray(start, end + 1), { status: 206, headers: {
                ...assetHeaders, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${body.length}`
            } });
        }
        return new Response(request.method === 'HEAD' ? null : body, { headers: assetHeaders });
    };
}
