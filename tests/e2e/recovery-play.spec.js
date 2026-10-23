const { test } = require('../helpers/media-diagnostics');
const { rummyWithoutStorage, qrDownloadRetry } = require('../helpers/recovery-flows');
test.use({ trace: 'retain-on-failure' });

test.beforeEach(async ({ context }) => {
    await context.route('**/*goatcounter.com/**', route => route.abort());
});

test('Rummy plays, changes difficulty and skips coaching when storage access is denied', async ({ page, hasTouch }) => {
    await rummyWithoutStorage(page, '/StalemateSite/play/turdrummy.html', hasTouch);
});

test('QR Retry reloads a failed song and restores native playback from the same button', async ({ page, hasTouch }) => {
    await qrDownloadRetry(page, '/StalemateSite/qr/', hasTouch);
});
