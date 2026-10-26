# Private-beta sessions and Lobby effects in one authority

This candidate integrates the existing private beta with a transaction-local
session fence. It does not qualify an all-ages policy, guardian consent, incident
authority, provider dispatch or public release. Application validation and review
must finish before rollout. No active Wrangler configuration enables this mode.

## Explicit mode and trust boundary

| `HANGOUT_SESSION_AUTHORITY` | Behavior |
| --- | --- |
| Unset | Existing separate beta registry behavior, retained for the receiving owner's staged rollout. |
| `lobby-v1` | Canonical `LOBBY/stalemate` handles session issuance/checks, room registration, revocation and Lobby effects. Missing or corrupt authority refuses access; it never falls back to the old registry or creates a new community. |
| Any other nonempty value | Refused configuration. |

Both website entrances continue to reach this one community. Entry badges remain
optional display context and grant no identity, room ownership or staff role.
The mode does not add cross-domain cookies, account linking or federation.

Actual beta admission verifies the first-party signed access cookie. Optional
owner/staff identity also needs the existing verified sign-in proof and expiry.
The local issued SID record retains a bounded account-HMAC profile, not a
plaintext email or a browser-supplied role. A stored profile cannot turn an
ordinary guest entry into moderator admission. Staff roles are checked against
the current configured allowlists as well as the issued profile.

Server-created connection bindings tie an actual connection ID to its SID,
version, device, IP hash, account, role, expiry and authority reference. Engine
session snapshots contain hibernation preferences/membership, not authority.
Wake-up accepts only independently validated surviving sockets; missing,
rejected and lost sockets must lose their durable connection bindings.

## Commit, evidence and revocation

The engine's independent `effectCommit` hook uses its existing rollback
checkpoint and staged output. Current session/role validation and the actual
room/net/session/report/log writes share one supplied rollback transaction, with
validation repeated after the last real write. Only a successful commit releases
frames, acknowledgments and presence. Actions without a participation-purpose
check, including moderator refresh and report completion, still get this fence.

Qualified C3 participation grants can impose additional restrictions in the same
transaction. This integration does not invent such grants. Existing private-beta
age/media safeguards remain while the all-ages replacement is qualified. Safety
cleanup and conservative rate costs are distinct from granting a revoked client
new effects or private evidence. Costs cannot restore identity authority or
publish a failed action.

Selected private report queue writes also use the local fence; guarding a later
completion frame alone would leave the underlying report mutation unprotected.
Ordinary chat and PM bodies remain ephemeral. Narrow selected report evidence
has its existing purpose and retention; this change is not incident encryption,
lawful-hold, backup-deletion or legal qualification.

Revocation commits a durable tombstone and closure work before socket shutdown or
outbound work. Local binding retirement prevents newly sent frames reaching a
revoked passive socket. Room fan-out occurs after leaving the authority event
gate and storage transaction, with the existing eight-second attempt deadline.
A stale/late response cannot confirm a newer closure attempt. Pending closure
survives failures and restart for bounded alarm retries.

This makes Lobby decisions local; it does not make a different private Room or
peer-to-peer media one atomic transaction. Remote disconnection, browser capture
and already delivered content have separate limits. Provider dispatch, including
AI and TURN in the new mode, remains unavailable until its own start fence and
provider requirements are qualified.

## Initialization, migration and rotation

The application exposes explicit binding-only initialization/migration controls;
neither public gateway forwards their paths. They are deployment-owner tools,
not visitor or moderator actions. A request parameter, marker or test fixture
does not establish that old deployed writers actually stopped.

Before any activation the receiving owner must inventory existing bindings,
namespaces, IDs, HMAC/account continuity, data and running writers; preserve a
recoverable copy and independently verify a full writer/socket/in-flight drain.
`HANGOUT_OPEN=0` alone is insufficient because it does not fence every issuer,
staff route or old private Room. Preserve every operational hold and review rule.

Known-new initialization refuses known legacy Lobby, report and budget state.
A first known-empty startup can be quarantined because no authority exists yet.
Only successful binding-only `initialize`, with no prior engine, sockets, live
bindings, pending admission/retirement or scheduled retirement retry, may retire
that quarantine. The actual empty-domain transaction and full awaited restore
must succeed; a fresh engine, unchanged opaque failure identity, ready private
queue and ready queue projection, cleared maintenance actor and repeated
quiescence are required before evidence storage becomes ready. Encoded queue
failures still refuse completion. Ordinary startup, alarms, migration, rotation,
duplicate initialization and preexisting engine failures never clear degradation;
a later failure immediately marks it degraded again. This is not an old-writer
drain, migration, data repair or general recovery mechanism.
Migration requires validated existing Lobby state and an actual read-only old
registry export. Every nonexpired old SID must be revoked with closure confirmed.
The export does not perform that drain. Existing mint budgets are copied rather
than refunded. Original raw state remains available for controlled recovery;
new-mode ordinary startup never interprets missing state as empty.

Explicit migration alone preserves the original legacy loader's defaults for
legitimately absent optional rows: no AI reviews, no moderation selections, empty
abuse/session metadata, and an empty private report queue. An absent room
aggregate means no rooms only when no indexed or raw room rows exist. Present
malformed records and a missing required network record are refused. These
legacy defaults never apply to missing records in the initialized new format.

Room IDs, ownership, bans, budgets, selected reports and moderation history must
be retained. The log conversion explicitly maps legacy individual records to
the bounded versioned segment format. Legacy SIDs/attachments are not imported
as new identity authority. Partial failure rolls back and must leave admission
closed. Large migrations beyond measured transaction bounds are refused; they
are not permission to raise limits or delete records.

The durable marker pins an admitted invite version and increasing generation.
Ordinary operations require the environment and marker to agree. Explicit
rotation requires old-session closure/cleanup and no surviving connection
bindings, preserves mint budgets and refuses reuse of an admitted version.
Changing or rolling back environment values cannot silently re-admit old SIDs.

Rollback is a receiving-owner procedure for matched code/assets, authority,
bindings and data. Simply turning off the mode is not a qualified rollback:
the previous global registry and the new local authority are different stores.
Never restore active old cookies/tombstones, change HMAC keys or create another
namespace to make a failing startup appear healthy. Revalidate every previously
stated recovery and ownership invariant against the actual rollback target.

## One alarm and runtime constraints

The same object coordinates Lobby tick, selected-report/log maintenance, session
expiry and revocation retries. An empty registry cannot delete the Lobby alarm.
Processing and queues stay bounded; at-least-once alarm delivery is expected.
The physical transaction ceilings remain 4,096 operations, 32 MiB reads and
16 MiB writes, including the shared native handle. No cost or production limit
increase is part of this change.

Startup recovery requires its trusted caller to hold the actual DO event gate
for the entire operation. It enumerates up to 16 SID/binding records per batch
and validates at most 16 bindings in each bounded native transaction. It validates
the real domain through bounded read-only handles and
checks initial/final metadata and configuration agreement before publishing the
recovered state. A mode flag or matching snapshot does not establish writer
exclusion. Mutation and effect commits remain one native transaction; paged
startup does not split their authorization fence across transactions.

Cloudflare documents storage as local to a single object, so a remote registry
check does not create a cross-object transaction. The application consequence is
co-locating the session decision and Lobby effects.
[Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

Expected write failures must escape the transaction for rollback, then be caught
inside the event gate; an uncaught `blockConcurrencyWhile` callback can reset the
object. Outbound fan-out must not hold that gate.
[Object state](https://developers.cloudflare.com/durable-objects/api/state/)

Each object has one alarm, and a new alarm replaces the old schedule. Alarm
operations follow storage rules and delivery is at least once. This requires one
composed scheduler and idempotent durable retry state.
[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Validation and ownership

Focused engine tests, disk SQLite authority tests and actual gateway/Lobby tests
must prove final-write denial/rollback, no-purpose moderation fencing, role
changes, migration refusal/retention, version rollback, cold binding retirement,
failed upgrades, bounded retry and absence of ordinary bodies. A spy fence or
mode flag alone is not end-to-end evidence. Local workerd proof must identify
actual source, runtime, post-write faults, process loss/recovery and cleanup.

Automated Node/Chromium/WebKit and local workerd checks do not qualify physical
phones, actual screen readers, hosted Cloudflare/Access behavior, platform
installation, native music/audio, provider/legal requirements or whole-community
capacity. Preserve those separate acceptance requirements and current evidence.

This session owns application source/design/tests/PRs. StoryPool 10-21-26 owns
core, Karen administration, actual deployment/drain and shared operational files.
No live configuration, deployment, core/poller, credentials, holds/locks, signing
trust or paused TURN/vault work is changed here. No purchases or public launch.
