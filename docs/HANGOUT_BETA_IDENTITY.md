# Private beta identity

The real visitor beta uses `hangout-worker/src/beta-entry.mjs` and `wrangler.beta.toml`. Build its protected assets with `npm run package:beta` into ignored `.beta-assets`. The existing pilot uses a different entrypoint, cookies, Worker, asset build and Durable Object namespaces. Its synthetic role selector is unavailable in the beta.

An invitation grants guest access, not an account or staff role. Guests choose a nickname and may host temporary channels. Email verification adds a stable, opaque account identifier for durable room ownership and verified co-host grants. It does not reserve nicknames or grant moderation privileges.

## Configuration

Required Worker secrets are `HANGOUT_BETA_INVITE_KEY` (at least 32 random characters), `HANGOUT_HMAC_KEY` (at least 32 random characters), and `HANGOUT_PREVIEW_KEY` (an internal compatibility admission key). Keep values outside source control. The browser receives the compatibility key only after invitation admission; possession of that key alone cannot pass the beta cookie gate.

Configure separate hostname/path Cloudflare Access applications for these paths:

| Paths | Application audience | Policy |
| --- | --- | --- |
| `/lobby-owner*` | `HANGOUT_OWNER_ACCESS_AUD` | Email-code verification for invited visitors who want durable ownership |
| `/lobby-admin*` | `HANGOUT_ACCESS_AUD` | Restricted staff email allowlist |

Set `HANGOUT_ACCESS_TEAM` to the Access team hostname. The audiences must be different. The Worker independently verifies signature, issuer, audience and expiry, then checks `HANGOUT_OWNER_EMAIL`, `HANGOUT_BAND_EMAILS` and `HANGOUT_MODERATOR_EMAILS` for staff access. The owner application does not grant staff privileges even when its verified email appears on a staff allowlist.

Use hostname/path Access applications, not the Worker-level Access switch. Guest asset routes remain protected by the invitation cookie, and every owner/staff WebSocket upgrade independently checks its corresponding Access JWT. Missing configuration or provider verification failures fail closed. The portal hides email/staff sign-in links until both distinct audiences are configured; a passing guest test is not evidence that email delivery works.

Set `HANGOUT_MODERATION_CONTACT` to a confirmed, monitored email address. The beta adapter renders it in the existing house-rules page. Missing or invalid contact configuration is shown explicitly; no fallback address is invented.

## Admission and session boundaries

Private invitations use `/beta/#invite=<private-code>`. The fragment is removed from browser history before it is submitted in a same-origin JSON POST. Do not put invitations in public PR descriptions, screenshots, logs or public navigation.

The access cookie is host-only, Secure, HttpOnly and SameSite=Lax, allowing the top-level Access email-login callback. Same-origin JSON POST mutations and WebSocket admissions require the exact beta Origin. The Access GET login callback changes identity only after provider JWT verification; it does not require an Origin header. Request bodies are bounded even without Content-Length. Product pages, JavaScript, images, private-room relay and TURN requests all require the invitation cookie and an active registry record.

Cookies expire after eight hours. A verified identity expires no later than its Access JWT or invitation session and is bound to that session's random ID. Staff allowlists are checked again when reading a staff identity. Guest socket admission ignores role query parameters, browser-supplied identity headers and staff JWTs. A valid staff identity cookie enables the moderation page but does not replace JWT verification on its WebSocket.

The separate `BETA_SESSIONS` Durable Object stores bounded lifecycle metadata: opaque session ID, expiry, invitation version, revocation status, retry metadata and up to 16 hashed private-room identifiers per session. It stores no chat, PMs, ciphertext, ICE or media. A maximum of 1,000 eight-hour sessions, including revoked tombstones, bounds the registry. New session minting is limited to 20 per daily keyed IP code in one-hour budget windows; the code changes at UTC midnight. At most 1,000 rate buckets are kept and expired buckets are pruned by alarm. Reopening an invitation with an active session reuses it instead of minting a new SID or extending its expiry. Infrastructure providers still receive network requests and process IP addresses in transit.

Before changing identity or completing logout, the gateway durably revokes the previous SID, then asks the lobby and every registered private-room Durable Object to close that SID's sockets. Identity changes mint a new SID bound to the newly verified identity. Copied revoked cookies remain rejected until their original expiry. If closure cannot be confirmed, the gateway returns an honest failure and leaves a durable retry pending. Alarms retry at most 16 sessions at once, backing off to one hour between failed attempts, and prune tombstones only when their original cookies expire.

Socket attachments retain only the session metadata and encrypted-relay token bucket/cumulative frame count through hibernation. Admission, wake and alarm consult the registry; individual frames check local expiry/version and the persistent frame cap without adding a registry RPC per frame. Outgoing messages also check recipient expiry/current staff permission before delivery. Access identity cookies contain a verified email for this bounded session; durable ownership uses a keyed account identifier and does not expose email to other visitors.

To revoke invitations, replace `HANGOUT_BETA_INVITE_KEY` and increment `HANGOUT_BETA_INVITE_VERSION`. Keep `HANGOUT_HMAC_KEY` stable: durable account IDs derive from it, so changing it without migration can orphan ownership. Emergency `HANGOUT_OPEN=0` pauses new visitor lobby, private-room and TURN admission. Cryptographically authenticated staff can still connect to the moderation panel. Existing visitor sockets require the network's emergency controls for immediate closure; this environment switch is an admission pause.

## Verification and remaining evidence

`hangout-worker/tests/beta.test.js` checks invitation-only asset/relay admission; real generated RSA signatures; distinct audiences; expiry; stable ownership across devices; staff allowlists; absence of synthetic role selection; session binding; exact-Origin checks; bounded streamed bodies; quota/provider failures; Turnstile hostname checks; emergency admission pause; and contact injection.

`hangout-worker/tests/beta-lifecycle.test.js` runs the actual gateway, registry and room/lobby adapters together to check multi-room logout, copied-cookie rejection, failed-close retry, admission/logout races, idle expiry, wake revocation, burst/frame caps through hibernation, bounded minting/room registration, timed pruning and absence of per-frame registry RPCs.

These automated tests do not prove that a real email arrived, that account-level Access applications exist, or that a real iPhone passed their login flow. Hosted evidence for those behaviors must be recorded separately before marking identity ready for invited visitors.
