# One community, multiple entrances

Decision confirmed by Jeff on October 25, 2026: Stalemate and Rad Dad open one
shared community address. People, channel/room IDs, ownership and moderation are
shared. Future websites can link into that same experience. Entry-site badges are
optional public display context, never proof of a visit, verified identity,
band membership, room authority or moderator status.

The initial entry links are ordinary top-level navigation. They need no shared
cookies, cross-origin API credentials or embedded frame. The community keeps its
own first-party session. Preserve the existing canonical service, Durable Object
namespace and lobby ID through release; deploying a separate namespace for each
band would split the community. Changing a visible lobby label does not justify
breaking existing links or ownership IDs.

## Entry behavior

- `?via=stalemate` displays “via Stalemate”; `?via=rad-dad` displays “via Rad Dad”.
- The join form discloses the badge and lets the visitor hide it. The People
  control can change visibility during the session. Earlier delivered messages
  retain the source label originally shown, like the rest of session scrollback.
- Direct, invalid, repeated or unknown `via` values are neutral. A nickname does
  not gain a prefix or change identity because of an entry source.
- A short-lived, one-use tab handoff carries a choice through invitation/sign-in
  navigation. It is not a persistent cross-site browsing history.
- Trusted return links point to `https://stalemate.band/` or
  `https://raddadband.com/`. Rad Dad's current public source canonical URL was
  read at revision `eb341772916be85c79064b472d97b41314badfa7`; this is source
  evidence, not a production response check.

The server explicitly advertises `features: { entrySources: 1 }` in its initial
hello. The client requires that exact numeric version before sending a dynamic
`entry-source` frame. A server without it keeps ordinary chat usable, hides and
disables badge controls, explains that badges are unavailable, and preserves the
visitor's own safe return link. Reconnection requires a fresh capability; it does
not reuse support from a previous server. A sharing change between hello and
welcome is reconciled before the connected client sends its next message.
These are protocol capabilities, independent of account and staff capabilities.

The People panel also lets a visitor pause screen-reader chat announcements.
Previously received scrollback stays quiet while channel navigation repaints
it; pausing announcements does not remove messages. Automated DOM/browser checks
establish these controls and ARIA state, not a completed human assistive-technology
assessment. Physical phone keyboard and screen-reader qualification remain
separate checks.

## Version 1 public integration package

The trusted configuration format is in `community-integration.example.json`.
It deliberately contains an example community URL and **disabled, unverified**
sites. The release owner must confirm the real approved community entry URL and
domain control; setting `domainVerified` in JSON records that operator decision,
and does not perform DNS verification or supply authentication.

Supported permissions are only `link`, `badge` and `return`. Return navigation
requires badge/source context; built-in badge entries retain their fixed return
links. Each enabled site
must be verified, have exact HTTPS origins and an allowlisted ID/label. Return
navigation must stay on a registered origin. Unknown fields—including accidental
credential fields—are rejected. Unsupported admin/moderation/identity permissions
are rejected. A future SSO/API integration requires a separately reviewed
authorization contract; this version does not silently confer it.

After reviewing a separate public configuration file:

```sh
node scripts/package-community-entry.mjs --config reviewed-community.json --out /tmp/hangout-entry-review
```

The output directory must not already exist. The command writes one small HTML
snippet for each enabled site, a public manifest and a README. It never copies
the repository, backups, private assets, cookies, invitation codes or credentials,
and never deploys either website or modifies Worker origins. Review the generated
snippets before the owning website session adds them to navigation. Preserve Rad
Dad's permanent `/tap/` → `/qr/` route and both websites' existing media consent,
navigation and packaging boundaries.

The link helper uses the canonical community address plus `via`. Initial band
badges are built in. Additional approved badge sites must also be configured in
the canonical Worker's public `HANGOUT_ENTRY_SITES` JSON array, for example:

```json
[{"id":"makers","label":"Makers & Friends","home":"https://makers.example.test/"}]
```

This is an example of the configuration shape, not a real enabled partner.
The Worker supplies the same sanitized registry to the client and engine.
Maximum 30 additions, bounded labels and IDs, HTTPS optional return homes and
immutable built-in labels prevent arbitrary query text or scriptable links from
becoming UI. No registry entry grants account or staff capabilities. Privacy-safe
analytics must not record nicknames, entry parameters or conversation text.

Removing a custom registry entry makes that badge neutral. Disabling a site in
the integration configuration stops generation of its approved links. Because
this is an open community, neither step bans people, prevents someone sharing
the ordinary community URL, nor deletes existing accounts/rooms. Global abuse
controls remain independent of entry site.

## Measured scope and overload behavior

The current architecture still coordinates the shared lobby and its open rooms
in one authoritative `HangoutLobby` object. Multiple entry sites do not create
additional lobby capacity. The existing 150-visitor lobby policy, eight-person
creative-room policy and other admission limits remain unchanged; they are
configuration/engine limits, not measured hosting guarantees. A busy single lobby
and large room snapshots need separate hosted measurements before selecting a
fan-out/sharding design. Private encrypted relay rooms and native audio have
separate transport and qualification boundaries.

`socket-delivery.mjs` adds the following bounded accounting. These are logical
delivery limits, not a promise about Cloudflare's physical queue memory:

| Limit | Current source value |
| --- | --- |
| One outgoing frame | 8 MiB + 64 KiB, preserving existing valid activity snapshots |
| One socket's outstanding window | 16 MiB and 128 frames |
| Shared outstanding window | 32 MiB and 8,192 frames |
| Legacy window without an observable transport buffer | 512 lifetime frames, also subject to byte limits |
| ACK controls | Burst 32, refill 20/second, 4,000/connection, at most eight consecutive duplicates |
| Local queued application work | 256 tasks and 4 MiB, with a separate bounded 256-task cleanup allowance |

The new browser negotiates `transport: 1`, coalesces handled-frame ACKs after
eight frames or a 50 ms timer, and spaces emitted ACKs at least 50 ms apart.
It cancels pending ACK work on disconnect/replacement.
The server validates issued sequence credit and restores metadata-only ledgers
from live socket attachments on hibernation. No transcript/replay queue is added.
Because custom clients can claim an issued sequence without honestly reading,
the ACK window is not proof of a hard runtime-memory bound against dishonest
peers. Actual observable buffer pressure is checked where the API exposes it.

ACK controls also use the existing shared request budget. The internal adapter
prepays blocks of 20 controls from one durably reserved request unit before
honoring credit; grants are scoped to a live socket and UTC day. Unused slots
are conservative reservations, not a separate free allowance or a refundable
browser token. Request-unit accounting does not cover duration, storage rows,
calling Workers, provider usage or account-wide charges.

New clients pause after protocol/resource closes and offer deliberate recovery.
Older clients receive a reload notice and the existing terminal close code
`4001`, preventing their legacy automatic reconnect loop. The complete
compatibility and rollback matrix is in
[the release handoff](HANGOUT_SHARED_COMMUNITY_HANDOFF.md).

Presence-only `chan` and room-directory projections from joins/departures now
share one non-resetting 50 ms scheduling timer. The queue keeps at most 32 room
name/generation pairs and directory/all-active bits, never messages, snapshots,
identities or old recipient lists. Each adapter serializes the flush with
application mutations and computes current authorized membership/visibility.
Dirty markers are staged only after required storage commits; pending or failed
room storage blocks projection. Room generations prevent a closed/recreated
name from inheriting an older dirty marker. Overflow recomputes current active
rooms rather than retaining more names.

Initial join/activity snapshots, explicit `/list`, chat/events, report replies,
signaling and policy/role/camera/privacy updates stay immediate after their
required commits. Direct engine callers retain synchronous behavior unless they
opt into the scheduler. The 50 ms value is a scheduling delay, not a guaranteed
delivery deadline when serialized work is busy. A pending short timer keeps a
Durable Object active until it drains; idle hibernation restores memberships and
transport ledgers without replaying a dirty snapshot or chat. No extra storage
schema, history queue or raised transport cap is introduced.

An earlier local scale receipt is
`StalemateSite/.local/webjam-product-finish/shared-community-load50-20261025-paid-controls.json`,
started October 25, 2026 at 18:32:43 UTC, with SHA-256
`5de1e410b4b8d7a579d6805b94efe01a6fd9bc297a1d1cc7e1c53c18fe3de310`.
It uses 50 synthetic clients, five hot-lobby markers and 10 rooms. It records:

| Observation | Local result |
| --- | --- |
| Join | 50 samples; p95 6.031 ms, p99 21.263 ms |
| Hot lobby | 250 deliveries; p95 3.464 ms, p99 3.533 ms |
| Ten rooms | 50 deliveries; p95 1.221 ms, p99 1.242 ms |
| Recovery | Reconnect/restart offered no chat backlog; 10 room records restored |
| Pressure | Peer withholding ACKs closed with 4413; healthy peers continued |
| Outstanding delivery peak | 1,060,254 bytes and 457 frames across the local relay |
| Shared request accounting before restart | About 139.65 units used of 40,000; 81 control units reserved for 1,140 consumed ACKs, with 480 unused prepaid slots |
| Entire Node test process | Peak RSS 82,355,264 bytes (78.54 MiB), including synthetic clients and the harness |

This roughly nine-second loopback run is a smoke/load sample, not a sustained
capacity test or release SLO. Persistence uses a local memory adapter; the
pressure peer consumes frames but withholds ACKs. It does not test physical TCP
suspension, Cloudflare storage/hibernation, Access, geographic latency, hosted
costs, media providers, TURN or native audio. The receipt has no embedded Git SHA;
attach exact source/artifact hashes before using it in a release decision. Later
source changes need their own appropriate evidence. Larger 200/1,000-client
tiers from the research brief require a separately approved staging design,
cost ceiling and explicit stop conditions; this work does not raise production
limits or authorize paid load.

The subsequent 150-client/30-room check exposed a real regression. The first
run failed because a healthy peer closed with `4429`: immediate ACKs every eight
frames could exceed the unchanged 20-controls/second server allowance during
join bursts. The failed receipt is retained as
`shared-community-load150-20261025-diagnostic.json` (SHA-256
`09edfee3bb6e4b5dd2e0a28d3937d3d8fbe328c0ec311025d10d4ae66b56ff0a`).
The browser and harness now pace emitted ACKs to at most one per 50 ms; server
limits were not raised to make the run pass.

The fresh run passed with receipt
`shared-community-load150-20261025-paced-controls.json` (SHA-256
`007bfe5e4a3736f6e0c11136af022573ec2754ed4e15fcb7408ab74232d97d32`),
started at 18:42:22 UTC. Both files are in the same local product-evidence
directory as the 50-client receipt. The passing wrapper records source hashes
for the harness, relay, engine, delivery, control budget and browser client.

| Observation | Larger local result |
| --- | --- |
| Scope/duration | 150 synthetic clients, 10 hot-lobby markers, 30 rooms; about 12.76 seconds |
| Join | 150 samples; p95 20.885 ms, p99 23.946 ms |
| Hot lobby | 1,500 deliveries; p95 14.862 ms, p99 15.194 ms |
| Thirty rooms | 150 deliveries; p95 3.423 ms, p99 6.373 ms |
| Recovery/pressure | No reconnect/restart backlog; 30 room records restored; withholding-ACK peer closed while healthy peers continued |
| Outstanding delivery peak | 9,148,228 bytes and 2,478 frames |
| Request accounting before restart | About 558.9 units used; 389 control units reserved, 5,938 ACKs consumed and 1,842 unused prepaid slots |
| Entire Node process | Peak RSS 183,507,392 bytes, including synthetic clients/harness; not isolated server memory |

This stronger sample still does not establish sustained production capacity,
Cloudflare memory/hibernation behavior, physical suspended-client behavior or
hosted cost. Keep the failed run, explanation, fix and fresh receipt together;
bind final release evidence to the final reviewed revision rather than replacing
the failed observation with an unchanged retry.

Adding 16 simultaneous reconnects then exposed another real failure: full
presence/directory snapshots from every departure and arrival filled the shared
32 MiB window before paced ACKs released credit. The preserved diagnostic
`shared-community-load150-20261025-churn-review-01.json` records a healthy peer
closing with `4413`, peak pending 33,554,372 bytes, and 134 pressure closes.
The earlier `shared-community-load150-20261025-churn-cap.json` is also retained.
Those observations motivated the bounded presence scheduler above; caps and
admission limits stayed unchanged.

The source-hashed follow-up passed in
`shared-community-load150-20261025-coalesced-presence-01.json` (SHA-256
`43a8d0ff4820af1cadf3183bd3362eaa05cad0dcfb5fb0b4dc6f123c82a4c558`).
The wrapper confirms its eight recorded source files stayed unchanged during
the run, completed at 19:00:26 UTC. This is the first listed sample that includes
the simultaneous 16-guest churn stage:

| Observation | Coalesced local result |
| --- | --- |
| Scope/duration | 150 synthetic clients, 10 hot-lobby markers, 30 rooms; about 17.69 seconds |
| Join | 150 samples; p95 8.581 ms, p99 16.616 ms |
| Hot lobby | 1,500 deliveries; p95 12.709 ms, p99 16.608 ms |
| Thirty rooms | 150 deliveries; p95 1.825 ms, p99 6.210 ms |
| Burst recovery | All 16 simultaneous guests rejoined in 149.369 ms; no earlier chat offered |
| Restart | 30 room records restored; no backlog and no ordinary chat in persisted state |
| Pressure | Exactly one intentional non-ACK peer closure; healthy peers remained connected; zero control closes or send failures |
| Outstanding delivery peak | 5,114,474 bytes and 2,554 frames |
| Delivery before restart | 47,063 frames and 139,903,769 bytes |
| Presence queue | 708 markers, 135 flushes, peak 17 room IDs; no overflow or scheduler failure |
| Shared request accounting | About 1,249.75 units used of 40,000; 1,062 control units reserved, 20,411 ACKs consumed and 829 unused prepaid slots |
| Entire Node process | Peak RSS 146,420,544 bytes, including synthetic clients/harness |

The later workload includes new churn and takes longer, so these totals are not
a controlled cost/performance comparison with the earlier runs. Request and
storage-write costs still need hosted qualification. Preserve failures as well
as this passing result. It demonstrates one bounded loopback scenario, not a
sustained production capacity, Cloudflare runtime or physical suspension claim.

## Identity and existing work

Source review found static website packages, not a demonstrated consumer login
provider on either band website. Guests can join under the existing admission
policy. Verified room ownership and staff authentication remain separate from
source badges. Preserve the current stable HMAC account mapping/key; any future
issuer/subject identity broker requires an explicit ownership migration and
authenticated account-linking procedure, never email/nickname-only merging.

Fresh remote reconciliation found website main `b1b947d` contains no Hang Out
application. This work starts from application candidate `c91c625` (PR82), not
from the old primary checkout or an unrelated website rewrite. PR77 has merged
into its application parent with a recorded Karen pass; PR79 is closed without
`mergedAt`, while PR80–82 remain open. Those facts do not authorize merging the
stack or prove it is deployed. The release owner must reconcile the closed PR79
dependency and the current website main through normal review. Native PR399
still requires its own review/release resolution and platform qualification.

## Evidence and boundaries

`tests/unit/community-integration.test.js` exercises both band links, a registered
third site, revocation, neutral links, configuration/URL attacks and exclusive
clean packaging. `tests/e2e/community-entry.spec.js` runs three distinct loopback
website origins into one real local relay, with entry labels, badge hiding,
shared chat/drawing, fresh-join privacy and 375/390px screenshots. The partner
registry, website pages and local identities are named test fixtures. They do
not prove real hosted domains, Access sign-in, DNS verification, physical phone
keyboard behavior or native audio.

The service's current age/media protections stay in force while the all-ages
consent/capability path is qualified. Read `HANGOUT_PRIVACY_AND_INCIDENTS.md` and
`HANGOUT_DATA_INVENTORY.md`; legal applicability and operator/staffing decisions
remain explicit launch dependencies. AI provider/child-data readiness assertions
are a separate gate, not a consent checkbox or legal certification.

The local `shared-community-20261025/production-dependency-audit.json` records
an official `npm audit --omit=dev` run with zero reported advisories and a lock
hash. Installed direct dependency licenses were inventoried separately. This
does not certify security or complete a transitive/native license review.

Application source, tests and integration artifacts belong to this session.
StoryPool 10-21-26 owns core, Karen, deployments, locks/holds and shared
operational files. Hand over exact revision/test/package evidence; do not change
those systems here. No public release, purchases, provider calls or paused
TURN/vault work are authorized by this document.

Use [the migration, configuration and review handoff](HANGOUT_SHARED_COMMUNITY_HANDOFF.md)
for the release-owner checklist. A source-tested application package is not a
deployed, legally qualified all-ages launch.
