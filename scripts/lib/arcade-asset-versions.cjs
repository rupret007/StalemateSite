// Revision the changed arcade APIs and their shared chess dependency graph.
// Content hashes are calculated after site branding and module transformations.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const TARGETS = new Set([
    'assets/suite-progress.js', 'assets/suite-progress.css', 'assets/suite-share.js',
    'games/suite-progress-core.js', 'games/table-continue-core.js',
    'games/chess-core.js', 'games/chess-engine.js', 'games/chess-ui.js',
    'stalemate/stalemate-overlay.js'
]);
function versionArcadeAssets(stage) {
    const exists = file => fs.existsSync(path.join(stage, file));
    const version = file => createHash('sha256').update(fs.readFileSync(path.join(stage, file))).digest('hex').slice(0, 16);
    const pathname = reference => reference.split(/[?#]/, 1)[0];
    function withVersion(reference, stamp, html = false) {
        const hashAt = reference.indexOf('#');
        const fragment = hashAt < 0 ? '' : reference.slice(hashAt);
        const beforeHash = hashAt < 0 ? reference : reference.slice(0, hashAt);
        const queryAt = beforeHash.indexOf('?');
        const file = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
        const query = new URLSearchParams(queryAt < 0 ? '' : beforeHash.slice(queryAt + 1).replaceAll('&amp;', '&'));
        query.set('v', stamp);
        return file + '?' + (html ? query.toString().replaceAll('&', '&amp;') : query.toString()) + fragment;
    }
    // A changed Core invalidates Engine, then both dependency URLs invalidate UI.
    for (const file of ['games/chess-engine.js', 'games/chess-ui.js']) {
        if (!exists(file)) continue;
        const original = fs.readFileSync(path.join(stage, file), 'utf8');
        const next = original.replace(/(\bfrom\s*)(['"])(\.\/chess-(?:core|engine)\.js(?:[?#][^'"]*)?)\2/g, (all, from, quote, reference) => {
            const target = 'games/' + pathname(reference).slice(2);
            return exists(target) ? from + quote + withVersion(reference, version(target)) + quote : all;
        });
        if (next !== original) fs.writeFileSync(path.join(stage, file), next);
    }
    for (const file of fs.readdirSync(stage).filter(file => file.endsWith('.html'))) {
        const original = fs.readFileSync(path.join(stage, file), 'utf8');
        const next = original.replace(/<(?:script|link)\b[^>]*>/gi, tag => tag.replace(/(\b(?:src|href)\s*=\s*)(['"])([^'"]+)\2/g, (all, prefix, quote, reference) => {
            const target = pathname(reference);
            return TARGETS.has(target) && exists(target) ? prefix + quote + withVersion(reference, version(target), true) + quote : all;
        }));
        if (next !== original) fs.writeFileSync(path.join(stage, file), next);
    }
}
module.exports = { versionArcadeAssets };
