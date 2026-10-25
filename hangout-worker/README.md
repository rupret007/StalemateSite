# Hang Out relay and private environments

The real visitor beta uses **`stalemate-hangout-beta`** and
`wrangler.beta.toml`. Start with [the beta handoff](../docs/HANGOUT_BETA_HANDOFF.md)
and [current assessment](../docs/HANGOUT_BETA_READINESS.md). It has real guest
sessions and no synthetic role selector; real email/staff acceptance remains a
separate requirement. The older pilot below is a demonstration environment.

The beta's optional `GET /beta/health` requires a separate
`HANGOUT_BETA_OPS_KEY` bearer credential. It returns read-only storage status,
configuration flags and aggregate application allowances without admitting a
guest or granting staff access. It performs no provider or billing checks and
does not verify storage writes. Normal Object wake housekeeping can still run.
See the [hosted boundary checks](../pr-assets/beta-collaboration/hosted-ops.json).

The new **`stalemate-hangout-pilot`** Worker is deployed at
[the protected pilot entrance](https://stalemate-hangout-pilot.jeffstory007.workers.dev/pilot/).
The existing **`stalemate-hangout`** Worker and public Stalemate site are untouched.
See [private access and test flows](../docs/HANGOUT_PRIVATE_PILOT.md) and
[deployment reconciliation and production setup](../docs/HANGOUT_DEPLOY.md).

## Private pilot

`wrangler.pilot.toml` selects a separate Worker, assets gateway, secrets and Durable Object
namespaces. Invitation access creates a signed eight-hour HttpOnly/Secure/SameSite=Strict
cookie. The gateway checks it before returning collaboration assets or upgrading relay sockets.
The entrance itself is reachable without an invitation; collaboration content is protected.
Public navigation remains unchanged and pilot responses disable indexing and caching.

Operator access can choose labeled synthetic guest, room-owner, moderator and site-administrator
identities. Guest invitations allow guest participation only. Changing identity or logging out
closes that session's lobby sockets. These roles make ownership and moderation testable without
claiming production email or Access setup is verified. **AI and TURN are off**; media uses
direct connections with STUN and requires explicit capture consent.

Build assets for the existing private pilot with `npm run package:pilot` from the repository
root. Its deployment configuration is `hangout-worker/wrangler.pilot.toml`; the default
`wrangler.toml` targets the existing main Worker and must not be substituted. The deployed
pilot already has its required configuration; testing it does not require another login,
secret upload or deployment.

The loopback alternative is `npm run dev:hangout`. Its printed URL works only on the machine
running it. It also uses explicitly labeled test identities.

## Relay behavior and caps

Private invite rooms forward encrypted data frames for drawing, chat, playback and WebRTC
signaling. The lobby engine handles moderated public text and creative activity state.
Camera/audio media stays between browsers; it is not sent to the AI text classifier.

- Default relay admission: exact allowed origin, preview credential, required bindings, and
  the pilot's additional signed session when using the private deployment.
- Default private room capacity: eight people. Client camera meshes also support up to eight.
- Default connection allowance: 200 per UTC day per deployed quota object, shared by its room
  and lobby admission. Unavailable accounting fails closed.
- Per encrypted socket: 8,000 messages, burst 30, refill eight per second, frames up to 1 MB.
- Public commands, reports and PMs have additional shared limits; see the
  [community configuration and retention design](../docs/HANGOUT_COMMUNITY_IMPROVEMENTS.md).

TURN issuance is disabled in the pilot. The prepared endpoint checks signed devices,
serializes durable room/device/global reservations and consults account-wide usage before
minting short-lived credentials. Its estimate is an admission guard, not a provider spending
cap; existing credentials and WebJam issuance are separate. Clients refresh in memory, update
active peer connections, and keep direct connections available when issuance fails. Production
TURN credentials, analytics permissions and cross-network connectivity remain unverified here.

## Lobby and production authentication

`src/lobby-core.mjs` provides the chat/community engine; `src/lobby-do.mjs` persists moderation,
room ownership and safety state using Durable Object storage and hibernating sockets.
`/lobby`, `/lobby-owner` and `/lobby-admin` provide guest, email-owner and staff admission in the
production entrypoint. Staff JWT signatures and email allowlists are checked server-side,
including login redirects. Public owner login uses a distinct Access audience; moderators
have separate capabilities from band/owner administrators.

For a future public release, verify the existing restricted Access application and exact staff
allowlists, the separate owner email application, approved Turnstile hosts and secrets, and
all reachable Worker hostnames. The account's Access application API returned 403 under the
available OAuth credential: those settings are **unverified, not absent**. The pilot's synthetic
role gateway does not establish production email delivery or authentication readiness.
The [production checklist](../docs/HANGOUT_DEPLOY.md) preserves the existing Cloudflare/WebJam
setup and identifies only additions that need verification.

## Community operation and AI

Guest rooms remain open when band members are away. Manual locks/shield, stored-state
validation and infrastructure caps still apply. Legacy automatic locks need explicit human
review because the stored flag can also indicate lost or corrupt moderation state.

`HANGOUT_AI_MODERATION="off"` is the default; the release owner verifies deployed settings.
Review mode additionally requires an `OPENAI_API_KEY` Worker secret and the explicit
server assertions `HANGOUT_AI_PROVIDER_READINESS="qualified"` and
`HANGOUT_AI_CHILD_DATA_READINESS="qualified"`. These record completed external qualification,
not parental consent or legal certification. Without them, status is `not-qualified` and
no text is submitted. Qualified review adds bounded classification of new eligible public
text. It never grants automatic punishment powers. AI flags, human
reports and held-message evidence use separate bounded 24-hour queues and never become
visitor chat history. See [AI data scope and activation](../docs/HANGOUT_SAFEGUARDS_AI.md).

Room-owner registration and co-host controls are implemented; production public email login
still needs live verification. WebJam owns its musical audio/signaling infrastructure; jam
rooms share host invitations, and `WEBJAM_WEB_ORIGINS` controls the optional browser-join hook.
Public launch still requires the real moderation contact and response process, production
email/Access/Turnstile checks, and any desired TURN activation. The invitation pilot is already
available for private testing.
