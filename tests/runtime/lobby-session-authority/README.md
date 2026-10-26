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

The separate, explicit production participation composition proof is:

```sh
npm run test:lobby-session-runtime -- --participation
```

That mode selects `c3-v1` in the actual `HangoutLobby`, without replacing its
production principal/session/partition/effect adapters. It first proves that a
real signed guest without a policy receives no nickname/publication, and that
ordinary traffic does not initialize policy. Nonce-only test controls then
install explicitly synthetic operator/guardian decisions through the real C2
ledger for current signed guest SIDs. No real guardian is qualified.

The unchanged baseline journeys, physical post-write rollback witnesses and
process-loss/recovery checks run under that composition. Additional checks deny
unfenced private-room/TURN admission, commit a synthetic media-purpose reduction
then invoke the actual production alarm, keep other visitors active, and deny a
new SID that reuses a genuine signed device token/IP/old nickname after restart.
No test clock, storage/frame cap or default baseline requirement is relaxed.
The command without the flag retains the original beta baseline; source-bound
receipts distinguish the two modes and do not qualify public enrollment, real
guardian rights, provider dispatch or hosted rollout.

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

## Separate I3a production source composition

`npm run test:lobby-session-runtime -- --incident-sources` explicitly enables the
production public-report source bridge in the owned test Worker. It is a separate
qualification from the default and `--participation` modes. Both flags can also
be selected explicitly for the combined integration proof described below. The real gateway, guest cookie, current lobby-v1 SID/binding,
queue/effect writer, indexed source loader and native SQLite mapping remain in
use. The original nine first-phase and three recovery check groups and both
physical fault witnesses stay intact.

After an actual delivered public message is reported, nonce-only controls
explicitly initialize a synthetic appointment, policy and case record. I1 then
preserves one source through the production loader in the same authority.records
transaction domain, encrypts and reads back its exact selected UTF-8, and verifies
a metadata-only source index with no plaintext case copy. No unrestricted quote,
media upload, real incident, handler grant or production endpoint is accepted.
The bound guest SID remains separate from the explicit synthetic appointment;
I1 revalidates the current actual binding inside each case transaction.

A parent-generated random test-only AES key travels privately over owned child
IPC and becomes a nonextractable purpose key in each test Worker. It is excluded
from stdout, receipt objects, source metadata and process environment. Retaining
that test key over the fixture phases proves encrypted record reload after whole
owned process loss, not real purpose-key provisioning, rotation, backup or owner
recovery. A current reconnected binding for the original signed SID is required
for the recovered I1 read.

The new source-index and final case-write rollback failures are qualified by the
actual disk SQLite unit integration. This native mode does not add a third fault
or claim those two new physical-manifest witnesses; the original session/room
witnesses remain its only injected native failures. All existing storage/frame/
log caps, deadlines, ordinary expiry and egress denial stay unchanged. CI runs
this mode as a distinct command with its own `lobby-incident-sources-runtime.*`
raw artifacts; the baseline alone cannot qualify it.


## Combined production sharing controls and public source mode

`npm run test:lobby-session-runtime -- --participation --incident-sources` selects
both real production compositions in the owned Worker. CI keeps separate default,
C3-only, I3-only and combined commands/raw artifacts. A passing single mode does
not qualify the combined path. The actual production C3 mode must be present at
explicit known-new authority initialization so its durable required-mode latch is
seeded by that real initializer; the fixture does not fabricate the latch.

The original nine first-phase and three recovery check groups, original two
native physical fault witnesses and Delta's partial camera-purpose reduction
with close4401 remain. A separate Echo (E) journey runs after those first-phase
checks in its own `#chat-native-safety` report context. The synthetic grant fixture
now admits five lifetime subjects A/B/C/D/E instead of four; this changes only the
bounded test workload, not any production quota, frame/storage cap or deadline.
The legacy `actualGatewayVisitors:3` value retains its original A/B/C meaning.
`originalGatewayVisitors:3` makes that explicit, while `totalRealAdmittedVisitors`
is five named, granted first-phase guests in participation mode (A/B/C/D/E), or
three in other modes. The separate ungranted socket-denial check is outside that
named-participant count. The sharing proof identifies the real E guest separately.

E uses an actual signed SID and synthetic C2 grant, opts into camera signaling,
and calls the real caller-only GET and same-origin Stop POST through betaFetch.
The response schema contains only E's current state, purposes, revision and
control availability. The real C2 withdrawal and immediate engine refresh must
keep E's existing socket open in safety-only state, clear server membership and
camera permission, deny new text/RTC, and accept a report of a message genuinely
delivered to that same socket before withdrawal. B/C's own HTTP projections must
stay unchanged. This is server permission/signaling proof, not decoded camera or
remote P2P transport proof; the separate browser camera evidence has its own scope.

The dedicated report must not include any of the four original ephemeral-body
sentinels in neighbouring context. Combined mode checks exactly two ordinary
reports/source entries and global generation2 after E's report: original source
revision1 and its encrypted I1 case remain unchanged, while only E's new selected
source gets revision2. Full source entries/digests/expiry bounds are checked;
counts are not loosened to minimums. The existing fixed I1 selection remains the
original benign greeting, not a replacement quote.

E closes its real socket before the original two-binding checkpoint, but retains
its issued cookie privately over IPC. A bounded read-only observation confirms
actual connection/binding retirement; it never unbinds or repairs the engine.
After whole owned process loss, real GET must still show E withdrawn at the exact
revision, a fresh hello must be denied, and real logout then invalidates that
cookie. The new-SID/device/IP isolation helper preserves its original `.12` default and
receives E's `.16` explicitly for the new recovery journey. No old proof or
production admission rule is changed. All60s/6s deadlines and command budgets remain;
new setup/barrier sends wait for the current real command-ready deadline before
sending, and no refused action is retried.

The private parent-held I1 test key and synthetic incident/guardian decisions stay
explicitly unqualified. No live guardian enrollment, legal policy, production
purpose key, provider, deployment or public all-ages activation is supplied.

## Optional healthy native ACK probe

```sh
npm run test:lobby-session-runtime -- --participation --traffic-acks
```

This separate optional fixture mode keeps the original nine first-phase and
three recovery check groups, two native rollback faults, and participation/own-
sharing journeys. It requires C3 and refuses an incident-mode combination; the
four existing commands retain their existing workload when the flag is absent.
It changes only this local fixture, not application limits, authority, TTLs,
provider state or deployment configuration. It installs nothing.
CI runs this mode separately as `npm run --silent test:lobby-session-runtime --
--participation --traffic-acks`, retaining `lobby-traffic-acks-runtime.stdout.log`,
`.stderr.log` and `.exit-code.txt` in the existing runtime diagnostic artifact.
The existing job and runner deadlines remain unchanged.

Alpha, Bravo and Charlie negotiate `transport:1` on their actual cookie-bound
WebSockets. Their raw incoming envelopes must carry contiguous sequences from
one once sequencing begins; only initial `device` and `hello` frames before
the first sequenced frame may be unsequenced. Before a separate semantic copy removes **only** `transportSeq`,
the visitor validates the raw envelope and records bounded count/byte/kind/time
summaries plus a SHA-256 of the exact sequenced envelope stream. The original
semantic assertions therefore remain independent of transport decoration.

ACKs use the page's existing policy: highest processed sequence, an eight-frame
or 50 ms flush, and at least 50 ms between actual sends. Timers are cancelled on
close, error and runtime cleanup. No fake replies, application clock, retry or
per-message inspection/barrier is used. Before and after the workload, a nonce-
only lightweight control reads actual delivery/control-budget counters and
serialized native socket sequence, ACK, control-count and prepaid remainder.
Numeric slots come from the three real current bindings and remain stable when
Alpha's Stop clears its nickname; no fixture identifier is written to storage.
Each **same socket** must accept more than 20 new controls. Client sends must
match server-consumed controls; reservations and each socket's remaining grant
must reconcile exactly at the existing 20-control boundary. Native storage-method
and transaction counts are observed by the existing test wrapper, not inferred
Cloudflare kernel or invoice measurements.

After a real 3,300 ms slow-mode warmup, 22 unique short public lines rotate among
three guests at least 1,100 ms apart globally and 3,300 ms per author. The intended
steady schedule spans 23.1 seconds; real lateness is recorded and delays the next
send rather than creating a catch-up burst. Each line must reach all three peers
exactly once, and the sender must receive its separately correlated `published`
result. Latency summaries distinguish sender disposition from the 66 peer
observations. No percentile is promoted to a public SLO or a pass threshold.

Alpha then calls the real own-status/Stop HTTP flow, remains on the same socket
in withdrawn revision 3, receives a rejected new-publication result, and receives
no later public lines. Bravo/Charlie continue publishing and ACKing; their own
projections remain unchanged. The original later Echo same-socket selected-
report/close/restart journey is unchanged. Alpha cannot report its own earlier
selected line, so this mode does not manufacture another report or preserve hot-
loop text. The ordinary logical/raw absence scan additionally checks the common
probe marker, including after cold recovery. The selected report/privacy
semantics remain unchanged.

The fixed 60-second child deadline, six-second waits, 2 MiB/2,000-frame visitor
bounds and every production policy/control/storage/checkpoint cap remain. Full
inspection/raw scans happen outside the timed workload. This mode adds no slow
or non-ACK reader; that is a separate bounded pressure qualification. Existing
whole-process loss, new-runtime recovery, binding retirement, same-SID authority
checks and owned-process/temporary-state cleanup still run.

Results are small native-local Node/Miniflare/WebSocket-bridge end-to-end samples
on the recorded host. They include IPC, serialization and scheduling; they are
neither isolated workerd CPU/SQLite latency, physical browser/WAN behavior, a
150-native-client throughput tier, a soak, hosted capacity/cost, nor guardian or
provider qualification. The source-bound receipt reports no cookies, identities
or message-body arrays in the probe metrics.
