# Hangout TURN plan — Lane A

Written 21 Nov 2026, 7:42 PM CT, from exact `369314431b21c55be363515c980cab1572249657` on `claude/hangout-turn-multiguest`. Private demo only. No deploy. No public site. No Music TURN key.

## What Cloudflare documents (checked 21 Nov 2026)

Sources: Realtime pricing, TURN service, Generate Credentials, and the TURN FAQ on developers.cloudflare.com.

- STUN at `stun.cloudflare.com` is free and unlimited.
- Realtime egress (SFU and TURN together, one shared allowance, one bill line) is free for the first 1,000 GB each month, then $0.05 per GB sent from Cloudflare to the client. Ingress into Cloudflare is not the billed direction. TURN used only as a path into Realtime SFU or Stream WHIP/WHEP is not charged a second time. Workers and Durable Objects are billed on their own prices.
- A TURN key is a long-term server secret. It is not a browser credential and it does not authenticate to `turn.cloudflare.com`. The server calls `POST /v1/turn/keys/{keyId}/credentials/generate-ice-servers` with the key’s API token and a `ttl`. The JSON `iceServers` list (short-lived username and credential) is what the browser may see. TTL can be at most 48 hours. This app keeps 600 seconds, which is also the client’s maximum.
- Expired credentials stop billing immediately. The allocation drops shortly after. A live peer connection can take a replacement with `setConfiguration` and an ICE restart.
- Relay-only testing sets `iceTransportPolicy` to `relay`, so host and server-reflexive candidates are not used. A successful connection then has to be a TURN allocation.

The $0 path for tonight is: do not deploy, do not call Cloudflare, and do not put a TURN key in the repo. Enabling the flag only arms the worker path. A later live session stays inside the free allowance only while that account’s shared Realtime egress is still under 1,000 GB. `HANGOUT_TURN_MONTHLY_GB=800` is an admission estimate in the worker. It is not a Cloudflare billing cap. This lane does not check live account usage and does not print account identifiers.

## What this tree already does

- `hangout-worker/src/turn.mjs` mints those short-lived ICE servers from `HANGOUT_TURN_KEY_ID` and `HANGOUT_TURN_API_TOKEN`, after a preview key, a signed device, and the monthly ledger. The key is not copied into the response, the ledger, or the client.
- `turn-config.mjs` advertises the `/turn` URL when `HANGOUT_TURN_ENABLED` is `1`. Static `HANGOUT_TURN_URLS` are a separate optional relay and still need their own username and credential. They are not a substitute for the Cloudflare mint.
- The room and lobby clients only POST `{ preview, room, device }` and keep the returned username and credential in memory. Failure drops back to STUN and direct media.
- Official beta, pilot, and public wrangler files pin `HANGOUT_TURN_ENABLED` to `0`. Official fullgate `36931443-1795304762229546928-f6a4bd5b684f` was therefore STUN-only.
- `HANGOUT_SESSION_AUTHORITY=lobby-v1` still refuses `/turn` (no provider call). No wrangler file sets that mode. This lane does not remove that refusal.
- `WEB_TURN_KEY_*` / `webjam-turn-credentials` is private Music. It is a different key and a different issuer. Hangout will not call it.

## What this lane changes

1. Set `HANGOUT_TURN_ENABLED` to `1` in `hangout-worker/wrangler.beta.toml` only. The TURN key, API token, and analytics token stay comments: vault secrets, never `[vars]`, never client assets. `HANGOUT_CF_ACCOUNT_ID` stays empty in the file. `HANGOUT_TURN_MONTHLY_GB` stays 800.
2. Update the beta config test that reads that file so it expects `"1"`, and keep every other assertion. Also reject a TURN key, token, or credential assignment in the beta file, and reject the Cloudflare credential URL and key env names in the room TURN client source.
3. Leave `wrangler.toml` and `wrangler.pilot.toml` at `0`. `deploy.test.js` keeps expecting the public file to say disabled TURN. That is the public worker, not this private beta. Not a weakened assertion.
4. Do not change `roomMax` (paint rooms stay 8), the 50ms checkpoint ceiling, the 5s unit budget, Playwright timeouts, GO-LIVE, `ev.BASELINE`, or karen-blockers. Do not skip or delete tests.

## Tests that enter the official inventory

Chromium’s Playwright project already runs every `tests/e2e` spec except the phone file. New specs are not marked skipped and are not manual-only. Phone and WebKit projects keep their existing file filters, same as the current Hangout TURN spec.

- Forced relay, Hangout: three browsers, `iceTransportPolicy` `relay`, cameras on, peer count 3, each selected pair is relay-to-relay, remote video is actually playing. The credential endpoint is the app’s TURN client. The relay itself is a loopback UDP TURN fixture with a fixture username and password, so the test does not spend Cloudflare egress and does not need the vault key.
- Forced relay, Paint Along: the same mesh after the host turns on Paint Along and shares the in-room copy control. The copied link has `activity=paint`, no preview parameter, and three peers complete relay video.
- Credential expiry and fallback: the first mint is short-lived; the refresh is refused; the room drops to STUN, does not store the credential, and two peers still connect on a non-relay pair.

A node test of the loopback TURN fixture (allocate, permission, channel relay) runs in the Vitest unit inventory so the fixture is gated even when Playwright is locked.

These tests do not prove a second network, a real Cloudflare key, or remaining free-tier headroom. They do not make GO-LIVE TURN-ready. Official fullgate and Karen stay with the integrator after merge.

## Out of scope

Deploy, public site, pilot flag, Music key, printing secrets, force-push, raising caps or timeouts, and editing the other lanes’ worktrees.
