# Local Durable Object record-mapping proof

This isolated, development-only fixture imports the actual
[`durable-record-storage.mjs`](../../../hangout-worker/src/durable-record-storage.mjs)
into a local SQLite-backed Durable Object. It does not configure or deploy an
application service. The clean-installed local run on October 25, 2026 passed
nine mapping checks, eight unique concurrent increments, whole-group
Node/workerd SIGKILL and three fresh-process recovery checks on macOS ARM64 /
Node 26.12.0. The complete original 3,355,494-byte, 52-chunk record and digest
survived; ordinary thrown/caught failures also stayed rolled back in both fresh
processes. The locked tool install used `npm ci --ignore-scripts`, and its npm
audit reported zero advisories. This establishes local mapping behavior only:
`localMappingQualified: true`, `rawOversizeAccepted: true` and
`hostedLimitQualified: false`. Node 24/Linux CI is a separate execution target.

Application-local evidence is retained under
`shared-community-20261025/durable-runtime-proof/` as
`clean-installed-cross-generation-rollback.{json,log,stderr.log}` and
`dependency-audit-after-clean-ci.json`. The runtime receipt binds Worker SHA-256
`033758f232faaf79f3d8469ad885658c75c0ae9847caaa8ac4720e6bfdab4cf2`
and runner SHA-256
`09310bb9a62ac5d091fc097c7fdaa5079cb6eccff648e641d61fe01c50ae8783`.
Original failed and earlier provisional runs remain intact. The checks below
specify what every subsequent run must prove; these results do not transfer to
changed source, another platform, a hosted service or a deployment.

## Pinned tools and running locally

Use macOS or Linux with Node.js 24 or later. From this directory:

```sh
npm ci --ignore-scripts
npm test
```

The install can fetch locked npm packages; the test itself denies outbound
Worker fetches locally. Do not substitute `npm install`, enable lifecycle
scripts, inject credentials or add a production resource binding to make a
failed test pass. This runner accepts no user paths or options. Its process-group
crash procedure is not a Windows test command.

[`package.json`](package.json) and [`package-lock.json`](package-lock.json) pin:

| Component | Exact version | Reason |
| --- | --- | --- |
| Miniflare | `5.20261019.2-beta` | Isolated test tooling that supplies the selected workerd and the v5 API used here. The beta pin is explicit, not a recommendation for production activation. |
| workerd | `1.20261019.1` | Its installed `lib/main.js` advertises maximum compatibility date `2026-10-19`, covering this fixture's requested `2026-10-01`. The runner verifies versions, compatibility metadata and binary/source hashes. |
| Undici override | `7.30.1` | Replaces Miniflare's declared `7.29.1`; the saved initial npm audit identifies three advisories affecting versions below `7.30.1`. No advisory-ignore switch is used. |

The initial Undici findings are
[EventSource memory exhaustion](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
[integrity algorithm handling](https://github.com/advisories/GHSA-f72v-6w45-q472)
and [excessive content-encoding error handling](https://github.com/advisories/GHSA-xjj6-f33q-929c).
The override is a targeted dependency repair; it does not certify the whole
toolchain as vulnerability-free. The original audit remains application-local
evidence in `shared-community-20261025/durable-runtime-proof/dependency-audit-before.json`.

The installed package metadata, Miniflare `dist/src/index.d.ts`, workerd
`lib/main.js` and `workerd.capnp` are the inspected version-specific sources.
Upstream context is available in
[Cloudflare's Miniflare package](https://github.com/cloudflare/workers-sdk/tree/main/packages/miniflare),
[workerd](https://github.com/cloudflare/workerd),
[compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
and [Durable Object asynchronous transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
The fixture translates its options through `convertV4MiniflareOptions`, checks
the resulting persistence path and registers the Worker and actual codec as
explicit source modules. It uses `useSQLite: true`, actual `storage.transaction`
and the SQL schema API; it does not replace transaction behavior with a Map or
`transactionSync`.

## What a complete local mapping result must prove

The `qualify` phase must execute exactly these nine named checks:

1. `outbound-egress-denied`: actual global fetch to a reserved `.invalid` name
   receives the local handler's exact 503/header denial.
2. `utf8-chunk-roundtrip`: a deterministic value exceeding 3 MiB of canonical
   UTF-8 JSON round-trips with the expected digest, ordered physical parts of
   at most 65,536 bytes and codec storage-list pages of at most four.
3. `mid-chunk-rollback`: an injected failure after an actual staged chunk write
   rolls back that record and an earlier baseline overwrite.
4. `caught-failure-poisons-transaction`: catching the same write failure inside
   the caller cannot acknowledge or commit the damaged transaction.
5. `final-authority-rollback`: a synthetic final authority denial after writes
   rolls back all staged effects. This is a transaction control, not real
   session, guardian or incident authority.
6. `shrink-delete-no-orphans`: shrinking and deleting a separate large record
   removes its surplus parts and manifest without leaving orphans.
7. `corruption-denied`: an intentionally changed chunk fails digest validation;
   the fixture repairs and removes only its own synthetic control record.
8. `bounded-prefix-pagination`: actual logical prefix listing returns four
   ordered records, then the remaining one, with the expected values.
9. `recovery-baseline-committed`: baseline, counter zero and a separate complete
   multichunk record are committed and reread before disposal.

Eight concurrent `increment` requests must then return the unique counters
1 through 8 using actual asynchronous Durable Object read/await/write
transactions. Eight concurrent successes do not prove transaction callbacks
retried. There is no host mutex. A fresh process opens the same persisted
namespace/object ID, verifies the complete original large record and then stages
a baseline overwrite, a small replacement of the multichunk record and a new
uncommitted record. The small replacement stages deletion of old surplus
chunks. After the exact staged-write console marker, the parent verifies its
owned process group contains workerd and sends **SIGKILL to that whole group**.
It requires no live group members before starting recovery; a runtime restart
or an ordinary error exit does not count as this crash proof.

Another fresh process must execute these three recovery checks:

1. `committed-baseline-survives-runtime-kill`.
2. `uncommitted-overwrite-and-new-record-rolled-back`.
3. `committed-multichunk-record-survives-runtime-kill`.

Both fresh processes also require the earlier ordinary thrown/caught-write and
final-authority-denial records to remain rolled back across generations.

The parent must also require recovered counter 8, identical object ID, matching
full large-record byte length/digest and unchanged source/tool/binary hashes.
Only then may it emit `localMappingQualified: true`. A zero exit or individual
phase response is insufficient. `hostedLimitQualified` must remain `false`;
there is no undifferentiated `qualified: true` claim.

## Observed local size-limit gap

The original real workerd attempt **accepted a raw 3 MiB value**. The earlier
`raw-single-value-limit` rejection control failed with
`raw-three-mib-negative-control-was-accepted`, and no passing receipt was emitted.
The source-bound failed attempt and stderr remain application-local evidence in
`shared-community-20261025/durable-runtime-proof/explicit-source-modules.json`
and `explicit-source-modules.stderr.log`; they must not be replaced or rewritten
as success.

The mapping-only fixture records this observation separately as `sizeProbe`,
with `attemptedBytes`, `nativeRejected`, bounded `error`,
`rawOversizeAccepted`, `hostedLimitQualified: false` and
`hostedLimitStatus: "unsupported-by-pinned-local-runtime"`. An accepted raw value
must round-trip exactly and be deleted; a rejected value must remain absent.
This probe is not one of the passing mapping checks. No fake native rejection,
production codec change or logical-cap increase is introduced.

[Cloudflare's hosted storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
remain a separate contract. Inspection found no supported native Durable Object
value-limit configuration in the installed Miniflare API/workerd configuration
that establishes that hosted behavior here. The workerd `memoryCache.limits`
configuration belongs to a separate in-memory cache binding; it is not a
Durable Object persisted-value limit and is not used to manufacture a result.

## Isolation, evidence and cleanup

The parent imports no third-party package before creating a child with a
credential-free environment allowlist. Only path/temp and Windows-system path
names are forwarded; macOS's automatically supplied `__CF_USER_TEXT_ENCODING`
is narrowly allowed. Inherited Node, Cloudflare, vault, proxy and provider
configuration is not forwarded. Each phase has private parent IPC and an owned
process group. Listeners and inspectors bind to `127.0.0.1` on assigned ports;
the fixture rejects browser Origin headers, non-JSON content and a wrong random
nonce before any SQL/storage phase work.

Remote account metadata/telemetry and shared storage are disabled. Every global
Worker fetch goes to the local deny handler; qualification requires exactly one
such call and recovery none. The crash `GATE` is a separate local,
never-resolving service binding, not an external provider. Logs are bounded and
each phase has a deadline; failure stops owned processes without automatic
retry. All records, deliberate corruption and crash mutations are synthetic.

Persistence lives only in a fresh, parent-owned `webjam-durable-runtime-*`
temporary directory, reused for those phases. The parent checks real path and
directory identity, stops every owned runtime group and removes only that
directory. It accepts no existing state/output path to delete. Capture stdout,
stderr, exit status and source-bound receipts outside that temporary state if
retaining evidence. No success is emitted when cleanup or proof fails.

This local test does **not** qualify hosted value/account limits, replication,
PITR, production sessions/consent/guardian or incident authority, encryption-key
management, migration/old-writer fencing, hosted rollback, sustained capacity or
cost, native installation/audio, legal compliance or public go-live. Those
requirements and their owning-session handoffs remain active. StoryPool
10-21-26 retains deployment/core/Karen/shared-operations ownership; this fixture
changes none of its locks, holds or review requirements.
