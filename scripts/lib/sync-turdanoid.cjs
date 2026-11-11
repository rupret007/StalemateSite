'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { versionArcadeAssets } = require('./arcade-asset-versions.cjs');

const ROOT = path.resolve(__dirname, '../..');
const UPSTREAM = 'https://github.com/rupret007/Turdanoid.git';
const PIN = '5f07783de30da174d643e39c106b57b84c94baa4';
const FILES = [
    'index.html', 'TurdAnoid.html', 'turdtris.html', 'turdjack.html', 'crapeights.html',
    'turdrummy.html', 'turdspades.html', 'turdomania.html', 'chess.html', 'turdrush.html', 'neon-arkanoid.html',
    'hub.html', 'game.js', 'favicon.svg', 'assets', 'games'
];
const MATCH_WORKER_FILES = [
    'games/chess-match.js', 'games/chess-core.js', 'assets/chess/chess.js', 'assets/chess/chess.js.map',
    'assets/chess/chessjs-LICENSE.txt', 'assets/chess/GPL-3.0.txt',
    'games/arcade-deck.js', 'games/crapeights-match.js', 'games/crapeights-rules.js',
    'games/turdrummy-match.js', 'games/turdrummy-rules.js',
    'games/turdspades-match.js', 'games/turdspades-engine.js',
    'games/turdjack-match.js', 'games/turdjack-engine.js', 'games/cards.js',
    'games/turdtris-match.js', 'games/turdtris-sprint.js', 'games/turdtris_logic.js',
    'games/turdtris-presentation.js', 'games/turdtris-modes.js',
    'games/turdomania-duel.js', 'games/turdomania-core.js',
    'games/turdrush-race.js', 'games/turdrush-core.js'
];
const SONGS = ['manic.m4a', 'andrea.m4a', 'only-been-18.m4a', 'wham-bam.m4a', 'planet-of-the-flakes.m4a'];
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://stalemate.goatcounter.com; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https://stalemate.goatcounter.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

function options(args) {
    let source = UPSTREAM;
    let ref;
    let matchWorker = false;
    let gameNight;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source') {
            if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--source requires a local repository path');
            source = fs.realpathSync(path.resolve(args[++i]));
            if (!fs.statSync(source).isDirectory()) throw new Error('--source must be a local repository directory');
        } else if (args[i] === '--match-worker' && !matchWorker) {
            matchWorker = true;
        } else if (args[i] === '--game-night' && !gameNight) {
            gameNight = new URL(args[++i]);
            const loopback = gameNight.protocol === 'http:' && gameNight.hostname === '127.0.0.1';
            if (!(gameNight.protocol === 'https:' || loopback) || !/^[a-z0-9.-]+$/i.test(gameNight.hostname) || gameNight.username || gameNight.password ||
                gameNight.pathname !== '/beta/' || gameNight.search || gameNight.hash) throw Error('Use the protected Game Night /beta/ URL.');
            gameNight.searchParams.set('via', 'stalemate');
        } else if (args[i].startsWith('-') || ref) {
            throw new Error('Usage: scripts/sync-turdanoid.sh [--source /path/to/Turdanoid] [--match-worker] [--game-night URL] [branch|tag|SHA]');
        } else {
            ref = args[i];
        }
    }
    return { source, ref: ref || PIN, matchWorker, gameNight };
}

function replaceStagedDirectories(pairs) {
    const installed = [];
    try {
        for (const [staged, destination] of pairs) {
            const backup = fs.existsSync(destination) ? `${staged}-previous` : null;
            if (backup) fs.renameSync(destination, backup);
            installed.push({ destination, backup, moved: false });
            fs.renameSync(staged, destination);
            installed.at(-1).moved = true;
        }
    } catch (error) {
        for (const { destination, backup, moved } of installed.reverse()) {
            if (moved) fs.rmSync(destination, { recursive: true });
            if (backup) fs.renameSync(backup, destination);
        }
        throw error;
    }
    for (const { backup } of installed) if (backup) fs.rmSync(backup, { recursive: true });
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

function transform(stage, gameNight) {
    const overlaySource = path.join(ROOT, 'scripts/stalemate-overlay');
    fs.cpSync(overlaySource, path.join(stage, 'stalemate'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/play-track.js'), path.join(stage, 'stalemate/play-track.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts/play-music-pref.js'), path.join(stage, 'stalemate/play-music-pref.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts/play-music-pref.css'), path.join(stage, 'stalemate/play-music-pref.css'));
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
                '<meta name="description" content="Play nine free browser games at Stalemate Arcade: chess, brick breaking, block stacking, matching puzzles and card games, with optional music by punk rock band Stalemate.">',
                '<meta property="og:url" content="https://stalemate.band/play/">',
                '<meta property="og:type" content="website">'
            ].join('\n'), filename);
            html = html.replace(/\s*<details class="changelog">[\s\S]*?<\/details>/i, '')
                .replace(/\s*\/\* -+ Changelog -+ \*\/[\s\S]*?\.changelog li \{[^}]*\}/i, '')
                .replace(/\n[ \t]*\.changelog \{[^}]*\}/gi, '');
            if (/changelog/i.test(html)) throw new Error('Hub changelog strip failed');
            if (gameNight) html = insert(html, '<section class="games"', `<p class="arcade-mode-shortcut"><a href="${gameNight.href}">Play online with friends →</a></p>`, filename);
            const footerNote = /<p class="footer-note">[^\n]*<\/p>/;
            if (!footerNote.test(html)) throw Error('Arcade footer note missing');
            html = html.replace(footerNote, note => note + `
    <footer class="site-footer site-footer--play">
      <nav aria-label="Footer navigation">
        <a href="../">Band homepage</a>
        <a href="../#contact">Contact</a>
      </nav>
    </footer>`);
            html = insert(html, '</head>', '<link rel="stylesheet" href="stalemate-strip.css">', filename);
            html = html.replace(/<body\b[^>]*>/i, '$&\n<nav class="stalemate-strip" aria-label="Stalemate"><a href="../" class="sm-home"><img src="../assets/mark.svg" alt="" width="22" height="22">Stalemate Arcade</a><a href="../#contact" class="sm-contact">Contact</a><button type="button" class="stalemate-music-toggle" data-music-toggle aria-label="Site music on or off">Music on</button><button type="button" class="sm-listen" data-site-play="manic" data-site-play-label="Listen to Manic" aria-label="Play Manic here">Listen to Manic</button></nav>');
        }
        html = insert(html, '</head>', '<link rel="stylesheet" href="stalemate/play-music-pref.css">\n<script src="../js/music-preference.js"></script>', filename);
        if (filename === 'TurdAnoid.html') {
            html = insert(html, '</head>', '<link rel="stylesheet" href="stalemate/stalemate-overlay.css">', filename);
            html = insert(html, '</body>', '<script src="../countdown.js"></script>\n<script src="stalemate/stalemate-overlay.js"></script>', filename);
        }
        if (filename === 'index.html' || filename === 'TurdAnoid.html') {
            html = insert(html, '</head>', [
                '<meta property="og:title" content="Stalemate Arcade">',
                '<meta property="og:description" content="Nine free browser games, including chess. Music by Stalemate.">',
                '<meta property="og:image" content="https://stalemate.band/play/stalemate/og-play.png">',
                '<meta property="og:image:width" content="1200">',
                '<meta property="og:image:height" content="630">',
                '<meta name="twitter:card" content="summary_large_image">'
            ].join('\n'), filename);
        }
        const bodyScripts = '<script data-goatcounter="https://stalemate.goatcounter.com/count" async src="../js/count.js"></script>\n<script src="../js/track.js" defer></script>\n<script src="stalemate/play-track.js" defer></script>\n<script src="stalemate/play-music-pref.js" defer></script>';
        html = insert(html, '</body>', filename === 'index.html'
            ? '<script src="../site-base.js" defer></script>\n<script src="../js/site-player.js" defer></script>\n' + bodyScripts
            : bodyScripts, filename);
        fs.writeFileSync(path.join(stage, filename), html);
    }
}

function main() {
    const { source, ref, matchWorker, gameNight } = options(process.argv.slice(2));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stalemate-upstream-'));
    const stage = fs.mkdtempSync(path.join(ROOT, '.play-sync-'));
    const workerStage = matchWorker ? fs.mkdtempSync(path.join(ROOT, '.match-worker-sync-')) : null;
    try {
        git(['init', '--quiet', tmp], ROOT);
        git(['remote', 'add', 'origin', source], tmp);
        // fetch accepts branch, tag and arbitrary reachable commit SHA; --branch clone does not.
        git(['fetch', '--quiet', '--depth=1', 'origin', ref], tmp);
        const sha = git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], tmp);
        git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', sha], tmp);
        // The disposable checkout is the patch root. A source change that
        // needs the site music overlay refreshed fails before publishing play.
        git(['apply', path.join(ROOT, 'scripts/stalemate-arcade-music.patch')], tmp);
        for (const name of FILES) fs.cpSync(path.join(tmp, name), path.join(stage, name), { recursive: true });
        if (workerStage) {
            for (const name of MATCH_WORKER_FILES) {
                const output = path.join(workerStage, name);
                fs.mkdirSync(path.dirname(output), { recursive: true });
                fs.writeFileSync(output, execFileSync('git', ['cat-file', 'blob', `${sha}:${name}`], { cwd: tmp }));
            }
            fs.writeFileSync(path.join(workerStage, 'VENDORED.txt'), `Turdanoid@${sha}\n`);
        }
        transform(stage, gameNight);
        versionArcadeAssets(stage);
        fs.writeFileSync(path.join(stage, 'VENDORED.txt'), `Vendored from github.com/rupret007/Turdanoid@${sha}.\nOriginal arcade material: same owner as StalemateSite. New chess modules/page and Chessground 10.5.0: GPL-3.0-or-later. Spatial piece artwork by Maurizio Monge: MIT. chess.js 1.4.0: BSD-2-Clause. Stockfish.js 19.0.1: GPL-3.0. See assets/chess/credits.html, included licenses and corresponding-source archives.\nDo not edit by hand: run scripts/sync-turdanoid.sh ${sha}\n`);
        const outputs = [[stage, path.join(ROOT, 'play')]];
        if (workerStage) outputs.push([workerStage, path.join(ROOT, 'hangout-worker/arcade')]);
        replaceStagedDirectories(outputs);
        process.stdout.write(`Synced Turdanoid ${sha} into play/\n`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(stage, { recursive: true, force: true });
        if (workerStage) fs.rmSync(workerStage, { recursive: true, force: true });
    }
}

try {
    main();
} catch (error) {
    process.stderr.write(`Turdanoid sync failed: ${error.stderr || error.message}\n`);
    process.exitCode = 1;
}
