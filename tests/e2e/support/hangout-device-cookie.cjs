'use strict';

const { testBaseURL } = require('../../../scripts/lib/e2e-test-server.cjs');

async function seedDeviceCookie(request, origin) {
    const base = origin || testBaseURL(process.env);
    await request.post(`${base}/__test/hangout-device-cookie`);
}

module.exports = { seedDeviceCookie };
