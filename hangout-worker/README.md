# Hang Out relay (hidden preview)

A tiny Cloudflare Worker with Durable Objects that forwards **encrypted data frames only** (strokes, chat, play/pause, WebRTC offers and answers) between people in one invite room. No video, audio or files go through it. Faces and voices connect browser to browser.

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
