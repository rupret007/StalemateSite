# Restricted selected-report incident primitives

Application slice I1, October 25, 2026. Implemented as an isolated module and
benign synthetic tests. It is not connected to the lobby, public or staff routes,
an incident interface, a deployed store, real evidence, external notifications,
AI or a reporting authority. It does not establish legal compliance, enable
all-ages access or appoint anyone. Read
[the all-ages/incident design](HANGOUT_ALL_AGES_CAPABILITIES.md) for unresolved
operator, consent, staffing, legal and release requirements.

## Implemented boundary

`hangout-worker/src/incident-cases.mjs` exports `createIncidentCases`,
`createIncidentEvidenceCipher`, `incidentEvidenceDigest`, implementation ceilings
and an explicit first-provisioning state constructor. There are no imports from
the lobby, public routing, ordinary staff state, health responses or operational
systems. No enumeration/export interface is provided.

Only an authoritative injected loader can supply selected bytes. A preservation
request supplies a source ID, expected revision/digest and case type; unknown
fields, replacement transcripts, client deadlines and role booleans are refused.
The loader returns the current source ID/revision/digest, exact `Uint8Array`
bytes, finite source expiry and one provenance label. The model independently
checks the selected bytes' SHA-256. `unverified-private-allegation` remains an
allegation; copying it does not verify its contents. Only that selected evidence
is copied. No history discovery, remote fetch, media download or scanning is
implemented.

Evidence is encrypted separately from restricted metadata using a caller-supplied
AES-GCM key. The helper requires a non-extractable secret key with encrypt/decrypt
usages, a bounded key ID and a fresh random 96-bit IV. Authentication binds the
purpose string, case/evidence references, immutable source identity, provenance
and collection time. A wrong key/context or modified ciphertext cannot return
evidence. Neither key material nor plaintext is stored in the case/audit ledger.
Metadata, source references, ciphertext and digests remain sensitive and require
restricted storage. A SHA-256 digest is an integrity binding, not anonymization.

Key purpose/provenance is an operator contract: the code can reject a signing
key, but cannot prove that someone never used the supplied AES key elsewhere.
There is no key retrieval, vault access, export, HMAC-key reuse, rotation or
backup-key implementation. Tests generate ephemeral synthetic keys in memory.

## Authority and policy contracts

`resolveAuthority({tx, principal, at})` must resolve an authenticated principal
from trusted server state, returning a current explicit incident appointment:
opaque `actorRef`, `incidentReviewer: true`, `active: true`, monotonic `revision`
and finite `expiresAt`. `canOpen` separately permits opening cases; `canMaintain`
permits content-free receipt maintenance. Caller-supplied actor/role/badge
objects are not authenticated principals. The module does not treat ordinary
moderator, band, room-host, guardian or integration privileges as an appointment.

Each case starts with only its opener in the ACL. Every case read/change checks
both the current appointment and ACL. ACL changes may name only currently
appointed actors, retain the acting handler and use an expected case revision.
`resolveReviewer({tx, actorRef, at})` authoritatively checks named assignees.
Appointments and assignee revisions are checked again after asynchronous work.
Removing an actor from a case or revoking an appointment prevents later access;
knowing a case ID or operation ID grants no evidence access. Missing and
unauthorized case lookups both return `forbidden`.

`policyFor({tx, action, at, request, case})` is an injected, qualified decision
adapter. No real policy is bundled. Its strict versioned response supplies:

- Qualified status, policy/procedure/authority/reason codes, and validity window.
- Explicit review, optional hold, evidence-deletion, case-deletion, tombstone,
  idempotency-receipt and audit deadlines, all finite integers.
- Explicit byte, case, evidence-size, audit, operation and tombstone limits.

Policy is rechecked before and after the final awaited state write using the
same original request/case decision context. After the last awaited authority,
assignee and policy lookups, a synchronous barrier uses fresh wall time to
validate appointment/policy/source/evidence/receipt expiry. No state write follows
that final barrier. A late staged write or lookup refuses success/plaintext at
the operation's transaction/write fence and rolls back staged audit, receipt
and case changes. No-write retries use the same final barrier. This depends on
the same-domain transaction contract below; it does not promise network delivery
before expiry or qualify backend commit latency or independent revocation
ordering outside that contract. A changed decision, stale qualification, missing
deadline or malformed budget refuses the operation. Source expiry cannot outlive
the initial idempotency/tombstone protection. Starting/extending a hold requires a future
deadline; extension cannot silently shorten existing evidence/case retention.
There is no fallback retention duration, implicit forever-hold or default legal
authority. The reason/authority codes are policy references, not legal findings.

The exported hard ceilings are defensive memory bounds, not selected production
quotas or a hosted storage guarantee. Tests use two cases, small byte limits and
short synthetic deadlines. The release owner must choose real budgets, per-actor
request/rate limits, bounded admission/transaction queuing and the overflow
escalation process. Full capacity returns `capacity`; it never evicts a case or
silently truncates evidence. If audit capacity is unavailable, even an evidence
read is refused rather than returning unaudited bytes.

## Atomic storage and source selection

The required `storage.transaction(async tx => ...)` contract is serializable,
isolated and rollback-capable across the whole asynchronous callback. The
transaction's `get`/`put` and the selected source loader must share that domain.
It must not resolve until the durable commit completes. The model reads current
ledger state for every operation; it does not trust a process-memory cache after
a failed or ambiguous write. `initialIncidentCaseState()` is only an explicit
first-provisioning value. A missing/wiped or malformed runtime record fails
closed; it is never interpreted as an empty incident database.

One committed operation includes encrypted evidence, case metadata/ACL, a
content-free audit event and an idempotency receipt. Success is returned only
after the transaction completes. Storage or key failure returns a failure, leaves
the ordinary source untouched and cannot evict accepted cases. An acknowledgement
lost after a real commit is reported as unconfirmed; retrying the same canonical
operation can recover its historical receipt without making another case.

Requests are canonically fingerprinted by action/parameters, independent of
object field order. An operation ID is bound to its original actor and request;
conflicting reuse is refused. Receipts describe a committed action/revision at a
past time, not a promise that evidence still exists now. Replaying a preservation
receipt after deletion cannot restore content. Current ACL/appointment checks
still apply; after full retirement the original appointed actor can recover only
its content-free historical receipt. Once protection receipts expire, the
authoritative expired source cannot be recopied using the old request.

Every replay must still be within its receipt deadline. Repeated case/evidence
reads additionally require an unchanged case revision; a newer revision needs a
fresh operation and audit entry. A legitimate metadata retry reproduces the
original receipt's point-in-time view, including time-derived review/due flags.
Use a fresh operation for current metadata. An evidence retry reauthorizes and
checks current retention, even when its original read succeeded. It cannot
return bytes after their deadline merely because an old receipt exists.

This transaction contract is **not yet provided by the existing report queues**.
A loader reading a cached engine map or ordinary queue snapshot cannot claim
atomicity with dismissal, purge or expiry. All such updates must participate in
the same serialized transactional source/revision protocol. A separate source
service requires a reviewed durable handoff/reservation/acknowledgement design.
Two unrelated successful writes are not an atomic preservation operation.

Authoritative appointment/policy changes must likewise share the transaction or
provide a version fence at commit. The final asynchronous recheck closes tested
in-flight races; it cannot make an unrelated external authority service atomic
after that check. Transaction retry callbacks must have no irreversible external
side effects. No notification, provider dispatch or real report submission is
part of this model.

## Review, holds and deletion

The independent states are review (`open` → `triaged` → `closed`), preservation
(`none`/`active`/`released`) and evidence (`present`, derived `deletion-due`, then
`deleted`). Every mutation uses an expected case revision. Closing review does
not release a hold. A hold extension or release is a separate authorized policy
decision with its own reason, revision and committed audit event.

An active hold blocks cleanup even after its recorded deadline; metadata marks
it `holdOverdue` for qualified human resolution. It is not silently extended or
automatically released. Review deadlines similarly produce `reviewDue`. This
slice does not implement reminders/staffing or claim that leaving an overdue
case unresolved satisfies retention obligations.

After an explicit release/no hold and the applicable evidence deadline,
`cleanupCase` deletes the ciphertext, immutable source reference and evidence
identifiers. Necessary review metadata/ACL may remain only for the separately
supplied case deadline. Once review is closed and that deadline is due, cleanup
removes the case and ACL, leaving a bounded content-free deletion tombstone and
operation/audit receipts. Receipt maintenance requires its separate appointment
permission and qualified policy; it removes only records past their explicit
deadlines, never live case evidence or an active hold. Cleanup never runs
automatically on missing/invalid policy.

Plaintext evidence access stops at its evidence-deletion deadline before cleanup
runs, unless a currently active, unexpired authorized hold applies. The check is
repeated after asynchronous decryption and authority/policy checks. An overdue
hold still blocks destructive cleanup pending qualified resolution but does not
itself justify plaintext access beyond the evidence deadline. Restricted
metadata and authorized cleanup remain available under qualified policy.

The committed audit stores bounded operation/case/actor references, appointment
revision, action, policy reason/authority codes, before/after revision and time.
Applied finite review/hold/deletion deadlines are recorded as well, so a hold
extension preserves the earlier and later authority/deadline decisions.
It contains no evidence, source quote, nickname, contact detail, invitation,
device/IP history or encryption key. Failed/denied operations do not create a
successful audit entry. A future operational rejection counter/escalation path
must remain content-free and bounded; do not log arbitrary caught exceptions.

Active-store deletion does not erase backups or already disclosed copies. The
storage/release owner must qualify backup retention, key recovery and restoring
committed tombstones/hold changes before access resumes. The logical state here
is a bounded single record; any physical row/chunk mapping and provider value
limits require a separately tested transaction adapter, not a blind deployment
of the implementation ceiling.

## Current API and evidence

The returned primitive exposes preservation, review transition, hold change,
ACL change, restricted case/evidence reads, case cleanup and receipt maintenance.
Case views omit ciphertext. Evidence reads return bytes only to the separately
authorized caller after their audit transaction commits. No public response,
download/preview UI, browser cache, broad staff broadcast or external export is
provided. Integrators must preserve that separation and clear any future case
UI after authority loss/disconnect.

`tests/unit/hangout-incident-cases.test.js` uses only benign synthetic reports and
an isolated serial transaction fixture. It covers exact source binding,
provenance, authenticated encryption/context/tampering, ordinary-role denial,
per-case ACL/revocation, no success before commit, lost-ACK restart recovery,
quota/storage/key failure, policy/missing-store refusal, async authority/policy
races, copy versus source dismissal, source expiry, review/hold separation,
finite extensions, stale concurrent revisions, deletion/receipt cleanup and
replay without resurrection. These are application-model tests, not production
storage/Access, legal, staffing, hosted recovery or active incident-UI proof.

StoryPool 10-21-26 retains core, Karen, deployment/admission, locks/holds and shared
operational ownership. This slice changes none of those systems, obtains no
credentials, appoints no handler and processes no real incident. Required next
contracts are the qualified operator policy, explicit appointments, production
transaction/source adapter, purpose-key provisioning/recovery, operational
deadlines/overflow response and separately reviewed I2 interface/activation.
