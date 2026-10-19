# Invitation-only community beta handoff

This is the readiness track for real visitors. The earlier `/pilot/` deployment
remains a separate demonstration with synthetic roles. Passing that demonstration
does not verify email ownership or staff authentication for this beta.

The beta uses `hangout-worker/wrangler.beta.toml`, a separate
`stalemate-hangout-beta` Worker and separate Durable Object namespaces. Public
navigation, the main website and the existing shared WebJam TURN issuer are not
part of this deployment.

## Operator setup

1. Jeff confirmed `jeffstory007@gmail.com` as the moderation contact and sole
   initial owner/reviewer. Both beta configuration fields are set; the hosted
   contact link is verified. Agree review coverage and backup before invitations.
   Additional role allowlists remain empty.
2. The two distinct Access applications on `/lobby-owner*` and `/lobby-admin*`
   are saved and dashboard-verified; [the setup receipt](../pr-assets/beta-collaboration/hosted-access-setup.json)
   records their public IDs/audiences. Both initial Allow
   policies include only `jeffstory007@gmail.com` and require One-time PIN;
   their audiences remain different. Future named cohort owners go only into
   the owner app and gain no staff role. Zero Trust Free has a shared 50-user
   limit; check seat use before expanding verified identities. Guest nickname
   chat and temporary hosting do not require Access. Configuration `a449541`
   was deployed as `33e6a92f`; its HTTP 200 health check confirmed configuration
   only. Real email-code owner login and separate staff SSO/WebSocket admission
   passed after the JWKS fix. Current runtime is
   `0ee7705e-e381-4cb4-a70a-1f26daa10e78`, committed source `b111bb2`.
   The sign-in acceptance was recorded on earlier `e3177c6d`/`832f7e1`;
   the current deployment also includes private AI observation, co-host grant
   revocation, media reconnect guards, durable ownership offers and initial-offer
   arbitration and safe YouTube embed metadata. Both current watch-client
   hashes, invitation denial and proof-session logout are
   [verified](../pr-assets/beta-collaboration/hosted-watch-privacy-asset.json).
   [Actual YouTube playback](../pr-assets/beta-collaboration/hosted-watch-provider.json)
   passed with two guests in a private room on one Mac: signed pause, paused
   seek, resume, sampled drift below 0.2 seconds and both logouts. No invitation-data
   match was found in 85 checked third-party HTTP requests.
   A separate [guest-hosted channel check](../pr-assets/beta-collaboration/hosted-channel-watch-provider.json)
   passed real play/pause/paused seek/resume, server denial of an ordinary
   guest's control request and no pre-join chat replay. The founder closed the
   exact temporary room and both guests logged out; 82 checked third-party HTTP
   requests had no invitation-data matches. Both hosted watch checks used one Mac.
   [Two hosted synthetic-camera guests](../pr-assets/beta-collaboration/hosted-camera-startup.json)
   also passed delayed-hello startup, capture-off, passive reconnect and both
   logout checks on one Mac on the preceding `348c747`/`08dd365d` deployment.
   Physical-device, mobile-autoplay, separate-network and TURN
   acceptance remain outstanding.
   Complete denied-identity and
   ownership-recovery acceptance. Use hostname/path applications: Cloudflare's
   Worker-level Access integration does not support WebSocket upgrades.
3. Recover the actual provider credentials through the approved vault/account.
   The approved account was signed in and its OpenAI key worked; needed TURN
   credentials were not visible there. Another successful login alone does
   not establish availability. Keep secrets outside source, PR bodies,
   screenshots and logs.
   The older `hangout-secrets-from-vault.sh --apply` targets the main Worker;
   do not use it for this beta. Any beta secret upload must explicitly select
   `hangout-worker/wrangler.beta.toml`.
   Reuse the existing shared TURN key; do not rotate it. The beta HMAC and invite
   keys are separate from the old demonstration. Keep the HMAC stable; rotate
   the invitation key with its version when revoking invitations.
4. Configure and verify Turnstile on the beta hostname. A real classifier request
   succeeded. A one-request hosted benign review and cap check also passed,
   with two guests logged out and AI restored off. A later owned synthetic
   public-room test produced one flagged provider outcome using one additional
   attempt under a two-attempt total cap; both guests logged out, its room was
   removed and AI was restored off on the same source with usage retained at two.
   Exact saved AI queue visibility and human disposition remain unverified.
   Keep AI moderation off
   until flagged-evidence and real staff handling are accepted. Keep TURN off until credential issuance,
   account-wide analytics and a forced-relay connection succeed.
5. Choose a conservative TURN allowance within the shared account's allocation.
   Its admission estimate is not a provider spending cap. Existing WebJam
   issuance and already minted credentials can continue independently.

The [provider audit](../pr-assets/beta-collaboration/provider-audit.json) preserves
October 19's earlier observations and the later dashboard setup. Zero
Trust Free onboarding is complete and
`throbbing-hill-6ed4.cloudflareaccess.com` serves public signing keys. At that
snapshot Access app/provider GETs returned empty lists; authorized creation
attempts returned 403/code 1010 `auth.forbidden`. The operator subsequently
saved One-time PIN and both apps through the signed-in dashboard, with exact
account/path guards and distinct public audiences. OAuth lists still omit
these same-account resources; the filtering mechanism is unknown and empty
results do not establish absence. The team and distinct audiences are deployed.
Actual OTP owner login and separate staff SSO succeeded; the moderation socket
showed the exact synthetic report. Jeff confirmed dismissing it and seeing it
disappear; an independent post-action queue reload has not been performed.
Temporary Chrome Apple Events scripting is restored off, confirmed by Jeff
and a blocked no-op probe (Chrome error 12).
The earlier accessible Turnstile list was empty. Current OAuth still cannot
list TURN keys, but a read-only account-wide TURN query succeeded at 04:13:55
UTC and returned zero October egress bytes. That sample does not establish
billing, SFU usage or remaining free allocation; no OAuth token was uploaded.
The beta's TURN issuer/analytics settings remain absent and TURN stays off.
The shared issuer's deployed source is desktop-only and was not changed.

Vaultwarden's bot CLI initially reported `unauthenticated`; interactive access
was subsequently restored and the approved OpenAI key passed a real moderation
request. Existing TURN credentials still need recovery through the approved
private process. See [the current assessment](HANGOUT_BETA_READINESS.md) and
[provider setup details](HANGOUT_BETA_IDENTITY.md) for exact remaining checks.

The first real login exposed a Workers-specific JWKS fetch failure:
`redirect: 'error'` throws before sending the request. The fix uses `manual`
and rejects non-success responses, preserving redirect refusal and all JWT
checks. The live callback works and the staff socket survived final deployment
`e3177c6d` with its synthetic report still visible. Jeff subsequently confirmed
dismissing that report and seeing it disappear. Complete independent post-action
queue reload/persistence and second-device room recovery. Never fix
provider connectivity by disabling signature or route-specific audience checks.

## Build and deploy privately

The original natural eight-hour expiry observation started October 19 at 08:00
UTC, with expiry at 16:00 UTC. Keep the hosted source, runtime, configuration,
invitation and identity keys unchanged until that original job has a recorded
terminal result; reaching 16:00 alone is not confirmation. New fixes are
prepared for review, not deployed. Complete the required human/Karen review and
release acceptance before deploying them.

Use a clean, isolated checkout of the reviewed release commit. Before building,
record the effective active configuration privately and reconcile it with the
candidate beta config. Tracked defaults are not a backup of live settings.
Preserve the effective `HANGOUT_OPEN` admission state, `HANGOUT_BETA_INVITE_VERSION`, staff
allowlists, Access audiences, provider enable flags and usage caps. Never reduce
or reuse an invitation version; keep AI/TURN disabled until accepted. Preserve
remote secrets, especially the stable `HANGOUT_HMAC_KEY`, and DO bindings.

Run from that checkout's repository root. Use the beta config explicitly for
every Wrangler command; the existing vault-upload script targets the main
Worker and is not a beta deploy command. The following commands do not grant
release approval or lift an incident pause.

```sh
npm ci
npm run test:install-browsers
npm run test:unit
npm run test:e2e
npm run package:beta
npx --yes wrangler@4.151.1 deploy --config hangout-worker/wrangler.beta.toml --dry-run
```

The existing beta secrets are already provisioned; do not replace them as part
of a code release. For a separate first-time setup only, provision
`HANGOUT_BETA_INVITE_KEY`,
`HANGOUT_HMAC_KEY` and `HANGOUT_PREVIEW_KEY` through stdin or a permission-restricted
ignored secret file with `wrangler secret bulk --config
hangout-worker/wrangler.beta.toml`. Do not put values in command arguments. A
deployment without them fails closed. Provider secrets are optional only while
their corresponding features remain explicitly disabled.

```sh
npx --yes wrangler@4.151.1 deploy --config hangout-worker/wrangler.beta.toml
npx --yes wrangler@4.151.1 deployments list --config hangout-worker/wrangler.beta.toml
```

Record the resulting version, source commit, configuration and test receipt in
the readiness assessment. Keep the private invitation out of that assessment.
An invitation has the form `/beta/#invite=<private-code>`; send it only to the
invited person. The fragment is removed before admission. It grants guest access
and never grants a staff role.

## A visitor's first session

1. Open the private invitation and choose a nickname. No account is needed for
   guest chat. Say hello in `#stalemate`; earlier conversation is not replayed.
2. Start a channel, canvas, watch room or invite-only WebJam channel. Use room
   invitations to bring another person into a restricted room.
3. To keep a room and recover it from another device, use the beta portal's
   email verification and then **Host tools → Keep this room**. This option is
   available after the successful real login; second-device registered-room
   recovery acceptance remains pending.
   Ownership offers keep their original ten-minute deadline across room-server
   wake/restart and remain bound to the current owner and verified co-host.
   Acceptance still requires that account to be in the room. Older code that
   omits the optional offer metadata can discard a pending offer on its next
   write; reissue it after recovery rather than treating it as completed.
4. For WebJam music, share the complete **Copy Invite** message and paste the
   complete message into desktop WebJam's **Join** dialog. A phone can use room
   chat; no browser audio client is promised. See the
   [native handoff evidence and remaining limits](HANGOUT_COLLABORATION_BETA.md).
5. In the lobby and its channels, use a message's report button for abuse. A
   check mark means the server confirmed durable submission to community staff.
   The currently hosted encrypted private-room page still has the older
   camera-tile **Report to the host** notice and no per-message staff action.
   That encrypted notice is not saved for community staff and does not confirm
   delivery to the host.
   A [prepared, not deployed staff-intake candidate](../pr-assets/beta-collaboration/private-staff-reports.json)
   adds message/member reports independent of the host. The reporter reviews
   the selected quote, claimed name and reason and explicitly consents to share
   that text with staff. Message reports require a quote; member reports require
   a reason. Ordinary private chat remains encrypted and excluded from AI;
   selected evidence is an unverified claim, with no automatic punishment.
   Do not include invitation or credential details. A saved acknowledgement
   requires a confirmed durable write, not an encrypted host notice.
   The separate staff queue retains at most 100 pending reports for 24 hours
   and permits 100 new reports per day globally. Up to 200 text-free request
   receipts remain for 24 hours. Resolve/Dismiss removes saved quote/name/reason
   after the write succeeds; it neither deletes private chat nor punishes a
   participant. Staff delivery and actions recheck the current staff session
   and permissions.
   Actual local protected guests reached the SQLite-backed queue; a graceful
   restart across two workerd generations preserved the pending report, with
   the same cookie and a fresh socket receiving the same report ID. Both
   logouts and copied-cookie asset denials passed. This does not prove real
   Access, human review or hosted behavior. Complete human/Karen review and
   hosted guest-to-staff acceptance after the original eight-hour expiry job
   has a recorded terminal result. See the
   [readiness assessment](HANGOUT_BETA_READINESS.md) and
   [moderator guide](HANGOUT_MODERATOR_GUIDE.md).
6. Leaving the beta revokes the session across its live chat and private-room
   connections. If closure cannot be confirmed, the portal reports failure and
   retries closure rather than claiming a successful logout.

Use the [first-session plan and invitation draft](HANGOUT_BETA_FIRST_SESSION.md)
for the initial 8–10-person cohort. Nothing has been scheduled or sent. Mac,
Windows and Linux all require actual WebJam package acceptance; native music
currently uses a Mac host. Keep browser participation available for people who
do not install the music app.

The [operations guide](HANGOUT_BETA_OPERATIONS.md) describes the separate
read-only health endpoint and installed local Mac monitor. Its five-minute
checks require an awake, online, logged-in Mac. They do not establish storage
write durability, provider availability/billing or continuous external coverage.

## Hosted acceptance before visitor invitations

Co-host removal now also revokes operator grants whose account/device association
was proved when granted, including disconnected devices restored from storage.
The optional `opAccounts` room metadata is bounded by the existing operator list.
Legacy grants with no proved association remain separate guest grants; retained
nicknames cannot establish ownership. An older engine can read the unchanged
operator list but drops these associations when it next saves the room. Prefer
rollback targets that preserve this field. After an emergency rollback to an
older serializer, audit and revoke affected guest operator grants explicitly;
restoring newer code cannot reconstruct associations that were discarded.

Use separate browser profiles for two guests, a verified owner and a restricted
moderator. Test real email delivery, ownership recovery on the second device,
co-host and transfer boundaries, report review, room capacity and restrictions,
drawing and watch state, full WebJam handoff, and a real forced-relay camera
connection. Confirm an uninvited profile cannot fetch product assets or connect
to any relay, and a verified room owner cannot enter staff routes.

Keep one connection idle through a server wake; its existing scrollback and room
membership must survive without replay. Refresh a separate profile: its history
must start empty. Report a pre-wake line from the original live connection.
Verify pending PM consent survives the wake without saving the undelivered first
text, and cannot transfer to a reconnect or another tab sharing a device token.

Exercise logout with multiple live rooms and copied cookies, eight-hour expiry,
invitation-version revocation, provider outages and full quotas. Redeploy the
same compatible schema while a registered proof room exists, confirm recovery,
and remove only the synthetic proof data. Do not delete other visitors' rooms.

An [actual local workerd/SQLite restart receipt](https://github.com/rupret007/StalemateSite/blob/77359d0cd7700bc647df40eef652af534c4e95fd/pr-assets/beta-collaboration/local-worker-restart.json)
in [sibling PR #53](https://github.com/rupret007/StalemateSite/pull/53) records one
short graceful process-restart check: normal guest sessions, temporary-room
settings, exact drawing and a granted device op recovered; a late guest saw no
earlier chat. Old sockets disconnected and guests explicitly rejoined. This is
not hosted restart, registered-account recovery, crash/power-loss or long-downtime
acceptance; those checks remain separate.

Automated WebKit phone viewports provide engine/layout coverage. They do not
replace physical iPhone Safari checks for email redirects, keyboard, permissions,
background/resume and real media. Record both types of evidence separately.

## Pause, recovery and rollback

For an incident, authenticated administrators retain access to moderation and
emergency controls. `/shield` pauses new rooms and PM requests and turns off
activity cameras; `/lobby readonly` pauses visitor speech; `/lobby lock` closes
visitor lobby connections. These do not revoke independent desktop WebJam or
already established private peer-to-peer media.

`HANGOUT_OPEN=0` pauses new lobby/private-room/TURN admission while preserving
restricted staff recovery access. It is an admission pause, not immediate
revocation of every existing connection. To revoke beta sessions, change the
invitation key and increment `HANGOUT_BETA_INVITE_VERSION`, then deploy; existing
sockets are checked on frames, wakes and alarms. Keep `HANGOUT_HMAC_KEY` stable
because registered account IDs derive from it.

Keep the effective invitation version at its current value or increase it,
including during rollback. A version mismatch rejects a cookie without marking
its saved session permanently revoked; restoring an older version can make its
still-unexpired cookies valid again. Rotating the invitation key alone does not
prevent this because existing cookies use the stable HMAC key.

Before a release, retain the previous source/config and deployment version.
Retain the pre-created YouTube iframe construction introduced in `b111bb2` on
both watch surfaces. The [real-provider comparison](../pr-assets/beta-collaboration/watch-privacy.json)
showed that the older constructor sends the full parent URL in embed metadata;
an unmodified earlier release reintroduces that invitation-data exposure.
Prefer a compatible recovery build retaining this fix over an earlier raw
version. If an emergency requires older code, keep invitations and watch use on
hold until the fix is restored and both watch-client bytes are rechecked.

A private pinned recovery package is prepared locally at
`.local/recovery-b111bb2/stalemate-beta-b111bb2.tar.gz`; its
[sanitized manifest](../pr-assets/beta-collaboration/recovery-b111bb2.json)
records the archive hash, exact `b111bb2` source/config/lockfile and both fixed
watch clients. The adjacent recovery tool and bundled README describe fresh
extraction and verification. All 68 committed source files and 46 built assets
matched the pinned Git objects; an extracted offline asset rebuild also passed.
This is source/assets recovery preparation, not an executed rollback or backup
of durable data, Access policies, credentials or live configuration overrides.
Compare the active schema/config before any future deployment and preserve
existing remote secrets, account identity and DO bindings. The package's
historical configuration includes admission open and invitation version `1`;
do not deploy those defaults over a later pause or version increment. Carry the
effective safety settings described above into a compatible recovery release.

Use a version rollback only after checking that the target's effective bindings,
invitation version, admission state, staff policies and provider settings retain
the current controls. Otherwise prepare a reviewed compatible recovery release
with those controls preserved. Do not use the command below to restore older
configuration blindly:

```sh
npx --yes wrangler@4.151.1 rollback <previous-version-id> --config hangout-worker/wrangler.beta.toml
```

Cloudflare's [rollback guidance](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
states that rollback activates the selected version immediately and leaves
connected resources unchanged. It does not restore their earlier data; Durable
Object lifecycle changes can also prevent rollback. Treat data compatibility and
the current safety settings as separate release checks.

Check the deployment list afterward and repeat invitation denial, guest chat,
staff sign-in and persistent-room recovery. A rollback to a version from before
the operations endpoint can make `/beta/health` return 401 even with a valid
monitor key. That is a monitoring compatibility gap, not proof that the site
is down or its key changed. Use the independent acceptance checks and restore
a compatible health-enabled release before relying on scheduled alerts again;
see [operations](HANGOUT_BETA_OPERATIONS.md). The recorded lobby rollback drill
predates the endpoint and did not prove health continuity across rollback.

Rollback does not reverse Durable
Object schema migrations or erase incident evidence. Do not roll back past the
initial `beta-v1` migration or restore an older permissive identity gateway over
newer state. Keep admission paused while resolving incompatible storage.

Operational references: [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[TURN analytics](https://developers.cloudflare.com/realtime/turn/analytics/),
[OpenAI moderation](https://developers.openai.com/api/docs/guides/moderation).

The [current assessment](HANGOUT_BETA_READINESS.md) records the actual deployment,
separate-browser checks, rollback/restore receipt and remaining blockers. Its
successful lobby drill does not establish persistent-room recovery or authorize
inviting visitors before real staff access and review coverage are verified.
