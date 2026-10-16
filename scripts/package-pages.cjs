'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const FILES = [
    '.nojekyll',
    '404.html',
    'embed-placeholder.html',
    'index.html',
    'countdown.js',
    'script.js',
    'show-state.js',
    'site-base.js',
    'styles.css',
    'assets/favicon.svg',
    'assets/grain.svg',
    'assets/hero-stage.svg',
    'assets/mark.svg',
    'assets/og.svg',
    'assets/torn.svg',
    'epk/index.html',
    'epk/stage-plot.txt',
    'epk/tech-rider.txt',
    'qr/index.html'
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

emptyDir(DIST);
for (const relativePath of FILES) {
    copyFile(relativePath);
}

process.stdout.write(`Packaged ${FILES.length} GitHub Pages files into dist/\n`);
