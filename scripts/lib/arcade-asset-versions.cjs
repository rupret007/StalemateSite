// Revision changed arcade APIs and every parent in their delivery graph.
// Content hashes are calculated after site branding and module transformations.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const TARGETS = new Set([
    'assets/suite-progress.js', 'assets/suite-progress.css', 'assets/suite-share.js',
    'assets/turdsuite.js', 'assets/suite-audio.js', 'assets/suite-sound.js',
    'games/turdtris-audio.js', 'games/turdjack-audio.js',
    'games/turdrummy-audio.js', 'games/turdrummy-audio-core.js',
    'games/turdspades-audio.js', 'games/turdspades-client.js',
    'games/crapeights-presentation.js',
    'games/suite-progress-core.js', 'games/table-continue-core.js',
    'games/chess-core.js', 'games/chess-engine.js', 'games/chess-ui.js',
    'stalemate/stalemate-overlay.js'
]);
function versionArcadeAssets(stage) {
    const targets = new Set(TARGETS);
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
    function localTarget(file, reference) {
        const clean = pathname(reference);
        if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(clean)) return null;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
        return exists(target) ? target : null;
    }
    function resolve(file, reference) {
        const target = localTarget(file, reference);
        return targets.has(target) ? target : null;
    }
    const importPattern = /(\bfrom\s*|\bimport\s*\(\s*|\bsuiteImport\s*\(\s*|\bimport\s*)(['"])([^'"\r\n]+)\2/g;
    function scripts(directory) {
        return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const file = path.join(directory, entry.name);
            return entry.isDirectory() ? scripts(file) : file.endsWith('.js') ? [file] : [];
        });
    }
    const graph = scripts(stage).map(file => {
        const name = path.relative(stage, file).split(path.sep).join('/');
        const text = fs.readFileSync(file, 'utf8');
        return { name, dependencies: Array.from(text.matchAll(importPattern), match => localTarget(name, match[3])) };
    });
    // A new or previously unlisted parent must be invalidated too. Find the
    // complete ancestor closure rather than relying on a handwritten list.
    let discovered;
    do {
        discovered = false;
        for (const file of graph) {
            if (!targets.has(file.name) && file.dependencies.some(dependency => targets.has(dependency))) {
                targets.add(file.name);
                discovered = true;
            }
        }
    } while (discovered);
    // Include static, side-effect, dynamic and SDK-wrapped imports. Version the
    // child's final bytes first so a changed leaf invalidates every cached parent.
    function rewriteImports(text, file, visit) {
        return text.replace(importPattern, (all, prefix, quote, reference) => {
            const target = resolve(file, reference);
            return target ? prefix + quote + withVersion(reference, visit(target)) + quote : all;
        });
    }
    const stamps = new Map(), visiting = new Set();
    function visit(file) {
        if (stamps.has(file)) return stamps.get(file);
        if (visiting.has(file)) throw new Error('Cyclic versioned arcade import: ' + file);
        visiting.add(file);
        if (file.endsWith('.js')) {
            const original = fs.readFileSync(path.join(stage, file), 'utf8');
            const next = rewriteImports(original, file, visit);
            if (next !== original) fs.writeFileSync(path.join(stage, file), next);
        }
        visiting.delete(file);
        const stamp = version(file);
        stamps.set(file, stamp);
        return stamp;
    }
    for (const file of targets) if (exists(file)) visit(file);
    for (const file of fs.readdirSync(stage).filter(file => file.endsWith('.html'))) {
        const original = fs.readFileSync(path.join(stage, file), 'utf8');
        let next = original.replace(/<(?:script|link)\b[^>]*>/gi, tag => tag.replace(/(\b(?:src|href)\s*=\s*)(['"])([^'"]+)\2/g, (all, prefix, quote, reference) => {
            const target = resolve(file, reference);
            return target ? prefix + quote + withVersion(reference, visit(target), true) + quote : all;
        }));
        next = next.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (all, open, body, close) => open + rewriteImports(body, file, visit) + close);
        if (next !== original) fs.writeFileSync(path.join(stage, file), next);
    }
}
module.exports = { versionArcadeAssets };
