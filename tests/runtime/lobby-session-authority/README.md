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

The plain `--participation` run also adds a C2 retention proof **after** its
canonical visitor/rollback/Stop/report assertions. Other modes keep their
existing journeys. This adds no CLI flag, workflow step, production endpoint,
policy change, clock override, wait cap or capacity increase. The two added
healthy-peer barriers reuse the existing command-budget pacing and timeouts.

A nonce-only fixture control clones an actual stored C2 schema into one
explicitly synthetic, expired historical target: one subject, guardian,
receipt, pending row and two operation rows, with nine matching owned logical
keys. The production record validator must accept it before the real codec
commits it in native SQLite. Each logical key must also have a raw native
manifest and at least one chunk in its exact part prefix inside that seed
transaction; the later raw absence checks cannot pass against an empty or
misaddressed namespace. Its past windows use the actual finite policy
tails and may precede the fresh fixture policy's issuance; this is a stored
schema/cleanup boundary, **not ordinary issuance chronology, enrollment or
guardian verification**. It allocates no visitor or affirmative permission.

At most four invocations of the existing actual alarm handler allow the
unchanged four-record cursor page to wrap past the six stored subjects. The
proof checks target partition/reference/index absence through both decoded
records and raw manifest/chunk prefixes. The current healthy guest's active
subject, guardian, receipt, purposes and subject revision remain exact. Only
pending/operation entries whose stored deletion deadline has passed by the
completed alarm may disappear; their surviving entries cannot change.

Complete existing logical/raw privacy scans and canonical room/report/native
rollback state are checked again after those real peer barriers. Every alarm
and cold read must leave both evidence storage and authority healthy; an alarm
that returns after marking storage degraded cannot pass. The existing owned
process kill and fresh native-disk reopen must retain deletion, healthy
permission and cursor state.
Only counts, digests and booleans enter the added receipt; signed cookies still
travel solely over the existing private IPC channel. This qualifies the actual
local alarm **handler** only when its source-bound run passes. It does not prove
hosted alarm delivery, deadline/SLO guarantees, backup erasure, a new native
retention-fault injection or real parental/legal rights handling.

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


## Separate native non-ACK pressure proof

```sh
npm run test:lobby-session-runtime -- --participation --pressure-only
```

This optional mode uses a fresh owned namespace and refuses incident/traffic-ACK
flags. It does **not** claim the original nine-plus-three checks, two faults,
Delta4401 or Echo reporting/Stop journey; the five existing commands keep those
unchanged. This mode has its own three real cookie/SID-bound C3 guests and a
one-binding process-loss checkpoint, all within the existing five lifetime
synthetic consent-subject/four-current-guest fixture bounds. No production quota,
TTL, deadline, provider or application source is changed. The existing native
workflow runs this separate command and retains its exit status, stdout/stderr
and source-bound diagnostics within the unchanged job deadline.

Two guests negotiate transport v1 and use the existing frontend ACK pacing. A
third also negotiates v1 and validates/hashes the same contiguous raw envelope
stream, but never schedules or sends an ACK. Initial unsequenced frames are still
restricted to device/hello. Setting transport to legacy would test a different
512-frame allowance and is not used here.

At most fifteen fresh real `/help` commands produce production HELP notices.
The first nine sends wait at least25ms each, then sends wait at least1,100ms;
hello's command token and the unchanged ten-command/one-per-second bucket stay
in force. The runner validates the actual notice digests and fixture-observed
production HELP indices, including a permitted final prefix at pressure close.
Refusal/error chatter cannot qualify. It stops sending at the first actual
close/CLOSING state, with no refused-action retry or manufactured output.

Nonce-only registration derives the probe from its actual HMAC-verified current
cookie and real binding. The Worker adds a bounded pass-through observer to the
actual production delivery sender and that one native socket's `send`: unchanged
payloads still go through their original functions. At the refused129th envelope,
the real attachment must show sequence128, ACK0,128 pending entries, and bounded
bytes; the production pressure counter must increase exactly once, native send
must not be invoked, and aggregate pending credit must fall by the exact probe
window. The received raw sequence1..128 and actual completed native sends must
agree. If a runtime does not permit that read-only native-send instrumentation,
this fixture fails rather than substituting fake evidence. Only indices, counts,
lengths, numeric slots and digests are reported; no new durable fixture records,
transcript, cookies, device IDs or principal fields are added.

Healthy guests publish and ACK before/during/after pressure at the real per-author
slow-mode pace. Only the probe may close4413. Its engine and durable binding must
actually retire before a later stage, not merely disappear from the client.
Native control consumption and saved prepaid remainders must reconcile for the
healthy sockets. Real logout then closes one healthy guest4401 and rejects cookie
state/upgrade replay; the other continues while both departed sockets receive
no new frames. Current logical/raw scans require no unselected marker retention
and no reports are created in this mode.

Exactly one healthy binding remains at the pressure-only checkpoint. The parent
kills that owned runtime without first disposing the visitors. Fresh-process
recovery retires the missing socket's old binding, keeps the revoked cookie
denied and lets the still-current SID establish a **new** C3 binding without old
chat. It does not claim the old binding survived. Normal close1000, runtime
disposal, owned-process retirement and temporary-state removal stay required.

All60s child/6s waits,2MiB/2,000-frame Visitor bounds and production128-frame/
16MiB per-socket and8,192-frame/32MiB global windows remain. The result is local
Node/Miniflare/native application-ACK credit isolation, not physical slow TCP,
browser suspension, shared high-fanout capacity, WAN,150-native scale, soak,
hosted cost/SLO or real guardian/provider qualification. No pressure execution is
implied by source or syntax checks alone.


## Explicit close-order diagnostic (not qualification)

`npm run --silent test:lobby-session-runtime -- --participation --traffic-acks
--diagnose-close` permits one explicitly selected observational mode. Only after
engine initialization, its first traffic-metrics call installs pass-through
observers on the real engine disconnect and authority unbind. They preserve the
actual returns/throws and add no storage operations. At most32 anonymous numeric/
allowlisted events and an overflow flag record engine/empty-nickname/live counts,
result status and ordering. Inspection additionally marks before/after load and
return. On a checkpoint mismatch, the existing exact assertion includes this
bounded metadata; its predicate, wait and all limits remain unchanged. No IDs,
cookies, bodies or raw error stacks enter the observer metadata. A passing run
means no reproduction in that instrumented run, not a close-retirement fix or
normal-mode/overall qualification. The canonical six modes do not install these
observers when the diagnostic flag is absent.

## Separate fifty-guest native fanout mode

```sh
npm run --silent test:lobby-session-runtime -- --participation --fanout-50
```

This new optional mode refuses incident, three-client traffic, pressure and close-
diagnostic flags. Unknown parent arguments are refused by the existing exact CLI
check. Its distinct `nativeLocalFiftyGuestFanoutQualified` result requires fifty
real signed guest cookies/SIDs, fifty successful actual native WebSocket upgrades
and nickname joins, and fifty current C3 grants from the existing explicitly
synthetic operator/guardian adapter. Fifty control registrations alone cannot
pass. Each guest uses a distinct fixture IP, retaining the real twenty-mints-per-
IP/hour check. No staff identity or production authority/consent bypass is used.

Only this profile permits fifty synthetic subjects and fifty-member inspection/
metrics; the existing five-subject, four-current and three-client canonical
fixture profiles remain unchanged. All production lobby (150 guests) and room (8 guests), binding200,
record/transaction/checkpoint/abuse/request/transport caps and provider-off states
remain. This is the first 50 native tier, not admission to the150 ceiling.

All fifty sockets negotiate transport v1, witness continuous raw sequences before
semantic normalization and use the existing eight-frame/50ms ACK policy. Twelve
unique ordinary public messages rotate twelve different authors at least 1,100 ms
apart, with no catch-up burst or action retry. Exactly 600 recipient line copies
and twelve correlated published sender results must arrive, with no duplicates
or missing recipients. Before/after delivery/control counters reconcile each
socket's actual ACK consumption, reservations and serialized prepaid remainder.
Latencies report native-local Node/Miniflare bridge observations with sample
counts, not isolated workerd latency, a public SLO or invoice cost.

Only the fifty-guest visitor phase also emits fifty ordinal-only paired admission
rows. The original full `admission` samples still start before unlock and end after
the authoritative join; the same unrounded total is retained in each row. Existing
operations are timed separately through parsed unlock HTTP response, parsed
synthetic C2 grant HTTP response, native upgrade response 101, observed server
hello, and client hello send through authoritative join. The remaining runner
gaps are added as a nonnegative residual. Ordered monotonic timestamps and finite,
nonnegative component bounds are checked, and their sum must reconcile to that
row's unchanged total within floating-point precision; values are not clamped or
rounded to remove cost. There are no component percentiles to add together.
Pair rows by ordinal when locating the components of a slow full admission.

This is measurement, not an admission fix: the existing full-admission p95 target
of less than 1,000 ms remains, and the prior observed admission misses are not
reclassified by separating synthetic consent cost. Fifty compact numeric rows are
bounded to 32 KiB before pretty-printing, with no names, cookies, IDs, IPs or bodies.
No worker controls/RPCs, pregrants, parallel admission, inspections, ACK changes,
timer resets or altered workload/targets are introduced. Other modes and cold
recovery collect no new timing spans. Node/Miniflare bridging, response parsing,
queueing and scheduling are included; these spans cannot isolate workerd CPU,
SQLite time, hosted latency or billing.

The fifty-guest mode's existing before/after/final metrics also carry passive
native storage counters. Seventeen fixed family labels classify known authority,
participation and room-record prefixes; alarm operations have their own label,
and unknown namespaces or batch shapes use fixed `other` buckets. Classification
compares encoded prefixes without decoding or returning dynamic keys or IDs.
Each actual get/put/delete/list/alarm call records a family/method attempt and its
returned or thrown result; native transaction calls record started/committed/
rejected outcomes. These are API-call observations: a returned write can still
be rolled back by its enclosing transaction. They are not accepted publications,
kernel operations, billable requests or CPU measurements.

The counters use only the existing pass-through storage proxy and metrics calls.
No SQL read, RPC, key, body, timer, projection or permission decision is added.
Snapshot cardinality is fixed, counters are nonnegative safe integers, and an
overflow is reported rather than silently losing counts. Family/method totals
must reconcile to the existing native-method counter; returned and thrown calls
may not exceed attempts. Only this FANOUT50 mode allocates or exports them.
Instrumentation has observation cost that remains in the original workload.

Exact resolver invocations, prepared-roster totals and cohort sizes are explicitly
unavailable. The production authority is frozen and captured by its adapters;
this fixture does not replace that authority with an observing permission facade
or infer resolver counts from read patterns. The same passive counters can bind
an unchanged-production baseline and a later reviewed optimization, but neither
family totals nor the paired spans alone establish latency attribution.

Real logout closes one guest with close code 4401 and denies its cookie state/upgrade replay. The
other 49 remain native members and ACK a real ordered names response. Their
actual durable/session/binding convergence must reach 49 before the checkpoint.
The owned runtime is killed with those 49 connected; fresh-process recovery must
prune all 49 missing sockets, retain revocation, and let one current SID create a
new binding without old chat. Its normal close with code 1000 and owned-process/temporary-
state cleanup remain required. No earlier binding is claimed to have survived.

Complete logical and raw privacy scans run before the kill and after cold
pruning, without creating a selected report. Continuations are opaque, one-use,
nonce-bound and never expose keys or values. Each pass reads at most 256 rows/
8 MiB. The new profile has fixed ceilings of 1,024 logical rows, 2,048 physical rows,
3,072 combined rows and 32 MiB combined, with at most 14 passes. The initial planning
estimate of 1,024 combined rows was never executed: the real fifty-subject shape
already needs about 515 logical records and at least 1,030 physical manifest/chunk
rows. The revised finite limits are explicit test-profile bounds, not changes to
canonical scans or production record guards. A bound, mutation-counter change,
missing required record, unfinished scan or retained ordinary marker fails the
mode; nothing is truncated or automatically expanded. Full logical decoding also
checks markers across physical chunk boundaries; the raw scan visits every
physical row and checks its contents separately.

The original 60-second child deadline includes bundling, every admission, traffic,
privacy and checkpoint work. Six-second waits and each Visitor's 2 MiB/2,000-frame
bound remain. This mode does not shorten the fifty-client/600-delivery workload
if time is tight. Its first-phase and recovery groups are separate from original
9+3, injected-fault, Stop/report and pressure proofs. Sixteen-client reconnect
storms, many-room/30-room recovery, 150-native load, longer soak, physical browser/
WAN, hosted capacity/cost and real guardian/provider qualification remain open.
