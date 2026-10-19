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
const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hang Out · Stalemate private pilot</title><link rel="stylesheet" href="/pilot/style.css"><script defer src="/pilot/client.js"></script></head>
<body><div class="portal-window"><header class="windowbar"><a class="brand" href="/pilot/"><span aria-hidden="true">✳</span> STALEMATE</a><span class="window-path">community / hang-out</span><span class="private-tag"><i aria-hidden="true"></i> INVITE ONLY</span></header><main>
<header class="hero"><div><p class="eyebrow">AN OPEN CHANNEL. A GOOD PLACE TO LAND.</p><h1>Hang Out<span class="cursor" aria-hidden="true">_</span></h1><p class="lede">Find your people. Make a little noise.<br>Stay for whatever happens next.</p><p class="hero-note">An IRC clubhouse for conversations that become something more.</p></div><div class="channel-mark" aria-hidden="true"><span>CONNECTED THROUGH</span><b>#</b><span>CHANNELS FOR THE CURIOUS</span></div></header>
<div class="channel-strip" aria-label="Things to do"><span><b>#</b> chat</span><span><b>↗</b> create</span><span><b>▷</b> watch</span><span><b>♪</b> jam</span><span class="strip-note">Come as you are.</span></div>
<p id="status" class="status" role="status">Checking your private invitation…</p>
<section id="login" class="access-card" hidden><div><p class="eyebrow">YOUR INVITATION</p><h2>A seat is waiting.</h2><p>Open your private invitation link, or paste its access code below.</p></div><form id="unlock"><label>Access code<input id="key" type="password" autocomplete="off" placeholder="Your private access code" required></label><button class="primary">Open private pilot <span aria-hidden="true">↗</span></button></form></section>
<section id="inside" hidden><section class="arrival" aria-label="Enter the community"><div><p class="eyebrow">YOU’RE ON THE GUEST LIST</p><h2>Pull up a chair.</h2><p>Chat starts when you join. Your camera stays off until you choose otherwise.</p><p id="identity" class="identity"></p></div><div class="arrival-actions"><a class="button primary" href="${ROOT}lobby/">Enter the lobby <span aria-hidden="true">↗</span></a><a class="button secondary" id="moderation" hidden href="${ROOT}admin/">Moderation panel</a><span class="entry-note">Guest chat. Shared rooms.</span></div></section>
<div class="workspace"><section id="roles" hidden><div class="section-heading"><span class="section-number">01</span><div><p class="eyebrow">BEHIND THE SCENES</p><h2>Your test controls</h2></div></div><p class="muted">Try a guest, room owner, or moderator. These pilot identities are stand-ins; email sign-in and delivery are not active.</p><form id="choose"><div class="form-pair"><label>Pilot name<input id="label" value="JeffTest" pattern="[A-Za-z][A-Za-z0-9_-]{2,19}" maxlength="20" required></label><label>Role<select id="role"><option value="room-owner">Room owner account</option><option value="fan">Guest</option><option value="moderator">Community moderator</option><option value="owner">Site administrator</option></select></label></div><button class="secondary">Use this test identity <span aria-hidden="true">→</span></button></form><p class="fine-print">Use another browser profile or private window for a second person. Close the prior chat before changing its identity.</p><div class="invite-tools"><h3>Better with company.</h3><p class="muted">Invite a tester with guest access. Share this link privately.</p><label class="sr-only" for="invite">Guest invitation link</label><input id="invite" aria-label="Guest invitation link" readonly><button class="secondary" id="copy">Copy guest invitation <span aria-hidden="true">↗</span></button></div></section>
<section class="field-guide" aria-labelledby="field-guide-heading"><div class="section-heading"><span class="section-number">02</span><div><p class="eyebrow">A LITTLE FIELD GUIDE</p><h2 id="field-guide-heading">Follow your curiosity.</h2></div></div><ol><li><b>Start with a hello.</b><span>Join as a guest, find a conversation, or host your own named channel.</span></li><li><b>Make it your place.</b><span>Choose a room-owner identity and use “Keep this room” in host tools. Return with the same pilot name to recover it.</span></li><li><b>Make something together.</b><span>Draw on a shared canvas, watch a video, or connect a WebJam session. Try a second browser to see it happen live.</span></li><li><b>Look out for each other.</b><span>Report a message, then switch to a moderator identity to review the report.</span></li></ol></section></div>
<footer class="pilot-footer"><div><span class="pilot-indicator">PRIVATE PILOT</span><p>AI review is off. Paint and video snapshots clear after ten empty minutes. Registered room names remain for 90 inactive days.</p></div><form id="logout"><button class="text-button">Leave private pilot <span aria-hidden="true">↗</span></button></form></footer></section>
</main><div class="window-footer"><span>STALEMATE / BUILT TOGETHER</span><span>CONVERSATION COMES FIRST.</span></div></div></body></html>`;
const STYLE = `
:root{color-scheme:dark;--bg:#0d1011;--panel:#141819;--raised:#1a2020;--ink:#eeeeda;--muted:#a1aaa2;--lime:#d1fa78;--pink:#eea9be;--amber:#e5c181;--rule:#343d36;--mono:ui-monospace,"SFMono-Regular",Consolas,monospace;font:16px/1.55 "Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink)}
*{box-sizing:border-box}body{margin:0;padding:40px 28px}button,input,select{font:inherit}a{color:var(--lime)}a,button,input,select{touch-action:manipulation}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--lime);outline-offset:4px}[hidden]{display:none!important}
.portal-window{max-width:1120px;margin:auto;border:1px solid var(--rule);background:var(--panel);box-shadow:12px 12px 0 #060909}.windowbar{display:flex;align-items:center;gap:28px;min-height:60px;padding:16px 32px;border-bottom:1px solid var(--rule);font:11px/1.4 var(--mono);letter-spacing:.07em}.brand{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:800;color:var(--ink);text-decoration:none}.brand>span{font-size:28px;color:var(--lime);line-height:1}.window-path{color:var(--muted);margin-right:auto}.private-tag{display:flex;align-items:center;gap:7px;color:var(--lime);white-space:nowrap}.private-tag i{width:6px;height:6px;border-radius:50%;background:currentColor}
main{padding:44px 48px 0}.hero{display:flex;justify-content:space-between;align-items:center;gap:28px;padding:0 0 32px}.eyebrow{font:10px/1.6 var(--mono);letter-spacing:.12em;color:var(--muted);margin:0 0 12px}.hero h1{font-size:clamp(3.5rem,7.5vw,6.2rem);line-height:.98;letter-spacing:-.065em;font-weight:800;margin:0 0 24px}.cursor{color:var(--lime);font-weight:500}.lede{font-size:clamp(1.2rem,2.3vw,1.55rem);line-height:1.4;letter-spacing:-.025em;margin:0 0 16px}.hero-note{color:var(--muted);font-size:.9rem;max-width:340px;margin:0}.channel-mark{display:flex;flex:0 0 215px;align-items:center;flex-direction:column;justify-content:space-between;min-height:230px;padding:18px 14px;border:1px solid var(--rule);transform:rotate(3deg);background:var(--bg)}.channel-mark b{font:900 132px/1.1 var(--mono);color:var(--lime);letter-spacing:-.1em;transform:rotate(-7deg)}.channel-mark>span{font:8px/1.4 var(--mono);letter-spacing:.1em;color:var(--muted)}.channel-mark>span:last-child{color:var(--lime)}
.channel-strip{display:flex;align-items:center;gap:32px;min-height:50px;border-block:1px solid var(--rule);font:12px/1.4 var(--mono);color:var(--muted)}.channel-strip>span{white-space:nowrap}.channel-strip b{color:var(--pink);margin-right:6px;font-size:16px;font-weight:400}.strip-note{margin-left:auto;font-size:10px}.status{color:var(--amber);font:11px/1.6 var(--mono);margin:0;padding:17px 0;min-height:51px}.status:before{content:"> ";color:var(--lime)}
h2{font-size:1.65rem;line-height:1.2;letter-spacing:-.035em;margin:0}h3{font-size:1.1rem;letter-spacing:-.02em;margin:0}p{margin:12px 0}.muted{font-size:.875rem;color:var(--muted)}
.access-card,.arrival{padding:30px;background:var(--raised);border:1px solid var(--rule);display:flex;align-items:center;justify-content:space-between;gap:32px}.access-card{margin-bottom:40px}.access-card>div,.arrival>div:first-child{max-width:460px}.access-card p:not(.eyebrow),.arrival p:not(.eyebrow):not(.identity){color:var(--muted);font-size:.9rem;max-width:370px}.access-card form{min-width:300px}.arrival-actions{display:flex;flex-direction:column;align-items:stretch;gap:10px;min-width:225px}.entry-note{font:9px/1.4 var(--mono);color:var(--muted);text-align:center}.identity{font:10px/1.5 var(--mono);color:var(--lime);overflow-wrap:anywhere;margin:16px 0 0}
.button,button{display:inline-flex;justify-content:center;align-items:center;gap:20px;min-height:46px;border:1px solid var(--rule);padding:12px 17px;background:var(--bg);color:var(--ink);font:600 12px/1.4 var(--mono);text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s}.button>span,button>span{margin-left:auto}.primary{background:var(--lime);border-color:var(--lime);color:#152014;font-weight:800}.primary:hover{background:#e0ff9d;border-color:#e0ff9d}.secondary:hover{border-color:var(--muted);background:#252c28}.access-card button{width:100%;margin-top:12px}
label{display:block;color:var(--muted);font:11px/1.5 var(--mono)}input,select{display:block;width:100%;min-width:0;min-height:46px;margin-top:8px;border:1px solid var(--rule);border-radius:0;background:var(--bg);color:var(--ink);padding:10px 12px;font:12px/1.5 var(--mono)}input::placeholder{color:#7d887e}select{padding-right:26px}
.workspace{display:grid;grid-template-columns:1.05fr 1fr;gap:48px;padding:44px 0}.workspace:has(#roles[hidden]){grid-template-columns:1fr}.section-heading{display:flex;align-items:start;gap:14px;margin-bottom:18px}.section-number{display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;border:1px solid var(--rule);color:var(--pink);font:11px var(--mono);margin-top:2px}.section-heading .eyebrow{margin-bottom:5px;font-size:9px}.section-heading h2{font-size:1.3rem}.form-pair{display:grid;grid-template-columns:.85fr 1.15fr;gap:12px;margin:22px 0 12px}#choose>button{width:100%;text-align:left}.fine-print{color:var(--muted);font-size:.75rem;line-height:1.65;margin:14px 0 0}.invite-tools{margin-top:28px;padding-top:24px;border-top:1px solid var(--rule)}.invite-tools p{margin:8px 0 14px}.invite-tools input{font-size:10px;color:var(--muted)}.invite-tools button{margin-top:10px;width:100%}
.field-guide ol{margin:0;padding:0;list-style:none;counter-reset:guide}.field-guide li{position:relative;counter-increment:guide;padding:0 0 20px 30px;margin:0 0 20px;border-bottom:1px solid var(--rule)}.field-guide li:last-child{margin-bottom:0;padding-bottom:0;border:0}.field-guide li:before{content:"0" counter(guide);position:absolute;left:0;top:3px;color:var(--muted);font:10px var(--mono)}.field-guide li b{display:block;font-size:.9rem;font-weight:600;margin-bottom:5px}.field-guide li span{display:block;font-size:.82rem;line-height:1.65;color:var(--muted)}
.pilot-footer{border-top:1px solid var(--rule);display:flex;align-items:center;justify-content:space-between;gap:28px;padding:24px 0}.pilot-footer>div{max-width:590px}.pilot-indicator{font:9px/1.4 var(--mono);letter-spacing:.1em;color:var(--amber)}.pilot-footer p{font-size:.72rem;color:var(--muted);line-height:1.7;margin:6px 0 0}.text-button{white-space:nowrap;padding:8px 0;background:none;border:0;font-size:10px;color:var(--muted)}.text-button:hover{color:var(--ink)}.window-footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid var(--rule);padding:12px 32px;color:var(--muted);font:8px/1.5 var(--mono);letter-spacing:.1em}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
@media(max-width:800px){body{padding:20px}.windowbar{padding:16px 24px;gap:16px}main{padding:32px 28px 0}.hero{gap:20px}.channel-mark{flex-basis:160px;min-height:195px}.channel-mark b{font-size:110px}.channel-mark>span{font-size:6px}.window-path{font-size:9px}.access-card,.arrival{padding:24px;gap:20px}.access-card form{min-width:240px}.workspace{gap:30px}.form-pair{grid-template-columns:1fr}.arrival-actions{min-width:195px}.channel-strip{gap:22px}.strip-note{display:none}.window-footer{padding-inline:24px}}
@media(max-width:600px){body{padding:0}.portal-window{border-inline:0;box-shadow:none}.windowbar{min-height:54px;padding:13px 20px;gap:10px}.brand{font-size:12px}.brand>span{font-size:24px}.window-path{display:none}.private-tag{margin-left:auto;font-size:9px}main{padding:32px 20px 0}.hero{padding-bottom:26px;align-items:flex-start}.hero .eyebrow{font-size:8px;max-width:220px}.hero h1{font-size:3.8rem;margin-bottom:20px}.lede{font-size:1.15rem}.hero-note{font-size:.8rem;max-width:280px}.channel-mark{display:none}.channel-strip{gap:23px;min-height:46px;font-size:10px}.channel-strip b{font-size:13px;margin-right:3px}.status{font-size:10px;min-height:48px;padding-block:15px}.access-card,.arrival{display:block;padding:22px 20px}.arrival h2,.access-card h2{font-size:1.6rem}.arrival-actions{margin-top:24px;gap:10px}.arrival-actions>.primary{min-height:50px}.access-card form{margin-top:22px;min-width:0}.workspace{grid-template-columns:1fr;gap:32px;padding-block:32px}.form-pair{grid-template-columns:1fr}.field-guide{border-top:1px solid var(--rule);padding-top:28px}.workspace:has(#roles[hidden]) .field-guide{border:0;padding:0}.section-heading h2{font-size:1.25rem}.pilot-footer{display:block;padding-block:22px}.pilot-footer>form{margin-top:14px}.text-button{min-height:40px}.window-footer{padding:12px 20px;font-size:7px}.window-footer>span:last-child{display:none}input,select{font-size:16px}#invite{font-size:10px}}
`;
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
        const banner = '<style>.pilot-strip{box-sizing:border-box;display:flex;flex:0 0 auto;align-items:center;gap:20px;min-height:34px;padding:7px 18px;border-bottom:1px solid #343d36;background:#141819;color:#a1aaa2;font:10px/1.4 ui-monospace,Consolas,monospace}.pilot-strip-label{color:#d1fa78;font-weight:600;white-space:nowrap}.pilot-strip-label:before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:currentColor;margin-right:7px;vertical-align:middle}.pilot-strip-note{margin-left:auto}.pilot-strip a{color:#eeeeda;text-decoration:none;white-space:nowrap}.pilot-strip a:hover{color:#d1fa78}.pilot-strip a:focus-visible{outline:2px solid #d1fa78;outline-offset:4px}@media(max-width:680px){.pilot-strip{min-height:38px;justify-content:space-between;gap:10px;padding:9px 12px;font-size:9px}.pilot-strip-note{display:none}}</style><div class="pilot-strip" aria-label="Private pilot controls"><span class="pilot-strip-label">Private Stalemate pilot</span><span class="pilot-strip-note">Test identities · Email and AI off</span><a href="/pilot/" aria-label="Test roles and guest invitation">Test controls ↗</a></div>';
        return reply(changed.replace(/(<body[^>]*>)/, '$1' + banner), asset.status, 'text/html; charset=utf-8');
    }
};
