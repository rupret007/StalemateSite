'use strict';

const { createRequire } = require('node:module');
const { signDevice, newDeviceId } = createRequire(__filename)('../../../hangout-worker/src/auth.mjs');

const DEV_HMAC = 'local-dev-only-hmac-key-not-a-secret-000';

async function signedDeviceToken() {
    return signDevice(newDeviceId(), DEV_HMAC);
}

async function addSignedDeviceCookie(context, origin) {
    const token = await signedDeviceToken();
    const base = origin.replace(/\/$/, '');
    await context.addCookies([{
        name: '__Host-hangout-dev',
        value: token,
        url: `${base}/`,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/'
    }]);
    return token;
}

module.exports = { addSignedDeviceCookie, signedDeviceToken, DEV_HMAC };
