// Separate protected, invite-only pilot. Production index.mjs never imports these preview identities.
import worker, { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget } from './index.mjs';
import { accountId, ipHash, newDeviceId, signDevice, verifyDevice } from './auth.mjs';
import { previewKeyOk } from './core.mjs';
import { PILOT_TTL, equalSecret, signPilot, pilotCookie, pilotSession } from './pilot-auth.mjs';
export { HangoutLobby, HangoutRoom, HangoutQuota, HangoutTurnBudget };
const ROOT = '/r/45662413410ed051/';
const CSP = "default-src 'self'; script-src 'self' https://www.youtube.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' wss: https://www.youtube.com https://*.googlevideo.com; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP };
const reply = (body, status = 200, type = 'text/plain; charset=utf-8', extra = {}) => new Response(body, { status, headers: { ...headers, 'Content-Type': type, ...extra } });
const json = (value, status = 200, extra) => reply(JSON.stringify(value), status, 'application/json; charset=utf-8', extra);
const redirect = (where, extra = {}) => reply(null, 303, 'text/plain', { Location: where, ...extra });
const stateEmail = (role) => role === 'owner' ? 'pilot-admin@pilot.invalid' : 'pilot-mod@pilot.invalid';
function configured(env) { return env.PILOT_MODE === 'protected' && env.PILOT_OPERATOR_KEY?.length >= 32 && env.HANGOUT_PREVIEW_KEY?.length >= 32 && env.HANGOUT_HMAC_KEY?.length >= 32 && env.ASSETS && env.LOBBY && env.QUOTA; }
function sameOrigin(request) { return request.headers.get('Origin') === new URL(request.url).origin; }
const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Stalemate · Private pilot</title><link rel="stylesheet" href="/pilot/style.css"><script defer src="/pilot/client.js"></script></head><body><main><p class="eyebrow">STALEMATE · PRIVATE TEST</p><h1>Hang Out</h1><p id="status" role="status">Checking your private invitation…</p><section id="login" hidden><p>Open your private invitation link, or paste its access code here.</p><form id="unlock"><label>Access code <input id="key" type="password" autocomplete="off" required></label><button>Open private pilot</button></form></section><section id="inside" hidden><p id="identity"></p><p>Real shared rooms and chat. Chat starts when you join. Cameras stay off until you choose otherwise.</p><p><a class="button" href="${ROOT}lobby/">Enter the lobby</a> <a class="button" id="moderation" hidden href="${ROOT}admin/">Moderation panel</a></p><section id="roles" hidden><h2>Test a role</h2><p>These are private pilot identities. Email delivery and production email sign-in are separate setup steps.</p><form id="choose"><label>Pilot name <input id="label" value="JeffTest" pattern="[A-Za-z][A-Za-z0-9_-]{2,19}" maxlength="20" required></label><label>Role <select id="role"><option value="room-owner">Room owner account</option><option value="fan">Guest</option><option value="moderator">Community moderator</option><option value="owner">Site administrator</option></select></label><button>Use this test identity</button></form><p>To test two people at once, use another browser profile or a private window. Close the prior chat before changing its identity.</p><h2>Invite a guest tester</h2><p>This invitation allows guest participation only. Share it privately with your testers.</p><input id="invite" aria-label="Guest invitation link" readonly><button id="copy">Copy guest invitation</button></section><h2>Try these flows</h2><ol><li>Join as a guest and host a named chat channel.</li><li>Use a room-owner pilot identity, create a room and choose “Keep this room” in host tools.</li><li>Return using the same pilot name to recover its rooms. Try a second owner name for co-host handoff.</li><li>Draw or watch together with another browser. Report a message, then review it as a moderator.</li></ol><p>AI review is off. Paint/video snapshots are bounded and clear after ten empty minutes; registered room names remain for 90 inactive days.</p><form id="logout"><button>Leave private pilot</button></form></section></main></body></html>`;
const STYLE = `:root{color-scheme:dark;font:16px/1.5 ui-monospace,monospace;background:#111722;color:#d9f2ef}body{margin:0}main{max-width:760px;margin:auto;padding:28px 20px}h1{font-size:44px;color:#71ffe3}h2{font-size:21px;margin-top:30px}.eyebrow{color:#a0b5c4}label{display:block;margin:14px 0}input,select,button,.button{font:inherit;padding:12px;border:1px solid #688089;border-radius:5px;background:#192834;color:inherit;box-sizing:border-box}input,select{display:block;width:100%;margin-top:5px}button,.button{display:inline-block;cursor:pointer;margin:4px 0;color:#7cffe0}a{color:#7cffe0}#status{color:#ffe4a2}[hidden]{display:none!important}li{margin:10px 0}`;
const CLIENT = `(() => {const $=s=>document.querySelector(s);const showError=e=>{$('#status').textContent=e.message||String(e);$('#login').hidden=false};async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error((await r.json()).error||'Request failed');return r.json()}async function draw(){const r=await fetch('/pilot/state');if(!r.ok){$('#status').textContent='Private invitation required.';$('#login').hidden=false;return}const s=await r.json();$('#login').hidden=true;$('#inside').hidden=false;$('#status').textContent='Private pilot is ready.';$('#identity').textContent=s.label+' · '+s.role+' · '+(s.operator?'operator access':'guest access');$('#roles').hidden=!s.operator;$('#moderation').hidden=!['owner','moderator'].includes(s.role);if(s.operator)$('#invite').value=s.guestInvite;}$('#unlock').onsubmit=async e=>{e.preventDefault();try{await post('/pilot/unlock',{key:$('#key').value});$('#key').value='';await draw()}catch(e){showError(e)}};$('#choose').onsubmit=async e=>{e.preventDefault();try{await post('/pilot/identity',{role:$('#role').value,label:$('#label').value});await draw()}catch(e){showError(e)}};$('#logout').onsubmit=async e=>{e.preventDefault();await post('/pilot/logout',{});location.reload()};$('#copy').onclick=()=>navigator.clipboard.writeText($('#invite').value).then(()=>{$('#status').textContent='Guest invitation copied.'});const fragment=new URLSearchParams(location.hash.slice(1));const key=fragment.get('operator')||fragment.get('invite');history.replaceState(null,'',location.pathname);if(key)post('/pilot/unlock',{key}).then(draw).catch(showError);else draw().catch(showError)})();`;

async function readBody(request) {
    const reader = request.body?.getReader(); if (!reader) return null;
    const chunks = []; let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 2048) { await reader.cancel(); return null; }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        const data = JSON.parse(new TextDecoder().decode(bytes));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch { return null; }
}
async function disconnectPilot(env, session) {
    const request = new Request('https://pilot-internal/__pilot/disconnect', { method: 'POST', headers: { 'X-Hangout-Identity': JSON.stringify({ pilotSid: session.access.sid }) } });
    const response = await env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(request);
    if (!response.ok) throw new Error('Could not end previous pilot connections');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/robots.txt') return reply('User-agent: *\nDisallow: /\n');
        if (!configured(env)) return reply('Private pilot is not configured.', 503);
        if (url.pathname === '/pilot/client.js') return reply(CLIENT, 200, 'text/javascript');
        if (url.pathname === '/pilot/style.css') return reply(STYLE, 200, 'text/css');
        if (['/', '/pilot', '/pilot/'].includes(url.pathname)) return reply(SHELL, 200, 'text/html; charset=utf-8');
        if (request.method === 'POST' && url.pathname.startsWith('/pilot/')) {
            if (!sameOrigin(request) || !request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Same-origin request required.' }, 403);
            if (Number(request.headers.get('Content-Length') || 0) > 2048) return json({ error: 'Request too large.' }, 413);
            const data = await readBody(request); if (!data) return json({ error: 'Invalid or oversized request.' }, 400);
            if (url.pathname === '/pilot/unlock') {
                const scope = equalSecret(data.key, env.PILOT_OPERATOR_KEY) ? 'operator' : equalSecret(data.key, env.HANGOUT_PREVIEW_KEY) ? 'guest' : '';
                if (!scope) return json({ error: 'Invitation was not accepted.' }, 403);
                const claims = { v: 1, sid: crypto.randomUUID(), exp: Date.now() + PILOT_TTL, scope };
                return json({ ok: true }, 200, { 'Set-Cookie': pilotCookie('__Host-pilot', await signPilot('access', claims, env.HANGOUT_HMAC_KEY)) });
            }
            const session = await pilotSession(request, env);
            if (!session) return json({ error: 'Private invitation required.' }, 401);
            if (url.pathname === '/pilot/logout') { await disconnectPilot(env, session); return json({ ok: true }, 200, { 'Set-Cookie': '__Host-pilot=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
            if (url.pathname === '/pilot/identity') {
                if (session.access.scope !== 'operator') return json({ error: 'Only the pilot operator can choose test identities.' }, 403);
                if (!['fan', 'room-owner', 'moderator', 'owner'].includes(data.role) || !/^[A-Za-z][A-Za-z0-9_-]{2,19}$/.test(data.label)) return json({ error: 'Choose a pilot name (3–20 letters, numbers, underscore or dash) and role.' }, 400);
                await disconnectPilot(env, session);
                const identity = { v: 1, sid: session.access.sid, exp: session.access.exp, label: data.label, role: data.role };
                return json({ ok: true }, 200, { 'Set-Cookie': pilotCookie('__Host-pilot-identity', await signPilot('identity', identity, env.HANGOUT_HMAC_KEY)) });
            }
            return json({ error: 'Unknown request.' }, 404);
        }
        const session = await pilotSession(request, env);
        if (!session) return reply('Private invitation required. Open your invitation link.', 401);
        const { identity, access } = session;
        if (url.pathname === '/pilot/state') return json({ role: identity.role, label: identity.label, operator: access.scope === 'operator', ...(access.scope === 'operator' ? { guestInvite: `${url.origin}/pilot/#invite=${env.HANGOUT_PREVIEW_KEY}` } : {}) });
        if (url.pathname === '/pilot/bootstrap.js') return reply(`sessionStorage.setItem('hangout-preview',${JSON.stringify(env.HANGOUT_PREVIEW_KEY)});sessionStorage.setItem('hangout-owner',${JSON.stringify(identity.role === 'room-owner' ? '1' : '0')});`, 200, 'text/javascript');
        if (url.pathname === '/lobby-owner/login' || url.pathname === '/lobby-admin/login') return redirect('/pilot/');
        if (['/lobby', '/lobby-owner', '/lobby-admin'].includes(url.pathname)) {
            if (request.headers.get('Upgrade') !== 'websocket') return reply('WebSocket required.', 426);
            if (!sameOrigin(request) || !previewKeyOk(url.searchParams.get('preview'), env.HANGOUT_PREVIEW_KEY)) return reply('Admission denied.', 403);
            const staff = ['owner', 'moderator'].includes(identity.role);
            if (url.pathname === '/lobby-admin' && !staff) return reply('Staff identity required.', 403);
            if (url.pathname === '/lobby-owner' && identity.role !== 'room-owner') return reply('Room-owner pilot identity required.', 403);
            let dev = await verifyDevice(url.searchParams.get('dev'), env.HANGOUT_HMAC_KEY);
            const fresh = !dev; if (!dev) dev = newDeviceId();
            const email = staff ? stateEmail(identity.role) : '';
            const account = identity.role === 'room-owner' ? await accountId(`${identity.label.toLowerCase()}@pilot.invalid`, env.HANGOUT_HMAC_KEY) : '';
            const who = { pilotSid: access.sid, role: staff ? identity.role : 'fan', email, admin: staff && url.pathname === '/lobby-admin', account, expiresAt: access.exp, dev, iph: await ipHash(request.headers.get('CF-Connecting-IP') || '0.0.0.0', env.HANGOUT_HMAC_KEY), devToken: fresh ? await signDevice(dev, env.HANGOUT_HMAC_KEY) : null };
            const quota = await env.QUOTA.get(env.QUOTA.idFromName('global')).fetch('https://quota/take', { method: 'POST' });
            if (quota.status !== 200) return reply('Pilot connection allowance reached.', 429);
            const nextHeaders = new Headers(request.headers); nextHeaders.set('X-Hangout-Identity', JSON.stringify(who));
            return env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(new Request(request, { headers: nextHeaders }));
        }
        if (url.pathname === '/room' || url.pathname === '/turn') return worker.fetch(request, { ...env, HANGOUT_EXTRA_ORIGINS: url.origin });
        if (!['GET', 'HEAD'].includes(request.method)) return reply('Method not allowed.', 405);
        const asset = await env.ASSETS.fetch(request);
        if (!asset.headers.get('Content-Type')?.includes('text/html')) {
            const response = new Response(asset.body, asset); for (const [k, v] of Object.entries(headers)) response.headers.set(k, v); return response;
        }
        const page = await asset.text();
        const changed = page.replace(/(<meta name="hangout-relay" content=")[^"]*(")/g, `$1${url.origin.replace(/^http/, 'ws')}$2`)
            .replace(/(<meta name="hangout-turn(?:stile)?" content=")[^"]*(")/g, '$1$2')
            .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
            .replace(/<script[^>]*goatcounter[^>]*><\/script>/gi, '')
            .replace('<head>', '<head><script src="/pilot/bootstrap.js"></script>')
            .replace('<body', '<body');
        return reply(changed.replace(/(<body[^>]*>)/, '$1<div style="padding:8px;background:#273b37;color:#d7ffe5;font:14px monospace">Private Stalemate pilot · <a style="color:inherit" href="/pilot/">Test roles &amp; guest invitation</a> · Pilot identities; email sign-in and AI are not active.</div>'), asset.status, 'text/html; charset=utf-8');
    }
};
