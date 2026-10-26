'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const UPSTREAM = 'https://github.com/rupret007/Turdanoid.git';
const PIN = 'cd2dfda364465a72592f640b21acf4785c0a73b4';
const FILES = [
    'index.html', 'TurdAnoid.html', 'turdtris.html', 'turdjack.html', 'crapeights.html',
    'turdrummy.html', 'turdspades.html', 'turdomania.html', 'chess.html', 'neon-arkanoid.html',
    'hub.html', 'game.js', 'favicon.svg', 'assets', 'games'
];
const SONGS = ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a'];
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://stalemate.goatcounter.com; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https://stalemate.goatcounter.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

function options(args) {
    let source = UPSTREAM;
    let ref;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source') {
            if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--source requires a local repository path');
            source = fs.realpathSync(path.resolve(args[++i]));
            if (!fs.statSync(source).isDirectory()) throw new Error('--source must be a local repository directory');
        } else if (args[i].startsWith('-') || ref) {
            throw new Error('Usage: scripts/sync-turdanoid.sh [--source /path/to/Turdanoid] [branch|tag|SHA]');
        } else {
            ref = args[i];
        }
    }
    return { source, ref: ref || PIN };
}

function git(args, cwd) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function insert(html, closingTag, content, filename) {
    if (!html.includes(closingTag)) throw new Error(`${filename}: missing ${closingTag}`);
    return html.replace(closingTag, `${content}\n${closingTag}`);
}

function stripTests(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) stripTests(file);
        else if (/\.test\./.test(entry.name)) fs.unlinkSync(file);
    }
}

function transform(stage) {
    const overlaySource = path.join(ROOT, 'scripts/stalemate-overlay');
    fs.cpSync(overlaySource, path.join(stage, 'stalemate'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/play-track.js'), path.join(stage, 'stalemate/play-track.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts/stalemate-strip.css'), path.join(stage, 'stalemate-strip.css'));
    // suite-music.js resolves assets/stalemate/. Keep the legacy copies for /qr/ audio links.
    fs.mkdirSync(path.join(stage, 'assets/stalemate'), { recursive: true });
    for (const song of SONGS) fs.copyFileSync(path.join(overlaySource, song), path.join(stage, 'assets/stalemate', song));
    stripTests(path.join(stage, 'games'));

    // Supply missing MIME metadata inside the isolated worker, without changing
    // pinned engine bytes or depending on access to the separate Apache host.
    const engineFile = path.join(stage, 'games/chess-engine.js');
    const engine = fs.readFileSync(engineFile, 'utf8');
    const nativeWorker = "new globalThis.URL('../assets/chess/stockfish-19-lite-single.js', import.meta.url)";
    const loaderWorker = "new globalThis.URL('../assets/chess/stockfish-loader.js#stockfish-19-lite-single.wasm', import.meta.url)";
    if (engine.includes(nativeWorker)) {
        // Older pinned sources predate the shared delivery loader.
        fs.writeFileSync(engineFile, engine.replace(nativeWorker, loaderWorker));
        fs.copyFileSync(path.join(ROOT, 'scripts/chess-stockfish-loader.js'), path.join(stage, 'assets/chess/stockfish-loader.js'));
    } else if (!engine.includes(loaderWorker) || !fs.existsSync(path.join(stage, 'assets/chess/stockfish-loader.js'))) {
        throw new Error('Chess worker integration changed upstream');
    }
    const creditsFile = path.join(stage, 'assets/chess/credits.html');
    if (fs.existsSync(creditsFile)) {
        const credits = fs.readFileSync(creditsFile, 'utf8');
        if (!credits.includes('href="stockfish-loader.js"')) {
            fs.writeFileSync(creditsFile, credits.replace('UCI client</a>', 'UCI client</a>, <a href="stockfish-loader.js">worker delivery loader</a>'));
        }
    }

    for (const filename of fs.readdirSync(stage).filter((name) => name.endsWith('.html'))) {
        let html = fs.readFileSync(path.join(stage, filename), 'utf8');
        html = html.replace(/<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>\s*/gi, '')
            .replace(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>\s*/gi, '');
        if (!/<head\b[^>]*>/i.test(html)) throw new Error(`${filename}: missing head`);
        const robots = filename === 'index.html' ? 'index,follow' : 'noindex,nofollow';
        html = html.replace(/<head\b[^>]*>/i, `$&\n<meta name="robots" content="${robots}">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
        if (filename === 'index.html') {
            html = html.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '')
                .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>\s*/gi, '');
            html = insert(html, '</head>', [
                '<link rel="canonical" href="https://stalemate.band/play/">',
                '<meta name="description" content="Play eight free browser games at Stalemate Arcade: chess, brick breaking, block stacking, matching puzzles and card games, with optional music by punk rock band Stalemate.">',
                '<meta property="og:url" content="https://stalemate.band/play/">',
                '<meta property="og:type" content="website">'
            ].join('\n'), filename);
            html = html.replace(/\s*<details class="changelog">[\s\S]*?<\/details>/i, '')
                .replace(/\s*\/\* -+ Changelog -+ \*\/[\s\S]*?\.changelog li \{[^}]*\}/i, '')
                .replace(/\n[ \t]*\.changelog \{[^}]*\}/gi, '');
            if (/changelog/i.test(html)) throw new Error('Hub changelog strip failed');
            html = insert(html, '</head>', '<link rel="stylesheet" href="stalemate-strip.css">', filename);
            html = html.replace(/<body\b[^>]*>/i, '$&\n<nav class="stalemate-strip" aria-label="Stalemate"><a href="../" class="sm-home"><img src="../assets/mark.svg" alt="" width="22" height="22">Stalemate Arcade</a><a href="https://www.youtube.com/@stalemate.punkband" class="sm-listen" rel="noopener">Listen to Stalemate</a></nav>');
        }
        if (filename === 'TurdAnoid.html') {
            html = insert(html, '</head>', '<link rel="stylesheet" href="stalemate/stalemate-overlay.css">', filename);
            html = insert(html, '</body>', '<script src="../countdown.js"></script>\n<script src="stalemate/stalemate-overlay.js"></script>', filename);
        }
        if (filename === 'index.html' || filename === 'TurdAnoid.html') {
            html = insert(html, '</head>', [
                '<meta property="og:title" content="Stalemate Arcade">',
                '<meta property="og:description" content="Eight free browser games, including chess. Music by Stalemate.">',
                '<meta property="og:image" content="https://stalemate.band/play/stalemate/og-play.png">',
                '<meta property="og:image:width" content="1200">',
                '<meta property="og:image:height" content="630">',
                '<meta name="twitter:card" content="summary_large_image">'
            ].join('\n'), filename);
        }
        html = insert(html, '</body>', '<script data-goatcounter="https://stalemate.goatcounter.com/count" async src="../js/count.js"></script>\n<script src="../js/track.js" defer></script>\n<script src="stalemate/play-track.js" defer></script>', filename);
        fs.writeFileSync(path.join(stage, filename), html);
    }
}

function main() {
    const { source, ref } = options(process.argv.slice(2));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stalemate-upstream-'));
    const stage = fs.mkdtempSync(path.join(ROOT, '.play-sync-'));
    const dest = path.join(ROOT, 'play');
    const backup = `${stage}-previous`;
    try {
        git(['init', '--quiet', tmp], ROOT);
        git(['remote', 'add', 'origin', source], tmp);
        // fetch accepts branch, tag and arbitrary reachable commit SHA; --branch clone does not.
        git(['fetch', '--quiet', '--depth=1', 'origin', ref], tmp);
        const sha = git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], tmp);
        git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', sha], tmp);
        for (const name of FILES) fs.cpSync(path.join(tmp, name), path.join(stage, name), { recursive: true });
        transform(stage);
        fs.writeFileSync(path.join(stage, 'VENDORED.txt'), `Vendored from github.com/rupret007/Turdanoid@${sha}.\nOriginal arcade material: same owner as StalemateSite. New chess modules/page and Chessground 10.5.0: GPL-3.0-or-later. Spatial piece artwork by Maurizio Monge: MIT. chess.js 1.4.0: BSD-2-Clause. Stockfish.js 19.0.1: GPL-3.0. See assets/chess/credits.html, included licenses and corresponding-source archives.\nDo not edit by hand: run scripts/sync-turdanoid.sh ${sha}\n`);
        // Both renames stay on the destination filesystem. A failed transform leaves play intact.
        const hadDest = fs.existsSync(dest);
        if (hadDest) fs.renameSync(dest, backup);
        try {
            fs.renameSync(stage, dest);
        } catch (error) {
            if (hadDest) fs.renameSync(backup, dest);
            throw error;
        }
        fs.rmSync(backup, { recursive: true, force: true });
        process.stdout.write(`Synced Turdanoid ${sha} into play/\n`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

try {
    main();
} catch (error) {
    process.stderr.write(`Turdanoid sync failed: ${error.stderr || error.message}\n`);
    process.exitCode = 1;
}
