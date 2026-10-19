# Hang Out deployment reconciliation — private testing only

This branch incorporates the relevant TURN, Access and vault preparation from
[PR #25](https://github.com/rupret007/StalemateSite/pull/25), preserving the newer community
moderators, persistent rooms and open community decisions. The existing Cloudflare setup is
the baseline: verify and reuse it before creating anything. Empty checked-in IDs are safe
defaults, not proof that dashboard settings or secrets are missing.

## Current private deployment

The new, separate **`stalemate-hangout-pilot`** Worker is deployed at
[the protected pilot entrance](https://stalemate-hangout-pilot.jeffstory007.workers.dev/pilot/).
October 18 deployment: `c7a855b0-55db-4c31-9a05-c7a05925470a`.
An invitation unlocks a signed, eight-hour, HttpOnly/Secure/SameSite=Strict cookie. The Worker
checks this session before serving collaboration assets or relay routes; a hidden path is not
its access control. Operator invitations can select clearly labeled synthetic test roles;
guest invitations cannot select staff roles. Role changes and logout end that pilot session's
open lobby connections. Production email delivery and Cloudflare Access remain unverified.

The existing **`stalemate-hangout`** Worker and public Stalemate site remain untouched.
The pilot has separate assets, Durable Object namespaces and secrets. **AI and TURN are off**;
cameras use direct connections with STUN. No public navigation points to the pilot. See
[private pilot access, verification and testing](HANGOUT_PRIVATE_PILOT.md).

The loopback preview also remains available through `npm run dev:hangout`; its launcher prints
the current local URL and uses explicit test identities. A loopback URL works only on the
machine running that command.

## Existing setup and additions

Reuse the existing `webjam-relay` TURN entry and approved staff Access application. Do not
rotate shared credentials. Check the existing Turnstile hosts and all reachable Worker
hostnames. Add only missing configuration. Public room-owner email login requires a **separate**
Access audience/application on `/lobby-owner*`; it must never broaden the staff policy.
`HANGOUT_MODERATOR_EMAILS` names the owner's community moderators; match those addresses in
the staff Access application alongside owner/band addresses.

The original PR's 24-hour band-absence shutdown was superseded. Community conversations stay
open without band attendance. Explicit moderation locks, corrupt safety-state recovery and
budget limits still apply.

## Production integration checklist

These checks apply to a future public release or integration into the existing main Worker.
They are not prerequisites for using the already deployed invitation pilot. The private pilot
uses its own cookie gateway and synthetic roles; it does not establish production Access,
Turnstile, public owner email or TURN readiness.

1. In Vaultwarden, verify the existing **Login** items (add only missing items) with the value in the **password** field and grant
   the bots vault reader access. Names must match exactly and be unique:

   | Item | Worker secret |
   | --- | --- |
   | Hangout HMAC Key | HANGOUT_HMAC_KEY |
   | Hangout Turnstile Secret | HANGOUT_TURNSTILE_SECRET |
   | Hangout TURN Key ID | HANGOUT_TURN_KEY_ID |
   | Hangout TURN API Token | HANGOUT_TURN_API_TOKEN |
   | Hangout TURN Analytics Token | HANGOUT_TURN_ANALYTICS_TOKEN |

   All five items are required for the helper; the separate analytics token is needed for the measured
   budget guard. Use a random HMAC secret of at least 32 characters. Never paste values into
   source, PRs, chat, terminal arguments, or logs.
2. In Cloudflare → Realtime → TURN, open the existing **webjam-relay** entry. Save its
   credential-generation key ID and corresponding API token in the two TURN vault items.
   Do not create a replacement or rotate a shared key without coordinating WebJam.
3. In Cloudflare → My Profile → API Tokens → Create Custom Token, grant **Account →
   Account Analytics → Read**, scoped to this account. Store that separate token in
   **Hangout TURN Analytics Token**. The TURN generation token does not grant analytics
   access. Copy the public account ID into `HANGOUT_CF_ACCOUNT_ID` in `[vars]`.
4. In Cloudflare → Turnstile, verify the approved site hosts and put the secret in its
   vault item. Hand the public site key to the client lane for `hangout-turnstile`.
5. In Cloudflare One / Zero Trust → Settings → Authentication → Login methods, enable
   **One-time PIN**. This is the approved email-code login for Jeff and band members.
6. In Access → Applications, verify the existing **Hang Out band admin** self-hosted application. Add the intended Worker hostname and path
   **`/lobby-admin*`**, covering both `/lobby-admin` and `/lobby-admin/login`.
   Choose a one-hour session. Add an **Allow** policy with **Include → Emails** containing
   Jeff's exact address, each band member's exact address and appointed moderator addresses. Use only One-time PIN as
   login method; no Everyone, email-domain-wide allow, Bypass, or Service Auth policy.
   Leave other identities denied. Protect every reachable hostname for this Worker,
   including its workers.dev address if enabled; avoid a narrower app overriding the policy.
7. Copy the app's **Application Audience (AUD)** and the team hostname
   (`<team>.cloudflareaccess.com`, no URL scheme) into the deployment configuration as
   `HANGOUT_ACCESS_AUD` and `HANGOUT_ACCESS_TEAM`. Keep account-specific IDs out of generic defaults.
   For a cross-site admin WebSocket, configure the Access cookie as **SameSite=None**
   and verify actual browser third-party-cookie behavior during production-auth testing. Keep the login
   redirect on the same Worker host. Never let the browser supply a trusted JWT itself.
8. Provision the existing preview/admin settings through the approved secret-management
   process: `HANGOUT_PREVIEW_KEY` (16+ characters), `HANGOUT_OWNER_EMAIL` (Jeff),
   `HANGOUT_BAND_EMAILS` (comma-separated band addresses), and `HANGOUT_ADMIN_RETURN`
   (the existing hidden admin HTTPS URL). The helper deliberately does not invent or
   overwrite these. Match the Worker email allowlist to the Access policy.
9. Review `scripts/hangout-secrets-from-vault.sh --dry-run`: it lists names only and does
   not open the vault or call Wrangler. The helper's `--apply` target is the main
   `wrangler.toml`, not `wrangler.pilot.toml`; it is unnecessary for testing the deployed pilot.
   During production configuration, `--apply` reads `~/vaultwarden/bin/bw-get`, validates
   all items in memory, and pipes each into `npx wrangler secret put` from `hangout-worker`.
   Output from both external tools is suppressed; values never enter argv or temporary files.
   A partial upload is possible if a later upload fails; rerun after correcting the cause.
   Secret uploads change the selected Worker's configuration; preserve the pilot's separate secrets.
10. Verify the client contract below, confirm the account's TURN/SFU budget allocation,
    and review the combined changes and tests. Keep `HANGOUT_TURN_ENABLED="0"` until live
    credentials, analytics admission and cross-network fallback have been verified.
    Keep `HANGOUT_OPEN="1"`: once configured the lobby has no opening-hours schedule;
    community rooms remain open independently of band presence.
11. Integration into the existing main Worker must include its v3 `HangoutTurnBudget` SQLite
    Durable Object migration and bindings. The new pilot uses a separate `pilot-v1` migration
    and its own namespaces; do not substitute either migration history for the other.
    Validate real staff/owner email codes, Access denial, Turnstile, camera consent and TURN
    budget fallback before public launch. Keep public navigation unlinked while private testing
    continues, and finish the public moderation contact/response process before launch.

## TURN client contract

The deployed pilot forces `<meta name="hangout-turn" content="">` empty and disables credential
issuance. When TURN is configured and verified, the value is the HTTPS Worker `/turn` endpoint,
with no key or token in its URL.

Send a JSON POST with `{ room, preview, device }`: `room` is the relay's 64-character
lowercase hex room ID; `preview` is the existing preview credential; `device` is the signed
`token` received in the lobby's `{t:"device", token}` message. It is not a user-picked UUID.
The endpoint supports exact-origin CORS and OPTIONS, and always sends `Cache-Control: no-store`.
Do not put credentials in query strings, analytics, or persistent ICE caches.

Success: HTTP 200, `{iceServers, ttl:600, expiresAt:<Unix milliseconds>}`. Merge with STUN.
Refresh before expiry (e.g. at 8 minutes), update active peer connections using
`setConfiguration`, and support ICE restart. Deduplicate parallel refreshes per device.
Failure: JSON with `iceServers:[]` and `reason`; 429 **`"budget used"`** or **`"rate limited"`**
(`retryAfter:600` seconds for rate limits); 503 for disabled, unconfigured or unavailable
TURN. Authentication errors are 403; malformed room IDs 400. On any non-200, empty ICE,
timeout or network failure, retain STUN and show direct-only status. Back off until the
rate window ends; do not loop on a spent monthly budget. Existing credentials may work
until expiry; disabling issuance does not revoke them immediately.

Both clients carry the signed lobby device, refresh credentials, update active peers and fall
back to direct connections. Private invitations without a signed lobby device explain that
relay admission needs a lobby visit. Camera and precheck capture require explicit adult
confirmation; lobby cameras are server-gated behind `adult18:true`. Verify these flows against
the live provider before enabling TURN; fixture tests do not prove cross-network relay behavior.

## Budget and abuse limits

One global `TURN_BUDGET` Durable Object serializes admission. It allows 16 requests per room,
2 per signed device across rooms, and 60 globally in a rolling ten-minute window that begins
on the first admitted attempt. Failed upstream attempts also consume rate allowance.

Before minting, query Cloudflare GraphQL for the current UTC calendar month's **account-wide
TURN egress**, cached for at most 60 seconds. Missing permissions, network errors, malformed
analytics, or inaccessible/corrupt accounting refuse credentials. A monthly high-water mark
prevents a lower later sample from reopening a spent budget. Each attempt to mint reserves
0.1 decimal GB durably before the upstream call, even if the response fails. The guard refuses
when observed usage plus reservations plus the next reservation would exceed
`HANGOUT_TURN_MONTHLY_GB` (positive, at most 800). Reservations reset on UTC month rollover.
They are deliberately not subtracted when usage catches up, so this errs toward early shutdown.

**This is a credential-admission guard, not a hard provider billing/egress cap.** The 0.1 GB
reservation approximates ten minutes at 1.33 Mbps; clients can exceed that and credentials can
be reused. Analytics lag, active credentials and other issuers can overshoot. Shared WebJam
issuance does not use this DO. The query includes all TURN keys but not SFU usage; Jeff must
budget shared usage and leave enough headroom or keep TURN disabled. Do not describe an
800 GB admission threshold as a guaranteed account spending ceiling.

## Verification

Run from the repository root:

```sh
npm run test:unit -- --maxWorkers=2
npx vitest run --config hangout-worker/tests/vitest.config.mjs
bash -n scripts/hangout-secrets-from-vault.sh
scripts/hangout-secrets-from-vault.sh --dry-run
```

The scoped deployment suite covers TURN signed-device admission, CORS, upstream failures,
durable concurrency/rates/budget/rollover, verified staff redirects (including moderators),
separate public-owner audience, StaleBot, continued operation without band attendance, and
lobby camera consent. All upstream calls and credentials in these tests are fixtures.
The dry run lists names only: it does not read the vault or upload secrets.

The combined local validation passed **382 unit tests and 93 community Chromium tests**.
Live two-browser pilot checks passed for shared chat, drawing and report review. The pilot's
signed-cookie asset/relay gateway provides private invitation access independently of Access.
The final live check retained the same socket, nickname, room membership and scrollback across
75 seconds idle, then accepted a new message with no page errors. A 390px phone viewport had
no horizontal overflow. A registered room survived a separate deployment; synthetic proof
rooms were removed afterward. See the [phone capture](../pr-assets/irc-first/private-pilot-phone.png).
See [the pilot verification record](HANGOUT_PRIVATE_PILOT.md) for cloud checks and remaining limits.

Public launch still needs actual email-code/JWT, staff/owner sign-in, Turnstile and live TURN
validation. Confirm every intended hostname enforces the production Access policy. The
invitation pilot's synthetic identities and direct media do not prove those integrations.

## October 18 read-only account check

The existing `stalemate-hangout` Worker is present with an October 16 deployment. Its inspected
bindings include the encrypted `ROOMS` and `QUOTA` Durable Objects and a preview secret;
the inspected deployment did not contain the new lobby bindings/configuration. The current
OAuth scope returned 403 for Access application inspection. The accessible Turnstile widget
list was empty. These observations establish what this credential could inspect; they do not
prove no setup exists in another account or outside its scope. No existing Worker was changed.

The room client now implements the signed-device POST, bounded credential lifetime,
deduplicated refresh, updates to active peer connections with ICE restart, and direct-only
fallback/backoff. A private invitation opened without a signed lobby device retains direct
connections and explains how to obtain relay admission. Credentials remain in memory.
Camera, art camera and optional precheck now require an explicit adult confirmation before
requesting capture. Automated browser tests cover consent cancellation and credential refresh
with fixture provider responses; live provider TURN connectivity remains unverified and off.

Cloudflare references: [TURN credential API](https://developers.cloudflare.com/realtime/turn/generate-credentials/),
[TURN analytics and token scope](https://developers.cloudflare.com/realtime/turn/analytics/),
[credential expiry behavior](https://developers.cloudflare.com/realtime/turn/faq/),
[Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
