import { readBetaBody } from './beta-auth.mjs';

export const VIDEO_ADMISSION_INTERNAL = '/__beta/webjam-video-admission';

export function videoAdmissionEnabled(env) {
    return env.HANGOUT_BETA_MODE === 'protected' && env.HANGOUT_WEBJAM_VIDEO_ADMISSION === 'on';
}

export async function handleVideoAdmission(request, env) {
    const empty = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    const url = new URL(request.url);
    if (url.pathname !== '/v1/check' || url.search || request.method !== 'POST') return empty(404);
    if (!videoAdmissionEnabled(env) || !env.LOBBY) return empty(503);
    try {
        const proof = await readBetaBody(request);
        if (!/^[a-f0-9]{64}$/.test(typeof proof?.session_id === 'string' ? proof.session_id : '')
            || !/^[a-f0-9]{64}$/.test(typeof proof?.invite_digest === 'string' ? proof.invite_digest : '')) return empty(403);
        const lobby = env.LOBBY.get(env.LOBBY.idFromName('stalemate'));
        const response = await lobby.fetch(new Request('https://lobby' + VIDEO_ADMISSION_INTERNAL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: proof.session_id, invite_digest: proof.invite_digest }),
        }));
        if (response.body) void response.body.cancel().catch(() => {});
        return empty(response.status === 204 || response.status === 403 ? response.status : 503);
    } catch {
        return empty(503);
    }
}
