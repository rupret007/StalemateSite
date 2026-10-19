# Private Stalemate community pilot

Updated October 18, 2026 (deployment receipts use October 19 UTC).

The community is implemented in **StalemateSite**, on `codex/hangout-irc-first`.
The protected test deployment is:

**https://stalemate-hangout-pilot.jeffstory007.workers.dev/pilot/**

That address requires a private invitation. Jeff's operator invitation is supplied
directly, never committed to the repository. The existing public website,
`stalemate-hangout` Worker, WebJam credentials and public navigation were not changed
by this deployment. This pilot has separate Durable Objects and secrets.

## Start testing

1. Open the private operator invitation. Choose **Guest**, **Room owner**,
   **Community moderator**, or **Site owner**, give the test identity a label, then
   open the lobby and choose a nickname.
2. Copy the **guest invitation** from the pilot portal to test with a friend or
   a second browser. Guest invitations grant visitor access; they cannot select
   a staff or owner identity. Keep the operator invitation for trusted testers.
3. Exchange messages in `#stalemate`. Start a named chat channel or try Draw
   together and Watch together. The creator hosts the room and can share hosting.
4. As a Room owner, use **Keep this room**. Return using the same test label to
   recover ownership on another device. Try a second label for ownership transfer.
5. Report another visitor's message. Reopen the portal as Community moderator
   and review the report; use Site owner to test the separate site controls.

The role selector deliberately supplies **test identities**, standing in for
verified email and staff login. It does not send email or establish real-world
ownership. Signing out or changing identities closes that pilot session's active
chat sockets. Cookie sessions expire after eight hours; the invitation can unlock
a new session. No artificial visitors or background conversation are generated.

Chat follows the agreed IRC model: new arrivals receive no backlog. Connected
visitors keep bounded scrollback in their own tab. A true disconnect, refresh or
leave/rejoin starts fresh. Server hibernation preserves the same live socket's
membership without replaying chat. Registered room settings and ownership are
durable; ordinary conversation and private messages are not stored as a backlog.

## What is verified

- **382 unit tests in 43 files**, including pilot authentication, permission
  boundaries, storage failures, moderation, durable ownership and session recovery.
- **93 Chromium browser scenarios**, including two-browser art/watch activity,
  private room signaling, consent, reconnect, guest hosting and phone layouts.
- Real Cloudflare browsers verified operator and guest invitations, WebSocket
  chat, shared drawing, durable registration, cross-device ownership recovery,
  no pre-join history, visitor reports and restricted moderator review, with no
  browser page errors.
- A registered room survived a separate deployment. A 75-second idle check then
  retained the same live socket, nickname, membership and scrollback, and accepted
  a new message. The 390-pixel phone layout had no horizontal overflow; see the
  [private pilot screenshot](../pr-assets/irc-first/private-pilot-phone.png).
- Unauthenticated requests to the pilot's product HTML **and JavaScript** return
  401. Static assets run through the Worker gate. Missing pilot secrets fail
  closed; invalid invitations and guest attempts to select staff roles are refused.
- Deployment version: `c7a855b0-55db-4c31-9a05-c7a05925470a`.

The invitation is removed from the browser URL before the unlock POST. Access
uses signed HttpOnly, Secure, SameSite cookies. Operator capabilities, guest
capabilities and server identity signatures are separate. Product pages have
no-store/noindex/no-referrer responses, and the pilot is unlinked from the site.
The publicly reachable portal shell contains no invitation or product credentials.

## Current limits and the path to public use

AI moderation is **off** in this pilot. Human reports, review and moderation work.
AI review can be enabled after its separate server-side provider configuration,
disclosure and operating limits are checked; automated provider tests use fixtures.

TURN is **off**. Direct camera connections require explicit adult consent and
browser permission; difficult networks may not connect. Chat, drawing and watch
state do not depend on TURN. The client now supports signed-device credentials,
refresh and direct-only fallback, but actual shared TURN relay connectivity and
account budget settings remain to be verified before enabling it. Existing shared
WebJam TURN keys were not read or rotated. The desktop WebJam invite bridge remains
separate from the website chat; this work does not prove WAN music timing.

Production email/Cloudflare Access and Turnstile remain separate launch work.
The authenticated account inspection found the existing main Worker; the current
OAuth scope returned 403 for Access applications, so those policies are unverified.
Synthetic pilot roles must be replaced by the verified production login flow before
public access. Public launch also requires contact/terms completion and device and
cross-network checks described in [deployment guidance](HANGOUT_DEPLOY.md).

After a server hibernation, reports against older text still visible in a browser
can be refused because its transient server receipt is gone. Report a newly
received line instead. Pending PM first-message text is also transient; resend a
pending request if necessary after a wake. Neither path restores a chat backlog.

For testing without the network, use the [local launcher](HANGOUT_LOCAL_TESTING.md).
`npm run package:pilot` prepares the ignored private asset directory;
`hangout-worker/wrangler.pilot.toml` deploys only the separate pilot. Local access
material lives in ignored `.local/` with owner-only permissions. Never add it to
source, screenshots, public issues or deployment logs.
