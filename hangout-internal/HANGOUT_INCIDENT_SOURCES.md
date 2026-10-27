# Selected public report sources on the lobby transaction

I3a is an initially inactive application bridge between delivered-message reports
and the existing I1 `loadEvidence` contract. It adds no incident route, appointment,
case-policy decision, purpose key, legal hold, provider or public all-ages
activation. Existing reports retain their ordinary 24-hour expiry and moderation
controls. No additional chat or PM transcript is stored.

## Configuration and activation boundary

The optional `HANGOUT_INCIDENT_SOURCE_BRIDGE=i3a-v1` setting requires protected
beta mode and `HANGOUT_SESSION_AUTHORITY=lobby-v1`. Unknown, empty or incompatible
settings fail closed. With the setting absent, new lines, delivery receipts and
reports retain their previous unstamped formats. New readers strictly preserve
valid optional stamps already present; they do not relabel legacy reports.

Explicit known-new lobby authority initialization can initialize the source
namespace when the setting is deliberately supplied. The separate
`initializeLobbyIncidentSources` helper requires an absent namespace and the
actual matching ordinary queue in the supplied transaction, with no stamped
rows to backfill. Neither ordinary startup, a read nor an effect write calls an
initializer. Missing or corrupt source state is an error, never an empty index.

An initialized source namespace requires this mode for subsequent recovery and
report writes. Removing the setting cannot silently downgrade the domain or
reset its generation. No downgrade/migration path is supplied. An operator must
qualify writer exclusion, drain, matched source/schema rollback and recovery
before activation; an older reader is not claimed compatible with new stamps.
No deployed configuration is changed by this source addition.

## Public provenance comes from original delivery

A `#` name alone does not establish public visibility. When this mode is enabled,
`publish()` checks the server's current public-channel decision at the moment of
accepted delivery. It adds only an internal `publicOrigin: {v:1, at:<delivery-time>}` stamp to delivery metadata, not to the line sent to visitors. Invite-only,
keyed and locked-room delivery is unstamped. PMs and undelivered held/AI/private
report queues cannot become public sources.

A held message may qualify only after it is actually approved, published into a
public room and then reported by a recipient. The stamp uses approval/delivery
time, which can be later than composition time. A room becoming private later
does not rewrite an earlier public delivery; opening a formerly private room
does not upgrade its earlier lines.

Receipts use a distinct v2 digest domain when the optional stamp is present. The
digest binds the exact selected text, existing immutable delivery fields and
stamp. Session restore preserves strictly validated stamps, and reporting after
volatile line loss rechecks the receipt digest and actual recipient. A browser
can supply only the exact quote for that check; supplied provenance fields are
ignored. Existing v1 receipts remain ordinary report witnesses without gaining
public incident provenance.

## One transaction for queue and source metadata

`writeLobbyEffects` reconciles the source index at its validated
`moderation-queue` branch, within the same supplied lobby-v1 native transaction.
Both ordinary session-fenced effects and optional C3 participation effects use
that writer. The DO's required-persistence fallback uses the same composed writer.
No source update runs later from a cached admin or engine snapshot.

The single logical record `lobby-incident-sources:v1` stores only
`{v, nextGeneration, entries}`. At most 100 active entries each contain source
message ID, revision, selected-text SHA-256, an immutable-origin fingerprint and
ordinary expiry. The fingerprint binds authoritative message/channel/author,
report and original-delivery time and selected text digest. It stores no raw
reporter/device/IP values, context, entry-site trail or body. Existing ordinary
queue fields are not copied into an extra evidence archive.

A durable monotonic generation allocates every insertion or immutable-origin
replacement. Votes, hidden state and neighbouring context do not change a
selection's version. Removal deletes active metadata while retaining the counter;
reinserting the identical ID and body gets a new revision, including after a
restart. Counter overflow fails closed. Ordinary non-queue effects and denied
cost-only writes do not mutate this index. Expired queue rows can remain indexed
until actual queue maintenance; the loader independently refuses them at expiry.

`authority.loadIncidentEvidence({tx, sourceId})` is the production I1 callback.
It reads and validates the current ordinary queue and exact source metadata using
I1's transaction handle, then returns only `{id, revision, digest, bytes,
expiresAt, provenance:'reported-public'}` for one current selection. It never
uses browser bytes, current room privacy, a cached report or a replacement quote.
An I1 caller still supplies separately qualified authority, policy, purpose-key
and initialized case state. No ordinary moderator becomes an incident reviewer.

A source removal that commits first makes a new preservation unavailable; an I1
copy that commits first remains separate encrypted case evidence after ordinary
source removal. A failed source write rolls back the report and staged report
acknowledgement. A failed case write rolls back case/evidence/audit/receipt state
and leaves the ordinary source untouched. This is one shared rollback domain,
not a pair of unrelated successful writes.

## Verification scope

The new SQLite integration tests drive the actual engine, lobby-v1 authority,
physical record codec and effect writer. I1 uses a synthetic appointment/policy
and ephemeral test-only purpose key. Tests cover delivery privacy transitions,
held approval, restored receipt binding/tampering, selected UTF-8 only, source
incarnations and disk reopen, dismissal/purge/delete/expiry ordering, native-write
faults, expiry, corruption and inactive/default behavior. These tests do not
qualify real appointments, key recovery, legal retention decisions, hosted
alarms, deletion across backups, external notices or public all-ages readiness.

The separate `test:lobby-session-runtime -- --incident-sources` command is wired
into the application runtime CI workflow with distinct raw artifacts. It retains
the existing default native checks and tests real source/I1 composition and
process recovery using synthetic incident authority and a private parent-held
test key. Source-index/case-write fault injection remains explicitly SQLite-unit
scope. A green default or C3 runtime command does not qualify this separate mode,
and fixture ciphertext reload does not qualify real purpose-key recovery.
