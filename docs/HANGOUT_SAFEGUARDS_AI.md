# Open community safeguards and AI review

October 18, 2026. Local development; not deployed. Jeff confirmed that guest-hosted rooms should operate independently of band presence, with safeguards, and selected **AI-assisted moderation before creative AI features**.

## Community operation

Being away for a day no longer raises the shield or makes the community read-only. Existing room hosts retain channel-scoped controls; site administrators retain authenticated site-wide controls. Manual shield/lock, admission checks, signed-device identity, message filters, room limits, PM consent, mute/ban checks, reporting and infrastructure budget limits remain.

The old persisted `lockAuto` flag also indicated corrupt or missing safety state. It is not sufficient evidence that a stored lock came only from band absence. Existing locks therefore require a human review and explicit `/lobby unlock` / `/shieldoff`; the new code does not silently clear manual or corruption locks.

## AI's first job: find messages for human review

When enabled, new public lobby and unrestricted-room text is classified **after publication**. Suspected abuse appears in an admin-only AI review queue with the actual message, channel, author display name, time, model and category labels. These labels are signals for review, not findings of fact. AI does not ban, mute, kick, change permissions, publish chat, or automatically remove messages.

The review UI offers two actions: delete that exact message, or dismiss the AI signal. Other existing moderation controls remain human-operated. Ordinary deterministic filters can still block or hold messages before publication, independently of AI.

Only the single eligible message text is sent to OpenAI. Nickname, device, IP hash, channel name and message ID are not added to the request. Text can itself contain information the author supplied; this is data minimization, not an anonymity guarantee. The preexisting personal-information filter runs first.

Excluded from automatic AI submission: PMs, invite-only/keyed/locked rooms, WebJam invitation commands, encrypted private rooms, cameras/audio, images, old scrollback, and held-message approval replay. The classifier cannot monitor peer-to-peer media or provide complete coverage of harassment that depends on a longer conversation.

The integration uses the fixed `/v1/moderations` endpoint and `omni-moderation-latest`, with strict result validation. There is no chat model prompt, tools, user-supplied endpoint, or model-generated command to execute. The official guide describes category signals and cautions against treating scores as automatic policy decisions. [OpenAI moderation guide](https://developers.openai.com/api/docs/guides/moderation)

## Availability and limits

- Default: `HANGOUT_AI_MODERATION="off"`; the local preview makes no provider calls.
- Review also requires the server-side assertions `HANGOUT_AI_PROVIDER_READINESS="qualified"` and `HANGOUT_AI_CHILD_DATA_READINESS="qualified"`, plus `HANGOUT_AI_MODERATION="review"` and an `OPENAI_API_KEY` Worker secret. Without completed external qualification, requested review is `not-qualified` and makes no provider calls. These assertions neither create parental consent nor certify legal compliance. The key never goes in a page, browser request, committed file or status response.
- Default allowance: 1,000 classifier requests per UTC day for the lobby Durable Object, configurable downward or up to a hard maximum of 10,000. Each reservation is stored before the API call, so hibernation cannot reset the counter. Failed calls still consume a reservation.
- Maximum three concurrent calls; no unbounded text backlog. A busy classifier skips the new check and records that skip.
- Four-second provider deadline, then 30-second failure backoff. No automatic retry of the same message. Invalid responses, provider errors, absent credentials and exhausted budgets are not treated as successful checks.
- The admin UI distinguishes off, not-qualified, ready, unavailable/degraded, misconfigured and capped. Session counters show checked/flagged/failed/skipped work; daily usage survives hibernation. A ready label means the adapter is available, not that every message was examined.
- AI outages leave ordinary chat and existing safeguards running. Reports remain available. This is review assistance, not a pre-publication AI gate.
- Evidence/storage write failures are tracked and shown in the review panel; in-memory evidence is not presented as reliably saved when persistence fails. A failed AI quota reservation prevents the provider call.

The Moderation API is currently documented as free, but Worker and storage consumption still need operational monitoring. The endpoint-specific data-controls table lists `/v1/moderations` with no training, abuse-monitoring retention or application-state retention; verify that table again before activation. Do not apply another endpoint's retention policy or claim the website retains no moderation evidence. [OpenAI moderation guide](https://developers.openai.com/api/docs/guides/moderation), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

## Evidence without a public chat archive

Visitor scrollback remains session-only and starts at join. A separate server moderation buffer supports reports. Flagged AI messages, user reports and held messages have separate bounded admin queues: at most 100 entries of each type, expiring after 24 hours. They survive a Durable Object restart so an absent moderator can review them later. Expired evidence is removed on the periodic alarm or when the queue is restored/updated; it is not added to a visitor's chat history.

Restored held messages cannot be published into a newly created room with the same name. Their original room no longer exists in memory, so the moderator can dismiss/delete the evidence. Human actions remain in the separate moderation log.

The 24-hour bound describes the active moderation queues, not physical erasure from infrastructure backups or point-in-time recovery. Confirm the Cloudflare recovery configuration and the separate action-log retention policy before public launch.

Report authorization is tied to actual message delivery, and report-triggered camera restrictions use the original author's immutable device identity. A reused nickname must not transfer responsibility for an older message. Deleting one message must not resolve unrelated reports.

Both retained AI and visitor-report queues expose message-ID delete/dismiss actions. Mute/kick/ban controls remain with the current live-user list; an old evidence nickname is not an account identifier. A future moderator workflow can bind such actions explicitly to the original author without exposing device identifiers.

## Configuration and validation

Configuration is prepared but has not been activated or deployed:

1. Resolve provider data controls and the applicable age/consent/legal processing model through the existing owners. Keep review off until qualified; see [privacy and incidents](HANGOUT_PRIVACY_AND_INCIDENTS.md). Record readiness with the two server assertions above only after that work is complete.
2. Configure a dedicated `OPENAI_API_KEY` Worker secret through normal secret management, set `HANGOUT_AI_MODERATION="review"` and choose `HANGOUT_AI_DAILY_LIMIT`. Do not enable this service or access paused credentials from the application session.
3. Deploy through the site's existing release process, with the guest disclosure and moderator UI in the same release.
4. Verify a small set of synthetic messages in an isolated staging community. Confirm disabled/degraded/capped states and the human dismiss/delete flow before enabling it for visitors.

Automated tests mock the provider and prove transport, permissions, routing, persistence, limits and failure behavior. They do not establish live model accuracy. Evaluate real classification separately with consented/synthetic cases, including ordinary profanity, quoted lyrics, reclaimed language, jokes, obfuscated harassment and false reports. Record false positives and misses before considering automatic AI interventions.

## Community follow-up

The moderator-role, rate-limit, action-log-pruning and room-continuity work is now implemented locally. See [Community improvements](HANGOUT_COMMUNITY_IMPROVEMENTS.md) for exact permissions, persistent email-backed rooms, limits, migration and staging requirements. Guest room creation remains immediate; permanent registration is optional.

Remaining public-launch work includes a real human response/appeal contact, reconciliation of existing Access/email setup with the new owner-login requirements, staging load/restart validation, and backup retention review. Creative AI remains later work: an explicitly invoked idea helper, collaborative writing prompts or help developing a shared artifact. It should never fabricate community members or quietly turn ephemeral conversations into public summaries.
