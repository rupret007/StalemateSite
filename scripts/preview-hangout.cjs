'use strict';

// Human preview is deliberately separate from the stateless automated test server.
// It always binds loopback; this command never configures or deploys Cloudflare.
(async () => {
    const { startPreview } = await import('./preview-hangout-server.mjs');
    const port = Number(process.env.HANGOUT_PREVIEW_PORT || process.env.STALEMATE_TEST_PORT || 4387);
    const preview = await startPreview({ port, ...(process.env.HANGOUT_PREVIEW_STATE ? { statePath: process.env.HANGOUT_PREVIEW_STATE } : {}) });
    console.log(`Hang Out private local preview: ${preview.url}`);
    console.log('Choose Guest, Room owner A/B, Community moderator, or Site owner in the launcher.');
    console.log('All role/email identities are local stand-ins. AI is off. Nothing is published.');
    console.log(`Local room and moderation state: ${preview.statePath}`);
    console.log('Ctrl+C stops the preview; registered rooms and preview links survive a restart for seven days.');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
        if (stopping) return;
        stopping = true;
        await preview.close();
        process.exit(0);
    });
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
