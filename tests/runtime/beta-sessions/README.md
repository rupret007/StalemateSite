# Local native beta-session transaction checks

This fixture imports the application's actual `BetaSessions` and
`beta-session-state.mjs`. It runs ten cases across two local Durable Object
classes: one with SQLite enabled and one configured for the legacy KV API.
It reuses the existing pinned Miniflare/workerd dependency package in
`../durable-records/`; there are no additional dependencies or production bindings.

From the repository root, with that package already installed:

```sh
node tests/runtime/beta-sessions/runner.mjs
```

To reproduce from a fresh checkout, install its existing locked development
dependencies first:

```sh
npm ci --ignore-scripts --prefix tests/runtime/durable-records
node tests/runtime/beta-sessions/runner.mjs
```

The process-group checks support macOS and Linux. Unsupported platforms fail
explicitly; this is not a Windows test. The fixture expects the exact package
versions already pinned by `../durable-records/package-lock.json` and uses the
application's `2026-10-01` compatibility date. It never installs packages itself.

## Assertions

For each backend, three registration cases inject an exception **after** an
awaited native transaction operation: mint-budget `put`, session `put`, or
`setAlarm`. The actual registry must return 503, leave its previous rows,
allowance and alarm unchanged, and allow an explicit retry to register once
with allowance count one.

Two further cases seed 271 expired sessions and one live session. They exercise
pruning through both the real registration route and `BetaSessions.prune()`.
An exception after the second native 128-key deletion must restore all 272
records, both IP allowance records and the prior alarm. The subsequent explicit
retry must delete the expired rows in batches of 128, 128 and 15, preserving the
live session and the unrelated IP's allowance. The fixture checks all rows;
its printed receipt includes counts and SHA-256 digests instead of the full
seeded registry.

The storage proxy delegates to the real runtime before injecting a failure.
It does not implement transactions, copy a Map for rollback, impose an artificial
storage limit or substitute the application's lifecycle operations.

## Isolation and evidence

The parent uses Node built-ins only. A fresh child receives a short environment
allowlist before importing test dependencies. Both the service and inspector
bind only to loopback; outbound requests are denied. Nonce, Origin, content-type,
binding-name and oversized-body negative controls must be refused.

Each run owns a temporary persistence directory and detached process group.
The parent checks for the actual workerd process, requires a complete receipt
and successful child exit, and verifies that no owned process remains. Normal
completion disposes Miniflare and removes temporary state before printing a
passing result. Failure or interruption kills only that owned group and cleans
its state. A fixed 45-second deadline fails without restarting the runtime.

The receipt binds the fixture, eight application modules, dependency package and
lockfile hashes, tool versions, workerd binary digest, platform and Node version.
It requires unchanged source hashes, zero outbound requests and zero unexpected
runtime restarts.

## Scope

These are local native registration, alarm-operation and pruning checks. They
do not qualify hosted replication/recovery, actual alarm wake-up delivery,
automatic transaction-callback retries, browser cookies/Cloudflare Access,
socket closure, cross-object revocation atomicity, production deployment or
whole-product readiness. The explicit application retries in these tests must
not be described as observed provider retries.

Cloudflare documents a maximum of 128 keys per asynchronous delete operation.
The pinned local runtime separately accepted 129-key deletes in both modes, so
this fixture verifies that the application issues supported bounded batches;
it does not claim that local runtime enforces the hosted limit. Similarly,
`storage.sql` property presence alone is insufficient to distinguish backends:
the fixture executes a bounded `SELECT 1`, which legacy KV mode must deny.

Primary references: [storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/),
and [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

All fault injection and inspection routes exist only in this test Worker.
Deploying this fixture is outside its purpose; no application route imports it.
