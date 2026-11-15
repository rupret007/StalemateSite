import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const caller = `
export default { fetch(request, env) {
    const path = new URL(request.url).pathname;
    const target = path === '/public' ? env.PUBLIC_BETA : env.VIDEO_ADMISSION;
    return target.fetch(new Request('https://video-admission.invalid/v1/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: '1'.repeat(64), invite_digest: (path === '/denied' ? '3' : '2').repeat(64) }),
        redirect: 'error',
    }));
} };
`;

export async function verifyNamedVideoBinding({ Miniflare, convertOptions, rolldown, state, fixturePath }) {
    const bundler = await rolldown({ input: fixturePath, platform: 'neutral', external: ['node:crypto', 'cloudflare:workers'] });
    let generated;
    try { generated = await bundler.generate({ format: 'esm', codeSplitting: false, sourcemap: false }); }
    finally { await bundler.close(); }
    assert.equal(generated.output.length, 1);
    const bundle = generated.output[0];
    assert.equal(bundle.type, 'chunk');
    assert.ok(bundle.exports.includes('WebJamVideoAdmission'));
    assert.ok(bundle.imports.includes('cloudflare:workers'));

    let outbound = 0;
    const blockEgress = () => { outbound++; return new Response(null, { status: 503 }); };
    const modules = (name, contents) => [{ type: 'ESModule', path: join(state, name), contents }];
    const options = convertOptions({
        host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1', inspectorPort: 0,
        resourcePersistencePath: join(state, 'video-binding-persist'), resourceTmpPath: join(state, 'video-binding-runtime'),
        cf: false, telemetry: { enabled: false }, unsafeRegisterWorker: false, unsafeRuntimeEnv: {},
        workers: [
            { name: 'video-binding-caller', compatibilityDate: '2026-10-01', modulesRoot: state, modules: modules('video-binding-caller.mjs', caller),
                serviceBindings: { PUBLIC_BETA: 'video-binding-beta',
                    VIDEO_ADMISSION: { name: 'video-binding-beta', entrypoint: 'WebJamVideoAdmission' } },
                outboundService: blockEgress },
            { name: 'video-binding-beta', compatibilityDate: '2026-10-01', modulesRoot: state, modules: modules('video-binding-beta.mjs', bundle.code),
                durableObjects: { LOBBY: { className: 'VideoBindingFixtureLobby', useSQLite: true } },
                bindings: { HANGOUT_BETA_MODE: 'protected', HANGOUT_WEBJAM_VIDEO_ADMISSION: 'on' },
                outboundService: blockEgress },
        ],
    });
    options.unsafeEnableSharedStorage = false;
    const mf = new Miniflare(options);
    try {
        assert.equal((await mf.ready).hostname, '127.0.0.1');
        const check = path => mf.dispatchFetch('http://local-fixture.invalid' + path);
        const allowed = await check('/allowed');
        assert.equal(allowed.status, 204, 'named Workerd binding should reach the verifier');
        assert.equal(await allowed.text(), '');
        assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
        const denied = await check('/denied');
        assert.equal(denied.status, 403, 'named Workerd binding should preserve refusal');
        const publicResult = await check('/public');
        assert.ok(publicResult.status >= 400, 'default beta handler must not approve the internal request');
        await publicResult.body?.cancel();
        assert.equal(outbound, 0);
        return { allowed: 204, denied: 403, publicResponse: publicResult.status, outbound,
            bundleSha256: createHash('sha256').update(bundle.code).digest('hex') };
    } finally { await mf.dispose(); }
}
