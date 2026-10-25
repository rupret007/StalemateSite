// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createIncidentReviewFixture } from '../../scripts/incident-review-fixture.mjs';
import { mountIncidentReview } from '../../scripts/incident-review-ui/controller.mjs';

const DAY = 86400000, CASES = 'restricted-incident-cases-v1';
const resources = [];
afterEach(async () => { for (const item of resources.splice(0)) await item(); });
async function fixture(options = {}) {
    let time = 1800000000000, timerId = 0, scheduledRuns = 0; const timers = new Map();
    const model = await createIncidentReviewFixture({ now: () => time, schedule: (fn, delay) => { timers.set(++timerId, { fn, at: time + delay }); return timerId; }, cancel: id => timers.delete(id), ...options });
    resources.push(() => model.stop());
    const advance = async target => { time = target; for (const [id, task] of [...timers]) if (task.at <= time) { timers.delete(id); scheduledRuns++; await task.fn(); } };
    async function view(profile = 'handler', wrap = value => value) {
        const token = await model.open(profile), dom = new JSDOM('<main></main>', { url: 'http://127.0.0.1:4397/' }); resources.push(() => dom.window.close());
        const adapter = wrap({ call: (method, args) => model.call(token, method, args), subscribe: fn => model.subscribe(token, fn), disconnect: () => model.disconnect(token) });
        const root = dom.window.document.querySelector('main'), controller = mountIncidentReview({ root, adapter }); await controller.ready;
        return { token, dom, root, controller, adapter };
    }
    return { model, view, advance, now: () => time, base: time, runs: () => scheduledRuns };
}
const button = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
const state = model => model.storage.snapshot().get(CASES);
async function reportAndPreserve(view, index = 0) {
    [...view.root.querySelectorAll('button')].filter(node => node.textContent === 'Flag benign sample')[index].click();
    await vi.waitFor(() => expect(view.root.querySelector('[data-source]')).not.toBeNull());
    const radios = [...view.root.querySelectorAll('[data-source]')]; radios.at(-1).click(); view.root.querySelector('[data-confirm-selection]').click();
    button(view.root, 'Preserve selected report').click();
    await vi.waitFor(() => expect(view.root.querySelector('[data-open-case]')).not.toBeNull());
}

describe('restricted local incident review interface with the actual report engine', () => {
    it('flags a real delivered report, preserves only selected bytes, survives source expiry/restart, then releases and deletes on scheduled deadlines', async () => {
        const f = await fixture(), view = await f.view();
        await reportAndPreserve(view);
        expect(f.model.generalStaffState().reports).toHaveLength(1);
        expect(state(f.model).cases).toHaveLength(1);
        const caseRef = state(f.model).cases[0].id;
        expect(JSON.stringify(f.model.generalStaffState())).not.toContain(caseRef);
        button(view.root, 'Open selected evidence').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-evidence]').textContent).toContain('shared drawing worked'));
        expect(view.root.querySelector('[data-evidence]').textContent).not.toContain('green pencil');
        expect(JSON.stringify(state(f.model))).not.toContain('shared drawing worked');
        button(view.root, 'Mark triaged').click();
        await vi.waitFor(() => expect(button(view.root, 'Close review')).toBeDefined()); button(view.root, 'Close review').click();
        await vi.waitFor(() => expect(view.root.textContent).toContain('Review: closed. Preservation: active'));
        button(view.root, 'Run due cleanup').click(); await vi.waitFor(() => expect(view.root.querySelector('[data-status]').textContent).toContain('active hold'));
        await f.advance(f.base + DAY);
        await vi.waitFor(() => expect(view.root.querySelectorAll('[data-source]')).toHaveLength(0));
        expect(f.model.generalStaffState().reports).toEqual([]); expect(state(f.model).cases[0].evidence.state).toBe('present');
        await f.model.restart(); expect(view.root.textContent).toContain('Disconnected');
        const reopened = await f.view(); reopened.root.querySelector('[data-open-case]').click();
        await vi.waitFor(() => expect(button(reopened.root, 'Open selected evidence')).toBeDefined()); button(reopened.root, 'Open selected evidence').click();
        await vi.waitFor(() => expect(reopened.root.querySelector('[data-evidence]').textContent).toContain('shared drawing worked'));
        button(reopened.root, 'Release under approved local decision').click();
        await vi.waitFor(() => expect(reopened.root.textContent).toContain('Preservation: released'));
        await f.advance(f.base + DAY + 3000);
        await vi.waitFor(() => expect(reopened.root.textContent).toContain('Evidence: deleted'));
        expect(state(f.model).cases[0]).toMatchObject({ cipher: null, source: null, evidence: { state: 'deleted' } });
        await f.advance(f.base + DAY + 4000); await vi.waitFor(() => expect(reopened.root.querySelectorAll('[data-open-case]')).toHaveLength(0));
        expect(state(f.model).cases).toEqual([]); expect(state(f.model).tombstones[0].caseRef).toBe(caseRef); expect(f.runs()).toBeGreaterThanOrEqual(3);
    });

    it('denies ordinary staff, forged principal fields, stale appointments and appointed handlers outside the case ACL', async () => {
        const f = await fixture(), handler = await f.view(); await reportAndPreserve(handler);
        const record = state(f.model).cases[0], request = { operationId: 'read_denied', caseRef: record.id, expectedRevision: record.revision };
        for (const profile of ['guest', 'moderator']) {
            const own = await f.view(profile); expect(own.root.textContent).toContain('no incident appointment');
            expect(await f.model.call(own.token, 'overview')).toEqual({ ok: false, error: 'forbidden' });
            expect(await f.model.call(own.token, 'evidence', request)).toEqual({ ok: false, error: 'forbidden' });
            expect(await f.model.call(own.token, 'evidence', { ...request, principal: handler.token })).toEqual({ ok: false, error: 'invalid-request' });
        }
        const other = await f.view('unassigned'); expect(other.root.querySelectorAll('[data-open-case]')).toHaveLength(0);
        expect(await f.model.call(other.token, 'evidence', request)).toEqual({ ok: false, error: 'forbidden' });
        await f.model.storage.transaction(async tx => { const appointment = await tx.get('appointment:local_handler'); appointment.revision++; await tx.put('appointment:local_handler', appointment); });
        expect(await f.model.call(handler.token, 'evidence', request)).toEqual({ ok: false, error: 'forbidden' });
        await handler.controller.refresh(); expect(handler.root.textContent).toContain('Disconnected');
    });

    it('clears evidence/focus on revocation and ignores late responses and retained detached controls', async () => {
        const f = await fixture(); let release, entered; const waiting = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
        const calls = vi.fn();
        const view = await f.view('handler', adapter => ({ ...adapter, call: async (method, args) => {
            calls(method); const result = await adapter.call(method, args); if (method === 'evidence') { entered(); await held; } return result;
        } }));
        await reportAndPreserve(view); const detached = button(view.root, 'Open selected evidence'), oldPre = view.root.querySelector('[data-evidence]');
        detached.click(); await waiting; await f.model.revoke();
        expect(oldPre.textContent).toBe(''); expect(view.root.textContent).toContain('Disconnected'); expect(view.dom.window.document.activeElement).toBe(view.root.querySelector('[data-status]'));
        const count = calls.mock.calls.length; detached.click(); expect(calls.mock.calls).toHaveLength(count);
        release(); await new Promise(resolve => setTimeout(resolve, 0));
        expect(view.root.textContent).not.toContain('shared drawing worked'); expect(view.root.querySelector('[data-evidence]')).toBeNull();
    });

    it('requires deliberate selection and reports capacity/store failures without a false preservation confirmation', async () => {
        const f = await fixture({ limits: { maxCases: 1 } }), view = await f.view();
        button(view.root, 'Preserve selected report').click(); expect(view.root.querySelector('[data-status]').textContent).toContain('Select one report');
        [...view.root.querySelectorAll('button')].find(node => node.textContent === 'Flag benign sample').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-source]')).not.toBeNull());
        view.root.querySelector('[data-source]').click(); view.root.querySelector('[data-confirm-selection]').click();
        f.model.storage.failNextCommit(); button(view.root, 'Preserve selected report').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-status]').textContent).toContain('Could not confirm'));
        expect(state(f.model).cases).toEqual([]);
        button(view.root, 'Preserve selected report').click(); await vi.waitFor(() => expect(view.root.querySelector('[data-open-case]')).not.toBeNull());
        [...view.root.querySelectorAll('button')].filter(node => node.textContent === 'Flag benign sample')[1].click();
        await vi.waitFor(() => expect(view.root.querySelectorAll('[data-source]')).toHaveLength(2));
        [...view.root.querySelectorAll('[data-source]')][1].click(); view.root.querySelector('[data-confirm-selection]').click(); button(view.root, 'Preserve selected report').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-status]').textContent).toContain('capacity is full'));
        expect(state(f.model).cases).toHaveLength(1);
    });

    it('honors actual source dismissal ordering and never manufactures a missing selection', async () => {
        const f = await fixture(), view = await f.view();
        [...view.root.querySelectorAll('button')].find(node => node.textContent === 'Flag benign sample').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-source]')).not.toBeNull());
        const source = (await f.model.call(view.token, 'overview')).reports[0];
        const request = { operationId: 'preserve_after_dismiss', sourceId: source.id, sourceRevision: source.revision, sourceDigest: source.digest, type: 'safety', reason: 'selected_report' };
        await f.model.dismiss(source.id);
        expect(await f.model.call(view.token, 'preserve', request)).toEqual({ ok: false, error: 'source-unavailable' }); expect(state(f.model).cases).toEqual([]);
    });

    it('purges the previous restricted metadata before a failed refresh and keeps detached controls inert', async () => {
        const f = await fixture(); let unavailable = false;
        const view = await f.view('handler', adapter => ({ ...adapter, call: (method, args) => unavailable && method === 'overview' ? { ok: false, error: 'storage-unavailable' } : adapter.call(method, args) }));
        await reportAndPreserve(view); const oldDetail = view.root.querySelector('[aria-label="Current restricted case"]'), oldButton = button(view.root, 'Open selected evidence');
        unavailable = true; await view.controller.refresh();
        expect(oldDetail.textContent).toBe(''); expect(view.root.querySelector('[aria-label="Current restricted case"]')).toBeNull();
        expect(view.root.querySelector('[data-status]').textContent).toContain('Could not confirm'); oldButton.click();
        expect(view.root.querySelector('[data-evidence]')).toBeNull(); expect(button(view.root, 'Retry restricted view')).toBeDefined();
    });

    it('enforces fixture session capacity inside the insertion transaction under concurrent opens', async () => {
        const f = await fixture();
        const opened = await Promise.allSettled(Array.from({ length: 17 }, () => f.model.open('guest')));
        expect(opened.filter(item => item.status === 'fulfilled')).toHaveLength(16); expect(opened.filter(item => item.status === 'rejected')).toHaveLength(1);
    });

    it('blocks duplicate profile submissions and closes a session arriving after page teardown', async () => {
        const html = readFileSync(new URL('../../scripts/incident-review-ui/index.html', import.meta.url), 'utf8');
        const source = readFileSync(new URL('../../scripts/incident-review-ui/client.mjs', import.meta.url), 'utf8');
        const dom = new JSDOM(html, { url: 'http://127.0.0.1:4397/', runScripts: 'outside-only' }); resources.push(() => dom.window.close());
        const pending = [], requests = [], mounted = [], disconnect = vi.fn();
        dom.window.fetch = (path, options) => {
            requests.push({ path, session: options.headers['x-local-session'] });
            return path === '/session' ? new Promise(resolve => pending.push(resolve)) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        };
        dom.window.__modules = { mountIncidentReview: input => { mounted.push(input); return { ready: Promise.resolve(), disconnect }; } };
        dom.window.eval(source.replace(/^import .*$/m, 'const { mountIncidentReview } = window.__modules;'));
        const form = dom.window.document.querySelector('#profiles'), submit = () => form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        submit(); submit(); expect(pending).toHaveLength(1);
        pending[0]({ json: async () => ({ ok: true, session: 'synthetic_session_one' }) }); await vi.waitFor(() => expect(mounted).toHaveLength(1));
        submit(); expect(disconnect).toHaveBeenCalledOnce(); dom.window.dispatchEvent(new dom.window.Event('pagehide'));
        pending[1]({ json: async () => ({ ok: true, session: 'synthetic_session_two' }) });
        await vi.waitFor(() => expect(requests).toContainEqual({ path: '/logout', session: 'synthetic_session_two' }));
        expect(mounted).toHaveLength(1);
    });

    it('shows an overdue hold without releasing it or offering an expired policy shortcut', async () => {
        const f = await fixture(), view = await f.view(); await reportAndPreserve(view);
        await f.advance(f.base + DAY + 2000);
        await vi.waitFor(() => expect(view.root.textContent).toContain('renewed qualified decision'));
        expect(button(view.root, 'Release under approved local decision')).toBeUndefined();
        expect(state(f.model).cases[0].hold.state).toBe('active'); expect(state(f.model).cases[0].evidence.state).toBe('present');
    });

    it('renders markup-shaped adapter text inert without creating a remote preview', async () => {
        const f = await fixture();
        const view = await f.view('handler', adapter => ({ ...adapter, call: async (method, args) => {
            const result = await adapter.call(method, args);
            return method === 'evidence' && result.ok ? { ...result, text: '<img src="https://must-not-fetch.invalid/"> benign literal' } : result;
        } }));
        await reportAndPreserve(view); button(view.root, 'Open selected evidence').click();
        await vi.waitFor(() => expect(view.root.querySelector('[data-evidence]').textContent).toContain('<img'));
        expect(view.root.querySelector('img,iframe,video,object')).toBeNull();
    });
});
