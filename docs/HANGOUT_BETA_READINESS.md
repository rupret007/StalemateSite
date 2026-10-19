# Community beta readiness assessment

Updated October 19, 2026 UTC. **The guest technical beta works; it is not yet
ready for general visitor invitations.** Real email/staff login, a confirmed
moderation contact and live TURN acceptance remain outstanding.

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
| Verified persistent ownership | Generated-RSA/JWT tests verify distinct owner audience, account continuity and room recovery/co-host/transfer boundaries. | Configure Access and receive a real email code; recover a registered room from a second device. |
| Restricted real staff | Automated allowlist, signature/audience/expiry and recipient-permission checks pass. Hosted guests are refused admin assets and owner/staff upgrades. | Real restricted staff login and human queue review are unverified; no synthetic staff role exists in beta. |
| Session lifecycle | Actual hosted logout closed lobby and private relay sockets in two profiles sharing a session; copied pre-logout cookies could not fetch assets or reconnect. Automated expiry, version revocation, multi-room retries and admission races pass. | Real Access callback/expiry acceptance on devices. |
| Reports and human review | A pre-idle message was durably acknowledged after 75 seconds with the same live sockets. Exact-delivery digests, failed storage, held evidence and human review controls pass automated checks. | Actual beta human review requires Access. Confirm a monitored contact and who checks the queue. |
| Host controls and abuse limits | Hosted guest created a restricted art room, denied an uninvited guest and admitted an invited one. Automated room/PM consent, account/device limits, caps and emergency controls pass. | Appoint actual moderators and run their incident/recovery drill. |
| Bounded AI assistance | A real `omni-moderation-latest` request returned HTTP 200 using the approved vault key. Beta secret provisioned. Automated queue, exclusions, 100/day limit and outage checks pass. | AI remains off. Verify hosted text-to-review flow and real staff handling before enabling it. |
| Shared drawing | Actual browser pointer drawing reached a separate hosted guest. WebKit/Android touch drawing and reconnect checks pass. | Physical touch-device acceptance. |
| Watch synchronization | Desktop/private room and phone fixtures verify host play/pause/seek and guest restrictions, including paused seeks. A provider-readiness race exposed in CI is fixed; pending source/leave cancellation is covered. | Actual YouTube/provider playback and mobile autoplay/permission behavior remain to be accepted on devices. |
| WebJam invitation/join | Actual native host invitation crossed two Cloudflare guests unchanged into actual Qt Join; a native guest authenticated and received a real Jamulus response. | Same Mac with explicit sealed-reply fallback. Mac, Windows and Linux are all beta requirements; compatible packaged installation, cross-network audio and timing remain to be accepted. Browser Web Join is disabled; its deployed site returned 404. |
| Camera/TURN and cost controls | Consent, credential expiry/refresh, failure fallback and serialized usage/rate accounting pass provider fixtures. | TURN is off. Shared key, issuance/analytics permissions, usage allocation and forced-relay connection need live verification. Admission estimates are not a billing cap. |
| Mobile usability | All repository browser checks passed, including WebKit phone projects. Hosted 375/390px captures have no page overflow, wrapping text, 16px input and visible Send. | Real iPhone Safari keyboard, Access redirects, camera/audio and background/resume are unverified. |
| IRC history/reconnect | Hosted newcomers saw no earlier messages; original live connections retained scrollback during idle. Exact-connection PM consent cannot transfer to a reconnect or another same-device tab. | Real device/network interruption acceptance. No transcript archive or pre-join history is introduced. |
| Compatible rollback/recovery | Actual Cloudflare rollback and restoration retained two real lobby sockets, scrollback and drafts; new guests received no backlog after either change. | This is lobby-only evidence. Temporary/registered room persistence and schema-changing recovery were not verified by this drill. |
| Provider failures/full rooms | Automated failed quota/storage/JWKS/classifier/relay responses, room/session limits and retry behavior pass. Missing Access fails closed on the hosted beta. | Live provider outage and shared TURN budget drill; avoid confusing fixtures with provider availability. |
| Handoff | Private access file, onboarding, moderator guide, deployment/rollback guidance and sanitized hosted receipts exist. | Complete the remaining provider/device checks and record reviewer acceptance before visitor invitations. |

## Verification receipts

- Final local unit run: **470 tests in 50 files passed**. Full browser run:
  **187 scenarios passed**, covering the entire repository rather than only the
  community pages. The final receipt optimization also passed 11 affected
  browser scenarios. The later watch correction passed 10 watch checks under
  CPU load and 39 related private/session/moderation scenarios; the additional
  readiness regression brings the browser suite to 188 scenarios. Provider
  fixtures are identified in their tests/docs.
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

The guest/native checks used beta version
`2f752cff-8aae-43fe-b1a6-4855057ae7a1`. Initial code upload was
`ee8fb29f-aaa5-4e55-8ee3-06c760fd3778`; the later version provisioned secrets.
Worker versions and Git commits are different identifiers.

**Current active runtime:** `d906ab1d-fb64-4f15-9887-4d485c24f5a7`, source commit
`31d2b7c68fb243ad64f2341b5e09194cc5de4530`. The earlier rollback drill changed
from `da842199` to compatible `2f752cff`, then restored `da842199`; that drill
does not prove a rollback of this later watch correction. A separate
[protected asset check](../pr-assets/beta-collaboration/hosted-watch-asset.json)
verified this deployed watch file byte-for-byte against source, with invitation
denial and proof-session logout. AI and TURN remain
off; Access and the moderation contact remain unconfigured. These deployment
facts are narrower than full beta readiness.

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

1. **Access:** the authenticated Cloudflare account API reports
   `access.api.error.not_enabled`. Current Wrangler OAuth can deploy Workers but
   cannot finish Access/Calls/account-analytics administration. Complete Zero
   Trust setup, configure the separate hostname/path owner and restricted staff
   apps, then verify actual email delivery and denied identities. Do not enable
   Worker-level Access: Cloudflare documents that its WebSocket upgrades fail.
2. **Contact and staffing:** confirm the moderation inbox and first reviewers.
   The existing site-contact PR proposes `stalemate.punk@gmail.com`; that alone
   does not establish a monitored inbox. No unconfirmed email is published.
3. **TURN:** the restored vault session exposes the working OpenAI key; relevant
   Cloudflare/Hangout/shared TURN credential searches did not expose those keys.
   Verify the existing issuer and analytics credentials through the approved
   vault process. Do not rotate shared WebJam keys or invent replacement ones.
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

Hosted receipts and the final assessment are supplied in a separate documentation
PR stacked on #35, keeping test artifacts out of the implementation diffs.

These are draft PRs. The repository's CI is the configured automated gate; no
automated Karen review or protected-branch rule was found. Human approval is not
inferred from passing tests, and nothing has been merged to `main`.

Use [the handoff/runbook](HANGOUT_BETA_HANDOFF.md) and
[moderator guide](HANGOUT_MODERATOR_GUIDE.md). Do not distribute visitor
invitations while real staff access/contact remain unavailable. Broader discovery,
events, AI conversation features and additional collaboration modes remain future
work; they are not prerequisites for this bounded beta.

Provider references: [Access hostname/path protection and WebSocket limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[TURN analytics permissions](https://developers.cloudflare.com/realtime/turn/analytics/),
[OpenAI moderation](https://developers.openai.com/api/docs/guides/moderation).
