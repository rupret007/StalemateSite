'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '../..');
const TEST_SLUG = 'e2e-lobby';

function discoverProductRoom(root = repoRoot) {
    const roomRoot = path.join(root, 'r');
    let names;
    try {
        names = fs.readdirSync(roomRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .filter(name => name !== TEST_SLUG && fs.existsSync(path.join(roomRoot, name, 'lobby', 'index.html')));
    } catch (error) {
        throw new Error(`Could not discover a product lobby under r/*/lobby/index.html (${error.code || error.message}).`);
    }
    if (names.length !== 1) {
        throw new Error(`Expected exactly one product lobby (r/*/lobby/index.html), found ${names.length}.`);
    }
    return { name: names[0], dir: path.join(roomRoot, names[0]) };
}

const discovered = discoverProductRoom();

function productFile(...parts) {
    return path.join(discovered.dir, ...parts.flat());
}

function productFileUrl(relative = '') {
    return pathToFileURL(productFile(relative)).href;
}

function productRepoPath(relative = '') {
    const tail = String(relative).replace(/^\/+/, '');
    return tail ? `r/${discovered.name}/${tail}` : `r/${discovered.name}`;
}

function productRoomPath(suffix = '') {
    const tail = String(suffix).replace(/^\/+/, '');
    return tail ? `/r/${discovered.name}/${tail}` : `/r/${discovered.name}/`;
}

function roomPath(suffix = '') {
    const tail = String(suffix).replace(/^\/+/, '');
    return tail ? `/r/${TEST_SLUG}/${tail}` : `/r/${TEST_SLUG}/`;
}

function rewriteRoomRequest(urlPath) {
    const replacements = [
        [`/StalemateSite/r/${TEST_SLUG}`, `/StalemateSite/r/${discovered.name}`],
        [`/r/${TEST_SLUG}`, `/r/${discovered.name}`]
    ];
    for (const [from, to] of replacements) {
        if (urlPath === from || urlPath.startsWith(`${from}/`)) return to + urlPath.slice(from.length);
    }
    return urlPath;
}

module.exports = {
    TEST_SLUG,
    repoRoot,
    productRoomDir: discovered.dir,
    productRoomName: discovered.name,
    productFile,
    productFileUrl,
    productRepoPath,
    productRoomPath,
    roomPath,
    rewriteRoomRequest,
    discoverProductRoom
};
