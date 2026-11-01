'use strict';

const crypto = require('node:crypto');

const DEV_HMAC = 'local-dev-only-hmac-key-not-a-secret-000';
const TTL_MS = 24 * 60 * 60 * 1000;

function newDeviceId() {
    return crypto.randomBytes(16).toString('base64url');
}

function signDevice(id, key, now = Date.now()) {
    const exp = (now + TTL_MS).toString(36);
    const sig = crypto.createHmac('sha256', key).update(`dev:${id}:${exp}`).digest('base64url').slice(0, 32);
    return `${id}.${exp}.${sig}`;
}

async function addSignedDeviceCookie(context, origin) {
    if (!origin || typeof origin !== 'string') throw new Error(`origin required for device cookie fixture (got ${origin})`);
    const token = signDevice(newDeviceId(), DEV_HMAC);
    const url = origin.endsWith('/') ? origin : `${origin}/`;
    await context.addCookies([{
        name: '__Host-hangout-dev',
        value: token,
        url,
        httpOnly: true,
        secure: url.startsWith('https:'),
        sameSite: 'Strict',
        path: '/'
    }]);
    return token;
}

module.exports = { addSignedDeviceCookie, signDevice, newDeviceId, DEV_HMAC };
