// Node-owned evidence survives navigation and includes every page in this context.
async function installNoCaptureSentinel(context) {
    const calls = [];
    await context.exposeBinding('__fixtureReportCapture', (_source, method) => {
        calls.push(method); // Never retain URLs, cookies or media contents.
    });
    await context.addInitScript(() => {
        window.__fixtureCaptureSentinelInstalled = false;
        if (!navigator.mediaDevices) return; // Only initial insecure/blank documents.
        for (const method of ['getUserMedia', 'getDisplayMedia']) {
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), method, {
                configurable: true,
                value: async () => {
                    await window.__fixtureReportCapture(method);
                    throw new Error('This newcomer walkthrough never captures media');
                }
            });
        }
        window.__fixtureCaptureSentinelInstalled = true;
    });
    return {
        calls,
        async assertClean() {
            for (const page of context.pages()) {
                if (page.url() === 'about:blank') continue;
                if (!await page.evaluate(() => window.__fixtureCaptureSentinelInstalled === true)) {
                    throw new Error('No-capture sentinel missing from a loaded document');
                }
            }
            if (calls.length !== 0) throw new Error(`Unexpected capture attempts: ${calls.length}`);
        }
    };
}
module.exports = { installNoCaptureSentinel };
