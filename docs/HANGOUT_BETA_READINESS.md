# Community beta readiness assessment

Updated October 19, 2026 UTC. **The guest technical beta works; it is not yet
ready for general visitor invitations.** Real email owner login and separate
staff access now work; Jeff confirmed the test-report dismissal. Second-device ownership recovery
and live TURN acceptance remain outstanding. Jeff confirmed `jeffstory007@gmail.com` as the
moderation contact and sole initial owner/reviewer; the contact is now visible
inside the hosted beta.

The separate entrance is
`https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/`. It requires a
private invitation, which is deliberately absent from this document. Operator
access material is kept in ignored, permission-restricted `.local/beta-access.md`.
Public navigation and the main website/Worker were not changed. The earlier
`/pilot/` demonstration remains separate and uses synthetic identities.

## Requirement assessment

“Automated” means a local engine, generated-JWT or browser fixture check. It does
not mean real provider or physical-device acceptance. “Hosted” refers to the
protected Cloudflare beta, with separate actual visitor browser contexts.

| Requirement | Evidence | Remaining work |
| --- | --- | --- |
| Nickname-only guests | Hosted separate guests exchanged real chat. Ten uninvited product/relay probes returned application 401. | Complete human device acceptance before inviting visitors. |
| Verified persistent ownership | A real email OTP was completed and the corrected hosted callback returned owner/fan state. Generated-RSA/JWT tests verify distinct audience, account continuity and recovery/co-host/transfer boundaries. The narrow owner app/policy and deployed AUD are dashboard-verified. | Recover a registered room from a second device and exercise handoff with a separately verified co-host. |
| Restricted real staff | The separate real staff callback succeeded through Access SSO, connected its moderation WebSocket and showed the exact synthetic report. Automated allowlist/signature/audience/expiry checks pass; no synthetic staff role exists in beta. | Jeff confirmed dismissing the identified report. Complete real denied-identity/device acceptance. |
| Session lifecycle | Actual hosted logout closed lobby and private relay sockets in two profiles sharing a session; copied pre-logout cookies could not fetch assets or reconnect. Automated expiry, version revocation, multi-room retries and admission races pass. | Real Access callback/expiry acceptance on devices. |
| Reports and human review | A pre-idle message was durably acknowledged after 75 seconds with the same live sockets. The real staff queue displayed the exact synthetic report, and Jeff confirmed dismissing it. Durable evidence and review controls pass automated checks. Jeff is the confirmed sole initial reviewer; the hosted contact link is verified. | Jeff confirmed dismissal and observed removal. Independent reload persistence and review coverage/handoff remain to be accepted. |
| Host controls and abuse limits | Hosted guests verified restricted-room admission and device-op handoff. A granted guest kept managing a temporary room across deployment and after its creator logged out. Automated room/PM consent, account/device limits, caps and emergency controls pass. | Run Jeff's authenticated incident/recovery drill; any additional staff need an explicit appointment and separate allowlists. |
| Bounded AI assistance | Actual hosted guest text completed one provider review under a one-request daily cap. A second message reached the other guest while quota stayed at one and review was skipped. Both guests logged out; AI was restored off with the configured 100/day allowance. Automated queue/privacy/outage checks pass. | A separate owned synthetic-fiction test produced one real provider flagged counter with one additional reserved attempt. Exact saved AI queue visibility and human disposition remain unverified; keep AI off. |
| Shared drawing | Actual browser drawing reached a separate guest; a fresh post-deployment visitor received the saved drawing. WebKit/Android touch drawing and reconnect checks pass. | Physical touch-device acceptance. |
| Watch synchronization | Desktop/private room and phone fixtures verify host play/pause/seek and guest restrictions, including paused seeks. A provider-readiness race exposed in CI is fixed; pending source/leave cancellation is covered. | Actual YouTube/provider playback and mobile autoplay/permission behavior remain to be accepted on devices. |
| WebJam invitation/join | Actual native host invitation crossed two Cloudflare guests unchanged into actual Qt Join; a native guest authenticated and received a real Jamulus response. | Same Mac with explicit sealed-reply fallback. Mac, Windows and Linux are all beta requirements; Windows native v3 is blocked by its unsigned bundled fabric; do not weaken the signature check. Compatible packaged installation, cross-network audio and timing remain to be accepted on all required platforms. Browser Web Join is disabled; its deployed site returned 404. |
| Camera/TURN and cost controls | Two invited guests on one Mac exchanged decoded synthetic-camera video through the deployed beta, then passed capture-off, passive reconnect and logout cleanup. Consent, credential expiry/refresh, failure fallback and serialized usage/rate accounting pass provider fixtures. A separate read-only account-wide analytics query returned zero October TURN egress bytes. | Physical cameras, separate networks and forced relay remain unverified. TURN is off; beta issuer/analytics credentials and shared allocation are missing. The zero sample does not establish remaining free allowance or billing; admission estimates are not a billing cap. |
| Mobile usability | All repository browser checks passed, including WebKit phone projects. Hosted 375/390px captures have no page overflow, wrapping text, 16px input and visible Send. | Real iPhone Safari keyboard, Access redirects, camera/audio and background/resume are unverified. |
| IRC history/reconnect | Hosted newcomers saw no earlier messages; original live connections retained scrollback during idle. Exact-connection PM consent cannot transfer to a reconnect or another same-device tab. | Real device/network interruption acceptance. No transcript archive or pre-join history is introduced. |
| Compatible rollback/recovery | Actual Cloudflare rollback and restoration retained two real lobby sockets, scrollback and drafts; new guests received no backlog after either change. | A separate temporary-room deployment rehearsal also preserved guest-op permissions, settings and drawing for fresh visitors. Registered-room provider acceptance, a forced restart, schema-changing rollback and health-endpoint continuity remain unverified. Pre-operations versions can return health 401 with the correct key. |
| Provider failures/full rooms | Automated failed quota/storage/JWKS/classifier/relay responses, room/session limits and retry behavior pass. Missing Access fails closed on the hosted beta. | Live provider outage and shared TURN budget drill; avoid confusing fixtures with provider availability. |
| Operational checks | Actual bearer-only hosted health reads preserve admission counters and exclude visitor content. This Mac's five-minute LaunchAgent completed live probes; actual local failure/recovery notification submissions and deduplication passed a controlled fixture. | Mac must be awake, online and logged in. Provider billing, availability, storage writes and independent external alert coverage are not established by these checks. |
| Handoff | Private access file, onboarding, moderator guide, deployment/rollback guidance and sanitized hosted receipts exist. | Complete the remaining provider/device checks and record reviewer acceptance before visitor invitations. |

The [installer assessment](HANGOUT_WEBJAM_INSTALLERS.md) records the exact candidate
artifacts. Windows native v3 currently fails its required signature policy;
All four exact-source artifacts are now verified, including Intel native CI and
an isolated Rosetta check. All three desktop platforms remain requirements.
A successful package build is not physical installation or cross-network audio
acceptance.

## Verification receipts

- [Initial-offer arbitration](../pr-assets/beta-collaboration/initial-offer-arbitration.json):
  when both peers already publish media, one defers its first offer while
  preserving later native negotiation work. Passive viewers still initiate;
  local/remote camera-off resumes pending setup, and an encrypted answer is
  queued before any follow-up offer. A controlled old-source check transmitted
  one unwanted competing offer. The fix passed **nine new startup scenarios**,
  **ten repetitions of the previously failing late-hello case**, and all
  **30 camera/startup scenarios**, without retries. Two strengthened proofs also
  passed. Independent review found no actionable issue. This mitigates the
  reproduced initial scheduling pattern; the underlying zero-candidate cause
  and later/passive glare remain separate. The exact source passed **575 unit
  tests and 205 browser scenarios** in [push CI](https://github.com/rupret007/StalemateSite/actions/runs/39212270471)
  without retries. [PR CI](https://github.com/rupret007/StalemateSite/actions/runs/39212275941)
  passed 575 unit tests and 204 browser scenarios directly; one unrelated iPhone
  game button-height check passed on retry. All Hang Out checks passed directly.
  The [deployed asset proof](../pr-assets/beta-collaboration/hosted-initial-offer-asset.json)
  confirms exact bytes, the active private runtime, invitation protection and
  logout revocation. A separate [hosted synthetic-camera check](../pr-assets/beta-collaboration/hosted-camera-startup.json)
  passed on the same source: delayed hello, bilateral decoded video, capture-off,
  a passive viewer's relay reconnect and both logouts, with no page errors.
  Both contexts received exact committed client bytes; the deployed response
  was not modified. These were simulated cameras on one Mac through the actual
  protected relay, not physical-device, separate-network or TURN acceptance.

- [Initial media ordering regressions](../pr-assets/beta-collaboration/initial-media-regressions.json):
  delayed hello/AV decryption could replace newer camera state, and a valid
  follow-up WebRTC offer could be discarded while a remote answer was still
  applying. Receive ordinals and per-PC answer state fix three failing negative
  controls; the first local run passed all **18 video scenarios** without retries. Capture consent,
  admission limits, recovery assertions and timeouts remain unchanged. These
  reproduced bugs do not establish the earlier intermittent CI failure's cause.
  Later Linux and local runs reproduced a separate startup failure. Both
  endpoints reach stable signaling, but the polite endpoint gathers no local
  network candidates and neither endpoint sends video. Five local repetitions
  with final-state-only diagnostics produced three passes and two failures;
  no native API wrappers ran in that check. That snapshot was undeployed; the
  superseding arbitration deployment and hosted check are recorded above.

- [Outbound reconnect review](../pr-assets/beta-collaboration/outbound-generation-regressions.json)
  reproduced stale camera state crossing a replacement
  relay identity, both during encryption and in the paced send queue. Socket
  scoping fixes both negative controls while retaining the bounded original
  unsent chat/drawing/signed-host envelopes. Two browser regressions pass;
  queued chat is verified to arrive once. A separate native-operation overlap
  regression reproduces and fixes an obsolete local offer entering a pending
  remote-offer operation. These narrow fixes passed independent source review;
  they do not explain or fix the zero-candidate startup failure above.
  The combined source `aebec95` passed **575 unit tests and all 196 browser
  scenarios without retries** in both [PR CI](https://github.com/rupret007/StalemateSite/actions/runs/39209749176)
  and [push CI](https://github.com/rupret007/StalemateSite/actions/runs/39209743297).
  Local startup failures were still observed on that source despite those passes. A separate
  diagnostic stopped at its first real stall, invoked one guest ICE restart,
  and observed no recovery in another 15 seconds. A restart-only watchdog has
  not been implemented. Bounded native controls, including separate browser
  contexts with fake camera capture, connected successfully but did not
  reproduce or explain the app failure.

- [Ownership-offer recovery](../pr-assets/beta-collaboration/ownership-offer-recovery.json):
  a reproduced ten-minute offer loss across wake is fixed with bounded,
  account-bound metadata and the original deadline. Fifteen new regressions
  cover wake, expiry, replay, identity changes, revocation and durable commit;
  all **575 unit tests in 55 files** and all **190 browser scenarios** pass in
  [CI](https://github.com/rupret007/StalemateSite/actions/runs/39206451586) without
  retries. This is engine evidence; real-account co-host and second-device
  acceptance remain outstanding.

- Co-host revocation passes **560 unit tests in 54 files and 188 browser scenarios**
  in [CI](https://github.com/rupret007/StalemateSite/actions/runs/39202779472).
  At that deployment, source `15767d9` differed from that CI head only in documentation and
  sanitized evidence. Sixteen new permission regressions cover offline restart,
  anonymous reconnect, multiple devices, nickname reuse and grant cleanup.
  The runbook records unknown legacy grants and older-serializer rollback limits.
  That then-deployed head also [passed CI](https://github.com/rupret007/StalemateSite/actions/runs/39203122936)
  with 560 unit tests, 187 browser scenarios directly and one video-relay
  reconnect scenario on its configured retry. Investigation reproduced two
  media races: delayed decryption could restore a departed tile, and obsolete
  ICE setup could block a fresh connection. Per-peer liveness and generation
  checks fix both. The [regression receipt](../pr-assets/beta-collaboration/reconnect-regressions.json)
  records failing negative controls, nine focused repetitions and all 15 video
  scenarios passing without retries. Pre-departure chat remains deliverable;
  no recovery timeout or assertion was weakened. Initial failure traces and
  generated CI diagnostics are now retained even after a passing retry.
  A subsequent full local run passed 189/190 scenarios; its host-control fixture
  locked before a resumed microphone advertisement arrived. The fixture now
  observes the host's received media state before locking. Host controls and
  all three reconnect scenarios then passed 12 repeated checks without retries;
  the product's moderation rules remain unchanged.
  The reconnect source [passed CI](https://github.com/rupret007/StalemateSite/actions/runs/39204794574)
  with 560 unit tests and all 190 browser scenarios directly. The then-deployed
  head `ea012fc` [passed CI](https://github.com/rupret007/StalemateSite/actions/runs/39205093407)
  with 560 unit tests, 189 browser scenarios directly and one existing camera
  startup check on retry, before that test's intended disconnect. Its cause is
  not established; a successful retry does not prove physical camera readiness.
  That historical head's [PR run](https://github.com/rupret007/StalemateSite/actions/runs/39205096878)
  passed all 560 unit tests and all 190 browser scenarios without retries.
  Ten bounded local repetitions of the camera-startup/disconnect case also
  passed without retries; they did not reproduce or explain the other CI run's
  initial failure. Its initial trace was unavailable, so the uncertainty remains.

- [Actual flagged provider outcome](../pr-assets/beta-collaboration/hosted-ai-flagged.json):
  one labeled synthetic message in an owned public proof room produced one
  checked/flagged result, zero failures and exactly one additional reservation
  under an effective two-attempt total cap. No non-owned participants were
  present. AI was restored off on the same source with usage retained at two;
  the room was removed and both guest sessions logged out. Exact stored queue
  visibility and human disposition remain unverified, subject to its 24-hour TTL.

- [Actual temporary-room deployment rehearsal](../pr-assets/beta-collaboration/hosted-temporary-room-recovery.json):
  granted guest-op permissions remained effective across the deployment and
  creator logout. A fresh visitor received saved settings/drawing with no earlier
  chat or op privilege. Both original sockets and drafts survived. The proof room
  was removed; all three guest sessions logged out. This does not establish a
  forced server restart or real verified-account ownership acceptance.

- [Actual hosted AI pipeline](../pr-assets/beta-collaboration/hosted-ai-pipeline.json):
  one benign guest message completed a real Worker/provider review, a second
  message continued through chat at the one-request cap, two guests logged out,
  and AI was verified off after restoration. No human review or flagged-content
  pass is implied. The observer source passed **544 unit tests in 53 files and 188 browser scenarios**
  in [CI](https://github.com/rupret007/StalemateSite/actions/runs/39202426418).


- The watch-correction head passed CI with **470 unit tests in 50 files** and
  **188 browser scenarios** (187 passed directly; one existing iPhone game test
  passed on its configured retry). The correction also passed 10 watch checks
  under CPU load and 39 related private/session/moderation scenarios. The
  subsequent monitor/source CI passed **509 unit tests in 52 files** and all
  **188 browser scenarios**. The Access configuration release also passed
  **85 focused identity/deployment/endpoint/monitor checks**, including the
  39 endpoint/monitor checks. Provider fixtures are identified in their
  tests/docs.
- The provider compatibility fix `832f7e1` passed the full local unit suite:
  **540 tests in 53 files**, including the 28 new Access diagnostics checks.
  The exact source head also passed [GitHub CI](https://github.com/rupret007/StalemateSite/actions/runs/39201407037)
  with **540 unit tests and all 188 browser scenarios**; no browser retry was
  reported in that run. The 509-unit result above is earlier evidence.
- [Hosted guest receipt](../pr-assets/beta-collaboration/hosted-guest.json):
  admission denial, separate chat, restricted guest art room, drawing, 75-second
  idle continuity, durable report acknowledgement, copied-session logout and
  replay denial; zero page errors and confirmed synthetic-room cleanup. The
  idle check did not force a deployment or prove physical device behavior.
- Hosted WebKit [375px](../pr-assets/beta-collaboration/hosted-webkit-375.png)
  and [390px](../pr-assets/beta-collaboration/hosted-webkit-390.png) captures.
- [Native WebJam through Cloudflare](../pr-assets/beta-collaboration/hosted-native-handoff.json)
  and [scope/limitations](HANGOUT_COLLABORATION_BETA.md).
- [Live classifier receipt](../pr-assets/beta-collaboration/moderation-provider.json):
  benign synthetic input, HTTP 200, 13 category signals and no visitor content.
  This does not prove the disabled Worker's hosted review pipeline.
- [Actual hosted rollback and restoration](../pr-assets/beta-collaboration/hosted-rollback-and-restore.json):
  both lobby sockets survived both changes; drafts and connected history stayed
  intact, fresh visitors saw no earlier lines, and new chat worked. Four test
  sessions logged out; zero page errors. A persisted three-rooms-per-IP/hour
  limit correctly denied further room creation, so no room-persistence claim is
  made and the abuse counter was not reset to manufacture a passing test.
- [Actual hosted operational boundaries](../pr-assets/beta-collaboration/hosted-ops.json):
  13 checks, read-only admission counters, distinct bearer access, no guest or
  product privilege, and the confirmed guest-visible moderation contact.
- [Saved Access provider/application setup](../pr-assets/beta-collaboration/hosted-access-setup.json):
  actual dashboard rows and saved settings verify One-time PIN, separate
  Jeff-only owner/staff policies, exact hostname/paths, eight-hour sessions,
  distinct public audiences, hidden launcher entries and HttpOnly cookies.
  Configuration `a449541` was deployed as `33e6a92f`; its protected health read
  returned HTTP 200 with healthy configuration and no issues. The endpoint
  performs no provider checks. Subsequent real OTP owner login and separate
  staff SSO/WebSocket admission passed after correcting the Workers JWKS fetch
  mode. Committed fix `832f7e1` was deployed as `e3177c6d`; the live staff socket
  survived deployment with the exact report still visible. Jeff subsequently
  confirmed dismissing that report and seeing it disappear. An independent
  post-action queue reload is not claimed. New diagnostics regressions pass **28/28**.
- [Installed Mac monitor](../pr-assets/beta-collaboration/installed-monitor.json)
  and [controlled local failure/recovery](../pr-assets/beta-collaboration/local-monitor-alerts.json):
  actual LaunchAgent exit 0, copied runtime/source match, private file modes,
  no key in job/runtime/logs, and actual macOS notification submissions. Human
  visibility and continuous external coverage are not claimed.

The guest/native checks used beta version
`2f752cff-8aae-43fe-b1a6-4855057ae7a1`. Initial code upload was
`ee8fb29f-aaa5-4e55-8ee3-06c760fd3778`; the later version provisioned secrets.
Worker versions and Git commits are different identifiers.

**Current active runtime:** `08dd365d-3ce9-435c-9552-21465cf008fe`, source commit
`348c747` (initial media ordering, socket-scoped outbound work and initial-offer
arbitration). The [protected asset proof](../pr-assets/beta-collaboration/hosted-initial-offer-asset.json)
verifies exact committed client bytes, the active deployment, invitation denial,
no-store caching, proof-session logout and denial afterward. Protected health
is ready with AI and TURN off and spent AI usage retained at two.

The preceding runtime was `df75bdc6-4e7c-45c1-9575-4d6dda4d6d68`, source `b95c7cd`
(AI restored off after the bounded flagged-outcome test; ownership offers survive
room-server wake). The [temporary-room rehearsal](../pr-assets/beta-collaboration/hosted-temporary-room-recovery.json)
records guest-op permissions, settings and drawing across the preceding
`a5d15d34` deployment of the same source;
real verified-account offer acceptance remains outstanding.

The previous runtime was `207a4b5a-c416-44c7-a751-24f88af5beb4`, source `ea012fc`
(private-room media reconnect guards and stronger test preconditions).
Its [protected asset receipt](../pr-assets/beta-collaboration/hosted-relay-recovery-asset.json)
verifies the client byte-for-byte, uninvited denial, no-store caching,
successful proof-session logout and denial afterward. This is asset and
read-only health evidence, not hosted WebRTC or forced-relay acceptance.
The current initial-camera and offer-arbitration source passed 30 local
camera/startup scenarios, ten repetitions of the original delayed-hello case
and the exact Linux checks above. These are narrower than physical-device,
cross-network and forced-relay acceptance.
The [current hosted camera receipt](../pr-assets/beta-collaboration/hosted-camera-startup.json)
adds actual protected-relay startup and passive reconnect with two separate
invited contexts and synthetic cameras on one Mac. Both decoded video, capture
stopped when requested, and both sessions logged out with asset access revoked.
It does not establish physical-device, separate-network or forced-relay behavior.
The previous runtime was `f4438515-7338-4287-b2e4-8485e88bbc90`, source `15767d9`
(co-host revocation with persisted account/device grant associations).
[Its deployment evidence](../pr-assets/beta-collaboration/hosted-cohost-deployment.json)
verifies the uploaded fix and observed health; real-account hosted revocation
acceptance remains separate. The previous AI observation runtime was
`210c1fee`, source `51c5fc5` (AI outcome counters and observed failure alerts).
The one-request hosted AI pipeline check passed, then restored the configured
100/day allowance without resetting its spent reservation. The previous sign-in
fix runtime was `e3177c6d`, source `832f7e1` (Workers-compatible provider requests
and bounded Access diagnostics).
The real staff moderation socket survived that earlier sign-in deployment and retained the
exact synthetic report. Initial Access configuration runtime was
`33e6a92f-57a8-4d89-b79f-23039af1044d`, source `a449541`; its health check
reported healthy configuration with HTTP 200 and no issues, with provider
checks explicitly unperformed. The previous operations runtime
was `4aa8ab36-02c6-4f3e-938a-5d22a7455680`, source `3d469ba`. The earlier
watch-correction runtime was `d906ab1d`, source `31d2b7c6`. The rollback drill changed
from `da842199` to compatible `2f752cff`, then restored `da842199`; that drill
does not prove a rollback of this later watch correction. A separate
[protected asset check](../pr-assets/beta-collaboration/hosted-watch-asset.json)
verified the `d906ab1d` watch file byte-for-byte against source, with invitation
denial and proof-session logout. The operations and Access configuration
deployments changed no static assets; the five Durable Object bindings remain
unchanged. AI and TURN remain off. Actual OTP owner authentication and separate
staff SSO/WebSocket admission now work. These deployment facts are narrower
than full beta readiness.

The real OTP exposed `redirect: 'error'`, which Workers rejects before sending
the public-key request even though Node fixtures accept it. Manual redirect
handling now refuses every non-success response without following Location;
the original signature/issuer/audience/expiry checks remain. The owner callback
then returned actual owner/fan state, and the separate staff callback connected
the moderation queue. These successful logins do not by themselves establish
human action or registered-room recovery.

The final receipt-accounting improvement removes repeated full metadata serialization
without increasing timeouts or weakening bounds. Existing CI exposed an intermittent
5-second retention-test timeout; the same workload improved locally from 1,399 ms
to 811 ms. New checks preserve byte reclamation, immutable pending snapshots and
zero-recipient cleanup.

The subsequent watch correction shares source-readiness work and applies the
latest room state after loading. Previously a source echo could let the guest
play while leaving the host paused. Both fixture players must now actually be
playing before concurrent, timestamp-aligned synchronization measurements. The
1.5-second tolerance and five-second expectation remain unchanged; leaving or
changing source while a provider is loading cannot start an obsolete player.

## External setup still needed

1. **Access:** initial Zero Trust setup is now complete on the Free plan;
   `throbbing-hill-6ed4.cloudflareaccess.com` serves real public signing keys.
   One-time PIN and both saved hostname/path apps are now verified through the
   signed-in dashboard; their distinct audiences are deployed from `a449541`.
   Current OAuth lists omit these same-account resources and creation requests
   returned 403/code 1010 `auth.forbidden`; those reads are insufficient for
   inventory, not proof of resource absence. Initially both Allow policies
   include only Jeff's confirmed email and require OTP; add future named cohort
   owners only to the owner app. Actual OTP owner login and separate staff
   admission now pass. Complete denied-identity acceptance and second-device
   recovery. Temporary Chrome Apple Events scripting is restored off: Jeff
   confirmed unchecking it and the no-op probe was blocked with error 12.
   Access Free has a shared 50-user limit; guest nickname chat/temporary
   hosting does not require Access. Do not enable Worker-level Access:
   Cloudflare documents that its WebSocket upgrades fail.
2. **Staffing:** Jeff confirmed `jeffstory007@gmail.com` for contact and as the
   sole initial owner/reviewer. Its hosted display and real staff sign-in are
   verified. Jeff confirmed dismissing the exact synthetic report and observing
   removal. Review coverage/handoff and independent reload persistence remain.
3. **TURN:** the shared desktop credential Worker and its secret-binding names
   are verified, but it lacks the newer browser Origin/key policy in WebJam
   master. It remains unchanged. Use the beta's same-origin `/turn` gateway;
   do not broaden the shared issuer for cameras. Current OAuth key listing
   returns 403/code 10000; account-wide TURN GraphQL succeeded at 04:13:55 UTC
   with zero October egress bytes. The runtime issuer, analytics and account
   settings remain absent. Recover approved existing credentials privately and
   provision only the beta settings; do not upload Wrangler OAuth or rotate
   shared keys. Billing, SFU usage and remaining shared free allowance are
   unknown. Complete the [provider checks](HANGOUT_BETA_IDENTITY.md) before
   enabling TURN.
4. **Devices/networks:** Mac, Windows and Linux desktop installations, physical
   iPhone Safari and a second household's connection need actual acceptance.
   WebKit emulation and same-Mac encrypted forwarding are narrower evidence.

Vault access was restored for this session. The legacy helper's saved bot-master
unlock does not match the account used for that sign-in, so unattended future
vault access is not repaired by the successful interactive read. No password or
session key is recorded in source or the evidence artifacts.

The read-only [provider audit](../pr-assets/beta-collaboration/provider-audit.json)
records the exact accessible API responses without credentials.

## Review and operations

The changes are stacked on the existing private-pilot baseline to avoid mixing
earlier website/game work into these diffs:

- [#33: full invitations and collaboration recovery](https://github.com/rupret007/StalemateSite/pull/33)
- [#34: durable moderation and exact-connection PM consent](https://github.com/rupret007/StalemateSite/pull/34)
- [#35: real beta identity and lifecycle](https://github.com/rupret007/StalemateSite/pull/35)
- [#37: protected operational health and confirmed contact](https://github.com/rupret007/StalemateSite/pull/37)
- [#39: real Cloudflare email verification](https://github.com/rupret007/StalemateSite/pull/39)
- [#41: bounded private AI observation](https://github.com/rupret007/StalemateSite/pull/41)
- [#42: durable co-host device-grant revocation](https://github.com/rupret007/StalemateSite/pull/42)
- [#44: private-room media reconnect recovery](https://github.com/rupret007/StalemateSite/pull/44)
- [#45: ownership offers across room-server wake](https://github.com/rupret007/StalemateSite/pull/45)
- [#46: initial camera state and WebRTC negotiation](https://github.com/rupret007/StalemateSite/pull/46)
- [#47: initial-offer arbitration and passive-viewer recovery](https://github.com/rupret007/StalemateSite/pull/47)

Initial hosted receipts and the assessment are supplied in documentation PR #36
stacked on #35. Subsequent evidence and installer progress are recorded in
documentation PRs #40 and #43, with the reconnect receipt in #44.

These are draft PRs. The repository's CI is the configured automated gate; no
automated Karen review or protected-branch rule was found. Human approval is not
inferred from passing tests, and nothing has been merged to `main`.

Use [the handoff/runbook](HANGOUT_BETA_HANDOFF.md),
[moderator guide](HANGOUT_MODERATOR_GUIDE.md),
[health operations](HANGOUT_BETA_OPERATIONS.md), and
[first-session plan](HANGOUT_BETA_FIRST_SESSION.md). Complete the human review,
coverage and device acceptance gates before distributing visitor invitations. Broader discovery,
events, AI conversation features and additional collaboration modes remain future
work; they are not prerequisites for this bounded beta.

Provider references: [Access hostname/path protection and WebSocket limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[Access Free seat limit](https://www.cloudflare.com/plans/),
[TURN analytics permissions](https://developers.cloudflare.com/realtime/turn/analytics/),
[shared Realtime allowance and pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/),
[OpenAI moderation](https://developers.openai.com/api/docs/guides/moderation).
