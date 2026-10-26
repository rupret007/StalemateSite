// Exact read-only public documents. No session, role, registry or provider work.
const TERMS = '/r/45662413410ed051/terms/';
const PATHS = new Set(['/beta/privacy', '/beta/help.css', TERMS.slice(0, -1), TERMS, `${TERMS}index.html`]);
const CSP = "default-src 'none'; script-src 'none'; style-src 'self'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const STYLE = `:root{color-scheme:dark;--display:system-ui,sans-serif;--pink:#eea9be;--cream:#eeeeda;--muted:#b5beb6;--blue:#91cbd5;background:#0d1011;color:var(--cream);font:16px/1.6 system-ui,sans-serif}*{box-sizing:border-box}html,body{max-width:100%;margin:0}body{overflow-wrap:anywhere}.titlebar{display:flex;gap:12px;justify-content:space-between;padding:16px;border-bottom:1px solid #46513e}.terms{max-width:46rem;margin:0 auto;padding:24px 20px 60px}.terms h1{font-size:clamp(2rem,8vw,2.6rem);line-height:1.2}.terms h2{font-size:1.35rem;margin-top:28px;color:var(--blue)}.terms h3{font-size:1.1rem}.terms p,.terms li{color:var(--muted)}.terms li{margin:8px 0}.terms ul{padding-left:24px}.terms b,.terms strong{color:var(--cream)}.big-rule{font-size:1.8rem;font-weight:800;color:var(--pink)!important}.small{font-size:.875rem}a{color:var(--blue);text-underline-offset:3px}a:focus-visible{outline:3px solid #d1fa78;outline-offset:3px}.btn{display:inline-flex;align-items:center;min-height:44px;padding:10px 14px;border:1px solid #d1fa78;color:#d1fa78}@media(max-width:480px){.terms{padding:20px 16px 48px}.titlebar{font-size:14px}.dots{flex:none}}`;
function response(request, body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
    return new Response(request.method === 'HEAD' ? null : body, { status, headers: {
        'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP,
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', ...extra
    } });
}
function contactHtml(env) {
    const contact = String(env.HANGOUT_MODERATION_CONTACT || '').trim();
    return contact.length <= 254 && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(contact)
        ? `<a data-contact href="mailto:${encodeURIComponent(contact).replace(/%40/g, '@')}">${contact}</a>`
        : '<b data-contact>Moderation contact is not configured. Please return later for contact details.</b>';
}
export async function publicBetaHelp(request, env) {
    const url = new URL(request.url);
    if (!PATHS.has(url.pathname)) return null;
    if (!['GET', 'HEAD'].includes(request.method)) return response(request, 'Method not allowed.', 405, 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    if (url.pathname === '/beta/privacy' || url.pathname === TERMS.slice(0, -1)) return response(request, null, 303, 'text/plain; charset=utf-8', { Location: TERMS });
    if (url.pathname === '/beta/help.css') return response(request, STYLE, 200, 'text/css; charset=utf-8');
    const contact = contactHtml(env);
    try {
        // Fixed GET only: never forward visitor cookies, proofs or query strings.
        const asset = await env.ASSETS?.fetch(new Request(`${url.origin}${TERMS}index.html`));
        if (!asset?.ok || !asset.headers.get('Content-Type')?.includes('text/html')) throw Error('Policy asset unavailable');
        const page = (await asset.text())
            .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
            .replace(/<link\b[^>]*>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace('</head>', '<link rel="stylesheet" href="/beta/help.css"></head>')
            .replace(/<b data-contact>[\s\S]*?<\/b>/, contact)
            .replace('<a class="btn" href="../lobby/">Back to #stalemate</a>', '<a class="btn" href="/">Back to Hang Out</a>');
        return response(request, page);
    } catch {
        return response(request, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hang Out · Help unavailable</title><link rel="stylesheet" href="/beta/help.css"></head><body><main class="terms"><h1>House rules are temporarily unavailable</h1><p>Please try again later. The community may still require a private invitation.</p><p>For moderation, appeals or privacy requests: ${contact}</p><p>Do not send invitation links, room keys, passwords or login codes.</p><p><a class="btn" href="/">Back to Hang Out</a></p></main></body></html>`, 503);
    }
}
