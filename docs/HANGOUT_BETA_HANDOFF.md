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
   `207a4b5a-c416-44c7-a751-24f88af5beb4`, committed source `ea012fc`.
   The sign-in acceptance was recorded on earlier `e3177c6d`/`832f7e1`;
   the current deployment also includes private AI observation, co-host grant
   revocation and media reconnect guards. The protected client hash, invitation
   denial and proof-session logout are [verified](../pr-assets/beta-collaboration/hosted-relay-recovery-asset.json);
   hosted camera/TURN acceptance remains separate.
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
   with two guests logged out and AI restored off. Keep AI moderation off
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
shows the exact synthetic report. Jeff has been asked to dismiss it, but human
review has not yet passed. Restore the temporary Chrome Apple Events scripting permission to
off when setup is finished and record verification.
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
`e3177c6d` with its synthetic report still visible. Complete Jeff's queue action
and second-device room recovery. Never fix
provider connectivity by disabling signature or route-specific audience checks.

## Build and deploy privately

Run from the repository root. Use the beta config explicitly for every Wrangler
command; the existing vault-upload script targets the main Worker and is not a
beta deploy command.

```sh
npm ci
npm run test:install-browsers
npm run test:unit
npm run test:e2e
npm run package:beta
npx --yes wrangler@4.151.1 deploy --config hangout-worker/wrangler.beta.toml --dry-run
```

Before the first working deployment, provision `HANGOUT_BETA_INVITE_KEY`,
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
4. For WebJam music, share the complete **Copy Invite** message and paste the
   complete message into desktop WebJam's **Join** dialog. A phone can use room
   chat; no browser audio client is promised. See the
   [native handoff evidence and remaining limits](HANGOUT_COLLABORATION_BETA.md).
5. Use a message's report button for abuse. A check mark means the server
   confirmed durable submission. Hosts manage their own rooms; community staff
   review reports under the [moderator guide](HANGOUT_MODERATOR_GUIDE.md).
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

Before a release, retain the previous source/config and deployment version.
For compatible code-only changes:

```sh
npx --yes wrangler@4.151.1 rollback <previous-version-id> --config hangout-worker/wrangler.beta.toml
```

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
