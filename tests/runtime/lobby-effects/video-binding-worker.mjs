// Synthetic lobby result for the named-binding transport test. Participant
// checks on the real lobby handler are exercised by its separate unit suite.
import { VIDEO_ADMISSION_INTERNAL } from '../../../hangout-worker/src/webjam-video-admission.mjs';
export { default, WebJamVideoAdmission } from '../../../hangout-worker/src/beta-video-entry.mjs';

export class VideoBindingFixtureLobby {
    async fetch(request) {
        if (request.method !== 'POST' || new URL(request.url).pathname !== VIDEO_ADMISSION_INTERNAL) {
            return new Response(null, { status: 404 });
        }
        const { session_id: session, invite_digest: digest } = await request.json();
        return new Response(null, { status: session === '1'.repeat(64) && digest === '2'.repeat(64) ? 204 : 403 });
    }
}
