# Lobby effects on a supplied durable transaction

`hangout-worker/src/lobby-effect-records.mjs` maps the Lobby's real effects and
recovery inputs onto the logical record API from `durable-record-storage.mjs`.
It is an application integration component. No production route, alarm or
provisioning path activates it in this change. Trusted connection/session,
guardian and incident authority remain separate unfinished integration work.

The caller must supply one rollback-capable transaction shared with its current
authority checks. The adapter never starts a nested transaction, calls a network
service or publishes a frame. Exceptions must leave the transaction callback;
catching an application validation failure inside that callback is not a promise
of rollback. C3's existing commit path propagates these failures and releases
staged output only after a successful commit.

## API and stored records

| Operation | Contract |
| --- | --- |
| `initializeLobbyEffects({tx,state,now})` | Explicit initialization of an independently established, known-new domain from complete validated snapshots. Refuses existing marker, known records, indexed room rows and legacy log rows. It is not a migration or an authorization decision. |
| `writeLobbyEffects({tx,effects,costsOnly,now})` | Writes the engine's exact known effect kinds. Validates incoming and existing scalar records, room/index relationships and log structure. All operations use the supplied transaction. |
| `readLobbyState({tx,now})` | Returns explicit inputs for the engine's restore methods. Refuses missing/corrupt initialized records, missing or extra indexed rooms, incompatible legacy aggregates/logs and malformed/missing/orphan log segments. |
| `pruneLobbyEffectLogs({tx,now})` | Explicit bounded log maintenance. Its caller must supply the authorization and transaction fence; no production alarm invokes it here. |

Initialization requires `net`, `rooms`, `abuse`, `sessions`, `moderationQueue`,
`aiReviews` and `modlog`. Normal writes accept only `net`, `rooms`, `abuse`,
`sessions`, `moderation-queue`, `ai-reviews` and `modlog`. Unknown fields/effects,
unsupported JSON, accessors and serializers are refused instead of silently
retaining arbitrary message bodies or invoking caller code.

These presence checks inspect logical records visible through the supplied
handle. The physical codec's namespace does not expose unrelated raw provider
keys. An empty logical namespace therefore does not prove that deployed legacy
state is absent or that old writers stopped. The caller's independent known-new
proof, raw-state inventory and writer drain cannot be replaced by this marker or
these checks.

| Logical key | Content |
| --- | --- |
| `lobby-effects:v1` | Versioned layout marker. Its presence does not establish identity, consent, writer exclusion or recovery authority. |
| `room-index` | Existing `{version:1,names}` room index. |
| `community-room:<channel>` | Real room metadata, including ownership, grant-time account bindings and bounded creative state. Removed rooms and their physical chunks are deleted in the same transaction. |
| `net`, `abuse`, `sessions` | The existing engine snapshots and their existing field envelopes. Session rows are hibernation metadata, not trusted issuance or role authority. |
| `moderation-queue`, `ai-reviews` | Existing narrowly selected report/hold/review envelopes; no new AI activation or general transcript archive. |
| `lobby-log:v1:index` | `{version:1,next,segments:[{key,count}]}`. |
| `lobby-log:v1:segment:<16-digit sequence>` | `{version:1,entries:[{seq,entry}]}`; each entry retains the existing six fields: `at`, `by`, `action`, `target`, `reason`, `ch`. |

`costsOnly` accepts only abuse/net/session snapshots and does not read or change
log records. Ordinary non-log effects likewise avoid log traversal. Actual log
additions and separately authorized maintenance enforce existing retention.
Budget request counts may be fractional; room-first device allowances may omit
chat fields. These valid engine states are preserved.

There is no ordinary chat or PM body field in session metadata. Pending PMs keep
only their existing endpoint/device/time/first-message-present metadata; receipts
keep digests and delivered connection IDs. Recovery must receive independently
validated surviving socket identities before `restoreSessions` may restore
membership or preferences. A stored nickname/role is not new admission authority.
Selected reports and held messages have a different, restricted evidence purpose.
This adapter alone does not implement incident encryption, lawful holds, provider
qualification, deletion across backups or all-ages consent.

## Bounded logs and recovery

Segments contain at most 64 entries, with at most 32 packed segments and 2,000
logical entries total. The transactionally persisted sequence allocates entries
without randomness or external work in retryable callbacks. TTL maintenance
filters expired entries anywhere, trims to the count bound, repacks, deletes
obsolete segments and updates the index atomically. It preserves original finite
timestamps when a clock correction temporarily makes them future-relative.
The existing 30-day log retention is unchanged.

Prefix scans use pages of at most four. Recovery cross-checks exact referenced
keys, counts and sequences and refuses orphans. It does not turn corrupt or
missing state into an empty community. No fallback to ordinary persistence is
allowed when the configured C3 path fails.

This is a **new physical log format**. Current production writes individual
`log:<timestamp>:<uuid>` rows. Those rows cannot simply be read as segments, and
the marker is not proof that old writers stopped. An explicit bounded migration,
verified writer/socket/in-flight drain, matched rollback and real binding/state
inventory remain required before activation. The deployment owner controls that
rollout; application-owned migration and trusted authority code remain to be
implemented and reviewed. Never wipe records, clear holds, change namespaces or
infer a new community from missing data to make startup pass.

The physical codec retains its 4,096-operation, 32 MiB read and 16 MiB write
transaction bounds. A real SQLite measurement with 2,000 log entries used 196
physical operations for initialization, 133 for fresh-disk recovery and 405 for
appending two entries and trimming to 2,000. These are fixture measurements, not
hosted throughput or cost guarantees. The 1,030-room bulk import regression
intentionally exceeds the unchanged operation ceiling and rolls back. Maximum
room-size migration/recovery is not qualified by small-room tests.

## Verification and integration limits

`tests/unit/hangout-lobby-effect-records.test.js` exercises schema, retention,
corruption, privacy and physical-budget boundaries over actual disk SQLite and
the physical codec. `hangout-durable-participation.test.js` now uses this writer
instead of arbitrary `lobby:<kind>` records. Actual C2/C3 and Lobby engines prove
room ownership/membership, blocks, selected reports and bans after reopening the
database and creating a fresh engine. The consent, participant, session and
guardian authorities in that fixture remain explicitly synthetic.

Failure injection follows real room-row and log-index writes. Final authority
denial occurs after the last real effect write, without a synthetic fence record.
The failed transaction must roll back related records and release no success
frame. Separate tests verify obsolete room/chunk removal, corrupt prior-record
refusal, selected-only evidence, no PM bodies, full log recovery and no log work
on denied-cost or quiet non-log updates.

No hosted deployment, real identity/consent/incident appointment, alarm wake-up,
legacy migration, whole-product capacity, native audio or legal qualification is
established here. StoryPool 10-21-26 retains core, Karen administration,
deployments and shared operational-file ownership. Existing review/release
controls, paused TURN/vault work and platform trust remain in force.
