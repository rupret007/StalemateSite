'use strict';

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const dests = [
    path.resolve('/opt/cursor/artifacts'),
    path.resolve(__dirname, '..', 'pr-assets')
];

async function main() {
    const browser = await chromium.launch({ headless: true });
    const shots = [
        { name: process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}_desktop_home.png` : 'after_desktop_home.png', url: 'http://127.0.0.1:4320/', width: 1440, height: 900 },
        { name: process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}_mobile_home.png` : 'after_mobile_home.png', url: 'http://127.0.0.1:4320/', width: 390, height: 844 },
        { name: process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}_desktop_qr.png` : 'after_desktop_qr.png', url: 'http://127.0.0.1:4320/qr/', width: 1440, height: 900 },
        { name: process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}_mobile_epk.png` : 'after_mobile_epk.png', url: 'http://127.0.0.1:4320/epk/', width: 390, height: 844 },
        { name: process.env.SHOT_PREFIX ? `${process.env.SHOT_PREFIX}_desktop_404.png` : 'after_desktop_404.png', url: 'http://127.0.0.1:4320/missing', width: 1440, height: 900 }
    ];

    for (const shot of shots) {
        const page = await browser.newPage({
            viewport: { width: shot.width, height: shot.height },
            javaScriptEnabled: true
        });
        await page.route('https://fonts.googleapis.com/**', (route) =>
            route.fulfill({ contentType: 'text/css', body: '/* local screenshot font fallback */' }));
        await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
        const response = await page.goto(shot.url, { waitUntil: 'networkidle' });
        if (!response || (response.status() >= 500)) {
            throw new Error(`Failed to load ${shot.url}: ${response && response.status()}`);
        }
        await page.waitForTimeout(200);
        const buffer = await page.screenshot({ fullPage: false, type: 'png' });
        for (const dest of dests) {
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, shot.name), buffer);
        }
        await page.close();
    }

    await browser.close();
    process.stdout.write(`Wrote ${shots.length} after screenshots\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
