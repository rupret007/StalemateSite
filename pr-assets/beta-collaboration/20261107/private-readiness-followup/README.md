# Private readiness follow-up evidence

This packet preserves the failed real eight-hour observation and its cleanup,
then separately records local repair qualification, exact-head CI, private
delivery and actual post-update journeys. It is not a release PASS.
`receipt.preparation.json` retains the initial preparation inventory;
`receipt.json` adds delivered evidence and inspected screenshots. The original
failed receipts must not be rewritten as passes. The distinct repaired full
real-duration observation is running, not passed. See the
[current repair checkpoint](../../../../hangout-internal/HANGOUT_PRIVATE_REPAIR_20261107.md).

## Actual hosted observation

Source `b35e5fcf5904eb99e17de653ddd2234e553bbada`, website version
`33862058-10a5-4a6f-9659-38841d70292f`: the quiet lobby still displayed connected
about 47 seconds after access expiry. Cleanup HTTP returned 401, but the later
same-signed-token replay assertions were not reached. An authentication bypass
was not established. Five recovered 1006 closes also prevent an uninterrupted
uptime claim. Independent readback confirmed the original receipt and harness,
closed owned processes, and unchanged deployed versions and settings.

## Controlled local native comparison

`idle-expiry-native-runtime-crypto-import-controller-nov07.json` contains the
completed comparison. It ran on NucBox's already running Ubuntu environment,
with isolated Node 24.22.2, Miniflare 5.20261019.2-beta, workerd 1.20261019.1 and
undici 7.30.1. The application snapshots were the PR #232 base
`32d3cdb5571e5c3d1e06eb99dde214ff6b282c89` and reviewed fix head
`d8c08fb88b94429f03d13d9beaf01d8ffd301e1a`. Only `lobby-do.mjs` differs between
their application runtime sources. Both snapshots retain the actual production
eight-hour TTL. The test-only Worker registers a ten-second synthetic guest in
the real local registry and signs its cookie with a synthetic fixture key.

| Observation | Before | After |
| --- | --- | --- |
| Stored alarm relative to access expiry | 49,954 ms late | Exact deadline |
| Quiet socket at expiry + 3 seconds | Still open | Automatic close 4401, 49 ms after expiry |
| Identical expired cookie at `/beta/state` | 401 | 401 |
| Identical expired cookie at `/join/app.js` | 401 | 401 |
| Other ordinary guest still answers | Yes | Yes |
| Manual alarm calls / clock advances | 0 / 0 | 0 / 0 |
| Provider/outbound calls / runtime restarts | 0 / 0 | 0 / 0 |

The protected alarm inspection happens before expiry. No requests or client
frames are sent during the subsequent quiet interval. The application alarm
handler is inherited unchanged; workerd dispatches it automatically. Each
instance uses separate owned storage, exact-hash source inputs, no shared
storage, and an outbound-denying service. Both are disposed, source hashes are
checked again, and independent process readback finds no owned process left.
No real invite, provider credential, physical microphone/camera or recording is
used. The runner bounds are part of a local fixture, not a Cloudflare delivery
latency guarantee or evidence that the new mode ran in native CI.

The packet retains two setup stops: the original archive validator rejected the
official archive's normal top-level directory without a trailing slash; the
first fixture runner incorrectly expected no external imports even though the
application imports `node:crypto`. Both stopped before a native trial. The
corrected archive check preserves checksum/path/extraction protections. The
qualified runner requires exactly that actual crypto import; no application
security flag or compatibility setting was relaxed. Both runner sources are
included so the correction is reviewable.

The fixture and runner are evidence sources, not a public application endpoint
or an installer. Their expected layout is an owned QA directory containing
`tools/package.json` and its repository-pinned tool lock/install, `before/` and
`after/` exact application snapshots, identical `fixture-worker.mjs` files in
those snapshots, and the qualified runner at the QA root. The original receipt
records the bundle and every actual source-input hash. Do not deploy this
fixture, substitute a shorter production TTL, or count this comparison as a
replacement for a new full-duration hosted test of the repaired deployment.

### Provider reference check, November 7

Cloudflare documents one alarm per object, retryable delivery, and preserving an
earlier alarm when scheduling other work. Its constructor guidance specifically
warns against overwriting the already scheduled alarm during wakeup. The repair
follows that model; the measured 49ms is a local observation, not a hosted
latency commitment. See the [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/).

Hibernation restores object memory while retaining eligible connections;
attachments provide the connection state after reconstruction. Forced code
updates can still disconnect clients, so the update test must check recovery
and draft privacy rather than assume uninterrupted sockets. See Cloudflare's
[WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
and [object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).
These references do not diagnose the five observed 1006 closes. The application's
existing compatibility date and flags remain unchanged.

## Prepared delivery and native launch location

The compile receipt verifies 69 assets and 111 staged inputs, with 64 unchanged
server source contents and two reviewed changes among 66. Compilation is not
deployment. The separate delivery receipt records version
`c2271048-aaa3-4649-8e9e-48dd46212da5`, its unchanged effective controls and all
66 source contents; post-update browser receipts and inspected images remain
separate. The retained Linux controller's `COUNTDOWN_HOSTED` label describes the
served source, not a demonstrated connected music/countdown session. The
corrected MacBook Desktop shortcut points to the existing
verified native source `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c`; the original
incorrect package-layout assumption and independent final readback are retained.
No native app or capture device was opened for that shortcut correction.

The relay review is source analysis plus cited standards, separate from a new
transport trial. Same-network devices can still select relay under the current
candidate policy. Credential operation limits remain distinct from TURN media
usage; this packet changes neither quotas nor transport policy.
