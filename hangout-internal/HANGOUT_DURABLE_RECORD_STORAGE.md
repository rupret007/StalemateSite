# Bounded physical records in one transaction

`hangout-worker/src/durable-record-storage.mjs` maps bounded logical JSON records
onto small physical values. This closes the physical-value-size gap between the
incident model's existing 8 MiB logical ceiling and a storage backend's smaller
row limit. It does not activate participation enforcement, incident preservation
or any new production route.

Cloudflare documents a 2 MB combined key/value limit for SQLite-backed Durable
Objects, and private storage per object. Its asynchronous transaction API is the
required integration surface; a synchronous transaction callback cannot await
the application's authorization and cryptographic work. See the current primary
[storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
The caller must independently qualify the deployed backend and its rollback,
retry, input/output gate and concurrent-access behavior.

## Contract

Construct `createDurableRecordStorage({ storage, namespace, maxRecordBytes })`
with an explicit existing async transaction provider, a purpose namespace and a
record-size bound no greater than 16 MiB. Use the incident model's existing
8 MiB bound for incident state; the mapper does not increase it. All related
authority/session/consent/effect records must use the **same provider transaction**
to obtain atomicity. A second object, remote RPC, readiness flag or new epoch
that old code ignores cannot supply that guarantee.

The returned `transaction(async tx => ...)` supplies sequential, awaited `get`,
`put`, `delete` and bounded `list({ prefix, startAfter?, limit })`. Listing returns
a sorted Map of logical keys and decoded values, with an exclusive cursor and
limit 1–4; this supports partitioned-consent maintenance without an aggregate
global index. An empty listing prefix is supported. Logical keys are printable
ASCII opaque references of 1–512 characters. The caller must not put personal
data or credentials in keys: ordered hexadecimal encoding is not encryption.

Records must be plain JSON data. The mapper rejects accessors, `toJSON` methods,
unsupported prototypes, cycles, array holes, undefined values, nonfinite numbers,
negative zero, symbols and typed arrays instead of silently changing them.
Incident source adapters must explicitly encode immutable source bytes (for
example base64) in their stored JSON and decode back to Uint8Array before the
existing evidence-digest/encryption interface. Never JSON-coerce a byte array.
This module supplies neither encryption nor authority; the incident service's
purpose-specific, nonextractable key and access checks remain necessary.

Each record has a versioned byte-length/chunk-count/SHA-256 manifest and ordered
64 KiB binary chunks. Reads enumerate exact chunk keys in bounded pages, reject
missing/extra/reordered/truncated/changed chunks and validate recovered JSON.
Missing manifests with surviving chunks are corruption, not a fresh record.
Replacement and deletion validate the old record, then atomically replace or
remove all old chunks and the manifest. Checksums detect corruption; they do
not authenticate a malicious storage operator or replace evidence encryption.

The transaction also bounds read bytes (32 MiB), write bytes (16 MiB), physical
API calls (4,096), JSON traversal (100,000 nodes) and depth (64). These are
defensive mapping ceilings, not measured capacity or a new production quota.
Failures poison the whole callback even if caught. Concurrent logical operations,
retained transaction handles and unfinished operations cannot be used to commit
partial writes. Pending mapper work settles before an aborted callback returns
to the provider. These guarantees still require the supplied provider to roll
back on callback rejection.

## Qualification and remaining integration

The test driver uses real temporary SQLite files and actual SQL transactions.
Process restart and failure-injection tests qualify this mapping against that
driver. The focused suites contain 71 codec/SQLite/incident cases and six
participation-domain cases. They exercise actual C2/C3 enrollment, guest chat,
withdrawal, final-write authorization denial, maintenance pages and reopening;
the identity/policy/guardian adapters remain explicitly synthetic. The incident
case uses its real cipher with an explicit byte decoder and final-expiry rollback.
They do not qualify Cloudflare's runtime, hosted recovery, media, native
installation, legal retention policy or production transaction latency. Chunking
still materializes a whole bounded logical record; it is not a new I1 partition
design, heap measurement or single-room scaling result.

A separate [local workerd fixture](../tests/runtime/durable-records/README.md)
now exercises the actual codec in a SQLite-backed Durable Object using native
asynchronous transactions. The recorded macOS ARM64 run checks chunk rollback,
caught-error poisoning, eight concurrent callers and recovery after SIGKILL of
the owned Node/workerd group. It recovers a full 3,355,494-byte record across
52 chunks and verifies committed/aborted state in fresh runtime processes.
These checks establish local mapping behavior, not callback-retry occurrence,
hosted replication, PITR, authority or production recovery. The pinned local
runtime accepted a raw 3 MiB single value: the original rejection-control failure
is retained, and hosted limit qualification remains explicitly false. There is
no synthetic native cap or production limit change. The isolated runtime CI
uses its own locked development dependencies and does not modify deployment CI.

Production `lobby-do.mjs` remains on its existing persistence path. Before any
activation the receiving owner must supply trusted transaction-local sessions,
consent/guardian and incident authority, keys and backup recovery, explicit
initial provisioning, bounded maintenance, migration/drain/old-writer fencing,
matched asset rollout and rollback. A completely wiped record has no surviving
chunks for this codec to distinguish from first provisioning; the existing
service's initialization/recovery sentinel must fail closed. Do not automatically
recreate policy, incident state or grants after a missing read.

Provider HTTP/media starts stay outside retryable transactions and use the
existing separate non-retrying start fence. The adapter never starts a provider,
chooses a consent policy or appoints a reviewer. StoryPool 10-21-26 owns deployment,
core, Karen administration and shared operational changes.
