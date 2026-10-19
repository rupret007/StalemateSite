// Shared metadata-only lifecycle checks. Frame handlers use validBetaSession without an RPC.
export const BETA_TTL = 8 * 3600 * 1000;
export const betaVersion = (env) => String(env.HANGOUT_BETA_INVITE_VERSION || '1');
export function validBetaSession(value, env, now = Date.now()) {
    return env.HANGOUT_BETA_MODE === 'protected' && /^[a-z0-9-]{16,64}$/.test(value?.betaSid || '') &&
        /^[A-Za-z0-9._-]{1,64}$/.test(value?.betaInviteVersion || '') && value.betaInviteVersion === betaVersion(env) &&
        Number.isFinite(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + BETA_TTL;
}
export function registryRequest(env, operation, data) {
    if (!env.BETA_SESSIONS) throw new Error('Beta session registry is unavailable.');
    return env.BETA_SESSIONS.get(env.BETA_SESSIONS.idFromName('global')).fetch(new Request(`https://beta-sessions/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    }));
}
export async function activeBetaSession(env, value) {
    if (!validBetaSession(value, env)) return false;
    try { return (await registryRequest(env, 'check', { sid: value.betaSid, version: value.betaInviteVersion, exp: value.expiresAt })).status === 200; }
    catch { return false; }
}
