// Reviewed exact bundle graph for the locked native Lobby fixture. Keep this
// explicit: an equal count with a substituted module is not the same source.
import assert from 'node:assert/strict';
import { isAbsolute, normalize, relative, sep } from 'node:path';

export const NATIVE_LOBBY_INPUTS = Object.freeze([
    'fixture/worker.mjs',
    ...[
        'lobby-core.mjs', 'lobby-effect-records.mjs', 'durable-record-storage.mjs',
        'community-state.mjs', 'filter.mjs', 'lobby-act.mjs', 'message-receipts.mjs',
        'transport-budget.mjs', 'participation-checkpoint.mjs',
        'lobby-incident-sources.mjs', 'incident-cases.mjs'
    ].map(name => 'application/hangout-worker/src/' + name),
    'application/r/45662413410ed051/sync-core.js',
    'application/r/45662413410ed051/entry-sites.mjs',
    ...[
        'index.mjs', 'index.js', 'censor/TextCensor.js', 'matcher/BlacklistedTerm.js',
        'censor/BuiltinStrategies.js', 'matcher/MatchPayload.js', 'matcher/Matcher.js',
        'dataset/DataSet.js', 'matcher/regexp/RegExpMatcher.js',
        'transformer/collapse-duplicates/index.js', 'pattern/ParserError.js',
        'pattern/Pattern.js', 'transformer/to-ascii-lowercase/index.js',
        'transformer/resolve-leetspeak/index.js', 'transformer/Transformers.js',
        'preset/english.js', 'transformer/skip-non-alphabetic/index.js', 'pattern/Nodes.js',
        'transformer/remap-characters/index.js', 'transformer/resolve-confusables/index.js',
        'util/Char.js', 'transformer/collapse-duplicates/transformer.js',
        'matcher/IntervalCollection.js', 'util/Interval.js', 'util/CharacterIterator.js',
        'pattern/Util.js', 'transformer/resolve-leetspeak/dictionary.js',
        'transformer/resolve-confusables/confusables.js', 'pattern/Parser.js',
        'transformer/TransformerSet.js'
    ].map(name => 'dependency/obscenity/dist/' + name)
].sort());

export function assertNativeLobbySourceCatalogue(paths, { fixtureWorker, applicationRoot, obscenityRoot }) {
    const absolute = path => typeof path === 'string' && isAbsolute(path) && normalize(path) === path;
    assert.ok([fixtureWorker, applicationRoot, obscenityRoot].every(absolute), 'canonical absolute source roots required');
    const inside = (path, root) => {
        const suffix = relative(root, path);
        return suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix) ? suffix.split(sep).join('/') : null;
    };
    assert.ok(Array.isArray(paths) && paths.every(absolute), 'canonical absolute source paths required');
    const names = paths.map(path => {
        if (path === fixtureWorker) return 'fixture/worker.mjs';
        // Dependency roots can be installed inside the application root or be
        // existing package symlinks. The caller supplies their real paths.
        const dependency = inside(path, obscenityRoot);
        if (dependency) return 'dependency/obscenity/' + dependency;
        const application = inside(path, applicationRoot);
        assert.ok(application, 'unexpected external native fixture source');
        return 'application/' + application;
    }).sort();
    assert.equal(new Set(names).size, names.length, 'duplicate native fixture source identity');
    assert.deepEqual(names, NATIVE_LOBBY_INPUTS, 'unexpected native fixture source catalogue');
    return names;
}
