# Controlled participation enforcement (C3)

October 25, 2026 application slice. This connects the C1 evaluator and C2 ledger
to actual engine mutations in an injected synthetic fixture. **No production
route supplies this adapter.** It does not activate child enrollment, guardian
contact, public identity, providers or an all-ages release. Existing 13+ admission
and 18+ camera checks remain. The qualified operator/consent/rights process and
real hosted implementation are still prerequisites.

## Optional boundary and actual hooks

Absent `createLobby({participation})`, the protected beta keeps its current
synchronous engine path and existing guards. A configured invalid/unavailable
adapter does not fall back to ordinary persistence or affirmative permissions.
The controlled adapter performs fresh validated C2 reads, then C1 checks inside
the real handlers. Nicknames, frame booleans, website badges, device reuse and
room/staff roles cannot create participation authority.

Hooks cover public text (including actions/quick lines and held approval),
nicknames/badges/away/topic artifacts, room creation/registration, PM request and
acceptance/delivery with both peers, camera opt-in, RTC peer reception, and watch
publication/reception. Existing membership, host/owner/moderator powers, content
filters, room modes, age checks, quotas and global safeguards still apply.
Participation is an additional ceiling. Reports, blocks, privacy withdrawals,
camera-off, leave and existing moderation safety actions are not consent grants.
Configured quit uses a generic reason so leaving cannot publish an unqualified
free-form message.

Watch snapshots/updates omit video for recipients without media reception and
qualified external-provider permission. Camera signaling checks the sender's
camera permission and the receiving peer's media permission. Audio-bearing SDP
requires both peers' audio permission, retained for later ICE checks. The current
browser capture uses `audio:false`; these signaling checks do not qualify native
WebJam audio or control an independent native/P2P session.

## Required trusted adapters

`createParticipationEnforcement` requires injected transactional storage,
`resolveConnection`, commit-side `validateConnection` and `writeEffects`.
`readParticipationPrincipals` is a server-only C2 accessor: it validates the
stored policy/subjects/active grants in an existing transaction, returns no raw
guardian verification/contact records, and never nests `ledger.lookup()`.

`resolveConnection` authenticates outside the effect transaction and supplies
only principal/community references and a finite identity expiry. It must not
map a nickname or copied device token to guardian approval. Prepared bindings
are capped by subject expiry, session identity expiry and policy max-session
duration. They are internal and are not sent in People/chat frames or trusted
from restored client fields.

`validateConnection({tx, connection, identity, at})` must use authoritative
current session/staff state inside the same commit fence. It must bind the
session/device/account/principal/community and current role/admin/capabilities,
not merely return true for a matching principal. The fixture proves expiry and
staff downgrade during awaited writes are denied. A remote authentication
service needs a real commit-side revision fence; a preflight lookup is not one.

`writeEffects({tx,effects,costsOnly})` receives bounded `[kind,value]` effects.
The production owner must map known kinds to approved rows, enforce provider
value/transaction limits, and keep all required writes atomic with current C2
and session revisions. A failed or ambiguous commit cannot acknowledge success.
No production implementation is supplied. The fixture uses one serial staged
store shared with the real C2 ledger; two unrelated databases/writes do not
satisfy this contract. Startup restoration that can write is also staged;
configured callers must await those restoration methods before accepting work.
Other trusted restoration initializers must run before live traffic.

## Staging, rollback and budgets

Configured actions stage **all** persistence, including moderation/log effects,
outgoing frames, closes, presence markers and classifier callbacks. Required
session-size failure propagates to the outer operation, preventing a room/log
commit when its required session state exceeds the existing 2 MiB limit.
Grouped revision/session checks run before and after awaited effect writes;
only a confirmed commit releases output or provider work.

A bounded transient checkpoint preserves original Map/Set/array/object identities
and aliases, including pending PM bodies and channel/line identities. It is never
stored or exposed. Full capture has defensive ceilings of 8 MiB logical bytes,
100,000 traversal units and 50 ms; these are not physical runtime-memory or
throughput guarantees. Exact receipt accounting and the stats dirty marker are
restored; sequence/generation counters can conservatively skip values.
Consumed frame/request/rate/chat/activity/device/IP allowances are not refunded,
and unpublished `lastText` bodies are not retained on denial.

Verified safety paths use an action-specific checkpoint that retains untouched
`room.act` graphs by identity without traversing/copying their internals. Those
paths cannot mutate activity contents; arbitrary actions and `tick` retain full
capture. A regression builds valid bounded creative state exceeding full capture
and still completes report/block/leave. Capture limits do not justify increasing
old storage/frame/room caps. Incoming frames are charged before capture or busy
refusal, and the classifier bounds input before parsing.

One operation stages at a time. A separate bounded queue accepts up to 16 safety
jobs, each at most 64 KiB of arguments, behind it. Queue-full/busy responses do
not claim a report was accepted. The owner must provide bounded adapter latency,
request admission and cleanup/retry handling; this slice does not make a hung
external service cancellable. Failed safety commits restore semantic state and
return unconfirmed failure. If rollback itself fails, the instance is quarantined,
all sockets close, every queued promise settles unavailable, and no potentially
uncommitted semantic snapshot is persisted as a cost update. Discard/recover that
instance from authoritative committed storage; do not publish its memory.

## Withdrawal, active media and provider start

Every newly controlled mutation rechecks current subject/policy revisions at
commit. Tests commit C2 withdrawal/policy change while work waits before the
effect transaction, then prove no room/artifact/log/receipt/PM or success frame
escapes. Restored metadata and a new device cannot recover a withdrawn grant.

The owning withdrawal/session service must call and await
`engine.refreshParticipation()` after a committed permission change, with a
bounded retry/acknowledgement path if notification fails. The method removes PM
grants and tears down active browser media sessions whose required purpose was
lost, using a socket close/rejoin. Existing frontend close handling clears its
capture, peer connections and watch iframe. Media-only withdrawal preserves
remaining chat eligibility and room ownership; a new authorized join receives
filtered media. Restored active media whose old binding cannot be reconstructed
requires rejoin. This model does not promise instant distributed fan-out,
unseeing delivered content, deleting peer recordings or terminating independent
native sessions.

Classifier work is optional and starts only after the effect commit. The trusted
callback must forward `beforeDispatch` and `startDispatch` into the real
`createAiModerator.review` adapter. Its durable quota reservation happens first,
then the fresh guard, then a final start fence. A timeout/false/nonboolean/late
guard cannot initiate an HTTP request; quota remains conservatively spent.

AI qualification requires an explicit injected non-retrying `dispatchStart`
fence. It must share withdrawal/session ordering, call `validate(tx)` against
current state, then invoke `start()` synchronously exactly once while that start
is fenced. **Do not place irreversible HTTP inside a retryable transaction.**
The final start ticket checks policy/binding expiry synchronously again; merely
awaiting an earlier authorization is insufficient. The fixture implements this
with a non-retrying serialized read/start critical section and releases it after
the request begins, without waiting for the response. No production fence is
provided, so production AI activation remains unqualified. A request already
started cannot be recalled. Late results cannot revive a changed participant
revision or create a participation grant.

## Evidence and remaining qualification

Focused synthetic tests exercise real C1/C2 subjects and actual engine actions,
atomic withdrawal/policy/session races, bounded safety pressure/queuing,
quarantine, badges, PM/media and provider boundaries, restoration/device denial,
and required-session capacity without raising limits. Checkpoint tests cover
identity preservation, opaque safety boundaries and resource rejection. No real
guardian, evidence, provider request, browser media, Cloudflare runtime or public
route is exercised by those fixtures.

Configured C3 prepares a fresh author view for ordinary public text; private
contact, media, commands and other actions retain connected-peer preparation.
See [the dependency selection contract](HANGOUT_PARTICIPATION_READ_SCOPE.md).
Ledger, transaction and checkpoint copies remain. **The earlier 150-client beta load does not
qualify consent-enabled C3 throughput, latency, memory, request or storage cost.**
Any such benchmark needs stable source, its own bounded local evidence and an
owner-approved hosted plan. The C2 ledger's defensive subject count is also not
a selected public-community capacity.

Next handoffs remain qualified operator policy/consent/rights decisions; real
public authenticated identity and guardian verification; atomic session/C2/effect
storage and non-retrying dispatch-start adapters; reliable withdrawal fan-out;
client capability/consent UX and actual hosted/accessibility/device journeys.
StoryPool 10-21-26 retains core, Karen, deployment/admission and operational
ownership. This work changes none of those systems, retrieves no credentials,
enrolls no real person and enables no provider or public child entry.
