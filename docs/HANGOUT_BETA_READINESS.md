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
| Session lifecycle | Actual hosted logout closed lobby and private relay sockets in two profiles sharing a session; copied pre-logout cookies could not fetch assets or reconnect. Automated expiry, version revocation, multi-room retries and admission races pass. | A normal eight-hour guest expiry observation started October 19 at 08:00 UTC, with issued expiry at 16:00 UTC; no result yet. Real Access callback/expiry acceptance on devices remains separate. |
| Reports and human review | A pre-idle message was durably acknowledged after 75 seconds with the same live sockets. The real staff queue displayed the exact synthetic report, and Jeff confirmed dismissing it. Durable evidence and review controls pass automated checks. Jeff is the confirmed sole initial reviewer; the hosted contact link is verified. | Jeff confirmed dismissal and observed removal. Independent reload persistence and review coverage/handoff remain to be accepted. |
| Host controls and abuse limits | Hosted guests verified restricted-room admission and device-op handoff. A granted guest kept managing a temporary room across deployment and after its creator logged out. Automated room/PM consent, account/device limits, caps and emergency controls pass. | Run Jeff's authenticated incident/recovery drill; any additional staff need an explicit appointment and separate allowlists. |
| Bounded AI assistance | Actual hosted guest text completed one provider review under a one-request daily cap. A second message reached the other guest while quota stayed at one and review was skipped. Both guests logged out; AI was restored off with the configured 100/day allowance. Automated queue/privacy/outage checks pass. | A separate owned synthetic-fiction test produced one real provider flagged counter with one additional reserved attempt. Exact saved AI queue visibility and human disposition remain unverified; keep AI off. |
| Shared drawing | Actual browser drawing reached a separate guest; a fresh post-deployment visitor received the saved drawing. WebKit/Android touch drawing and reconnect checks pass. | Physical touch-device acceptance. |
| Watch synchronization | Two invited Chromium guests passed real YouTube play/pause/paused seek/resume in both a private room and a naturally guest-hosted temporary channel. Channel host controls worked; the server rejected one ordinary guest control request. The late joiner received current activity without earlier chat. The founder closed the test channel and both guests logged out. Phone fixtures cover source changes and cancellation. | The deployed source misses YouTube's blocked-autoplay event; a [tested recovery fix](../pr-assets/beta-collaboration/watch-autoplay.json) passes real-provider denial recovery on both loopback surfaces but is not deployed. Hosted denial recovery, physical/mobile autoplay and separate networks remain to be accepted. Hosted checks used separate contexts on one Mac. |
| WebJam invitation/join | Actual native host invitation crossed two Cloudflare guests unchanged into actual Qt Join; a native guest authenticated and received a real Jamulus response. | Same Mac with explicit sealed-reply fallback. Mac, Windows and Linux are all beta requirements; Windows native v3 is blocked by its unsigned bundled fabric; do not weaken the signature check. Compatible packaged installation, cross-network audio and timing remain to be accepted on all required platforms. Browser Web Join is disabled; its deployed site returned 404. |
| Camera/TURN and cost controls | Two invited guests on one Mac exchanged decoded synthetic-camera video through the deployed beta, then passed capture-off, passive reconnect and logout cleanup. Consent, credential expiry/refresh, failure fallback and serialized usage/rate accounting pass provider fixtures. A separate read-only account-wide analytics query returned zero October TURN egress bytes. | Physical cameras, separate networks and forced relay remain unverified. TURN is off; beta issuer/analytics credentials and shared allocation are missing. The zero sample does not establish remaining free allowance or billing; admission estimates are not a billing cap. |
| Mobile usability | All repository browser checks passed, including WebKit phone projects. Hosted 375/390px captures have no page overflow, wrapping text, 16px input and visible Send. | Real iPhone Safari keyboard, Access redirects, camera/audio and background/resume are unverified. |
| IRC history/reconnect | Hosted newcomers saw no earlier messages; original live connections retained scrollback during idle. Exact-connection PM consent cannot transfer to a reconnect or another same-device tab. | Real device/network interruption acceptance. No transcript archive or pre-join history is introduced. |
| Worker process restart | An [actual local workerd restart](../pr-assets/beta-collaboration/local-worker-restart.json) retained normal guest sessions, temporary art-room settings, exact drawing and a granted device op. A fresh guest received current activity without earlier chat and could not change the topic. All three logouts and copied-cookie revocation checks passed. | This is graceful local process recovery during a short downtime inside the ten-minute temporary-room lifetime. Hosted restart, real Access/registered-account recovery, crash/power loss, longer downtime and schema-changing rollback remain unverified. |
| Compatible rollback/recovery | Historical Cloudflare rollback/restoration retained two real lobby sockets, scrollback and drafts; newcomers received no backlog. A private [pinned recovery package](../pr-assets/beta-collaboration/recovery-b111bb2.json) now retains both watch privacy fixes and current backend/config, with all 114 source/asset payloads and an offline rebuild verified. | The package was not deployed and contains no live data or credentials. A separate temporary-room deployment rehearsal preserved guest-op permissions, settings and drawing. Registered-room acceptance, hosted forced restart, schema-changing rollback and health continuity remain unverified. Raw versions before `b111bb2` reintroduce the demonstrated watch URL exposure; pre-operations versions can also return health 401. |
| Provider failures/full rooms | Automated failed quota/storage/JWKS/classifier/relay responses, room/session limits and retry behavior pass. Missing Access fails closed on the hosted beta. A [prepared YouTube recovery fix](../pr-assets/beta-collaboration/watch-loader.json) handles failed API downloads, player readiness deadlines and provider errors with local explicit retry; controlled loopback checks pass. | The YouTube candidate is not deployed during the natural expiry observation. Complete hosted controlled-failure recovery and the shared TURN budget drill; fixtures do not establish external provider availability. |
| Operational checks | Actual bearer-only hosted health reads preserve admission counters and exclude visitor content. This Mac's five-minute LaunchAgent completed live probes; actual local failure/recovery notification submissions and deduplication passed a controlled fixture. | Mac must be awake, online and logged in. Provider billing, availability, storage writes and independent external alert coverage are not established by these checks. |
| Handoff | Private access file, onboarding, moderator guide, deployment/rollback guidance and sanitized hosted receipts exist. | Complete the remaining provider/device checks and record reviewer acceptance before visitor invitations. |

The [installer assessment](HANGOUT_WEBJAM_INSTALLERS.md) records the exact candidate
artifacts. Windows native v3 currently fails its required signature policy;
All four exact-source artifacts are now verified, including Intel native CI and
an isolated Rosetta check. All three desktop platforms remain requirements.
A successful package build is not physical installation or cross-network audio
acceptance.

## Verification receipts

- [Watch-player privacy](../pr-assets/beta-collaboration/watch-privacy.json):
  an actual-provider comparison using only public dummy markers found the API's
  default constructor copied the full parent URL into embed metadata. Both
  watch surfaces now attach to a pre-created iframe with a video ID and
  origin-only identification. The same real provider played successfully with
  zero dummy markers in outbound requests after the change. Two new browser
  regressions fail on the preceding product source and pass with the fix; all
  nine targeted watch scenarios pass without retries. The page's no-referrer
  policy and invitation URL remain intact. Exact source `b111bb2` passed
  **575 unit tests and 207 browser scenarios directly**, without retries, in
  both [push CI](https://github.com/rupret007/StalemateSite/actions/runs/39215495193)
  and [PR CI](https://github.com/rupret007/StalemateSite/actions/runs/39215533300).
  The [deployed asset proof](../pr-assets/beta-collaboration/hosted-watch-privacy-asset.json)
  verifies both committed watch clients, no-store caching, the privacy notice,
  invitation denial, logout revocation and healthy AI/TURN-off state.
  The [actual hosted provider check](../pr-assets/beta-collaboration/hosted-watch-provider.json)
  passed with two invited guest/fan contexts in a private room: real decoded
  YouTube video, signed pause, paused seek to 21 seconds and resume. Measured
  normalized drift was 0.193 seconds initially and 0.110 seconds after resume.
  No autoplay bypass or player fixture was used, no permission/capture was
  requested, and both logouts and ended states were verified. The HTTP request
  guard checked 85 third-party requests and found no invitation-data matches.
  This private-room check is one-Mac Chromium evidence, not physical-device,
  mobile-autoplay, separate-network or TURN acceptance.

- [Actual guest-hosted channel watch check](../pr-assets/beta-collaboration/hosted-channel-watch-provider.json):
  the ordinary Watch tile created one new temporary room with the creator's
  natural `@`; both visitors remained unverified guests without staff powers.
  Actual YouTube decoded and advanced on both endpoints through server-authorized
  pause, paused seek to 21 seconds and resume. Sampled playback convergence met
  the 1.5-second drift budget initially and after resume. One valid ordinary guest
  control request received the expected server denial; host state stayed
  unchanged and playback continued. A pre-join line was not replayed, while a
  live line arrived once and the current activity synchronized. Both visitors
  observed the exact founder close, room removal and activity teardown; both
  logouts returned 200 with subsequent asset 401 and stable socket closure.
  The HTTP guard checked 82 third-party requests with no invitation-data matches.
  No fixtures, autoplay bypass, capture, role overrides or quota resets were used.
  This is separate-context, one-Mac evidence; physical devices and networks
  remain separate. An [initial harness attempt](../pr-assets/beta-collaboration/hosted-channel-watch-provider-attempt1.json)
  stopped at a hidden desktop navigation button before any room-join request;
  both sessions logged out. Local reproduction identified that selector error;
  the corrected runner checks actual pane visibility before navigation.

- [Blocked-autoplay recovery](../pr-assets/beta-collaboration/watch-autoplay.json):
  YouTube returns no play promise, so the previous players could leave the tap
  prompt hidden after policy denial and publish a blocked host's local pause.
  Prepared source `baf96de` handles the provider event, preserves shared play
  intent and keeps the gesture prompt until actual playback. Both old-code
  regressions failed at the intended hidden-button assertion; seven new policy
  fixtures and twelve related watch checks pass directly. Independent review
  identified a delayed-callback edge, now fixed and covered on both surfaces.
  This candidate is not deployed while the natural expiry observation runs.
  A [real-provider private-host probe](../pr-assets/beta-collaboration/watch-autoplay-provider-private.json)
  now passes on loopback: genuine denial with no activation in either document,
  more than 2.3 seconds paused with shared play preserved, one trusted site tap,
  then decoded frames and time growth with the prompt cleared. No native-player
  click or simulated provider event was used. The [old-source baseline](../pr-assets/beta-collaboration/watch-autoplay-provider-baseline.json)
  reproduced a hidden prompt and unwanted shared pause; its overall recovery
  attempt failed because no native recovery control was visible, and remains
  recorded as failed. The [first local probe](../pr-assets/beta-collaboration/watch-autoplay-provider-attempt1.json)
  stopped earlier at browser inspection; a [neutral frame-routing control](../pr-assets/beta-collaboration/watch-autoplay-frame-routing.json)
  validates the corrected reader without granting activation. Every probe closed
  its owned resources. A separate [natural guest-channel founder probe](../pr-assets/beta-collaboration/watch-autoplay-provider-channel.json)
  also passes the genuine denial, 2.3-second shared-intent hold, single product
  tap and decoded playback checks; its exact owned temporary channel was closed.
  These are separate single-host Chromium checks on one Mac, not hosted,
  multi-visitor synchronization, physical/mobile or separate-network acceptance.

- [Watch-loader failure recovery](../pr-assets/beta-collaboration/watch-loader.json):
  failed API downloads previously left both surfaces waiting indefinitely;
  repeated selections and channel reentry could not recover. The prepared
  shared helper bounds API and player readiness to 15 seconds, handles provider
  errors, retires obsolete callbacks and offers explicit local retry without
  reload or repeated automatic requests. Shared intent survives a local failure.
  Private host signing cannot publish an obsolete selection after a newer one.
  Initial source `af37814` passed ten focused regressions, eighteen related
  checks and all 575 unit tests, but its first full CI gate failed on late
  channel visitors and phone watch initialization. Corrected source `11acab0`
  retains the page-wide API attempt across room reinitialization; a new negative
  case proves two old script insertions versus one expected. Eleven distinct
  loader cases and ten relevant desktop/phone checks now pass in targeted
  runs. Three existing private checks explicitly wait for the host player
  before calling its API; their timeouts and drift limits stay unchanged.
  The corrected [push CI](https://github.com/rupret007/StalemateSite/actions/runs/39230423122)
  passed all 575 unit and 225 browser checks directly. [PR CI](https://github.com/rupret007/StalemateSite/actions/runs/39230428352)
  passed 575 units and 224 browser checks directly; one existing iPhone SE game
  share-height assertion passed on retry. All eleven loader cases passed directly
  in both runs, with no skips or final failures. The original failures are retained.
  Independent review also caught Bob controls accessing a retired player; they
  now use current shared intent while a replacement loads. The existing iframe
  privacy, autoplay and synchronization checks pass. The first diagnostic remains
  [overall failed](../pr-assets/beta-collaboration/watch-loader-diagnostic-attempt1.json)
  because its private drawing stroke was not observed; no drawing defect or
  cause was established. Two later baseline cases fail at the intended missing
  recovery feedback. An initial candidate matrix exposed two isolated fixture
  cleanup errors, retained and corrected before the passing matrix. An unrelated
  encryption test changed only unused base64 bits; [its separate correction](https://github.com/rupret007/StalemateSite/pull/51)
  now changes a decoded ciphertext byte, with production crypto unchanged.
  These are controlled loopback faults, not a real provider outage or hosted,
  physical-device, mobile or separate-network candidate acceptance. The hosted
  source remains unchanged during the natural eight-hour expiry observation.

- [Actual local Worker process restart](../pr-assets/beta-collaboration/local-worker-restart.json):
  exact source `11acab0` ran through the real protected beta entry and local
  SQLite-backed workerd. Two normal guests created a temporary art room,
  acknowledged drawing and settings, and granted a guest device op. The first
  process group exited before distinct Worker processes started against the
  same storage. The original cookies and device tokens remained valid on fresh
  connections; explicit room rejoin restored settings and the exact drawing.
  The delegated guest changed the topic after restart. A third guest received
  current activity without earlier chat, had no host grant, and its topic change
  was denied. Founder close, all three normal logouts, copied-cookie HTTP 401
  checks and stable offline states passed. The run finished in 9.747 seconds
  with zero page errors or nonlocal browser requests. Independent checks found
  all recorded test processes gone and the port closed. Source and built assets
  were independently compared to Git before execution. This used a separate
  [local Durable Objects environment](https://developers.cloudflare.com/durable-objects/reference/environments/)
  and new local-only keys, with Access, AI, TURN and Turnstile disabled. It proves
  short graceful local process recovery, not hosted restart, hibernating socket
  continuity, registered ownership, real Access, crash/power-loss durability,
  physical devices or separate networks. No hosted deployment occurred.

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

**Current active runtime:** `0ee7705e-e381-4cb4-a70a-1f26daa10e78`, source commit
`b111bb2` (safe YouTube embed metadata on both watch surfaces, retaining earlier
media reliability fixes). The [protected asset proof](../pr-assets/beta-collaboration/hosted-watch-privacy-asset.json)
verifies both exact committed watch clients, the active deployment, invitation
denial, no-store caching, privacy notice, proof-session logout and denial
afterward. The [private-room provider check](../pr-assets/beta-collaboration/hosted-watch-provider.json)
adds two separate guests' real playback and signed pause/seek/resume; the
[channel provider check](../pr-assets/beta-collaboration/hosted-channel-watch-provider.json)
adds normal guest hosting and server-enforced host controls. Protected
health is ready with AI and TURN off and spent AI usage retained at two.

The preceding runtime was `08dd365d-3ce9-435c-9552-21465cf008fe`, source `348c747`
(initial media ordering, socket-scoped outbound work and initial-offer
arbitration). Its [protected asset proof](../pr-assets/beta-collaboration/hosted-initial-offer-asset.json)
and synthetic-camera proof below remain historical evidence for that deployment.

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
The initial-camera and offer-arbitration changes on `348c747` passed 30 local
camera/startup scenarios, ten repetitions of the original delayed-hello case
and the exact Linux checks above. These are narrower than physical-device,
cross-network and forced-relay acceptance.
The [hosted camera receipt](../pr-assets/beta-collaboration/hosted-camera-startup.json)
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
- [#48: watch-player invitation privacy and real-provider acceptance](https://github.com/rupret007/StalemateSite/pull/48)
- [#49: wait for snapshot delivery in the replay fixture](https://github.com/rupret007/StalemateSite/pull/49)
- [#50: recover watch playback after browser autoplay denial](https://github.com/rupret007/StalemateSite/pull/50)
- [#51: make the ciphertext tamper test change decoded bytes](https://github.com/rupret007/StalemateSite/pull/51)

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
