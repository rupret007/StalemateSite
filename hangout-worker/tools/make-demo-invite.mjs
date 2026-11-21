import { writeFile } from 'node:fs/promises';
import { makeDemoInvite } from '../src/beta-auth.mjs';

const [origin, brand, output] = process.argv.slice(2);
const site = new URL(origin);
if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash
    || !['stalemate', 'rad-dad'].includes(brand) || !output) {
    throw new Error('Use a private HTTPS origin, stalemate or rad-dad, and a new output file.');
}
const key = process.env.HANGOUT_HMAC_KEY;
const version = process.env.HANGOUT_BETA_INVITE_VERSION || '1';
const invite = await makeDemoInvite(key, version);
const link = new URL('/beta/', site);
link.search = new URLSearchParams({ 'game-night': '1', via: brand });
link.hash = new URLSearchParams({ invite });
await writeFile(output, link.href + '\n', { flag: 'wx', mode: 0o600 });
