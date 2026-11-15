// Alternate entry module for reviewed private video delivery. The default
// fetch still uses the ordinary protected site handler.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleVideoAdmission } from './webjam-video-admission.mjs';

export { default } from './beta-entry.mjs';
export * from './beta-entry.mjs';

export class WebJamVideoAdmission extends WorkerEntrypoint {
    fetch(request) { return handleVideoAdmission(request, this.env); }
}
