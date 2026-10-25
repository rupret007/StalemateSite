# Shared-community integration and release handoff

Application source assessment, October 25, 2026. This is a reviewable handoff to
StoryPool 10-21-26, which owns core, Karen, deployments and shared operations. It
does not execute a deployment, change a hold, choose a public launch date or
claim legal/platform readiness. Read [the product/integration description](HANGOUT_SHARED_COMMUNITY.md)
and the existing beta identity, privacy and data-inventory documents together.

## Source and review dependencies

The shared-community branch started from application candidate `c91c625`, rather
than website main `b1b947d`, which the initial remote inventory found had no
Hang Out application. The current application branch also includes these
separately reviewable safety slices:

| Slice | Observed source/review location | Required release-owner action |
| --- | --- | --- |
| Preserve accepted reports at queue capacity | [PR 87](https://github.com/rupret007/StalemateSite/pull/87), head `35506907a472fde3e56e17890af7e07b872351ea`, based on `codex/webjam-setup-help` | Revalidate the current head, CI and normal exact-head Karen result. A full intake queue must not silently displace an accepted report. |
| AI provider/child-data readiness gate and design documents | [PR 88](https://github.com/rupret007/StalemateSite/pull/88), head `0249a6a23d92a2e73f29fbf56a556a12dc7edccc`, based on `codex/moderation-queue-capacity` | Resolve the stacked dependency through normal review. Do not enable AI merely because readiness configuration names exist. |
| Shared entry, client controls and bounded transport | [PR 89](https://github.com/rupret007/StalemateSite/pull/89), head `6597aa21ba8f3f338672e3222038269345b73bf7`, based on PR 88 | Source-bound local validation and package receipts are listed below. CI was green and normal Karen review requested on October 25; revalidate the current head/verdict before admission. Neither request nor CI is a Karen PASS or deployment. |
| Inactive purpose-bound participation policy | [PR 90](https://github.com/rupret007/StalemateSite/pull/90), head `61261470c0ed591c2ef7733db40ec5a95afb9c95`, based on PR 89 | C1 pure evaluator only. Real consent/guardian verification, durable receipts and integration/revocation remain separate work. It does not change current beta admission. |

Those heads are source snapshots, not claims that the PRs remain unchanged,
have passed review or are deployed. The initial October 25 reconciliation also
found PR 77 merged into its application parent, PR 79 closed without a merge,
and PRs 80–82 open. Reconcile that application chain and the current website
main without losing either site's independently owned work. Native WebJam
PR 399 and its platform packages need their own current review/qualification;
browser chat does not complete native audio acceptance.

Use the existing review/admission process, including current-head Karen and CI
where required. This handoff adds no substitute approval, fabricated verdict,
lock removal or bypass. If a dependency belongs to StoryPool core, provide its
exact failure/evidence to that owner rather than repairing it in this branch.

## Preserve identity and data authority

- Keep one authoritative community origin/service and its existing Durable
  Object namespaces. Preserve the `LOBBY` binding and `idFromName('stalemate')`,
  the compatibility lobby name `#stalemate`, and stable room IDs. Brand entry
  badges must not become separate namespaces, membership databases or bans.
- Preserve `ROOMS`, `QUOTA`, `TURN_BUDGET` and `BETA_SESSIONS` bindings and their
  existing classes/storage. Quota and beta-session registry paths use the
  existing `global` object IDs. Do not delete/recreate namespaces or rewrite
  migration tags to create a fresh budget or empty registration database.
- Preserve `HANGOUT_HMAC_KEY` and the current lowercase verified-email account
  mapping. It also protects other signed/keyed references; rotation requires a
  specific reviewed migration. A nickname, badge, site ID or copied device token
  is not account ownership. Future identity-provider linking needs verified
  issuer/subject identities and authenticated account linking.
- Preserve room records, ownership/co-host labels, moderation/abuse state,
  report evidence, invitation/session revocation and scheduled cleanup. The
  candidate adds optional entry metadata and socket delivery/control metadata;
  it does not authorize retaining a chat transcript or creating a public backlog.
- Host-only `__Host-hangout-beta` and `__Host-hangout-beta-identity` cookies stay
  on the community origin. A domain move requires a qualified first-party sign-in
  journey; do not export/copy cookies between the band sites. Keeping the HMAC
  mapping and namespace lets verified ownership be recovered after sign-in.

The current beta Wrangler configuration retains the existing SQLite class
migration. No new class or namespace migration is needed just to display entry
badges, reserve ACK request units or package ordinary Join links.

## Configuration inventory: names and responsibilities

This inventory intentionally contains no credential values. Review the selected
entry point and real runtime configuration before release; not every name below
is needed in every environment. Browser/query values cannot set trusted
configuration or staff/readiness decisions.

| Names | Type and purpose | Handoff requirement |
| --- | --- | --- |
| `ASSETS`, `LOBBY`, `ROOMS`, `QUOTA`, `TURN_BUDGET`, `BETA_SESSIONS` | Worker bindings | Keep canonical service/storage authority; package assets and Worker source together. |
| `HANGOUT_BETA_MODE`, `HANGOUT_BETA_INVITE_VERSION`, `HANGOUT_OPEN` | Admission/version/emergency controls | Preserve private-beta settings and existing holds. Version changes invalidate sessions; do not use them as an incidental rollback shortcut. |
| `HANGOUT_BETA_INVITE_KEY`, `HANGOUT_HMAC_KEY`, `HANGOUT_PREVIEW_KEY` | Existing server secrets | Provision through the existing owner-controlled process only. Never put values in entry packages, logs, screenshots or PRs. |
| `HANGOUT_BETA_OPS_KEY` | Separate read-only monitoring secret | Optional existing monitoring path; not an invitation, staff role or publication credential. |
| `HANGOUT_ENTRY_SITES` | Reviewed public JSON additions: `id`, `label`, optional HTTPS `home` | Match the enabled public integration manifest. At most 30 additions; built-in band names/homes cannot be replaced. Absence keeps only the two built-ins. |
| `HANGOUT_ACCESS_TEAM`, `HANGOUT_ACCESS_AUD`, `HANGOUT_OWNER_ACCESS_AUD` | Public Access issuer and distinct staff/owner audiences | Revalidate hostname/path apps and JWT verification on the actual community origin. Do not broaden staff authorization to obtain ordinary ownership. |
| `HANGOUT_OWNER_EMAIL`, `HANGOUT_BAND_EMAILS`, `HANGOUT_MODERATOR_EMAILS` | Trusted role configuration | Existing operator controls initial staff. Site integration permissions never alter these roles. |
| `HANGOUT_MODERATION_CONTACT` | Public report/appeal fallback | Confirm the monitored contact and actual coverage; no continuous-review promise without staffing. |
| `HANGOUT_TURNSTILE_SITEKEY`, `HANGOUT_TURNSTILE_SECRET` | Public site key and separate server secret | Qualify hostname and exact-origin guest challenge; avoid logging tokens. |
| `HANGOUT_AI_MODERATION`, `HANGOUT_AI_DAILY_LIMIT`, `HANGOUT_AI_PROVIDER_READINESS`, `HANGOUT_AI_CHILD_DATA_READINESS` | Optional classifier mode, cap and trusted readiness assertions | Remain off/unqualified while provider and possible child-data prerequisites are unresolved. These assertions do not obtain consent or certify compliance. |
| `OPENAI_API_KEY` | Optional existing provider secret | Neither possession nor configuration of a key establishes provider/child-data qualification. No provider request is authorized by this handoff. |
| `HANGOUT_TURN_ENABLED`, `HANGOUT_TURN_MONTHLY_GB`, `HANGOUT_CF_ACCOUNT_ID` | Optional TURN controls/account identifier | Preserve the paused/disabled state and existing accounting requirements. Do not activate to complete a UI test. |
| `HANGOUT_TURN_KEY_ID`, `HANGOUT_TURN_API_TOKEN`, `HANGOUT_TURN_ANALYTICS_TOKEN` | Optional existing TURN credentials | Paused vault/TURN work remains with its owner. Never recover, copy or print values for this document. |
| `WEBJAM_WEB_ORIGINS` | Exact approved browser-join destination origins | Distinct from website entry origins and staff identity. Do not wildcard it or imply native audio qualification. |
| `HANGOUT_CONNECTIONS_PER_DAY`, `HANGOUT_MAX_PEERS` | Existing bounded private-relay admission overrides | Preserve current limits. A test count or extra website is not authorization to raise production limits. |
| `HANGOUT_EXTRA_ORIGINS`, `HANGOUT_OWNER_RETURN`, `HANGOUT_ADMIN_RETURN` | Legacy/general Worker origins/return configuration | The protected beta uses exact same-origin admission and its own redirects. Ordinary partner links do not require additional socket origins or arbitrary return targets. |
| `PILOT_MODE`, `PILOT_OPERATOR_KEY`, local `HANGOUT_DEV_ADMIN_KEY` | Separate pilot/loopback identity fixtures | Never import synthetic pilot role selection into real beta authentication or public account sign-in. |

The public integration config has version, `communityAddress`, and reviewed
site IDs/labels, exact origins, `returnUrl`, `permissions`, `enabled` and
`domainVerified`. `domainVerified` records an operator decision; the package
builder does not verify DNS. Its only supported permissions are `link`, `badge`
and `return`. It provides no SSO, moderator authority, remote API token or
federation. Public configuration and generated snippets are not a secret store.

## Mixed-version and socket behavior

| Client/server combination | Expected behavior and evidence scope |
| --- | --- |
| New client/new server | Numeric `features.entrySources === 1` enables dynamic source privacy updates. The initial client hello also requests `transport: 1`; server-issued `transportSeq` values trigger bounded ACK batching. Actual-client DOM tests cover the handshake opt-out race and stale-socket cancellation. |
| New client/pre-feature server | Older hello has no entry-source feature, so source controls become unavailable and no dynamic `entry-source` frame is sent. Ordinary chat and own safe return navigation still work. No ACK is emitted without `transportSeq`. Extra hello fields are ignored by the older engine. |
| Old client/new server | It does not opt into ACK transport or source updates. Legacy delivery gets a finite allowance and an explicit reload notice. Terminal code `4001` is understood by the older client and stops its automatic reconnect loop. This is a transition path, not indefinite support for stale code. |
| Same live socket wakes from hibernation | Restore live identity, metadata-only delivery ledger, control grant and memberships. Rebuild shared window accounting from live attachments. Never send a new join/history replay merely because an actor wakes. |
| Genuine new connection/reload | Reauthenticate/re-admit and start chat fresh. Entry capability is negotiated again; old nickname/device data cannot recover PM consent or room/account authority. |

Presence coalescing is server-side and does not require a new client frame or
feature negotiation. Existing `chan`/`list` shapes are preserved. Only replaceable
join/departure projections wait for one 50 ms timer; initial join/activity,
explicit list, chat/events and authority/privacy/camera changes remain immediate
after required commits. The queue retains bounded room IDs/generations and bits,
then recomputes currently authorized views inside the adapter's serialized work.
It never retains old recipients, chat or activity snapshots. A closed room's old
generation cannot publish into a new room using that name. Required-write failure
blocks pending projections, including markers from an earlier committed event.

The short timer prevents ordinary idle hibernation until it drains; it is not a
persistent timer, snapshot log or delivery SLA under a busy serialization queue.
After normal idle wake, the existing stored sessions/live attachments restore
memberships and delivery credit without a new join or chat replay. A deployment
may interrupt in-memory scheduling; it still requires the existing owner's live
socket/reload qualification rather than an uninterrupted-service promise.

The request-control grant is internal server state, valid for its current socket
and UTC day. Twenty controls are prepaid by one persisted unit from the existing
shared budget before honoring credit. Corrupt, expired, failed-write or exhausted
grants fail closed; replaying a browser field cannot mint one. This accounts for
one request category, not an invoice or account-wide spending cap.

Resource/protocol close codes `1009`, `4400`, `4413` and `4429` pause the new UI
and offer deliberate retry/reload guidance. Preserve that behavior during
rollback so overload does not become a reconnect/admission storm. Other auth,
revocation and administrative close semantics must remain unchanged.

## Socket attachment audit

Cloudflare's current documentation, checked October 25, states a maximum
serialized attachment size of 16,384 bytes. It describes attachment persistence
for the life of a healthy socket, not a durable transcript or evidence store.
[Cloudflare attachment documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocketserializeattachment)

A synthetic combined attachment with bounded IDs, a 254-character ASCII staff
email, 128 size entries totaling the 16 MiB per-socket window, maximum sequence
integers, control counters and a control grant measured 1,827 JSON bytes and
1,371 bytes using Node's V8 serializer. These are illustrative serialization
measurements, not the Cloudflare runtime's wire format or a maximum-memory proof.
Confirm the combined maximum accepted metadata in the actual hosted runtime
before relying on attachment size for release qualification.

The audit found the earlier verified-JWT email check accepted an unbounded
signed claim containing `@`. A synthetic 20,002-character email produced a
21,575-byte JSON attachment (21,120-byte Node V8 estimate). This required a valid
issuer signature and, for stored staff identity, matching trusted role
configuration; it was not an unsigned identity bypass. The candidate now rejects
email claims above 254 characters or UTF-8 bytes before hashing/storing them.
Keep the boundary regressions and this fix in the reviewed release. Do not
restore the unbounded validator during a rollback without assessing that risk.

## Release and rollback order for the existing owner

1. Reconcile the complete application stack with the selected website work.
   Record exact PR heads, current CI/review verdicts, source/artifact hashes,
   enabled integrations and source-tested versus hosted evidence. Preserve all
   existing locks, release holds and normal admission requirements.
2. Inventory the deployed Worker revision, origin, bindings, namespace IDs,
   storage schemas and secret/configuration names without exporting values.
   Keep a verified previous code-plus-asset artifact and the existing owner's
   storage/recovery procedure. Data recovery is not equivalent to a code rollback.
3. Qualify the server and matching protected assets together in the existing
   isolated beta path before changing band navigation. Ensure a fresh test server
   imports the new engine; hot-serving new assets from a Node process caching an
   older engine is a mixed-version test, not exact-revision proof.
4. Check both band-entry contexts and a registered third fixture, hidden/direct
   entry, fresh-join privacy, ordinary room creation/drawing, reporting/blocking,
   owner/moderator isolation, logout/revocation and reconnect/overload handling.
   Use a narrow new synthetic report only when a changed path needs it; preserve
   Jeff's completed real-review receipt instead of repeating an unchanged task.
5. Hand reviewed public snippets to the site owners. Add ordinary navigation
   links only after the canonical service is qualified. Preserve Rad Dad's
   permanent `/tap/` to `/qr/` route, both sites' consent/navigation behavior and
   clean packaging boundaries. Do not publish a private invitation in a snippet.
6. If rollback is required, the owner can withdraw/disable the affected entry
   links first, or use the existing pause control when the community itself is
   unsafe/unavailable. Restore the selected previously reviewed server/assets
   through the normal deployment owner. Preserve namespace IDs, HMAC mapping,
   rooms, reports, bans and revocations; do not clear storage to make rollback
   appear healthy. Restore approved configuration deliberately, including
   provider-off defaults and reviewed source registry.
7. Verify old/new client compatibility, fresh-sign-in ownership recovery, report
   integrity and bounded reconnect behavior on the actual restored revision.
   Existing live sockets may close or require a reload across a code change; do
   not promise uninterrupted hibernation through deployment or resurrect an
   expired/revoked session. Record recovery evidence with the release owner.

Removing a custom badge registry entry makes it neutral, and disabling a site in
the integration config prevents new approved packages. Those operations do not
ban people or revoke an ordinary public Join URL. All moderation and identity
remain community-wide. Reverting entry UI must not discard accepted reports or
re-enable an unqualified classifier; independently reviewed safety fixes may
need to remain even when the feature presentation is rolled back.
Rolling back the coalescer restores the older synchronous metadata fan-out. The
preserved 150-client reconnect failure demonstrates a regression risk at busy
churn; do not interpret unchanged schemas or compatible frame shapes as proof
that the older artifact is safe under the same load.

## Evidence and remaining qualification

### Final shared-entry source and standalone artifact

The exact PR 89 head `6597aa21ba8f3f338672e3222038269345b73bf7` passed
840 unit tests and all 298 configured browser tests. Both private-beta and Pages
packages built with file/hash inventories. The Pages artifact includes the
application branch's website snapshot; it must not overwrite newer public-band
work from website main. Consume the selected app assets/source and reviewed
navigation changes through the receiving owner.

Receipts are in the application-local directory
`.local/webjam-product-finish/shared-community-20261025/`:

- `final-unit-6597aa21ba8f-privacy.json` and matching log;
- `final-browser-6597aa21ba8f-privacy.json`, log and result directory;
- `final-packages-6597aa21ba8f-privacy.json`, including both artifact inventories;
- `final-load-6597aa21ba8f.json`, with exact head and module hashes;
- `toolkit-extracted-smoke-6597aa21ba8f.json`;
- `final-screenshots-6597aa21ba8f/`, including provenance and 375/390px captures;
- `review-entry-final-evidence.json`, the dated CI read and review-request receipt.

The final-source loopback run passed 150 guests, 30 rooms and 16 simultaneous
reconnects in 127.326 ms, with no replayed backlog. Hot-lobby delivery p95 was
15.754 ms and peak logical pending delivery was 4,480,982 bytes. Existing caps
remained unchanged. Exactly the intentionally unacknowledging peer was retired;
healthy peers continued, excess admission returned 429, and 30 rooms survived a
memory-adapter restart without stored ordinary chat. The short local sample is
not Cloudflare capacity, an invoice, real suspended TCP behavior or hosted
recovery qualification.

`community-entry-toolkit-6597aa21ba8f.zip` is a 54,384-byte standalone entry
toolkit with SHA-256
`4df5bdc29698e1eab12bd654fe61beacee9dd34f2fb66f9b9bd7eb46e81bfe5e`.
Fresh extraction produced the three reviewed synthetic-site snippets without
npm installation or network access. The real-site example remains disabled and
unverified. The toolkit does not deploy the application, select the real
canonical URL, verify DNS, provide SSO or grant staff permissions.

Use [the demonstration guide](HANGOUT_DEMO_GUIDE.md) for a local dry run and the
separate owner-qualified hosted journey. Preserve all earlier failure receipts
below; they explain the pacing/coalescing changes and rollback risk.

The local 50-client/10-room paid-control receipt and its SHA-256 are recorded in
[the shared-community document](HANGOUT_SHARED_COMMUNITY.md#measured-scope-and-overload-behavior).
It includes loopback percentiles, restored room metadata, pressure closure and
request reservations. It does not contain a Git SHA and predates some final
compatibility/identity refinements; preserve it as a bounded local observation,
then bind appropriate final tests/artifacts to the actual reviewed head.

That document also retains the initial failed 150-client/30-room run and the
fresh paced-ACK passing run. A healthy peer originally exhausted the unchanged
ACK rate limit. The client and harness were corrected to emit at most one ACK
per 50 ms; the subsequent source-hashed receipt records 1,500 hot-lobby
deliveries with p95 14.862 ms and preserved join-time-only recovery. It is a
roughly 12.76-second loopback sample, not a hosted capacity claim. Preserve both
failure and success when assembling the review evidence.

The later 16-guest simultaneous reconnect stage failed against that fan-out:
`shared-community-load150-20261025-churn-review-01.json` records a healthy `4413`
closure at 33,554,372 aggregate pending bytes and 134 pressure closes. Full
replaceable presence/directory snapshots on each arrival/departure saturated the
unchanged 32 MiB window. The new bounded scheduler addresses that application
fan-out; it does not raise delivery caps, delay authority changes or store chat.

The fresh `shared-community-load150-20261025-coalesced-presence-01.json` records
unchanged source hashes, 150 clients/30 rooms, and all 16 reconnects succeeding
without backlog in 149.369 ms. Its 1,500 hot-lobby deliveries have p95 12.709 ms;
peak pending delivery is 5,114,474 bytes/2,554 frames. Exactly one intentionally
unacknowledging probe closes, healthy peers continue, 30 rooms survive restart,
and ordinary chat is absent from persisted state. The approximately 17.69-second
run uses about 1,249.75 shared request units, including 1,062 prepaid control
units for 20,411 ACKs; 829 prepaid slots remain unused. This differs from the
earlier workload and is not an isolated hosted cost comparison. The product
document records its SHA-256 and complete limits. Preserve failed receipts and
source hashes, then rebind final validation to the reviewed head.

Focused regressions cover scheduler bounds/deadlines/disposal, pending and
failed commits, departed/expired identities, hidden/keyed/locked room visibility,
current owner/co-host authority, closed/recreated names, immediate policy and
camera changes, synchronous direct callers, and mixed legacy/negotiated socket
restore without replay. They are local simulated adapter evidence, not actual
Cloudflare hibernation or a physical suspended-browser measurement.

Hosted qualification still needs operator-approved cost and rate ceilings,
duration/storage and account-wide usage measurements, realistic hot-room
traffic/churn, actual socket suspension and deployment recovery. The logical ACK
window is not proof of a hard Cloudflare memory limit against a custom peer that
claims issued sequence credit without reading. Production encrypted private-room
transport in `index.mjs` is separately scoped from the lobby delivery helper.

The product evidence directory also contains the lock-hashed production
dependency audit (`shared-community-20261025/production-dependency-audit.json`),
which reports zero advisories for `npm audit --omit=dev`. Direct installed
licenses were inventoried; neither that result nor the source tests complete a
native/transitive license review or security certification.

Real Access sign-in/role revocation, deployment origin/account inventory,
assistive-technology/physical-phone checks, and Mac/Windows/Linux native package,
installation/trust and cross-house audio evidence remain distinct acceptance
items. Loopback/Tailscale/browser simulation cannot substitute for them.

Public all-ages release also requires qualified operator/legal decisions and
the actual minimal-data consent/capability and incident-preservation paths.
See [privacy and incidents](HANGOUT_PRIVACY_AND_INCIDENTS.md) and
[the data inventory](HANGOUT_DATA_INVENTORY.md). The existing age/media guards
remain until a qualified replacement is implemented; a readiness flag or policy
document does not complete it. No public go-live, paid signup, credential
recovery, native-trust bypass or paused TURN work is performed by this handoff.
