// Inert local review UI. Its injected adapter, never DOM roles/booleans, decides
// authority. No browser persistence, HTML evidence, URLs or remote previews.
export function mountIncidentReview({ root, adapter, newOperation = () => `ui_${crypto.randomUUID().replaceAll('-', '')}` }) {
    const document = root.ownerDocument;
    let connected = true, generation = 0, busy = false, unsubscribe = () => {}, selectedSource = '', selectedCase = '', evidenceNode = null, hadAppointment = false;
    const element = (tag, text, attributes = {}) => {
        const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node;
    };
    const wipe = () => { if (evidenceNode) evidenceNode.textContent = ''; evidenceNode = null; for (const node of root.querySelectorAll('[data-sensitive]')) node.textContent = ''; root.replaceChildren(); };
    const message = text => { const node = root.querySelector('[data-status]'); if (node) node.textContent = text; };
    function disconnect() {
        if (!connected) return; connected = false; generation += 1; selectedSource = ''; selectedCase = ''; unsubscribe(); wipe();
        const status = element('p', 'Disconnected. Case details are cleared. Open a new local session.', { role: 'status', tabindex: '-1', 'data-status': '' });
        root.append(status); status.focus();
        Promise.resolve(adapter.disconnect?.()).catch(() => {});
    }
    const errors = { capacity: 'Case capacity is full. Nothing new was confirmed.', 'storage-unavailable': 'Could not confirm the save. Retry the same action before assuming it succeeded.',
        'source-unavailable': 'The report is no longer available. Nothing was copied.', 'source-conflict': 'The selected report changed. Refresh and select it again.',
        'revision-conflict': 'The case changed. Refresh before taking another action.', 'hold-active': 'An active hold prevents deletion. A separate approved release is required.',
        'policy-unqualified': 'No current approved local decision permits this action.', 'evidence-retention-due': 'Evidence is no longer available under its deadline.' };
    const forget = result => { try { if (typeof result?.text === 'string') result.text = ''; } catch { /* Independently owned immutable copies cannot be erased here. */ } };
    async function action(method, args, scope, after = 'Saved after the local transaction completed.') {
        if (!connected || scope !== generation || busy) return;
        busy = true; message('Saving…');
        let result; try { result = await adapter.call(method, args); } catch { result = { ok: false, error: 'storage-unavailable' }; }
        if (!connected || scope !== generation) { forget(result); busy = false; return; }
        busy = false;
        if (!result.ok) { if (result.error === 'forbidden') return disconnect(); message(errors[result.error] || 'This action was not confirmed. Refresh or reconnect.'); return; }
        if (method === 'evidence') {
            if (evidenceNode) { evidenceNode.textContent = result.text; forget(result); evidenceNode.focus(); }
            message('Selected evidence opened for this appointed local session.'); return;
        }
        if (result.caseRef) selectedCase = result.caseRef;
        await refresh(after);
    }
    function button(label, fn, attributes = {}) {
        const scope = generation, node = element('button', label, { type: 'button', ...attributes });
        node.addEventListener('click', () => { if (connected && generation === scope) fn(); }); return node;
    }
    function render(status, messages, overview, statusText) {
        wipe(); const scope = generation;
        root.append(element('h1', 'Restricted incident review · local fixture'));
        root.append(element('p', 'Synthetic identities, decisions and benign messages only. No legal qualification or production permissions.', { class: 'banner' }));
        root.append(element('p', statusText || `Connected as local ${status.profile}.`, { role: 'status', 'data-status': '' }));
        root.append(button('Disconnect and clear', disconnect));
        const samples = element('section'); samples.append(element('h2', 'Actual lobby report path · benign samples'));
        for (const sample of messages.messages) {
            const row = element('p'); row.append(element('span', sample.text));
            row.append(button('Flag benign sample', () => action('report', { id: sample.id }, scope, 'Report accepted by the lobby after persistence.'), { 'aria-label': `Flag benign sample: ${sample.text}` })); samples.append(row);
        }
        root.append(samples);
        if (!status.appointed) { root.append(element('p', 'This profile has no incident appointment. Restricted source selection and cases are unavailable.')); return; }
        if (overview.maintenance?.errors.length) root.append(element('p', 'Scheduled cleanup needs attention. No cleanup success was confirmed.', { role: 'alert' }));
        const sources = element('section', undefined, { 'aria-label': 'Selected report preservation' }); sources.append(element('h2', 'Select one reported message'));
        for (const report of overview.reports) {
            const label = element('label', undefined, { class: 'source' }), input = element('input', undefined, { type: 'radio', name: 'selected-report', value: report.id, 'data-source': report.id });
            input.checked = selectedSource === report.id; input.addEventListener('change', () => { if (connected && generation === scope) selectedSource = report.id; });
            label.append(input, element('span', `${report.id} · ${report.provenance} · revision ${report.revision}`, { 'data-sensitive': '' })); sources.append(label);
        }
        if (!overview.reports.length) sources.append(element('p', 'No current source reports. No transcript archive is shown.'));
        sources.append(element('p', `Decision: ${overview.policy.reason}. Authority: ${overview.policy.authority}. Hold until ${new Date(overview.policy.holdUntil).toISOString()}. Evidence deletion ${new Date(overview.policy.evidenceDeleteAt).toISOString()}.`, { 'data-sensitive': '' }));
        const confirmation = element('label'), check = element('input', undefined, { type: 'checkbox', 'data-confirm-selection': '' });
        confirmation.append(check, element('span', ' Preserve only this selected reported message under the displayed local decision.')); sources.append(confirmation);
        const preserveOperation = newOperation();
        sources.append(button('Preserve selected report', () => {
            const report = overview.reports.find(item => item.id === selectedSource);
            if (!report || !check.checked) return message('Select one report and confirm the displayed preservation decision.');
            action('preserve', { operationId: preserveOperation, sourceId: report.id, sourceRevision: report.revision, sourceDigest: report.digest, type: 'safety', reason: 'selected_report' }, scope);
        }));
        root.append(sources);
        const cases = element('section', undefined, { 'aria-label': 'Assigned restricted cases' }); cases.append(element('h2', 'Cases assigned to this handler'));
        for (const record of overview.cases) cases.append(button(`Open case ${record.id}`, () => { selectedCase = record.id; refresh(); }, { 'data-open-case': record.id }));
        root.append(cases);
        const record = overview.cases.find(item => item.id === selectedCase);
        if (!record) return;
        const detail = element('section', undefined, { 'aria-label': 'Current restricted case', 'data-sensitive': '' });
        detail.append(element('h2', `Case ${record.id}`), element('p', `Review: ${record.review}. Preservation: ${record.hold.state}. Evidence: ${record.evidence.state}. Revision: ${record.revision}.`),
            element('p', `Provenance: ${record.evidence.provenance || 'deleted'}. Review due ${new Date(record.reviewAt).toISOString()}. Evidence deletion ${new Date(record.evidenceDeleteAt).toISOString()}. Case deletion ${new Date(record.caseDeleteAt).toISOString()}.`));
        const request = () => ({ operationId: newOperation(), caseRef: record.id, expectedRevision: record.revision });
        if (record.evidence.state === 'present') {
            const args = request(); detail.append(button('Open selected evidence', () => action('evidence', args, scope)));
            evidenceNode = element('pre', '', { tabindex: '-1', 'aria-label': 'Selected evidence text', 'data-evidence': '' }); detail.append(evidenceNode);
        }
        if (record.review === 'open') { const args = request(); detail.append(button('Mark triaged', () => action('triage', args, scope))); }
        if (record.review === 'triaged') { const args = request(); detail.append(button('Close review', () => action('closeReview', args, scope))); }
        if (record.holdOverdue) detail.append(element('p', 'The hold deadline passed. A renewed qualified decision is required; cleanup stays blocked.', { role: 'alert' }));
        if (record.hold.state === 'active' && overview.policy.releaseAvailable) { const args = request(); detail.append(button('Release under approved local decision', () => action('release', args, scope))); }
        const cleanupArgs = request(); detail.append(button('Run due cleanup', () => action('cleanup', cleanupArgs, scope)));
        root.append(detail);
    }
    async function refresh(statusText = '') {
        if (!connected || busy) return; const scope = ++generation;
        wipe(); root.append(element('p', 'Refreshing restricted view…', { role: 'status', 'data-status': '' }), button('Disconnect and clear', disconnect));
        let status, messages, overview;
        try {
            status = await adapter.call('status'); messages = await adapter.call('messages');
            if (status.ok && status.appointed) overview = await adapter.call('overview');
        } catch { return disconnect(); }
        if (!connected || scope !== generation) return;
        if (!status.ok || !messages.ok || hadAppointment && !status.appointed || status.appointed && !overview?.ok && overview?.error === 'forbidden') return disconnect();
        hadAppointment = status.appointed;
        if (status.appointed && !overview?.ok) { message(errors[overview?.error] || 'Restricted state could not be loaded.'); root.append(button('Retry restricted view', () => refresh())); return; }
        render(status, messages, overview, statusText);
    }
    unsubscribe = adapter.subscribe?.(event => { if (event.type === 'disconnect') disconnect(); else if (event.type === 'update' && !busy) refresh(); }) || (() => {});
    return Object.freeze({ ready: refresh(), refresh, disconnect });
}
