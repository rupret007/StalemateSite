# Privacy and incident handling for the shared community

This is an application design and operator handoff, not a finding of legal compliance or public-release approval. Stalemate, Rad Dad and future entry sites lead to one community, with the same safety rules and staff permissions. All-ages access is the product goal. The current 13+ chat admission and 18+ open-camera guards remain until an appropriate replacement is implemented and qualified; removing those guards does not implement parental consent.

## Collect less, describe it accurately

Keep chat starting at join with connected-session scrollback. Do not add a public backlog, private-message scanning, media recording, identity-document upload, biometrics or advertising profiles as a moderation shortcut. Keyed account/device/IP references are pseudonymous identifiers, not proof of anonymity. Children can disclose personal information in text, drawings, room titles or voice even when a form never asks for a real name.

The optional, disclosed "via Stalemate"/"via Rad Dad" session badge is an exception to hiding entry context: a visitor can hide it, and direct entry stays neutral. It must not disclose age, email, private-room membership or browsing history. It establishes no identity, ownership or staff authority. One entry source never grants a separate ban evasion allowance.

See [the data inventory](HANGOUT_DATA_INVENTORY.md) for actual storage, recipients, expiry and unresolved backup questions. A short active-queue lifetime is not immediate physical erasure from infrastructure backups, nor a lawful-preservation mechanism.

## AI has a separate readiness gate

`hangout-worker/src/ai-eligibility.mjs` derives a content-free decision from trusted Worker configuration only. Both the moderator's `enabled` option and the engine's public-text callback must use its `allowed` decision. Neither browser requests nor WebSocket frames may supply this configuration. Existing engine restrictions still exclude PMs, invitations, restricted rooms, encrypted private rooms, media and approval replay.

| Configuration | Meaning |
| --- | --- |
| `HANGOUT_AI_MODERATION="review"` | Requests optional human-review assistance. Every other value leaves it off. |
| `HANGOUT_AI_PROVIDER_READINESS="qualified"` | Operator has verified the intended provider, endpoint, project, terms and required data controls. |
| `HANGOUT_AI_CHILD_DATA_READINESS="qualified"` | Operator has a documented, qualified basis for the child-data processing possible in this deployment, including applicable consent, disclosures, rights and provider conditions. |
| `OPENAI_API_KEY` | Existing server secret must be configured; a key is not a readiness decision. Never expose its value in status, a page or a commit. |

The two readiness values are operator assertions to record an external qualification decision. The module cannot establish legal applicability, inspect a provider account, obtain consent or certify that a child-data program works. It does not make an API request. Leave them absent while those prerequisites are unresolved; do not set them just to make a health panel green. They apply to the whole possible audience rather than trusting a visitor's self-declared age to route data.

Eligibility states are `off`, `not-qualified` and `provider-ready`. The last means the explicit configuration prerequisites are present, not that provider behavior, model quality or every visitor's consent has been proved. Runtime status still distinguishes missing configuration, degradation, quota caps and evidence-storage failures. A blocked classifier does not block ordinary reporting or authorize additional surveillance.

In the opt-in `lobby-v1` session-authority mode, the gate also returns `session-start-fence-not-qualified`. Setting the two readiness values and a key cannot enable AI in that mode while its provider-start boundary remains unqualified; see [the session-authority guide](HANGOUT_SESSION_AUTHORITY.md).

Provider child-data requirements and endpoint retention must be rechecked before activation. The [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance) and [endpoint-specific data controls](https://developers.openai.com/api/docs/guides/your-data) are separate from our own evidence retention. Do not infer project qualification from an endpoint being eligible for Zero Data Retention.

## Everyday review

1. Let a recipient report a delivered message. Retain only necessary evidence and limited context; confirm success only after its required write. Private-room quotes are consented allegations, not verified transcripts.
2. Human moderators assess context and use exact-message actions. A nickname may have been reused; it is not authority to punish the current holder for an old report. Host powers stay room-scoped; staff review does not transfer room ownership.
3. Explain consequential human actions and provide an appeal route. Do not place private evidence in public GitHub issues, screenshots, analytics or another site's chat. Contact/inbox records need their own retention and access policy.
4. When intake is unavailable or full, show an honest error and the configured contact. Do not promise continuous coverage. Existing queue limits must not silently become indefinite archives.

## Incident triage and operator decisions

The in-app queue is not an emergency service. A person in immediate danger should contact local emergency services. Staff should not ask a reporter to download, forward or email suspected illegal imagery. Work with a brief non-graphic description, approximate time and safe location/message identifiers; do not request room keys, invitation capabilities, passwords or login codes.

| Situation | Application / human handling | Qualification required before public launch |
| --- | --- | --- |
| Harassment, threats, spam or doxxing | Report/block, narrowly scoped host/staff actions, reason and appeal. Escalate credible immediate danger through the operator's agreed procedure. | Actual review coverage, backup contact and authority boundaries. |
| Suspected child exploitation or grooming | Restrict disclosure, do not solicit media copies, contact the designated incident owner promptly. Avoid prejudging a person from an AI category. | Qualified determination of reporting obligations, authorized reporting route, safe evidence handling and coverage. |
| Intimate imagery shared without consent | Provide an accessible removal-request route without requiring an account or another upload; track receipt and restricted handling. | Determine applicability, valid-request handling, removal/copy obligations and deadlines. Do not promise removal from independent peers' devices. |
| Copyright | Provide an identifiable rights/removal contact and separate appeal/counter-notice handling. Review uploaded artifacts, watch sources and music rights by feature. | Operator identity, applicable procedure, designated-agent decision and repeat-infringer policy where relevant. No paid registration is authorized here. |
| Privacy or parental request | Route to an authorized person; disclose the minimum needed to establish authority. Do not automatically reveal a child's room membership or conversation to someone claiming to be a parent. | Verified parental-consent/rights process, deletion limits and response responsibilities. |

The beta application supplies report review and a contact fallback. Source also includes [restricted incident-case primitives](HANGOUT_INCIDENT_CASE_PRIMITIVES.md) and a [loopback review interface](HANGOUT_INCIDENT_REVIEW.md), exercised with selected synthetic reports and explicit fixture authority. Those implementations are not a production incident service: real handler appointments, purpose keys, policy/deadline decisions, storage integration, statutory-notice validation and external reporting still need qualification. The handling above describes responsibilities to establish, not a completed legal workflow. Legal duties depend on operator, jurisdiction, audience and features. Use the [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [18 USC 2258A](https://uscode.house.gov/us/usc/119-118/t18/s2258A/), [FTC TAKE IT DOWN guidance](https://www.ftc.gov/business-guidance/resources/complying-take-it-down-act), [Copyright Office guidance](https://www.copyright.gov/512/) and relevant jurisdiction guidance with qualified review.

## Narrow preservation, without changing ephemeral chat

Before relying on a lawful hold, qualify and integrate a distinct production incident store using the implemented model's boundaries. The model does not supply real appointments, keys or legal authority. Copy only specifically selected necessary evidence into an access-controlled case; record who authorized preservation, why, its authority and review/deletion deadline. Record access and disposition without duplicating evidence into general logs. Hold creation must be an explicit authorized operation, not an AI verdict or an unbounded free-text retention extension available to every host.

An ordinary report expires or is dismissed according to its published policy. A separately required hold must not disappear because that active report was resolved or its queue hit capacity. Conversely, a hold must not turn into an archive of unrelated messages, retroactively replay chat to newcomers or claim control over P2P media. Restarts, failed/ambiguous writes, expiry, access revocation, deletion and backup restoration need explicit evidence at the relevant integration boundary. Until production handling is qualified, the operator must resolve preservation requirements before relying on the service for covered incidents; do not claim a 24-hour queue is adequate for them.

## All-ages consent and capability implementation design

1. Carry forward [the confirmed personal Texas operating arrangement](HANGOUT_ALL_AGES_CAPABILITIES.md), including that no existing organization is being used. With qualified review, assign responsibility for notices, parental-rights requests, incident handling and retention, and resolve legal status, intended markets, actual audience and feature-specific data flows. Do not treat a terms checkbox or this factual record as that assessment.
2. Define a minimal server-owned permission state: policy version, consent/eligibility status, permitted capabilities and expiry/revocation. Store a reference to the authorized process rather than a public birth date, identification document or publicly visible age badge. Unknown status is not parental consent.
3. Establish the real parental-consent and rights process where needed, including public disclosure, processors and safe verification. No process or vendor purchase is selected here. Keep parental identity and child linkage restricted and purpose-limited.
4. Derive capabilities on the server for posting/discovery, direct contact, cameras/microphones, external providers and optional AI. Define age-appropriate permissions from qualified requirements rather than inventing a universal adult-only rule. Hosts, sites and clients cannot widen them.
5. Bind permission changes to active sessions. Revocation/expiry must stop affected actions, provider submission and live media signaling; reload/reconnect cannot restore stale rights. Existing peer media limits need honest documentation.
6. Prove spoofed client claims fail, role and entry badges grant no eligibility, revoked permissions reach live sockets, deletion respects narrowly authorized holds, and no provider call occurs for unknown/unqualified data. Use benign synthetic fixtures and isolated staging.

This design is unfinished application work and a concrete legal/operator dependency. It does not enable public under-13 participation. Existing private-beta release gates, provider-off defaults, paused TURN/vault work and the StoryPool deployment boundary remain unchanged.
