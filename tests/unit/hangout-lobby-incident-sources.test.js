// @vitest-environment node
// Actual lobby-v1 native transaction mapping/effect writer over disk SQLite.
// Appointments, incident policy and ephemeral purpose key are synthetic only.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { createLobbySessionAuthority, initializeLobbySessionAuthority, LOBBY_AUTHORITY_COMMUNITY } from '../../hangout-worker/src/lobby-session-authority.mjs';
import { writeLobbyEffects, readLobbyState } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { LOBBY_INCIDENT_SOURCE_KEY as SOURCES, lobbyIncidentSourceMode, initializeLobbyIncidentSources } from '../../hangout-worker/src/lobby-incident-sources.mjs';
import { createIncidentCases, createIncidentEvidenceCipher, initialIncidentCaseState } from '../../hangout-worker/src/incident-cases.mjs';

const NOW = 1800000000000, DAY = 86400000, CASES = 'restricted-incident-cases-v1', APPOINTMENT = 'synthetic-incident-appointment';
const copy = value => structuredClone(value), cleanups = [], logical = event => event.name === 'put' && event.key.includes(':manifest:')
    ? Buffer.from(event.key.split(':manifest:')[1], 'hex').toString('utf8') : '';
afterEach(async () => { for (const item of cleanups.splice(0)) { for (const driver of item.drivers) await driver.close(); await rm(item.directory, { recursive: true, force: true }); } });
async function fixture({ enabled = true, initialize = true } = {}) {
    let at = NOW, seq = 0;
    const directory = await mkdtemp(join(tmpdir(), 'lobby-incident-sources-')), filename = join(directory, 'lobby.sqlite'), hooks = {};
    const driver = openDurableRecordSqlite(filename, hooks), cleanup = { directory, drivers: [driver] }; cleanups.push(cleanup);
    const wrap = disk => ({ transaction: fn => disk.transaction(raw => fn({ ...raw,
        getAlarm: () => raw.get('__alarm__'), setAlarm: value => raw.put('__alarm__', value), deleteAlarm: () => raw.delete('__alarm__') })) });
    const env = { HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'synthetic-incident-source-test-only', HANGOUT_MODERATOR_EMAILS: 'reviewer@example.invalid', HANGOUT_BAND_EMAILS: 'band@example.invalid',
        ...(enabled ? { HANGOUT_INCIDENT_SOURCE_BRIDGE: 'i3a-v1' } : {}) };
    const storage = wrap(driver), makeAuthority = native => createLobbySessionAuthority({ storage: native, env, now: () => at });
    const authority = makeAuthority(storage), blank = createLobby({ now: () => at }), initial = {
        net: blank.snapshot(), rooms: blank.roomSnapshot(), abuse: blank.abuseSnapshot(), sessions: blank.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: [] };
    if (initialize) await initializeLobbySessionAuthority({ storage, env, state: initial, now: at });
    const frames = [], engine = createLobby({ now: () => at, incidentSources: enabled, effectCommit: authority.effectCommit,
        send: (recipient, frame) => frames.push({ recipient, ...copy(frame) }), limits: { defaultSlow: 0, pmMinLobbyMs: 0 } });
    const bindings = new Map();
    async function enroll(id, moderator = false) {
        const profile = moderator ? { kind: 'staff', account: await accountId(moderator === 'band' ? 'band@example.invalid' : 'reviewer@example.invalid', env.HANGOUT_HMAC_KEY), role: moderator === 'band' ? 'band' : 'moderator', admin: true, expiresAt: at + 3600000 } : null;
        const request = { sid: `session-${id.toLowerCase().padEnd(12, 'x')}-${++seq}`, version: '1', exp: at + 3600000,
            iph: `mint-${id.padEnd(17, 'x')}`.slice(0, 22), profile };
        expect((await authority.register(request)).status).toBe(200);
        const binding = { id, betaSid: request.sid, betaInviteVersion: '1', dev: `device_${id}`, iph: request.iph,
            account: profile?.account || '', role: profile?.role || 'fan', admin: !!profile,
            expiresAt: request.exp, authorityRef: id, authorityRevision: 1 };
        await authority.bind(binding); bindings.set(id, binding);
        expect((await engine.connect(binding)).ok).toBe(true);
        await message(id, { t: 'hello', nick: id, age13: true });
        expect(frames.some(frame => frame.recipient === id && frame.t === 'welcome' && frame.nick === id)).toBe(true); return binding;
    }
    async function message(id, body) { at += 1000; const result = await engine.message(id, JSON.stringify(body)); expect(result?.ok).not.toBe(false); return result; }
    const command = (id, name, args = [], ch = '#stalemate') => message(id, { t: 'cmd', name, args, ch });
    async function say(id, text, ch = '#stalemate', extra = {}) {
        const before = frames.length; await message(id, { t: 'say', ch, text, ...extra });
        const line = frames.slice(before).find(frame => frame.t === 'line' && frame.from === id && frame.text === text);
        expect(line).toBeDefined(); return line;
    }
    const get = key => authority.records.transaction(tx => tx.get(key));
    const put = (key, value) => authority.records.transaction(tx => tx.put(key, value));
    const queue = () => get('moderation-queue'), index = () => get(SOURCES);
    const source = sourceId => authority.records.transaction(tx => authority.loadIncidentEvidence({ tx, sourceId }));
    const writeQueue = value => authority.records.transaction(tx => authority.writeParticipationEffects({ tx, effects: [['moderation-queue', value]] }));
    async function cases(handler = 'Handler', controls = {}) {
        if (!bindings.has(handler)) await enroll(handler);
        const binding = bindings.get(handler), identity = { principalRef: `s_${binding.betaSid}`, communityRef: LOBBY_AUTHORITY_COMMUNITY, expiresAt: binding.expiresAt };
        const appointment = { actorRef: 'synthetic_handler', incidentReviewer: true, active: true, revision: 1,
            expiresAt: NOW + 3 * DAY, canOpen: true, canMaintain: true };
        await authority.records.transaction(async tx => { await tx.put(CASES, initialIncidentCaseState()); await tx.put(APPOINTMENT, appointment); });
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const cipher = createIncidentEvidenceCipher({ keyId: 'synthetic_ephemeral_key', key });
        const policy = { qualified: true, version: 'synthetic_v1', procedure: 'synthetic_only', authority: 'synthetic_decision', reason: 'selected_report',
            validFrom: NOW, validUntil: NOW + 3 * DAY, reviewAt: NOW + DAY + 1000, holdUntil: null,
            evidenceDeleteAt: NOW + DAY + 2000, caseDeleteAt: NOW + DAY + 3000, tombstoneUntil: NOW + 2 * DAY,
            receiptUntil: NOW + 2 * DAY, auditUntil: NOW + 2 * DAY,
            limits: { maxCases: 4, maxBytes: 100000, maxEvidenceBytes: 1200, maxAuditEvents: 100, maxOperations: 100, maxTombstones: 10 } };
        let operation = 0;
        const model = createIncidentCases({ storage: authority.records, now: () => at,
            resolveAuthority: async ({ tx, principal }) => principal === handler && await authority.validateParticipationConnection({ tx, connection: binding, identity }) ? tx.get(APPOINTMENT) : null,
            resolveReviewer: ({ tx }) => tx.get(APPOINTMENT), policyFor: () => copy(policy),
            loadEvidence: input => authority.loadIncidentEvidence(input),
            cipher: { decrypt: (...args) => cipher.decrypt(...args), encrypt: async (...args) => { const encrypted = await cipher.encrypt(...args); await controls.afterEncrypt?.(); return encrypted; } } });
        const preserve = selection => model.preserveSelectedReport({ principal: handler, operationId: `preserve_${++operation}`,
            sourceId: selection.id, sourceRevision: selection.revision, sourceDigest: selection.digest, type: 'safety' });
        const read = receipt => model.readEvidence({ principal: handler, operationId: `read_${++operation}`, caseRef: receipt.caseRef, expectedRevision: receipt.revision });
        return { model, preserve, read, controls, binding };
    }
    return { env, storage, authority, driver, hooks, frames, engine, bindings, initial, enroll, message, command, say, get, put, queue, index, source, writeQueue, cases,
        now: () => at, advance: ms => { at += ms; },
        async restore({ mutate = value => value, authority: current = authority, enabled: mode = enabled } = {}) {
            const restored = createLobby({ now: () => at, incidentSources: mode, effectCommit: current.effectCommit,
                send: (recipient, frame) => frames.push({ recipient, ...copy(frame) }), limits: { defaultSlow: 0, pmMinLobbyMs: 0 } });
            await restored.restoreRooms((await current.load()).state.rooms);
            expect(restored.restoreSessions(mutate(await get('sessions')), [...bindings.values()]).rejected).toEqual([]);
            return restored;
        },
        async reopen() { await driver.close(); const next = openDurableRecordSqlite(filename); cleanup.drivers.push(next); return { authority: makeAuthority(wrap(next)), driver: next }; } };
}
async function report(f, text = 'Benign selected public pencil report', room = '#stalemate') {
    const line = await f.say('Alpha', text, room); await f.message('Bravo', { t: 'report', id: line.id }); return line;
}
async function people(f) { await f.enroll('Alpha'); await f.enroll('Bravo'); }

describe('production selected public incident source composition', () => {
    it('uses original delivery visibility across public→private and private→public room changes, ignoring browser stamps', async () => {
        const f = await fixture(); await people(f);
        await f.command('Alpha', 'join', ['#chat-origin']); await f.command('Bravo', 'join', ['#chat-origin']);
        const publicLine = await f.say('Alpha', 'Benign public before invite mode', '#chat-origin', { publicOrigin: { v: 1, at: 1 } });
        await f.command('Alpha', 'mode', ['+i'], '#chat-origin');
        await f.message('Bravo', { t: 'report', id: publicLine.id, publicOrigin: { v: 1, at: 1 } });
        expect((await f.source(publicLine.id)).provenance).toBe('reported-public');
        expect((await f.queue()).reports[0].publicOrigin).toEqual({ v: 1, at: publicLine.ts });
        expect(publicLine).not.toHaveProperty('publicOrigin');
        const privateLine = await f.say('Alpha', 'Benign private before opening', '#chat-origin');
        await f.command('Alpha', 'mode', ['-i'], '#chat-origin');
        await f.message('Bravo', { t: 'report', id: privateLine.id, publicOrigin: { v: 1, at: privateLine.ts } });
        expect(await f.source(privateLine.id)).toBeNull();
        expect((await f.queue()).reports.find(row => row.id === privateLine.id)).not.toHaveProperty('publicOrigin');
    });
    it.each(['key', 'locked'])('keeps %s-room deliveries ineligible after the room is opened', async privacy => {
        const f = await fixture(); await people(f); await f.command('Alpha', 'join', ['#chat-private']); await f.command('Bravo', 'join', ['#chat-private']);
        await f.command('Alpha', privacy === 'key' ? 'mode' : 'lock', privacy === 'key' ? ['+k', 'abc123'] : ['on'], '#chat-private');
        const line = await f.say('Alpha', 'Benign restricted room text', '#chat-private');
        await f.command('Alpha', privacy === 'key' ? 'mode' : 'lock', privacy === 'key' ? ['-k'] : ['off'], '#chat-private');
        await f.message('Bravo', { t: 'report', id: line.id }); expect(await f.source(line.id)).toBeNull();
    });
    it('classifies held messages only at their eventual public delivery, with approval time bound separately from composition', async () => {
        const f = await fixture(); await people(f); await f.enroll('Band', 'band');
        await f.command('Band', 'filter', ['hold', 'pencil']);
        await f.command('Alpha', 'join', ['#chat-held']); await f.command('Bravo', 'join', ['#chat-held']); await f.command('Band', 'join', ['#chat-held']);
        await f.message('Alpha', { t: 'say', ch: '#chat-held', text: 'Benign pencil draft one' });
        const first = (await f.queue()).held[0]; expect(first).toBeDefined(); expect(await f.source(first.id)).toBeNull();
        await f.command('Alpha', 'mode', ['+i'], '#chat-held'); await f.command('Band', 'approve', [first.id]);
        await f.message('Bravo', { t: 'report', id: first.id }); expect(await f.source(first.id)).toBeNull();
        await f.message('Alpha', { t: 'say', ch: '#chat-held', text: 'Benign pencil draft two' }); const second = (await f.queue()).held[0];
        await f.command('Alpha', 'mode', ['-i'], '#chat-held'); await f.command('Band', 'approve', [second.id]);
        const acceptedAt = f.now(); await f.message('Bravo', { t: 'report', id: second.id });
        expect((await f.queue()).reports.find(row => row.id === second.id).publicOrigin).toEqual({ v: 1, at: acceptedAt });
        expect(acceptedAt).toBeGreaterThan(second.ts); expect((await f.source(second.id)).provenance).toBe('reported-public');
    });
    it('keeps the digest-bound original stamp through actual session receipt restore, without inferring current room privacy', async () => {
        const f = await fixture(); await people(f); await f.command('Alpha', 'join', ['#chat-restore']); await f.command('Bravo', 'join', ['#chat-restore']);
        const publicLine = await f.say('Alpha', 'Benign public witness before restart', '#chat-restore');
        await f.command('Alpha', 'mode', ['+i'], '#chat-restore'); const privateLine = await f.say('Alpha', 'Benign private witness before restart', '#chat-restore');
        await f.command('Alpha', 'mode', ['-i'], '#chat-restore');
        const restored = await f.restore();
        expect(restored._debug.lines.size).toBe(0); // Observation only: no seeded source authority.
        await restored.message('Bravo', JSON.stringify({ t: 'report', id: publicLine.id, text: publicLine.text }));
        await restored.message('Bravo', JSON.stringify({ t: 'report', id: privateLine.id, text: privateLine.text, publicOrigin: { v: 1, at: NOW } }));
        expect((await f.source(publicLine.id)).provenance).toBe('reported-public'); expect(await f.source(privateLine.id)).toBeNull();
    });
    it.each(['remove', 'change'])('refuses receipt fallback with %s-d v2 stamp even when the selected quote is exact', async tamper => {
        const f = await fixture(); await people(f); const line = await f.say('Alpha', 'Benign tampered witness');
        const restored = await f.restore({ mutate: saved => { const receipt = saved.receipts.find(row => row.id === line.id);
            if (tamper === 'remove') delete receipt.publicOrigin; else receipt.publicOrigin.at += 1; return saved; } });
        const before = f.frames.length; await restored.message('Bravo', JSON.stringify({ t: 'report', id: line.id, text: line.text }));
        expect((await f.queue()).reports).toEqual([]); expect(f.frames.slice(before).some(frame => frame.t === 'report-status')).toBe(false);
    });
    it('keeps original v1 receipts ordinarily reportable after an explicit empty-source activation, without granting source provenance', async () => {
        const f = await fixture({ enabled: false }); await people(f); const line = await f.say('Alpha', 'Benign legacy witness');
        await f.authority.records.transaction(async tx => initializeLobbyIncidentSources({ tx, queue: await tx.get('moderation-queue'), now: f.now() }));
        f.env.HANGOUT_INCIDENT_SOURCE_BRIDGE = 'i3a-v1'; const authority = createLobbySessionAuthority({ storage: f.storage, env: f.env, now: f.now });
        const restored = await f.restore({ authority, enabled: true }); await restored.message('Bravo', JSON.stringify({ t: 'report', id: line.id, text: line.text }));
        expect((await f.queue()).reports).toHaveLength(1);
        expect(await authority.records.transaction(tx => authority.loadIncidentEvidence({ tx, sourceId: line.id }))).toBeNull();
    });
    it('rejects source-removal-first preservation without case changes, and serializes a copy that starts first before dismissal', async () => {
        const f = await fixture(); await people(f); await f.enroll('Reviewer', true); const first = await report(f, 'Benign dismissed selection'), gone = await f.source(first.id);
        const controls = {}, c = await f.cases('Handler', controls); await f.command('Reviewer', 'dismiss', [first.id]);
        expect(await c.preserve(gone)).toEqual({ ok: false, error: 'source-unavailable' }); expect(await f.get(CASES)).toEqual(initialIncidentCaseState());
        const second = await report(f, 'Benign ordered selection'), selection = await f.source(second.id);
        let release, entered; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
        controls.afterEncrypt = async () => { entered(); await held; };
        const preservation = c.preserve(selection); await started;
        const dismissal = f.command('Reviewer', 'dismiss', [second.id]); release();
        expect((await preservation).ok).toBe(true); await dismissal; expect(await f.source(second.id)).toBeNull(); expect((await f.get(CASES)).cases).toHaveLength(1);
    });
    it('preserves exact selected UTF-8 through I1 in the actual shared SQL transaction without copying queue context or identifiers', async () => {
        const f = await fixture(); await people(f); await f.say('Alpha', 'Unselected benign context message');
        const line = await report(f, 'Benign selected café pencil report'), selection = await f.source(line.id), c = await f.cases();
        const accepted = await c.preserve(selection); expect(accepted.ok).toBe(true);
        const read = await c.read(accepted); expect(new TextDecoder().decode(read.evidence.bytes)).toBe(line.text);
        const indexText = JSON.stringify(await f.index()), saved = await f.get(CASES);
        for (const omitted of [line.text, 'Unselected benign context message', 'device_Alpha', 'device_Bravo', 'mint-Bravo', 'context', 'publicOrigin']) expect(indexText).not.toContain(omitted);
        expect(saved.cases[0].evidence.provenance).toBe('reported-public');
        expect(JSON.stringify(saved)).not.toContain(line.text); expect(JSON.stringify(saved)).not.toContain('Unselected benign');
        expect(Object.keys(selection).sort()).toEqual(['bytes', 'digest', 'expiresAt', 'id', 'provenance', 'revision']);
        expect(saved.cases).toHaveLength(1); expect(saved.operations).toHaveLength(2); expect(saved.audit).toHaveLength(2);
    });
    it('keeps generation for votes/hidden/context, advances on immutable origin change, and never reuses after identical deletion/reinsertion or disk reopen', async () => {
        const f = await fixture(); await people(f); const line = await report(f), originalQueue = await f.queue(), first = await f.source(line.id);
        const vote = copy(originalQueue); vote.reports[0].devs.push('another_device'); vote.reports[0].iphs.push('another_ip'); vote.reports[0].hidden = true; vote.reports[0].context.push('Benign extra context');
        await f.writeQueue(vote); expect((await f.source(line.id)).revision).toBe(first.revision);
        const changed = copy(vote); changed.reports[0].from = 'DifferentAuthor'; await f.writeQueue(changed);
        expect((await f.source(line.id)).revision).toBeGreaterThan(first.revision);
        await f.writeQueue({ reports: [], held: [] }); const counter = (await f.index()).nextGeneration;
        await f.writeQueue(originalQueue); const second = await f.source(line.id); expect(second.revision).toBeGreaterThan(counter);
        const reopened = await f.reopen(), loaded = await reopened.authority.records.transaction(tx => reopened.authority.loadIncidentEvidence({ tx, sourceId: line.id }));
        expect(loaded).toEqual(second); await reopened.authority.load();
    });
    it.each(['dismiss', 'delete', 'purge', 'tick'])('orders actual %s source removal with I1 preservation and never resurrects ordinary report text', async action => {
        const f = await fixture(); await people(f); await f.enroll('Reviewer', true); const line = await report(f), selection = await f.source(line.id), c = await f.cases();
        const accepted = await c.preserve(selection); expect(accepted.ok).toBe(true);
        if (action === 'tick') { f.advance(DAY); expect((await f.engine.tick())?.ok).not.toBe(false); }
        else await f.command('Reviewer', action, [action === 'purge' ? 'Alpha' : line.id]);
        expect(await f.source(line.id)).toBeNull(); expect((await f.index()).entries).toEqual([]);
        expect((await f.get(CASES)).cases[0].evidence.state).toBe('present');
        if (action !== 'tick') expect(await c.preserve(selection)).toEqual({ ok: false, error: 'source-unavailable' });
        expect(f.frames.filter(row => row.t === 'line' && row.id === line.id)).toHaveLength(3);
    });
    it('refuses missing/corrupt source state and disabled initialized domains without resetting generations or provisioning', async () => {
        const f = await fixture(); await people(f); const line = await report(f), original = await f.index();
        await f.authority.records.transaction(tx => tx.delete(SOURCES)); await expect(f.source(line.id)).rejects.toThrow(); await expect(f.authority.load()).rejects.toThrow(); expect(await f.index()).toBeUndefined();
        await f.put(SOURCES, { ...original, nextGeneration: -1 }); await expect(f.source(line.id)).rejects.toThrow();
        await f.put(SOURCES, original); delete f.env.HANGOUT_INCIDENT_SOURCE_BRIDGE;
        const disabled = createLobbySessionAuthority({ storage: f.storage, env: f.env, now: f.now }); await expect(disabled.load()).rejects.toThrow();
        expect(await f.index()).toEqual(original);
    });
    it('rolls back the real queue and staged report acknowledgement if the source-index native write fails', async () => {
        const f = await fixture(); await people(f); const line = await f.say('Alpha', 'Benign source write fault'), before = await f.queue(), index = await f.index(), offset = f.frames.length;
        let tripped = false;
        f.hooks.after = event => { if (!tripped && logical(event) === SOURCES) { tripped = true; throw Error('synthetic-after-real-index-write'); } };
        const result = await f.engine.message('Bravo', JSON.stringify({ t: 'report', id: line.id }));
        expect(tripped).toBe(true); expect(result.ok).toBe(false); expect(await f.queue()).toEqual(before); expect(await f.index()).toEqual(index);
        expect(f.frames.slice(offset).some(frame => frame.t === 'report-status' && frame.submitted)).toBe(false);
        expect(f.engine.adminState().reports).toEqual([]);
    });
    it('rolls back case/cipher/audit/receipt on final case write failure while leaving ordinary source unchanged', async () => {
        const f = await fixture(); await people(f); const line = await report(f), selection = await f.source(line.id), c = await f.cases(), before = await f.queue(), index = await f.index();
        let tripped = false; f.hooks.after = event => { if (!tripped && logical(event) === CASES) { tripped = true; throw Error('synthetic-after-real-case-write'); } };
        expect(await c.preserve(selection)).toEqual({ ok: false, error: 'storage-unavailable' }); expect(tripped).toBe(true);
        expect(await f.get(CASES)).toEqual(initialIncidentCaseState()); expect(await f.queue()).toEqual(before); expect(await f.index()).toEqual(index);
    });
    it('rechecks the real SID binding and distinct synthetic appointment after awaited encryption before any success', async () => {
        const f = await fixture(); await people(f); const line = await report(f), selection = await f.source(line.id);
        const c = await f.cases('Handler', { afterEncrypt: async () => { f.advance(3600000); } });
        expect(await c.preserve(selection)).toEqual({ ok: false, error: 'forbidden' }); expect(await f.get(CASES)).toEqual(initialIncidentCaseState());
        expect(await f.source(line.id)).toEqual(selection);
    });
    it('keeps unstamped legacy/default production unchanged and does not promote PM or AI rows', async () => {
        const f = await fixture({ enabled: false }); await people(f); const line = await report(f);
        const saved = (await f.get('sessions')).receipts.find(row => row.id === line.id), queued = (await f.queue()).reports[0];
        expect(saved).not.toHaveProperty('publicOrigin'); expect(queued).not.toHaveProperty('publicOrigin'); expect(await f.index()).toBeUndefined();
        const expected = createHash('sha256').update(JSON.stringify(['hangout-delivered-line-v1', 'line', line.id, line.ch, line.from, '', line.prefix || '', !!line.band, !!line.moderator, !!line.me, line.ts, 'device_Alpha', line.text])).digest('hex');
        expect(saved.digest).toBe(expected);
        await f.authority.records.transaction(tx => initializeLobbyIncidentSources({ tx, queue: { reports: [queued], held: [] }, now: f.now() }));
        const enabled = { ...f.env, HANGOUT_INCIDENT_SOURCE_BRIDGE: 'i3a-v1' }, authority = createLobbySessionAuthority({ storage: f.storage, env: enabled, now: f.now });
        expect(await authority.records.transaction(tx => authority.loadIncidentEvidence({ tx, sourceId: line.id }))).toBeNull();
        const pm = { ...queued, id: 'pbenign', ch: 'pm:Alpha>Bravo' };
        await authority.records.transaction(tx => writeLobbyEffects({ tx, effects: [['moderation-queue', { reports: [pm], held: [] }]], incidentSources: true, now: f.now() }));
        expect((await f.index()).entries).toEqual([]);
        const forged = { ...pm, publicOrigin: { v: 1, at: NOW } };
        await expect(authority.records.transaction(tx => writeLobbyEffects({ tx, effects: [['moderation-queue', { reports: [forged], held: [] }]], incidentSources: true, now: f.now() }))).rejects.toThrow();
        await authority.records.transaction(tx => writeLobbyEffects({ tx, effects: [['ai-reviews', [{ id: 'mbenign', from: 'Alpha', ch: '#stalemate', text: 'Benign AI review', at: NOW, model: 'synthetic', categories: ['harassment'] }]]], incidentSources: true, now: f.now() }));
        expect((await f.index()).entries).toEqual([]);
    });
    it('never touches source records for costsOnly/non-queue effects and refuses allocation at the safe-integer ceiling', async () => {
        const f = await fixture(); f.driver.resetOperations();
        await f.authority.records.transaction(tx => f.authority.writeParticipationEffects({ tx, effects: [['net', f.initial.net]], costsOnly: true }));
        expect(f.driver.stats.operations.some(event => logical(event) === SOURCES)).toBe(false);
        await f.put(SOURCES, { v: 1, nextGeneration: Number.MAX_SAFE_INTEGER, entries: [] }); await people(f); const line = await f.say('Alpha', 'Benign exhausted generation'), before = await f.queue();
        const result = await f.engine.message('Bravo', JSON.stringify({ t: 'report', id: line.id })); expect(result.ok).toBe(false);
        expect(await f.queue()).toEqual(before); expect((await f.index()).nextGeneration).toBe(Number.MAX_SAFE_INTEGER);
    });
    it.each(['', null, 'unknown'])('fails closed for invalid configured mode %s before any initialization', async mode => {
        expect(() => lobbyIncidentSourceMode({ HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_INCIDENT_SOURCE_BRIDGE: mode })).toThrow();
    });
});
