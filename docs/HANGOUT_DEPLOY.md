# Hang Out deployment preparation — HIDDEN, NOT deployed

This draft prepares the Worker. It does not authorize deployment or public links. Keep the
client meta values empty until the client lane completes integration. No real vault upload,
Wrangler login, or deployment was performed. Existing hidden pages remain unchanged.

## Jeff's checklist, in order

1. In Vaultwarden, add **Login** items with the value in the **password** field and grant
   the bots vault reader access. Names must match exactly and be unique:

   | Item | Worker secret |
   | --- | --- |
   | Hangout HMAC Key | HANGOUT_HMAC_KEY |
   | Hangout Turnstile Secret | HANGOUT_TURNSTILE_SECRET |
   | Hangout TURN Key ID | HANGOUT_TURN_KEY_ID |
   | Hangout TURN API Token | HANGOUT_TURN_API_TOKEN |
   | Hangout TURN Analytics Token | HANGOUT_TURN_ANALYTICS_TOKEN |

   Jeff must add all four requested items; the fifth is also required for the measured
   budget guard. Use a random HMAC secret of at least 32 characters. Never paste values into
   source, PRs, chat, terminal arguments, or logs.
2. In Cloudflare → Realtime → TURN, open the existing **webjam-relay** entry. Save its
   credential-generation key ID and corresponding API token in the two TURN vault items.
   Do not create a replacement or rotate a shared key without coordinating WebJam.
3. In Cloudflare → My Profile → API Tokens → Create Custom Token, grant **Account →
   Account Analytics → Read**, scoped to this account. Store that separate token in
   **Hangout TURN Analytics Token**. The TURN generation token does not grant analytics
   access. Copy the public account ID into `HANGOUT_CF_ACCOUNT_ID` in `[vars]`.
4. In Cloudflare → Turnstile, configure the approved site hosts and put the secret in its
   vault item. Hand the public site key to the client lane for `hangout-turnstile`.
5. In Cloudflare One / Zero Trust → Settings → Authentication → Login methods, enable
   **One-time PIN**. This is the approved email-code login for Jeff and band members.
6. In Access → Applications → Add application → Self-hosted (or Self-hosted and private),
   name it **Hang Out band admin**. Add the intended Worker hostname and path
   **`/lobby-admin*`**, covering both `/lobby-admin` and `/lobby-admin/login`.
   Choose a one-hour session. Add an **Allow** policy with **Include → Emails** containing
   Jeff's exact address and each band member's exact address. Use only One-time PIN as
   login method; no Everyone, email-domain-wide allow, Bypass, or Service Auth policy.
   Leave other identities denied. Protect every reachable hostname for this Worker,
   including its workers.dev address if enabled; avoid a narrower app overriding the policy.
7. Copy the app's **Application Audience (AUD)** and the team hostname
   (`<team>.cloudflareaccess.com`, no URL scheme) into `HANGOUT_ACCESS_AUD` and
   `HANGOUT_ACCESS_TEAM`. These public placeholders are already in `wrangler.toml`.
   For a cross-site admin WebSocket, configure the Access cookie as **SameSite=None**
   and verify browser third-party-cookie behavior in the hidden pilot. Keep the login
   redirect on the same Worker host. Never let the browser supply a trusted JWT itself.
8. Provision the existing preview/admin settings through the approved secret-management
   process: `HANGOUT_PREVIEW_KEY` (16+ characters), `HANGOUT_OWNER_EMAIL` (Jeff),
   `HANGOUT_BAND_EMAILS` (comma-separated band addresses), and `HANGOUT_ADMIN_RETURN`
   (the existing hidden admin HTTPS URL). The helper deliberately does not invent or
   overwrite these. Match the Worker email allowlist to the Access policy.
9. Review `scripts/hangout-secrets-from-vault.sh --dry-run`: it lists names only and does
   not open the vault or call Wrangler. **After separate deployment approval**, an operator
   may run the same script with `--apply`. It reads `~/vaultwarden/bin/bw-get`, validates
   all items in memory, and pipes each into `npx wrangler secret put` from `hangout-worker`.
   Output from both external tools is suppressed; values never enter argv or temporary files.
   A partial upload is possible if a later upload fails; rerun after correcting the cause.
   Secret uploads can change a live Worker version: do not run `--apply` during this prep.
10. Resolve the client-lane blockers below, confirm the account's TURN/SFU budget allocation,
    and review the draft PR and tests. Leave `HANGOUT_TURN_ENABLED="0"` in this prep.
    Keep `HANGOUT_OPEN="1"`: once configured the lobby has no opening-hours schedule;
    the server automatically makes fans read-only after 24 hours without band presence.
11. Stop here for this task. A later, separately approved deployment must include the v3
    `HangoutTurnBudget` SQLite Durable Object migration and all bindings. After that rollout,
    use a hidden pilot to verify Jeff/band email codes work, outsiders and missing/invalid
    JWTs fail, camera consent works, and budget exhaustion retains STUN/chat/drawing.
    Keep public navigation unlinked and indexing disabled. Legal/contact review remains a
    prerequisite to any public rollout. Never merge or undraft this preparation PR automatically.

## Client contract for the other lane

`<meta name="hangout-turn" content="">` stays empty now. On a later approved rollout,
its value is the HTTPS Worker `/turn` endpoint, with no key or token in its URL.

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

**Client blockers:** the current private-room request omits `device` and caches ICE indefinitely.
The other lane must carry the signed lobby device into private rooms (or add a separately
reviewed authenticated bootstrap), implement refresh/fallback, and keep credentials out of logs.
Lobby cameras are server-gated behind explicit `adult18:true`, off by default. The private-room
camera/microphone defaults are also off, but its camera permission flow currently has no 18+
confirmation. The client lane must add that gate, including the optional camera precheck,
before enabling this integration. This PR does not edit client files.

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

Run from the repository root, only when `python3 -c "import os;print(os.getloadavg()[0])"`
is below 14; wait and recheck otherwise:

```sh
nice -n 10 npx vitest run --maxWorkers=2
nice -n 10 npx vitest run --config hangout-worker/vitest.config.mjs
bash -n scripts/hangout-secrets-from-vault.sh
scripts/hangout-secrets-from-vault.sh --dry-run
```

The scoped config includes the unchanged full existing unit suite **plus** tests under
`hangout-worker/tests/`, without modifying the root config or other lane's tests. Fetches
are mocked. Coverage includes signed-device admission, CORS, upstream errors, durable
concurrency/rates/budget/rollover, Access JWT denial, StaleBot, open/24h lockdown, and lobby
18+ camera consent. Existing hidden-page and video tests remain enabled.

Cloudflare references: [TURN credential API](https://developers.cloudflare.com/realtime/turn/generate-credentials/),
[TURN analytics and token scope](https://developers.cloudflare.com/realtime/turn/analytics/),
[credential expiry behavior](https://developers.cloudflare.com/realtime/turn/faq/),
[Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
