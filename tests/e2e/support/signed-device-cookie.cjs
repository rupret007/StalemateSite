'use strict';

async function addSignedDeviceCookie(context, origin) {
    if (!origin) throw new Error('origin required for device cookie fixture');
    const { signDevice, newDeviceId } = await import('../../../hangout-worker/src/auth.mjs');
    const token = await signDevice(newDeviceId(), 'local-dev-only-hmac-key-not-a-secret-000');
    const base = origin.endsWith('/') ? origin : `${origin}/`;
    await context.addCookies([{
        name: '__Host-hangout-dev',
        value: token,
        url: base,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/'
    }]);
    return token;
}

module.exports = { addSignedDeviceCookie };
