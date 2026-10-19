# Invitation-only community beta handoff

This is the readiness track for real visitors. The earlier `/pilot/` deployment
remains a separate demonstration with synthetic roles. Passing that demonstration
does not verify email ownership or staff authentication for this beta.

The beta uses `hangout-worker/wrangler.beta.toml`, a separate
`stalemate-hangout-beta` Worker and separate Durable Object namespaces. Public
navigation, the main website and the existing shared WebJam TURN issuer are not
part of this deployment.

## Operator setup

1. Confirm the owner and moderator email addresses and a monitored moderation
   inbox. Set `HANGOUT_OWNER_EMAIL`, any additional role allowlists, and
   `HANGOUT_MODERATION_CONTACT`. Do not infer staffing from an account login or
   an address mentioned in an unmerged PR.
2. Follow [the identity setup](HANGOUT_BETA_IDENTITY.md) for two distinct Access
   applications on `/lobby-owner*` and `/lobby-admin*`. Verify actual email
   delivery and denied identities. Use hostname/path applications: Cloudflare's
   Worker-level Access integration does not support WebSocket upgrades.
3. Restore the approved Vaultwarden bot CLI session before retrieving provider
   credentials. Keep secrets outside source, PR bodies, screenshots and logs.
   Reuse the existing shared TURN key; do not rotate it. The beta HMAC and invite
   keys are separate from the old demonstration. Keep the HMAC stable; rotate
   the invitation key with its version when revoking invitations.
4. Configure and verify Turnstile on the beta hostname. Keep AI moderation off
   until a real classifier request succeeds and its status, daily limit and
   outage behavior are checked. Keep TURN off until credential issuance,
   account-wide analytics and a forced-relay connection succeed.
5. Choose a conservative TURN allowance within the shared account's allocation.
   Its admission estimate is not a provider spending cap. Existing WebJam
   issuance and already minted credentials can continue independently.

The provider audit on October 19 UTC found the main, pilot and shared TURN
Workers. Access's API reported `access.api.error.not_enabled` for this account;
the accessible Turnstile widget list was empty. Current Wrangler OAuth could not
read TURN keys or account analytics. Vaultwarden's bot CLI initially reported
`unauthenticated`; interactive access was subsequently restored and the OpenAI
key passed a live moderation request. Access/TURN setup remains unresolved; see
[the current assessment](HANGOUT_BETA_READINESS.md) for the latest evidence.

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
   unavailable until real Access configuration is complete.
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

## Hosted acceptance before visitor invitations

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
staff sign-in and persistent-room recovery. Rollback does not reverse Durable
Object schema migrations or erase incident evidence. Do not roll back past the
initial `beta-v1` migration or restore an older permissive identity gateway over
newer state. Keep admission paused while resolving incompatible storage.

Operational references: [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[TURN analytics](https://developers.cloudflare.com/realtime/turn/analytics/),
[OpenAI moderation](https://developers.openai.com/api/docs/guides/moderation).

The [current assessment](HANGOUT_BETA_READINESS.md) records the actual deployment,
separate-browser checks, rollback/restore receipt and remaining blockers. Its
successful lobby drill does not establish persistent-room recovery or authorize
inviting visitors before real staff access and contact are configured.
