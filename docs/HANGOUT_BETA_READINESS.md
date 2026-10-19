# Community beta readiness assessment

Updated October 19, 2026 UTC. **The guest technical beta works; it is not yet
ready for general visitor invitations.** Real email owner login and separate
staff access now work; human report review, second-device ownership recovery
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
| Verified persistent ownership | A real email OTP was completed and the corrected hosted callback returned owner/fan state. Generated-RSA/JWT tests verify distinct audience, account continuity and recovery/co-host/transfer boundaries. The narrow owner app/policy and deployed AUD are dashboard-verified. | Recover a registered room from a second device. |
| Restricted real staff | The separate real staff callback succeeded through Access SSO, connected its moderation WebSocket and showed the exact synthetic report. Automated allowlist/signature/audience/expiry checks pass; no synthetic staff role exists in beta. | Complete the human queue action and real denied-identity/device acceptance. |
| Session lifecycle | Actual hosted logout closed lobby and private relay sockets in two profiles sharing a session; copied pre-logout cookies could not fetch assets or reconnect. Automated expiry, version revocation, multi-room retries and admission races pass. | Real Access callback/expiry acceptance on devices. |
| Reports and human review | A pre-idle message was durably acknowledged after 75 seconds with the same live sockets. The real staff queue displays the exact synthetic report. Durable evidence and review controls pass automated checks. Jeff is the confirmed sole initial reviewer; the hosted contact link is verified. | Jeff's requested dismissal is pending. Agree review coverage/handoff and verify the action persists before marking human review passed. |
| Host controls and abuse limits | Hosted guest created a restricted art room, denied an uninvited guest and admitted an invited one. Automated room/PM consent, account/device limits, caps and emergency controls pass. | Run Jeff's authenticated incident/recovery drill; any additional staff need an explicit appointment and separate allowlists. |
| Bounded AI assistance | Actual hosted guest text completed one provider review under a one-request daily cap. A second message reached the other guest while quota stayed at one and review was skipped. Both guests logged out; AI was restored off with the configured 100/day allowance. Automated queue/privacy/outage checks pass. | Benign input only. Complete real flagged-evidence and human review acceptance before permanent enablement. |
| Shared drawing | Actual browser pointer drawing reached a separate hosted guest. WebKit/Android touch drawing and reconnect checks pass. | Physical touch-device acceptance. |
| Watch synchronization | Desktop/private room and phone fixtures verify host play/pause/seek and guest restrictions, including paused seeks. A provider-readiness race exposed in CI is fixed; pending source/leave cancellation is covered. | Actual YouTube/provider playback and mobile autoplay/permission behavior remain to be accepted on devices. |
| WebJam invitation/join | Actual native host invitation crossed two Cloudflare guests unchanged into actual Qt Join; a native guest authenticated and received a real Jamulus response. | Same Mac with explicit sealed-reply fallback. Mac, Windows and Linux are all beta requirements; Windows native v3 is blocked by its unsigned bundled fabric; do not weaken the signature check. Intel packaging is still pending. Compatible packaged installation, cross-network audio and timing remain to be accepted on all required platforms. Browser Web Join is disabled; its deployed site returned 404. |
| Camera/TURN and cost controls | Consent, credential expiry/refresh, failure fallback and serialized usage/rate accounting pass provider fixtures. A separate read-only account-wide analytics query succeeded and returned zero October TURN egress bytes. | TURN is off. Beta issuer/analytics credentials, shared allocation and forced-relay media remain unverified. The zero sample does not establish remaining free allowance or billing; admission estimates are not a billing cap. |
| Mobile usability | All repository browser checks passed, including WebKit phone projects. Hosted 375/390px captures have no page overflow, wrapping text, 16px input and visible Send. | Real iPhone Safari keyboard, Access redirects, camera/audio and background/resume are unverified. |
| IRC history/reconnect | Hosted newcomers saw no earlier messages; original live connections retained scrollback during idle. Exact-connection PM consent cannot transfer to a reconnect or another same-device tab. | Real device/network interruption acceptance. No transcript archive or pre-join history is introduced. |
| Compatible rollback/recovery | Actual Cloudflare rollback and restoration retained two real lobby sockets, scrollback and drafts; new guests received no backlog after either change. | This is lobby-only evidence. Temporary/registered room persistence, schema-changing recovery and health-endpoint continuity were not verified. Pre-operations versions can return health 401 with the correct key. |
| Provider failures/full rooms | Automated failed quota/storage/JWKS/classifier/relay responses, room/session limits and retry behavior pass. Missing Access fails closed on the hosted beta. | Live provider outage and shared TURN budget drill; avoid confusing fixtures with provider availability. |
| Operational checks | Actual bearer-only hosted health reads preserve admission counters and exclude visitor content. This Mac's five-minute LaunchAgent completed live probes; actual local failure/recovery notification submissions and deduplication passed a controlled fixture. | Mac must be awake, online and logged in. Provider billing, availability, storage writes and independent external alert coverage are not established by these checks. |
| Handoff | Private access file, onboarding, moderator guide, deployment/rollback guidance and sanitized hosted receipts exist. | Complete the remaining provider/device checks and record reviewer acceptance before visitor invitations. |

The [installer assessment](HANGOUT_WEBJAM_INSTALLERS.md) records the exact candidate
artifacts. Windows native v3 currently fails its required signature policy;
Intel packaging remains pending. All three desktop platforms remain requirements.
A successful package build is not physical installation or cross-network audio
acceptance.

## Verification receipts

- [Actual hosted AI pipeline](../pr-assets/beta-collaboration/hosted-ai-pipeline.json):
  one benign guest message completed a real Worker/provider review, a second
  message continued through chat at the one-request cap, two guests logged out,
  and AI was verified off after restoration. No human review or flagged-content
  pass is implied. The observer source passed **544 unit tests in 53 files**.


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
  Configuration `a449541` is deployed as `33e6a92f`; the protected health read
  returns HTTP 200 with healthy configuration and no issues. The endpoint
  performs no provider checks. Subsequent real OTP owner login and separate
  staff SSO/WebSocket admission passed after correcting the Workers JWKS fetch
  mode. Committed fix `832f7e1` is deployed as `e3177c6d`; the live staff socket
  survived deployment with the exact report still visible. A human dismissal
  is requested but not yet accepted. New diagnostics regressions pass **28/28**.
- [Installed Mac monitor](../pr-assets/beta-collaboration/installed-monitor.json)
  and [controlled local failure/recovery](../pr-assets/beta-collaboration/local-monitor-alerts.json):
  actual LaunchAgent exit 0, copied runtime/source match, private file modes,
  no key in job/runtime/logs, and actual macOS notification submissions. Human
  visibility and continuous external coverage are not claimed.

The guest/native checks used beta version
`2f752cff-8aae-43fe-b1a6-4855057ae7a1`. Initial code upload was
`ee8fb29f-aaa5-4e55-8ee3-06c760fd3778`; the later version provisioned secrets.
Worker versions and Git commits are different identifiers.

**Current active runtime:** `210c1fee-6344-4376-a4f8-3d44c20d142a`, source commit
`51c5fc5` (private AI outcome counters and observed failure alerts; AI restored off).
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
   recovery. The operator must restore temporary Chrome
   Apple Events scripting to off after setup and record verification.
   Access Free has a shared 50-user limit; guest nickname chat/temporary
   hosting does not require Access. Do not enable Worker-level Access:
   Cloudflare documents that its WebSocket upgrades fail.
2. **Staffing:** Jeff confirmed `jeffstory007@gmail.com` for contact and as the
   sole initial owner/reviewer. Its hosted display and real staff sign-in are
   verified. Review coverage/handoff and Jeff's human queue action still need
   completion; a visible report is not a completed review.
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

Hosted receipts and the final assessment are supplied in a separate documentation
PR stacked on #35, keeping test artifacts out of the implementation diffs.

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
