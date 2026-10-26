// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { NATIVE_LOBBY_INPUTS, assertNativeLobbySourceCatalogue } from '../runtime/lobby-effects/source-catalogue.mjs';

const roots = { fixtureWorker: '/fixture/worker.mjs', applicationRoot: '/application', obscenityRoot: '/external/obscenity' };
const path = name => name === 'fixture/worker.mjs' ? roots.fixtureWorker : name.startsWith('application/')
    ? join(roots.applicationRoot, name.slice('application/'.length)) : join(roots.obscenityRoot, name.slice('dependency/obscenity/'.length));
const graph = () => NATIVE_LOBBY_INPUTS.map(path);
describe('exact native Lobby source catalogue', () => {
    it('accepts all explicitly reviewed sources across an existing external dependency root', () => {
        expect(assertNativeLobbySourceCatalogue(graph().reverse(), roots)).toEqual(NATIVE_LOBBY_INPUTS);
        expect(NATIVE_LOBBY_INPUTS).toContain('application/hangout-worker/src/lobby-incident-sources.mjs');
        expect(NATIVE_LOBBY_INPUTS).toContain('application/hangout-worker/src/incident-cases.mjs');
    });
    it('rejects missing sources and an equal-count substituted application source', () => {
        expect(() => assertNativeLobbySourceCatalogue(graph().slice(1), roots)).toThrow('source catalogue');
        const replaced = graph(); replaced[0] = '/application/hangout-worker/src/unreviewed.mjs';
        expect(() => assertNativeLobbySourceCatalogue(replaced, roots)).toThrow('source catalogue');
    });
    it('rejects duplicate identities, external paths and noncanonical path aliases', () => {
        const duplicate = graph(); duplicate[0] = duplicate[1];
        expect(() => assertNativeLobbySourceCatalogue(duplicate, roots)).toThrow('duplicate');
        const external = graph(); external[0] = '/application-elsewhere/hidden.mjs';
        expect(() => assertNativeLobbySourceCatalogue(external, roots)).toThrow('external');
        const alias = graph(); alias[0] = '/application/hangout-worker/src/../src/filter.mjs';
        expect(() => assertNativeLobbySourceCatalogue(alias, roots)).toThrow('canonical');
    });
});
