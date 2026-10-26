# Shared-community load and recovery qualification

These are application acceptance targets and a receiving-owner staging plan,
dated October 25, 2026. They do not approve a deployment, change limits, authorize
spending or establish hosted capacity. Read the measured results and retained
failures in [the shared-community guide](HANGOUT_SHARED_COMMUNITY.md).

## Local targets

Run the existing loopback harness with unchanged application policy:

```sh
node scripts/measure-hangout-local.mjs --clients 50 --rounds 5 --rooms 10
node scripts/measure-hangout-local.mjs --clients 150 --rounds 10 --rooms 30
```

The following engineering targets leave headroom above the observed local
baseline. They measure protocol admission/delivery, excluding human invitation,
email, challenge and media setup time. They are regression criteria for this
synthetic workload, not public performance promises.

| Criterion | Local acceptance target |
| --- | --- |
| WebSocket/nickname admission | p95 under 1,000 ms; every expected guest admitted |
| Hot-lobby and many-room text | p95 under 250 ms, p99 under 1,000 ms; all expected deliveries present |
| Reconnect burst | Sixteen simultaneous guests rejoin within 5 seconds; no earlier chat offered |
| Isolation under pressure | Exactly the intentional non-acknowledging probe closes; healthy peers continue |
| Saturation | The 151st ordinary guest receives HTTP 429 with the existing 150-guest limit |
| Recovery/privacy | Thirty room records restored; no ordinary message bodies stored or replayed |
| Bounded work | No serial-queue rejection; logical delivery and projection queues stay within source limits |
| Durable control accounting | Consumed controls equal accepted ACKs; persisted prepaid slots cover them; no reset after wake |

The source-hashed coalesced-presence run satisfies these assertions. The earlier
failed runs are important evidence: fast ACK bursts first hit the control rate;
then repeated full presence snapshots caused an aggregate-window disconnect
cascade. Neither failure was resolved by raising caps or omitting recipients.
One short passing run is not a soak test or proof against every adversarial
reader. Raw private-room relay and media traffic have separate limits.

## Separate native fifty-guest workload

The explicit local command is:

```sh
npm run test:lobby-session-runtime -- --participation --fanout-50
```

This mode must admit fifty distinct real gateway cookies/SIDs and actual local
WebSockets through the production C3 composition. Test-only controls supply
explicitly synthetic guardian decisions; no real enrollment is qualified.
Twelve distinct authors each publish one paced lobby message. All fifty guests
must observe each message exactly once, giving 600 line deliveries and twelve
published sender results. Raw sequence, ACK and prepaid-control accounting must
reconcile without healthy-peer pressure closures.

Actual logout retires one guest and denies copied-cookie replay. Forty-nine
bindings remain at the checkpoint; a fresh process must retire those lost
bindings, preserve the revoked SID denial and let a current SID reconnect
without earlier chat. Complete bounded logical and physical scans check that
ordinary messages were not stored. A failure is retained rather than resolved
by omitting guests, recipients, state or existing protections.

Run receipts are required before claiming this workload passes. It uses the
existing sixty-second phase deadline and production limits. Existing canonical
modes retain their assertions. It does not prove 150 native guests, thirty
native creative rooms, a sixteen-client reconnect storm, sustained load,
physical slow TCP, browser suspension, hosted performance or native audio.

Wrapped storage-method counts remain diagnostic, not billable usage. Cloudflare
separates incoming WebSocket request billing, active duration and storage;
local counters do not establish an account invoice or cost ceiling. See the
[current pricing dimensions](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[workload-dependent object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
and [hibernation behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
No hosted load, deployment, provider activation or spending is authorized here.

## Hosted staging handoff

The later public-room camera/blocking candidate adds a separate browser activity
pacer and compact pair-policy updates, described in [the media contract](HANGOUT_MEDIA_BLOCKING.md).
Its retained engine fixture admits eight ordinary visitors and 50 synthetic
trusted staff to 30 rooms using real actions and unchanged limits. The old
22,997,580-byte refresh rolled back Block at the 16 MiB stage ceiling; the compact
update commits the same action with 63 frames / 7,260 encoded bytes. This proves
that regression case only, not the maximum number of staff, hosted capacity,
throughput or a public SLO. Re-run relevant acceptance checks on the selected
candidate; do not transfer the earlier load result to changed source silently.

StoryPool 10-21-26 owns the actual isolated deployment and monitoring. Start with
50 visitors and only attempt the existing 150-visitor ceiling after the lower
tier passes. The previously proposed 200/1,000 tiers remain future investigation
targets: they cannot run against this policy without separate capacity work and
the existing release owner's normal decisions. Do not silently change limits.

For each permitted tier, record source/asset revisions, bindings, geography,
duration, posting rate, room distribution, reconnect/suspension pattern and
moderation overhead. Begin with a short baseline and a budget calculation before
a longer soak. Repeat hot-lobby, many-room, sixteen-client reconnect, slow-reader,
hibernation/restart and authorization-revocation checks. Test ordinary WAN/NAT
and physical-browser suspension separately from Tailscale and protocol fixtures.
Provisional text/admission targets above are useful initial staging objectives;
record real percentiles and explain environmental differences before assigning
a public SLO. Measure field LCP/INP/CLS separately from protocol latency.

Keep the existing 40,000-unit lobby request ledger, its 85% read-only and 95%
closed thresholds, connection quotas, per-person abuse limits and media/provider
off states. These controls do not cap the entire Cloudflare invoice. The owner
must account for incoming request/control units, Worker calls, active duration,
storage/rows, account-wide usage and any separately enabled media. Short presence
timers keep the actor awake briefly; hibernation does not erase that duration.
Use the already authorized account/staging cost allowance; if none is established,
hand off that missing input and do not start hosted load or purchase anything.

Stop a tier on unexpected healthy-peer closures, missing delivery, growing
queues/storage, failed identity/revocation checks, unavailable monitoring or the
existing budget threshold. Preserve results and identify the cause before
repeating. The owning session handles pause/rollback through its existing
release process; do not clear rooms, reports, bans, namespaces or holds to make
a run appear healthy.

## Dependency scope

This work adds no package dependency. A local official-registry
`npm audit --omit=dev --json` on the locked JavaScript dependencies reported no
known advisories on the document date. Installed direct-package license metadata
is MIT for obscenity, ws, jsdom and Vitest, and Apache-2.0 for Playwright. The
local receipt records versions and the lock hash. This is neither a full
transitive-license audit nor a review of native WebJam binaries, media providers,
browser engines or application security. Review those artifacts in their own
qualification scope before making broader claims.
