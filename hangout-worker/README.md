# Hang Out relay (hidden preview)

The private invite-room relay forwards **encrypted data frames only** (strokes, chat, play/pause, WebRTC offers and answers). The separate public lobby engine below handles moderated text and activity state. Video/audio stay between browsers; they are not sent to the AI text classifier.

## Caps (free plan, no card, fail closed)
- **Admission:** an exact-origin allowlist plus the `HANGOUT_PREVIEW_KEY` secret. A missing secret or binding returns 503, and a wrong key returns 403.
- **Rooms:** 8 people per room. Cameras and mics are capped at 4 by the client.
- **Daily connections:** 200 a day for the whole account, after which it returns 429. If quota accounting can't be reached, it returns 503.
- **Per connection:** up to 8,000 messages, a burst of 30, refilling at 8 a second, and frames of 1 MB or less.
- **Request budget:** worst case is 200 × 8,000 messages ÷ 20 (WebSocket messages bill 20:1) ≈ 80k request-equivalents, under the free 100k a day.

## Deploy (needs `wrangler login` as Jeff, on the free plan)
```sh
cd hangout-worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put HANGOUT_PREVIEW_KEY   # >= 16 random chars, never committed
```
Then put the `wss://stalemate-hangout.<account>.workers.dev` URL in the room page's `hangout-relay` meta tag.

## Camera bandwidth math
- **Per stream:** camera at 320×240, 15 fps, 250 kbps, plus mic Opus at 32 kbps, ≈ 0.28 Mbps. On a relayed leg it drops to 160×120 at 10 fps, 100 kbps.
- **4-person mesh:** each person uploads 3 streams and downloads 3, ≈ 0.85 Mbps each way.
- **Direct connections** cost $0.
- **TURN worst case (every leg relayed):** 12 legs × 0.28 Mbps ≈ 1.5 GB an hour, or ≈ 0.6 GB an hour at the relayed low tier.
- **TURN typical (about 15% of legs relayed):** 0.1–0.25 GB an hour.
- **Free allowance:** Cloudflare's TURN and SFU share one free 1,000 GB a month. WebJam's TURN Worker caps the account at 800 GB, with 200 GB for web traffic.
- **TURN is off by default.** `hangout-turn` is empty, so the room uses direct connections only (STUN) until a capped TURN credential endpoint is approved. If the endpoint says the budget is used up, faces fall back to direct-only, and chat, draw and watch keep working.

## Lobby (#stalemate) — phase 1, hidden, NOT deployed
- `/lobby` (fans) and `/lobby-admin` (band) WebSockets on the same Worker, one `HangoutLobby` Durable Object (Hibernation API).
  Engine: `src/lobby-core.mjs` (pure, unit-tested, also driven by `scripts/hangout-relay-dev.mjs`). Filter: `src/filter.mjs`.
  Auth + device ids: `src/auth.mjs`. Worker gate: `src/lobby-do.mjs`.
- Fail closed: any missing secret/binding → 503. `HANGOUT_OPEN=0` → "back soon". Daily request share: read-only at 85 %, closed at 95 %.
- Before any deploy (needs Jeff's OK):
  1. Cloudflare Zero Trust (free) → Access app covering `<worker host>/lobby-admin*`, policy = band emails, login = One-time PIN.
     Set the Access cookie to SameSite=None so the WebSocket from stalemate.band carries it. Put the team domain and AUD in
     `[vars]` (public ids).
  2. `wrangler secret put` HANGOUT_HMAC_KEY (32+ random chars), HANGOUT_TURNSTILE_SECRET, HANGOUT_OWNER_EMAIL,
     HANGOUT_BAND_EMAILS, HANGOUT_ADMIN_RETURN (https://stalemate.band/r/<hidden>/admin/). Turnstile site key goes in the
     lobby page meta.
  3. Lawyer reviews `r/<hidden>/terms/` and the contact placeholder is filled before any public link (rollout R3).
- WebJam: jam rooms only relay the host's `webjam://` invite; signaling, mailbox, TURN and Jamulus stay in WebJam.
  `WEBJAM_WEB_ORIGINS` turns on the Web Join (#388) browser hook.

## Open-community operation and optional AI review

Guest rooms remain open when band members are away. Manual locks/shield, stored-state validation and infrastructure caps still apply. Legacy automatic locks are not silently cleared because their stored flag can also mean lost/corrupt moderation state.

`HANGOUT_AI_MODERATION="off"` is the default. Setting it to `"review"` plus an `OPENAI_API_KEY` Worker secret enables review-only classification of new public text using `src/ai-moderation.mjs`. `HANGOUT_AI_DAILY_LIMIT` defaults to 1000; the persistent allowance, concurrency cap, timeout and failure backoff bound provider traffic. No browser receives credentials. The local relay does not enable external AI calls.

AI flags, human reports and held-message evidence use separate bounded 24-hour storage queues; they never become visitor chat history. They are for authenticated human review. AI does not automatically punish users. See [the safeguard design and activation procedure](../docs/HANGOUT_SAFEGUARDS_AI.md) for data scope, failure behavior, validation and remaining launch work.

## Community roles and room registration

Optional public email ownership uses a separate Access application (`HANGOUT_OWNER_ACCESS_AUD`, `HANGOUT_OWNER_RETURN`); staff remain behind the existing restricted application. `HANGOUT_MODERATOR_EMAILS` is owner-managed deployment configuration. See [community configuration, limits and migration](../docs/HANGOUT_COMMUNITY_IMPROVEMENTS.md). Nothing in this change configures Cloudflare, sends email, deploys pages, or enables AI.
