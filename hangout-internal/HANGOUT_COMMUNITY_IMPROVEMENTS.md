# Community safeguards and persistent rooms

Implemented locally on October 18, 2026. Not deployed. Guest access, temporary hosting and join-time-only IRC chat remain available. AI stays off unless explicitly configured.

## Assessment and resulting behavior

| Gap | Implemented behavior |
| --- | --- |
| Site-wide help required band accounts | Owner-appointed moderator allowlist; distinct MOD badge and server-enforced capabilities |
| Browser/device loss meant losing a room | Optional verified-email ownership; another device with the same verified email recovers the owner role |
| Hibernation lost room settings and hosts | Versioned room records and bounded activity snapshots restored before socket readmission |
| Commands/reports/PMs could evade ordinary chat limits | Shared device/account buckets, aggregate daily-IP command bucket, durable allowances |
| Action-log storage grew without pruning | Startup/alarm pruning at 30 days or 2,000 records; physical backup retention remains separate |
| Visitors could not distinguish ongoing and returnable rooms | Active/temporary, registered, and My rooms views, search, real occupancy and host presence |
| Host handoff required memorizing commands | Visible guest/verified co-host controls, offline verified co-host removal, accepted ownership transfer |

## Ownership and interfaces

Existing `/lobby` guest and `/lobby-admin` staff sockets remain. `/lobby-owner` is a separate verified-email socket that grants no staff role. `/lobby-owner/login` validates the Access assertion and redirects only to the configured first-party lobby page. Browser state indicates which endpoint to use; it never proves identity. Expired sessions must sign in again or continue as guests. Nicknames remain unreserved.

`hello`/`welcome` include `verified` and capabilities (`moderate`, `configure`, `register`). Staff state includes capabilities. `moderator` is separate from `band`/`owner`. Unknown staff email is refused; stored staff sessions are rechecked on wake and each message. Sessions also expire according to their JWT. Emails and account IDs are not added to public chat, directory or member frames. Only the room owner's private co-host management frame includes opaque co-host IDs, enabling offline revocation.

New room commands: `/register`, `/cohost add|remove nick`, `/transfer nick`, `/acceptowner`, `/unregister`. Owners can also remove an offline co-host using the private host-tools list. Guest `/op` and `/deop` remain room-scoped. Registration requires the temporary room's current signed-device founder to sign in with email. Registration removes its implicit guest-device host grant, so continuing anonymously on the same device does not retain ownership power. Transfer requires a verified co-host's acceptance within ten minutes; pending offers are invalid after restart. The previous owner becomes a verified co-host.

Limits: three registrations per account, 1,000 sitewide, 30 simultaneously active rooms, eight occupants per room. An absent registered owner has one reserved place within the room's capacity. Temporary room creation keeps the existing device/IP throttles. Registered names expire after 90 days without an authenticated owner/co-host visit or continuing presence; ordinary visitors cannot renew them. Temporary rooms expire after ten empty minutes. Activity state clears after ten empty minutes in either room type. No chat or PM backlog is persisted. WebJam invitation links are not written into room records.

Room and abuse-state writes must finish before buffered success frames are delivered. Kick reasons are sent before closing sockets. Failed durable writes make the engine read-only and stop room changes until recovery; the client is told the operation was not confirmed. Missing or malformed indexed room records block creation instead of releasing names. Restore does not automatically recreate memberships, media sessions, or camera consent: visitors rejoin with access checks and fresh scrollback.

## Moderation, limits and retention

Moderators review held/reported/AI evidence, delete messages, mute/kick/ban visitors, disable cameras and close abusive rooms. They cannot appoint staff or change network/filter configuration. Band/owner configuration permissions remain. Public verified-email login never maps the email to staff privileges; staff require the separate staff endpoint and allowlist. Account-based bans/mutes apply across a verified person's devices.

Commands: burst ten, refill one/second, plus aggregate 120/minute per daily IP hash. Reports: burst five, refill five/minute. New PM requests: burst three, refill three/minute. PM delivery and public text share the ordinary message bucket and daily allowance. Band administrators retain the existing trusted exemption. Device/account limits survive reconnects, extra tabs and restart. Rejections use a structured `rate-limit` response with `scope` and `retryAfter`, at most one notice per connection every five seconds. This is abuse mitigation, not proof that distinct devices/IPs represent distinct people.

Active moderator action logs keep at most 2,000 records and 30 days, with scheduled enforcement approximately once per minute. Evidence queues remain capped at 100 entries each for 24 hours. Backup/PITR settings are separate. Durable rate buckets expire after 24 hours idle and are bounded to 5,000; room-creation counters expire after their applicable window. Activity snapshots retain at most 400 strokes and about 250 KB of stroke JSON per room. Old drawing strokes may be discarded at this bound. These limits protect the single lobby Durable Object; staging load validation is still required.

## Deployment configuration and migration

No secrets or cloud settings were changed by this implementation. This does **not** mean the Cloudflare account has no prior setup. Rechecked GitHub on October 18: [StalemateSite PR #25](https://github.com/rupret007/StalemateSite/pull/25), commits `f6ea5fa38224` and `f905d79d66269`, already contains Hang Out TURN/Access/vault preparation and setup regression tests. Its deployment branch is not incorporated into this development branch. [WebJam PR #375](https://github.com/rupret007/webjam/pull/375) merged the TURN credential Worker/client, and [PR #389](https://github.com/rupret007/webjam/pull/389) merged Worker CI coverage.

Use that work as the existing baseline. PR #25 explicitly references the existing `webjam-relay` entry and says not to replace or rotate the shared key. Its source/checklist records preparation and mocked tests, not a receipt for live Access application configuration. Current cloud settings were not queried in this reconciliation; mark them **unverified here**, not absent. The new public owner audience and moderator allowlist are additional requirements to check against existing settings. Reconcile PR #25's auth redirect hardening, TURN route/binding/migration, client contracts and tests before any combined release; do not reintroduce its superseded band-absence shutdown rule.

Before staging, verify/reuse existing resources and add only missing configuration:

1. Keep `/lobby-admin*` under its existing restricted Access application. Set `HANGOUT_MODERATOR_EMAILS` to the owner's explicit comma-separated allowlist and include those people in the staff Access policy. Only deployment configuration can appoint/remove moderators.
2. Verify or add a **different** Access application for `/lobby-owner*`, using email one-time PIN for public room owners. Set `HANGOUT_OWNER_ACCESS_AUD` and `HANGOUT_OWNER_RETURN=https://stalemate.band/r/<hidden-slug>/lobby/`. Reuse the verified Access team/JWKS flow. Do not broaden the staff application's policy. Review Access seat capacity/pricing before accepting public users; this implementation does not assume unlimited free sign-ins. Prefer a first-party relay domain and validate actual browser cookie/Access behavior; update CSP/relay configuration together if the domain changes.
3. Preserve `HANGOUT_HMAC_KEY`: room account identifiers are domain-separated HMACs of normalized verified email. Rotating it needs an explicit ownership migration/recovery procedure, as it also changes guest device-token trust. Do not rotate it as part of this rollout.
4. Stage the Worker and matching pages together. Old clients can continue temporary chat but do not expose registration controls. New storage is `room-index` plus individual `community-room:<name>` records, atomically updated; `abuse` holds rate/creation allowances. The adapter can read the intermediate aggregate `rooms` format and retires it after a successful indexed write. Missing prior room storage means no historical rooms can be recovered. Keep room records if rolling back; older code cannot enforce reservations, so close new room admission during such a rollback.
5. Confirm email delivery, audience isolation, revoked staff access, real Durable Object wake/rejoin, bounded storage and failure handling. Enable AI separately only after its existing staging checks. Publish the real moderation contact and arrange human coverage before opening the site publicly.

Automated browser tests use the real local chat engine with an explicitly authenticated **test-only** owner identity in the loopback relay. JWT/admission/storage tests exercise production modules with fixture keys and storage. They do not send email, configure Access, establish live AI accuracy, or prove WAN/WebJam audio timing.

## Validation

All 300 unit tests (35 files), 25 focused Chromium browser scenarios, Pages packaging and whitespace checks pass. Added coverage includes ownership recovery, spoofed ownership, expired offers, offline co-host removal, reserved capacity, 90-day cleanup, repeated hibernation cleanup, activity restoration without camera activation, account bans across devices, shared PM/public allowances, durable log pagination, corrupt/missing records, storage failure, staff revocation and moderator-only UI capabilities.
