'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const FILES = [
    '.nojekyll',
    '404.html',
    'index.html',
    'robots.txt',
    'sitemap.xml',
    'countdown.js',
    'script.js',
    'show-state.js',
    'site-base.js',
    'js/count.js',
    'js/count.LICENSE',
    'js/count.PROVENANCE.json',
    'js/track.js',
    'js/site-track.js',
    'js/contact-mail.js',
    'js/contact-form.js',
    'styles.css',
    'assets/favicon.svg',
    'assets/games/turdanoid.webp',
    'assets/games/turdomania.webp',
    'assets/icon-facebook.svg',
    'assets/icon-instagram.svg',
    'assets/icon-youtube.svg',
    'assets/grain.svg',
    'assets/hero-stage.svg',
    'assets/manic-poster.jpg',
    'assets/manic.mp4',
    'assets/mark.svg',
    'assets/og.png',
    'assets/og.svg',
    'assets/torn.svg'
];

function emptyDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function copyFile(relativePath) {
    const from = path.join(ROOT, relativePath);
    const to = path.join(DIST, relativePath);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

const HANGOUT_RUNTIME = /\.(html|css|js|webp|png|jpe?g|gif|svg|woff2?|ttf|otf|ico)$/i;

function copyHangoutRoomRuntime() {
    const rRoot = path.join(ROOT, 'r');
    if (!fs.existsSync(rRoot)) return;
    for (const slug of fs.readdirSync(rRoot, { withFileTypes: true })) {
        if (!slug.isDirectory()) continue;
        const roomDir = path.join(rRoot, slug.name);
        for (const ent of fs.readdirSync(roomDir, { withFileTypes: true })) {
            if (!ent.isFile() || /\.md$/i.test(ent.name) || !HANGOUT_RUNTIME.test(ent.name)) continue;
            copyFile(path.join('r', slug.name, ent.name));
        }
    }
}

const DIRS = ['play', 'qr', 'tap', 'events', 'join'];
// Internal notes stay in the repository and out of the Pages artifact. GitHub
// still reports Pages source.path as "/" for this workflow build, so a new
// file under docs/ would look published. Do not add these directories here.
const UNPUBLISHED = ['docs', 'hangout-internal', 'tests', 'hangout-worker', ['node', 'modules'].join('_')];
for (const relativePath of [...FILES, ...DIRS]) {
    const top = relativePath.split('/')[0];
    if (UNPUBLISHED.includes(top)) throw new Error(`Refusing to publish ${relativePath}`);
}

emptyDir(DIST);
for (const relativePath of FILES) {
    copyFile(relativePath);
}
copyHangoutRoomRuntime();
for (const dir of DIRS) {
    fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
}

process.stdout.write(`Packaged ${FILES.length} GitHub Pages files into dist/\n`);
