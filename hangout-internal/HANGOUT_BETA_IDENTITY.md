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

The existing draft rules, privacy information and contact are readable before an
invitation, after logout and when the session service is unavailable. Exact
GET/HEAD requests to `/beta/privacy` lead to the existing house-rules directory;
that directory and its `index.html` alias use only `/beta/help.css`, with no scripts,
analytics, session bootstrap, cookie issuance or community-service lookup.
Other product assets remain protected. A missing policy asset returns an honest
503 page with the configured public contact, if available; an owner email is
never substituted. This access fix does not approve the draft policy, change
the existing 13+/18+ safeguards or provide a new report-collection service.

## Admission and session boundaries

Private invitations use `/beta/#invite=<private-code>`. The fragment is removed from browser history before it is submitted in a same-origin JSON POST. Do not put invitations in public PR descriptions, screenshots, logs or public navigation.

The access cookie is host-only, Secure, HttpOnly and SameSite=Lax, allowing the top-level Access email-login callback. Same-origin JSON POST mutations and WebSocket admissions require the exact beta Origin. The Access GET login callback changes identity only after provider JWT verification; it does not require an Origin header. Request bodies are bounded even without Content-Length. Product pages, JavaScript, images, private-room relay and TURN requests all require the invitation cookie and an active registry record.

Cookies expire after eight hours. A verified identity expires no later than its Access JWT or invitation session and is bound to that session's random ID. Staff allowlists are checked again when reading a staff identity. Guest socket admission ignores role query parameters, browser-supplied identity headers and staff JWTs. A valid staff identity cookie enables the moderation page but does not replace JWT verification on its WebSocket.

The separate `BETA_SESSIONS` Durable Object stores bounded lifecycle metadata: opaque session ID, expiry, invitation version, revocation status, retry metadata and up to 16 hashed private-room identifiers per session. It stores no chat, PMs, ciphertext, ICE or media. A maximum of 1,000 eight-hour sessions, including revoked tombstones, bounds the registry. New session minting is limited to 20 per daily keyed IP code in one-hour budget windows; the code changes at UTC midnight. At most 1,000 rate buckets are kept and expired buckets are pruned by alarm. Reopening an invitation with an active session reuses it instead of minting a new SID or extending its expiry. Infrastructure providers still receive network requests and process IP addresses in transit.

Session registration now commits expiry cleanup, the mint allowance, the new session and its maintenance alarm in one storage transaction. A failure within this transaction rolls back all of those mutations. Cookie signing and delivery happen afterward; a lost response after commit is not undone. Cleanup deletes at most 128 keys per operation, within the existing 1,000-session bound. `beta-session-state.mjs` accepts the caller's storage/transaction handle; it does not open another transaction or perform network work. The [storage API contract](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/) defines transaction rollback and the 128-key deletion limit. Local runtime observations are separately qualified; they do not establish enforcement of hosted limits.

Before changing identity or completing logout, the gateway durably revokes the previous SID, then asks the lobby and every registered private-room Durable Object to close that SID's sockets. Identity changes mint a new SID bound to the newly verified identity. Copied revoked cookies remain rejected until their original expiry. If closure cannot be confirmed, the gateway returns an honest failure and leaves a durable retry pending. Alarms retry at most 16 sessions at once, backing off to one hour between failed attempts, and prune tombstones only when their original cookies expire.

Revocation deliberately keeps its separate durable write before scheduling or fanout. A later failure must not roll it back into an active session. Handled registration errors are caught outside the transaction but inside the concurrency callback. This application change keeps the existing namespace and admission policy; it does not colocate registry authority with Lobby effects, establish guardian consent or qualify a hosted rollout.

Socket attachments retain only the session metadata and encrypted-relay token bucket/cumulative frame count through hibernation. Admission, wake and alarm consult the registry; individual frames check local expiry/version and the persistent frame cap without adding a registry RPC per frame. Outgoing messages also check recipient expiry/current staff permission before delivery. Access identity cookies contain a verified email for this bounded session; durable ownership uses a keyed account identifier and does not expose email to other visitors.

To revoke invitations, replace `HANGOUT_BETA_INVITE_KEY` and increment `HANGOUT_BETA_INVITE_VERSION`. Keep `HANGOUT_HMAC_KEY` stable: durable account IDs derive from it, so changing it without migration can orphan ownership. Emergency `HANGOUT_OPEN=0` pauses new visitor lobby, private-room and TURN admission. Cryptographically authenticated staff can still connect to the moderation panel. Existing visitor sockets require the network's emergency controls for immediate closure; this environment switch is an admission pause.

## Private-message peer references

The lobby advertises numeric `hello.features.privateMessagePeers: 1`. It identifies
a PM counterpart by its original live connection ID and a random 32-hex `ref`
issued for a genuinely new request. Acceptance, rename and a valid same-socket
wake preserve that reference; a closed and recreated conversation gets a new
one. These values correlate one conversation, not an account, device credential,
registered-room owner or staff role. They do not grant contact permission.

Implicit PM text and actions use `ch: "pm:<ref>"`, `pmPeer` and `pmRef`. The
server requires the exact actor, current peer and accepted pair/reference before
delivery, then applies its existing participation, blocking and commit fences.
Pending Accept/Decline controls instead require the exact pending sender and
request reference. Missing, malformed or stale fields refuse without falling
back to a nickname. Deliberately typed `/msg nickname text` and named commands
still choose the current nickname; only a deliberate menu `/msg` uses
`pmExplicit: true`. Private `/me` and quick actions remain in their selected
conversation. A typed `/slap` may name another current person in its text without
changing the private message's recipient.

Server PM request, open, request-ended, close, rename (`pm-peer`) and body frames
carry `peer`/`ref` with display labels. Each delivered PM also carries the other
peer's `with` label and a server-derived `self` boolean. Clients use that metadata,
not a nickname comparison, to update tabs, authorship, held callbacks and drafts.
These fields are added to delivery envelopes after the existing receipt is
created; the receipt digest and selected-report boundary are unchanged. This
does not add a persistent PM-body log or end-to-end encryption.

A rename or same-socket wake keeps the original conversation's history and draft.
A new socket clears old received PM lines; only closed views with an unsent
ordinary draft remain for manual Copy/Discard. A new endpoint/reference never
inherits that draft or history. Closed or unconfirmed conversations cannot
restore a saved body into a different conversation. Drafts remain in the tab's
existing in-memory stores. If the numeric peer capability is absent or has the
wrong type, implicit sends/actions retain their draft; deliberately named
commands and ordinary public chat remain available. Old stored pairs without a
reference cannot authorize a bound reply: a deliberate fresh request needs
fresh consent and a new server reference.

Safety controls do not require a new contact grant. Bound Block/Ignore actions
resolve the original live ID rather than a reused label; a valid-shaped reference
is not consent. Missing, malformed or departed bound targets refuse without
nickname fallback. Block can target a hidden safety-only connection without
storing an empty ignore nickname; Ignore may refuse a hidden name. Deliberately
typed named safety commands keep their explicit meaning. Reporting previously
delivered messages and quitting remain available independently of PM capability
or pair state.

### Upgrade and rollback

The strict session codec now accepts an optional `ref` on existing open and
pending PM records and requires valid, unique references across both sets. This
extends the record whitelist: the previous strict reader rejects rows containing
the new field. Record version, capacity/byte limits and deadlines are unchanged.

Deploy matching client assets, lobby core and session codec through the release
owner's existing maintenance and writer/socket-drain process. Qualify readers and
saved-state compatibility before activating the writer; do not assume mixed
versions are safe. A downgrade needs a separately qualified compatible snapshot
or state-translation procedure, or a reader that still understands these records.
A code-only rollback or configuration flip is not a qualified recovery procedure.
This guide supplies no migration API, automatic repair or manual database-field
deletion recipe.

PM references do not change invitation cookies, verified account linking,
registered-room ownership, Access audiences or credentials. Partner sites need
only the canonical Join link described in the [website integration guide](HANGOUT_WEBSITE_INTEGRATION.md);
they do not implement this internal protocol or receive staff powers. The
existing c841 entry-only toolkit is unchanged. This source contract does not
qualify deployment, real provider behavior, guardian consent or physical devices.

## Verification and remaining evidence

`hangout-worker/tests/beta.test.js` checks invitation-only asset/relay admission; real generated RSA signatures; distinct audiences; expiry; stable ownership across devices; staff allowlists; absence of synthetic role selection; session binding; exact-Origin checks; bounded streamed bodies; quota/provider failures; Turnstile hostname checks; emergency admission pause; and contact injection.

`hangout-worker/tests/beta-lifecycle.test.js` runs the actual gateway, registry and room/lobby adapters together to check multi-room logout, copied-cookie rejection, failed-close retry, admission/logout races, idle expiry, wake revocation, burst/frame caps through hibernation, bounded minting/room registration, timed pruning and absence of per-frame registry RPCs.

`hangout-worker/tests/beta-session-transactions.test.js` exercises the existing registration, check, room and revoke endpoints over rollback-capable test storage. It checks write/alarm/commit failures, multi-batch cleanup rollback, corrupt budgets, denied requests and preservation of revocation before fanout. Simulated callback retries remain distinct from observing an actual provider retry.

These automated tests do not prove that a real email arrived, that account-level Access applications exist, or that a real iPhone passed their login flow. Hosted evidence for those behaviors must be recorded separately before marking identity ready for invited visitors.

## Provider setup snapshot — October 19, 2026 UTC

The signed-in Cloudflare dashboard verifies One-time PIN and both saved beta hostname/path applications. Each saved application's Additional Settings supplied its distinct public AUD and confirmed hidden App Launcher listing and HttpOnly cookies. Separate Jeff-only policies include his confirmed email and require One-time PIN. The [Access setup receipt](../pr-assets/beta-collaboration/hosted-access-setup.json) records public application/policy IDs, audiences and the exact evidence source. Initial configuration `a449541` was deployed as `33e6a92f-57a8-4d89-b79f-23039af1044d`; its healthy HTTP 200 configuration check explicitly performed no provider checks. A subsequent live compatibility fix proved actual email-code owner login and separate staff authentication. Committed fix `832f7e1` was deployed as `e3177c6d-6bea-4c80-90dc-491d29a33da1`; the live moderation socket survived that deployment and retained the exact synthetic report.

The current private runtime is `0ee7705e-e381-4cb4-a70a-1f26daa10e78`, from committed source `b111bb2`. The [readiness record](HANGOUT_BETA_READINESS.md) separates its protected-asset and actual YouTube checks, the preceding hosted synthetic-camera check, and the earlier real owner/staff sign-in evidence from remaining physical-device, ownership-recovery and provider acceptance.

The first real OTP attempt exposed a runtime difference hidden by Node fixtures: Workers rejects `fetch(..., { redirect: 'error' })` with `TypeError` before making the JWKS request. The gateway now requests public keys with `redirect: 'manual'` and rejects non-success statuses, including every redirect, without following Location. Signature, issuer, route-specific audience and expiry checks remain required. Real `/beta/state` returned owner/fan after login; the separate staff callback then used Access SSO and connected the moderation WebSocket with the synthetic report visible. Jeff subsequently confirmed dismissing that report and seeing it disappear. Independent post-action queue reload/persistence and second-device registered-room recovery remain pending. [Workers redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/).

The saved initial private setup is:

1. **Integrations → Identity providers → One-time PIN** is available.
2. Two self-hosted applications protect `stalemate-hangout-beta.jeffstory007.workers.dev` at `lobby-owner*` and `lobby-admin*`, with different audiences, eight-hour sessions, no App Launcher listing, HttpOnly cookies, only One-time PIN enabled and Use all identity providers disabled.
3. Both Allow policies use **Include → Emails → jeffstory007@gmail.com** and **Require → Login Methods → One-time PIN**. Add future named cohort owners only to the owner application; staff access requires a separate explicit appointment and both staff allowlists. Guest nickname access and temporary room hosting remain available through invitations.
4. The team hostname `throbbing-hill-6ed4.cloudflareaccess.com` and two public AUDs are deployed. Actual OTP delivery, owner callback and separate staff WebSocket admission have succeeded; Jeff confirmed the identified report's dismissal/removal. Complete owner recovery, denied-identity acceptance and independent queue reload/persistence. Share only public AUDs; keep PINs, JWTs, cookies and provider tokens private. Temporary Chrome Apple Events scripting is restored off, confirmed by Jeff and a blocked no-op probe (Chrome error 12).

The public team certificate endpoint serves two signing keys. Existing OAuth app/provider list reads return empty results even for this same-account dashboard-verified setup; the exact filtering mechanism is unknown, so those lists cannot establish resource absence. Authorized API creation attempts returned HTTP 403/code 1010 (`auth.forbidden`) and created nothing; the operator completed setup through the dashboard. The [provider receipt](../pr-assets/beta-collaboration/provider-audit.json) preserves earlier observations. API automation would need account-scoped **Access: Organizations, Identity Providers, and Groups Write** and **Access: Apps and Policies Write**. [OTP setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) documents the identity-provider permission. Keep the applications scoped to hostname/path: [Worker-level Access currently rejects WebSocket upgrades](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

Cloudflare lists a **50-user limit** for Zero Trust Free. Verified owner/staff sign-ins use Access seats; nickname-only guests do not pass through Access. Check the shared seat roster before expanding the named owner cohort. Allowing every verified email is a future public-community policy decision, not the initial private-beta policy. [Current plan limits](https://www.cloudflare.com/plans/).

## Existing TURN service and beta integration

The existing `webjam-turn-credentials` Worker remains unchanged. Its October 16 deployment has desktop key/analytics secret bindings, a 600-second credential TTL and an 800 GB admission threshold. Its deployed source checks invitation shape and key-filtered analytics, but has neither browser Origin controls nor separate browser keys. [WebJam master](https://github.com/rupret007/webjam/tree/5effbc58db706254f8ca8b52de4a0520c482294a/deploy/relay/cloudflare-worker) contains newer browser-specific policy; that code is not in the audited deployment. Binding names do not prove working provider credentials.

Use the beta's existing same-origin `/turn` gateway for its cameras. It requires an active invitation, exact beta Origin, preview admission and a signed lobby device, then applies serialized rate/reservation limits. This route needs no CORS expansion or redeployment of the shared issuer. Calling the public WebJam issuer directly would bypass those beta checks; an allowed Origin or a correctly shaped invite is not proof of beta admission.

Remaining setup, with TURN kept off:

- Verify the existing `webjam-relay` entry through the dashboard or an account-scoped **Calls Read** token. Current OAuth key listing returns 403/code 10000. No key creation or rotation is needed for this route. Key-detail APIs return metadata, not the stored issuer secret; recover the approved existing token through its private credential workflow.
- Provision only the beta's `HANGOUT_TURN_KEY_ID`, `HANGOUT_TURN_API_TOKEN` and separate `HANGOUT_TURN_ANALYTICS_TOKEN`, plus public `HANGOUT_CF_ACCOUNT_ID`. Runtime issuance uses the existing key bearer; analytics needs account-scoped **Account Analytics Read**. All four beta settings were absent in the audit. Never upload the Wrangler OAuth token as a runtime secret. See [key metadata permissions](https://developers.cloudflare.com/api/resources/calls/subresources/turn/methods/list/) and [TURN analytics](https://developers.cloudflare.com/realtime/turn/analytics/).
- Confirm the account's shared allocation and choose a conservative beta allowance. Then record controlled credential issuance, analytics failure denial, consent, expiry/refresh, forced relay across two networks, direct-only fallback and rollback before enabling wider camera use. No credentials or live relay traffic were created by this audit.

A read-only account-wide TURN query succeeded using local OAuth at 04:13:55 UTC and returned **0 October egress bytes**. This does not configure the runtime analytics secret or verify billing, SFU usage, subscription terms or remaining free allowance. Cloudflare's first **1,000 GB/month is shared between SFU and TURN**, followed by $0.05/GB egress; Workers and Durable Objects are separate. Existing WebJam accounting sums ingress and egress conservatively, whereas provider pricing is based on egress. Analytics lag, other issuers and active credentials mean neither issuer's admission threshold is a hard spending cap. [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [credential lifecycle](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
