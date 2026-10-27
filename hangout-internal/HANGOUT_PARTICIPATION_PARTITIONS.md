# Partitioned participation records: application storage slice

October 25, 2026. This replaces the single aggregate as an **optional server
storage adapter**, using existing C2 transitions and the actual C3 enforcement
reader. No production route selects it. It does not enroll a real person,
qualify an operator/guardian process, enable a provider or complete public
all-ages readiness. Existing beta age/media and admission guards remain.

## Storage and atomicity boundary

`participation-partitions.mjs` stores one small global policy record and
separate records addressed by SHA-256 of the trusted community/principal pair.
Each subject record holds exactly one subject and its bounded consent history.
There is no whole-community subject array or larger aggregate subject limit.
The original C2 aggregate ceiling remains 64. The new per-record ceilings are
**one subject, eight guardians, sixteen receipts, sixteen pending records,
thirty-two operations and 65,536 logical JSON bytes**; these tighten the existing
C2 maxima. Full histories refuse further intake while retaining the existing
headroom and revision rules for reductions. They are defensive model limits,
not a chosen production retention policy or public capacity.

Policy, subject/peer records, session authority, uniqueness/routing indices,
allocation accounting and controlled lobby effects must share **one serializable
rollback transaction domain**. A transaction promise resolves only after commit;
rejection or ambiguous outcome cannot acknowledge success. The storage adapter
must provide `transaction(fn)` with transaction-local `get`, `put`, `delete` and
bounded prefix `list({prefix,startAfter,limit})`. Callbacks must not perform
external verification, HTTP, send frames or independently commit writes.

Cloudflare documents that a Durable Object's attached storage is private to that
one instance and that transaction operations use the transaction object. Its
transaction callback can be retried. Consequently separate Durable Objects do
not satisfy this interface merely because their keys have matching prefixes;
irreversible dispatch cannot run inside a retryable transaction. This adapter
partitions records, not Cloudflare object ownership or compute. A different
backend needs equivalent qualified transaction/session/revocation guarantees.
[Cloudflare SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Durable Object storage ownership](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/).

## Trusted API and identity

Create `createPartitionedParticipationConsents({storage,adapters,admitSubject,
releaseSubject?,now?,randomRef?})`. It exposes C2-compatible `installPolicy`,
`begin`, `complete`, `lookup` and `change`, plus bounded authorized `sweep`.
The four existing C2 authentication/verification adapters retain their exact
schemas. In particular a verified completion decision does **not** gain a
client-supplied community field. Completion and guardian reduction resolve the
immutable subject-reference index, then validate the same routing inside the
actual record transaction. Equal guardian principal names do not grant access
to another subject's distinct guardian reference/revision.

An anchor binds a principal's stable record key to its current subject. A missing
record with its prior anchor/index cannot become a fresh enrollment. Subject
references and operation references have community-wide ownership indices;
pending, guardian and consent references and verifier/decision pairs also have
bounded expiring uniqueness indices. Current live prior indices are validated
before a grant, including unchanged pending indices and no-write replays.
Changed/expired entries are updated or removed atomically. Expired references
can be reused according to the original retention rules; old cleanup cannot
delete a newer owner's index. Hash-key/embedded-reference mismatches refuse
the operation. Hashes are identifiers, not authentication or encryption; there
is no HMAC/account-key reuse or browser-selected partition authority.

`admitSubject({tx,principalRef,communityRef,partitionKey,at})` is mandatory and
must return exactly `true` after any required allocation reservation in that
transaction. It must use the supplied metered transaction and approved bounded
quota rows. This prevents free unbounded record creation. It does not create
legal consent or authenticate the caller. Failed allocation, state capacity or
commit leaves existing records and indices unchanged.

An optional qualified `releaseSubject` receives those same arguments only when
**all** subject, guardian, pending, receipt and operation retention has completed
and the record/anchor is actually deleted. A false/rejected release rolls back
data deletion and quota changes together. Active-storage quota can be reclaimed
exactly once through this hook. With no hook, lifetime admission/resource
accounting is retained deliberately. Withdrawal, lookup and partial cleanup do
not automatically refund consumed resources or free storage allocation. The
operator must choose the quota meaning rather than infer it from a counter.

## C3 and revocation

Supply `readPartitionedParticipationPrincipals` as the trusted `readPrincipals`
option to `createParticipationEnforcement`. Its default remains the existing
aggregate reader. The shared reader is used for prepare, both commit checks,
provider preflight and the final provider start fence. The existing C3
transaction/session/role validation, bounded staging/rollback, safety handling,
media refresh and non-retrying dispatch-start requirements remain in force.

The policy root changes in one transaction. Reads compare every relevant
record with that current policy in the same transaction, so an untouched record
cannot retain a grant under an older revision. Lazy alignment reuses the C2
policy transition: pending/authorized grants become review-required; withdrawn
records are never widened, recreated or turned into active receipts. Stale
client revisions still conflict. A trusted current lookup can obtain the new
review-required revision before a reduction; a real rights/enrollment service
must provide its qualified status and retry process even when participation is
unavailable. This slice does not add such public routes.

Grant-producing operations recheck authentication, active policy time and
pending/authorized subject expiry after all awaited quota/index/record writes.
Cross-partition peer withdrawal or a root policy change committed before an
effect transaction prevents output. Existing current-session/role changes are
also checked in that effect transaction. Hash partitioning is no substitute for
these fences. An already-started external request or independent native/P2P
session cannot be recalled, and notification across services is not instant.

## Bounded work and cleanup

A record mutation permits at most **160 transaction reads and 160 writes or
deletes**, including its allocation/release hook. Exceeding either refuses and
rolls back the operation. Live-history validation and cleanup are bounded by the
fixed record counts above; no operation scans all enrolled people. Logical
record bounds do not measure physical JS/SQLite memory. The owner must bound
transaction latency, hook payloads, retry scheduling and backend costs too.

The transaction-local C3 reader accepts at most 256 identities, matching the
existing enforcer ceiling, and deduplicates identical principal records. It
reads one policy root and at most six backend values per distinct live subject
(record, anchor, subject index and current grant indices). Thus its upper bound
is 1,537 point reads, independent of total enrolled population. It never lists
the community or writes cleanup during authorization. C3 still prepares views
for connected peers; that work, its checkpoint ceiling and the existing lobby
limits remain real throughput constraints, not solved by this storage slice.

`sweep(proof,{cursor:'',limit:4})` requires the trusted
`authorizeMaintenance({proof})` adapter to return the intended community and
finite current expiry. At most four record keys are enumerated per page through
a fixed prefix and validated key cursor. Each record cleanup is its own bounded
atomic transaction. The cursor is server-only metadata, never authority. A page
can make partial per-record progress before a failure; false/error results never
claim an entire scan succeeded. The owner must save progress, retry failures and
restart a complete scan so keys inserted before an old cursor are revisited.
Malformed/oversized backend pages are refused. Nothing is deleted ahead of its
finite C2 retention deadline; no arbitrary transcript or verification proof is
added. A corrupted record can block its own cleanup and needs owner recovery,
not a permissive skip, fabricated release or infinite retry loop.

## Proof and remaining qualification

Synthetic unit tests enroll **96 records** through the real C2 begin/verified
completion paths without any aggregate limit increase. Only **two actual engine
connections** are used in the cross-partition C3 public/PM/revocation journeys;
this is not a 96-client load test. Tests also exercise global operation/decision
replay and reference collisions, shared guardian isolation, corrupt/missing
indices, restart, storage/allocation/expiry failures, late policy/grant expiry,
quota-hook bounds and finite paginated cleanup/allocation reuse. No real
provider, guardian, Cloudflare runtime or durable hosted service is involved.

The earlier default-beta 150-client and configured-C3 16/64-participant receipts
belong to their original exact sources and adapters. They do not qualify this
new record layout, sustained/concurrent load, runtime memory, storage costs or
distributed scaling. New source-bound measurements and hosted owner-qualified
failure/recovery/cost checks remain required before capacity is advertised.

There is no automatic aggregate migration or fallback. A release owner must
design a bounded migration preserving exact policy/subject/guardian/receipt and
operation references, revisions, withdrawals, expiry and uniqueness ownership,
with a real fence against concurrent old writers. Missing new policy data must
not initialize an empty community or mint new grants. Recovery must restore
records and their indices/quota consistently; loss of all authoritative records
and anchors cannot be detected or repaired by guessing from a nickname/device.

Production binding/migration, operator/legal/retention and rights decisions,
real session/enrollment/guardian verification, incident handling, provider start,
cost/admission limits, withdrawal fan-out, assistive technology and native/WAN
acceptance remain with their existing owners. StoryPool 10-21-26 owns core,
Karen, deployments and shared operational files. No such file, namespace,
credential, release hold, paid service or paused TURN work changes here.
