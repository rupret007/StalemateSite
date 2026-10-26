# Local native Lobby effect records

This fixture bundles the actual Lobby engine, domain effect adapter and physical
record codec, then runs them in SQLite-backed Durable Objects using the existing
pinned Miniflare/workerd package in `../durable-records/`. It reuses Rolldown
1.2.14 and Obscenity from the application's locked development/runtime packages.
It does not install dependencies itself or change application source.

With both existing dependency packages installed, run from the repository root:

```sh
node tests/runtime/lobby-effects/runner.mjs
```

For a fresh checkout:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix tests/runtime/durable-records
node tests/runtime/lobby-effects/runner.mjs
```

Supported test hosts are macOS ARM64 and Linux x64 with GNU libc. The runner
selects the installed matching Rolldown binding and rejects other hosts before
starting a runtime. A successful run qualifies only its executing host; it is
not Windows or full application/native-audio platform evidence.

## Four actual runtime cases

1. The actual engine generates connect, nickname, room creation, registration
   and public-message effects. The domain adapter commits these through the
   native asynchronous storage transaction. Recovered room ownership and session
   metadata match; the ordinary public message body is absent from durable state.
2. Another actual engine command changes the room topic. A storage proxy awaits
   the real room manifest write and then throws. The complete recovered domain
   digest must remain unchanged.
3. A second object explicitly initializes 2,000 six-field moderation entries
   copied from an actual engine-produced log template. The fixture tests segmented
   recovery, failure after the real log-index write, and a successful two-entry
   append that retains exactly the newest 2,000 entries across 32 segments. This
   is representative stored log data, not a claim of 2,000 simulated users or
   measured event throughput. Physical mapper calls must stay below 4,096.
4. The first Miniflare/workerd instance is disposed and its actual workerd process
   must disappear. A new native process opens the same private persistence
   directory and must recover both objects' exact identifiers and domain digests.

The injected failures occur after awaited **native** operations. The proxy does
not implement rollback, substitute a Map or impose an artificial provider limit.
The actual domain adapter and codec supply the application behavior.

## Source binding and isolation

The receipt binds the fixture, application modules/assets, root package and lock,
beta runtime configuration, isolated runtime dependency lock, tool versions,
workerd binary and selected Rolldown native binding. The bundler records hashes
for its 42 raw source inputs and its generated bundle; those inputs and files
must remain unchanged. CommonJS `sync-core.js` and Obscenity are bundled intact.
`node:crypto` must remain an actual native external import.

The fixture asserts that the current beta configuration's global compatibility
date is `2026-10-01` with no explicit compatibility flags, then uses that same
combination. It does not change or infer missing production configuration. A
future configuration change requires reviewing and updating this assertion.

The parent imports only Node built-ins. A detached child receives a short
environment allowlist before importing test packages or the native bundler.
Service and inspector bind to loopback, outbound requests are denied, and three
nonce/Origin/content-type controls must return 403. No account, production
namespace, provider credential or deployment binding is used.

Each run owns its process group and temporary persistence. The parent captures
actual workerd processes, requires a complete receipt and exit zero, verifies
no owned live process remains, and removes its state before printing success.
Failure/interruption kills only that group. IPC disconnect cleanup also covers
bundling. A fixed 45-second deadline fails without an automatic runtime restart.

## Scope and remaining work

This is a local native domain-storage proof, including graceful fresh-process
recovery and deliberately failed transactions. It does not establish abrupt
power-loss recovery, hosted replication/PITR, hosted value-limit enforcement,
production throughput/cost or deployment readiness. Explicit success after a
failed transaction does not prove automatic transaction-callback retries.

The pure engine supplies fixture effects, but its captured frames are not a C3
publication fence. This fixture supplies no real first-party session, guardian,
consent or incident authority. It does not activate the adapter, migrate existing
records, fence old deployed writers or authorize maintenance. The new segmented
log format still needs explicit migration/drain and rollout work.

Relevant primary references: [storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
and [Node crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

Inspection/fault routes exist only in this test Worker. Do not deploy it.

The bundler proof now compares every normalized input against the explicit
`source-catalogue.mjs` catalogue: the fixture Worker, eleven named application
modules (including the I3a source bridge and I1 digest implementation), two shared
browser modules and thirty named files from the locked obscenity package. Equal
counts with substituted files, missing/extra inputs, aliases and unknown external
roots fail; each actual input digest still matches its file. The catalogue and
both new transitive application modules are included in recorded source hashes.
Early bundler/catalogue errors use the same bounded IPC failure message so the
parent can preserve the primary error and clean its owned process without waiting
for the unchanged 45-second failure deadline. No API cap or deadline is raised.
