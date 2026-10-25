import { mountIncidentReview } from './controller.mjs';
const root = document.querySelector('main'), csrf = document.querySelector('meta[name=local-csrf]').content;
let current, attempt = 0, opening = false;
document.querySelector('#profiles').addEventListener('submit', async event => {
    event.preventDefault(); if (opening) return; opening = true;
    const submit = event.currentTarget.querySelector('button[type=submit]'); submit.disabled = true;
    const ownAttempt = ++attempt; current?.disconnect(); current = null;
    const post = async (path, body, session, extra = {}) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-local-csrf': csrf, ...(session ? { 'x-local-session': session } : {}) }, body: JSON.stringify(body), ...extra });
    try {
        const response = await post('/session', { profile: document.querySelector('#profile').value }), opened = await response.json();
        if (!opened.ok) throw Error('Unavailable');
        const session = opened.session;
        if (ownAttempt !== attempt) { await post('/logout', {}, session); return; }
        current = mountIncidentReview({ root, adapter: {
            call: async (method, args = {}) => { const response = await post('/call', { method, args }, session); return response.json(); },
            disconnect: () => post('/logout', {}, session),
            subscribe(listener) {
                const abort = new AbortController();
                (async () => {
                    const response = await post('/events', {}, session, { signal: abort.signal });
                    if (!response.ok) throw Error('Disconnected');
                    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
                    while (true) {
                        const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true });
                        let boundary; while ((boundary = pending.indexOf('\n\n')) >= 0) {
                            const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
                            if (block.startsWith('data: ')) listener(JSON.parse(block.slice(6)));
                        }
                        if (pending.length > 1024) throw Error('Invalid local update');
                    }
                    if (!abort.signal.aborted) listener({ type: 'disconnect' });
                })().catch(() => { if (!abort.signal.aborted) listener({ type: 'disconnect' }); });
                return () => abort.abort();
            }
        } });
        await current.ready; document.querySelector('#launcher-status').textContent = 'Local session opened. Identity and policy are synthetic.';
    } catch { if (ownAttempt === attempt) document.querySelector('#launcher-status').textContent = 'Could not open this local fixture. Restart the loopback launcher.'; }
    finally { opening = false; submit.disabled = false; }
});
addEventListener('pagehide', () => { attempt++; current?.disconnect(); });
