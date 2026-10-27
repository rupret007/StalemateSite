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
    'countdown.js',
    'script.js',
    'show-state.js',
    'site-base.js',
    'js/count.js',
    'js/count.LICENSE',
    'js/count.PROVENANCE.json',
    'js/track.js',
    'js/site-track.js',
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

const DIRS = ['play', 'qr', 'tap', 'r', 'join'];
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
for (const dir of DIRS) {
    fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
}

process.stdout.write(`Packaged ${FILES.length} GitHub Pages files into dist/\n`);
