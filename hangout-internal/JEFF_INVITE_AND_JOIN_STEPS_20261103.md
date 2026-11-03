# Jeff: issue a private beta invitation and join (2026-11-03)

Operator-only steps for the **invitation-only** community at
`https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/`.
Do not paste invitation codes, cookies, or Worker secrets into git, PRs,
screenshots, or chat. This document names locations only.

## What an invitation is

- A **guest invitation** is an opaque code bound to Worker secret
  `HANGOUT_BETA_INVITE_KEY` and version `HANGOUT_BETA_INVITE_VERSION` in
  `hangout-worker/wrangler.beta.toml` (values live in Cloudflare secrets, not in
  source).
- Opening `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/#invite=<code>`
  strips the fragment, POSTs to `/beta/unlock`, and mints an eight-hour HttpOnly
  session cookie. See `hangout-worker/src/beta-entry.mjs` and
  [HANGOUT_BETA_IDENTITY.md](HANGOUT_BETA_IDENTITY.md).
- Guest invitations grant **visitor** access only. Owner/staff paths use separate
  Cloudflare Access apps on `/lobby-owner*` and `/lobby-admin*` with One-time PIN.

## Where Jeff keeps invitation material

| Purpose | Location (name only) |
| --- | --- |
| Operator notes and invitation codes | Ignored file `.local/beta-access.md` at the StalemateSite repo root (permission `600`; referenced in [HANGOUT_BETA_READINESS.md](HANGOUT_BETA_READINESS.md)) |
| Hosted demo receipts (no secrets) | `pr-assets/beta-collaboration/` and worktree `.local/demo-progress/` |
| Worker secrets already on the beta Worker | `HANGOUT_BETA_INVITE_KEY`, `HANGOUT_HMAC_KEY`, `HANGOUT_PREVIEW_KEY` via `wrangler secret` against `hangout-worker/wrangler.beta.toml` |

Jeff generates or rotates invitations **outside** the repository (password manager,
private note, or approved vault item). Rotating the invite key requires incrementing
`HANGOUT_BETA_INVITE_VERSION` and redeploying through the owner process in
[HANGOUT_BETA_HANDOFF.md](HANGOUT_BETA_HANDOFF.md) — **not** part of this demo PR
line and **not** authorized in Cursor sessions that forbid deploys.

## Issue one guest invitation (Jeff)

1. Read the current invitation code from `.local/beta-access.md` (or create a new
   code and update that file locally only).
2. Build the link: `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/#invite=<code>`.
3. Send the link through a private channel (text, email, etc.). Never commit the
   URL with the fragment to git.
4. Optional: copy a **guest sub-invitation** from the beta portal after Jeff signs
   in as operator, if the portal exposes one for a friend — same rules apply.

## Join as Jeff (hosted beta)

1. Open the private link in a normal browser (Chromium or WebKit; not headless
   automation without the invitation).
2. Submit the code if prompted; choose **Guest**, pick a nickname, enter the lobby.
3. For **Stalemate** vs **Rad Dad** entry badges, use the portal entry choices or
   the reviewed toolkit links once inserted on band pages (not required for a
   minimal music trial).
4. To test **Web Join music** after native host setup:
   - Mac host runs the qualified private-beta WebJam build (`private-beta` target).
   - Host: start music session → **Web Join → Allow a web guest** → **Copy web invite**.
   - Paste the browser link in the community Jam invitation box → **Share** → guest
     clicks **Join in browser** (see [HANGOUT_BROWSER_INVITATION_HANDOFF.md](HANGOUT_BROWSER_INVITATION_HANDOFF.md)).
   - Guest page: complete the first-run checklist (headphones, mic consent), then
     **Join with microphone**.

## Join without the hosted beta (local smoke)

```sh
cd StalemateSite   # qualified assembly checkout
npm run dev:hangout
```

Open the printed loopback launcher URL; pick **Guest** and **Room owner A** in two
tabs. This does **not** prove cross-network music or TURN; it validates lobby/chat
mechanics only ([HANGOUT_LOCAL_TESTING.md](HANGOUT_LOCAL_TESTING.md)).

## What still blocks a real music trial

- Physical reciprocal audio on ARM / Intel / Windows (**PENDING-Jeff**).
- Hosted `HANGOUT_TURN_ENABLED=0` and missing web TURN bindings until owner
  activates providers ([HANGOUT_WEB_JOIN_READINESS_20261031.md](HANGOUT_WEB_JOIN_READINESS_20261031.md)).
- Jeff’s live invitation for any automated hosted probe (gate-only without it).

## Related docs

- [HANGOUT_BETA_HANDOFF.md](HANGOUT_BETA_HANDOFF.md) — operator setup, deploy fence
- [HANGOUT_DEMO_GUIDE.md](HANGOUT_DEMO_GUIDE.md) — visitor journey
- [HANGOUT_MUSIC_DEMO_ACCEPTANCE.md](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) — music proof plan
