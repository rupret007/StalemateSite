# Actual guest journeys in local workerd

This fixture drives the real `betaFetch` gateway, `HangoutLobby`, session
authority, effect writer and physical record codec in local SQLite-backed
Durable Objects. It uses the existing locked Miniflare/workerd tools in
`../durable-records/` and the application's existing Rolldown/Obscenity packages.
The runner installs nothing and changes no application or deployment source.

Results qualify only the recorded source and executing host. Run this checkout
and inspect its source-bound receipt; the earlier application-local prototype
does not qualify this portable copy.

## Run from a checkout

Use Node.js 24 or later on macOS ARM64 or Linux x64 with GNU libc. Other hosts
are explicitly refused; Windows and macOS Intel are not qualified by this test.
From the repository root, with both existing dependency packages installed:

```sh
npm run test:lobby-session-runtime
```

For a fresh checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund --prefix tests/runtime/durable-records
npm run test:lobby-session-runtime
```

The existing Node 24 runtime workflow runs this command and preserves stdout,
stderr, the exit code and source hashes in its runtime diagnostic artifact. No
additional package, dependency version or lockfile is introduced.

## Actual journeys and failure controls

The first runtime refuses a real guest unlock while the authority marker is
missing. The test explicitly invokes the binding-only known-empty initializer;
this is neither automatic production provisioning nor proof of writer drain.

Three visitors receive real locally signed guest cookies and upgrade actual
local WebSockets. Stalemate and Rad Dad visitors share a channel and drawing
canvas with their entry badges. A neutral direct newcomer receives the current
drawing and membership, without earlier chat. A real report preserves selected
evidence, while unrelated ordinary chat must be absent from a complete decoded
record scan. That bounded scan requires known nonempty records; the additional
raw physical scan does not substitute for detecting text across chunk edges.

Logout closes the connected visitor, applies the cookie-clearing policy, rejects
copied-cookie state/upgrade requests and allows the other visitors to continue
chatting. The revoked visitor must receive no later frames. The remaining two
visitors enable synthetic camera permission and relay one synthetic SDP through
the actual gateway. A device Block must persist in actual SQLite, publish only
the relevant pair-policy updates and deny subsequent signaling in both
directions. No actual camera capture or WebRTC media transport is exercised by
this native storage fixture.

One fault thrown only after an awaited native session-manifest write must roll
back the other visitor's attempted Block in both durable and engine state and
release no Block, PM-close or media-policy success. A second, separately armed
fault after an actual room-manifest write must leave room/report semantics
unchanged and release no topic-success frame. The nonce-protected fixture allows
only those two distinct fault keys. Synthetic SDP bodies must remain absent
from the same bounded logical/raw scans used for ordinary chat.

Final session values alone cannot prove native rollback: the engine also writes
conservative accounting/session state after a failed event. For each injected
fault the fixture therefore captures an original physical-manifest digest,
observes a different staged digest after the awaited native put, then catches
the original native transaction's rejection and re-reads that manifest before
letting the error reach engine recovery. The runner requires the original
digest to be restored at that boundary. Only the allowlisted logical record,
three digests and bounded boolean observations enter the receipt, never the raw
manifest or physical key. This is a native-manifest rollback witness alongside
the end-to-end semantic checks, not a whole-domain storage equality claim.

Two visitors and their durable bindings remain connected at the first
checkpoint. The parent records and kills that entire owned process group
without closing the visitors or disposing Miniflare first. A separate child and
fresh workerd process reopen the same private persistence directory. Committed
room/canvas/report semantics and revoked-cookie denial must survive; lost
socket bindings and membership must be retired. The still-valid guest cookie
then reconnects to the existing canvas without replaying prior chat. Volatile
budgets, empty-room timestamps and recovery metadata are not compared as a
whole-domain digest.

## Isolation, source binding and cleanup

The parent imports only Node built-ins. Runtime children receive a short
credential-free environment allowlist before loading the pinned tools or native
bundler. Services and inspectors bind to loopback. The nonce/Origin/content-type
negative controls must all return 403. One deliberate outbound probe must be
denied by the runtime egress service; any other outbound call fails the proof.

The receipt binds every application `.mjs` source, the fixture and README,
runtime workflow, root package/lock, beta configuration, isolated tool manifests
and lock, actual raw bundle inputs, generated bundle, workerd binary and selected
Rolldown native binding. It asserts the beta compatibility date `2026-10-01`
with no explicit flags and requires the actual native `node:crypto` import.
Both runtime generations must retain matching input, bundle and binary hashes.

Only private parent/child IPC carries fixture cookies between generations;
cookies are removed from the final receipt. Each phase has a fixed 60-second
deadline and bounded logs. Failure, interruption or IPC loss kills only the
owned process group. The parent verifies no owned live process remains and
removes its newly created temporary state before printing success.

## Scope

This is an actual local guest gateway/WebSocket/SQLite regression, including
whole-process loss with connected visitors. It does not qualify browser cookie
storage, real Cloudflare Access OTP/staff authentication, physical devices,
guardian consent, incident authority, hosted deployment/migration/drain,
Cloudflare limits/cost or unrestricted capacity. TURN/camera behavior and native
WebJam installation/audio remain separate acceptance work. A passing run
qualifies only its recorded source and executing host.

The Worker wrapper's inspection/fault/control routes exist only in this test.
Do not deploy it or expose its known-empty initializer as public onboarding.
