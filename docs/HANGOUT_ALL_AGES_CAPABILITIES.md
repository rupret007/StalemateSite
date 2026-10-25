# All-ages participation and narrow incident preservation: implementation design

Design date: October 25, 2026. **Designed, not implemented or legally qualified.** This document specifies application work; it does not enable children's data collection, appoint a legal operator, select a verification vendor or approve a public launch. The operator/entity, country and intended markets are still unanswered questions. Do not infer them from a Gmail address, band name, Cloudflare account or website domain.

Keep one community, shared account/room identifiers and shared moderation across Stalemate, Rad Dad and future entrances. Participation permissions can differ by an individual's qualified consent/safety state without creating brand silos or separate communities. All-ages access remains the objective; retaining today's protections while building the replacement is not a permanent adults-only or 13+-only product decision.

## What exists, and what does not

| Existing application behavior | Missing capability |
| --- | --- |
| Guest nickname admission currently checks `age13`; open-camera activation checks `adult18`. | Neither checkbox obtains verifiable parental consent, establishes legal applicability or supplies trusted age/capability state. |
| Host-only verified sessions, optional email-derived room ownership and distinct host/moderator/administrator powers. | Guardian identity, verified guardian-child linkage, consent/rights requests and child-permission revocation. Do not repurpose room ownership or a staff login as proof of guardianship. |
| `ai-eligibility.mjs` requires explicit server provider/child-data qualification; unqualified review stays off. | Those configuration assertions are not per-person consent, provider-account inspection or permission to process unknown children's data. |
| Delivered-message reports, consented private allegations, bounded evidence queues and human review; accepted public reports are preserved when intake is full. | An independent restricted incident case/hold store, qualified statutory-notice workflows and case deadlines. |
| Chat starts at join; no visitor archive; separate bounded evidence, pseudonymous identifiers and action logs. | A complete parental access/deletion implementation, reconciled backups/provider/inbox retention and a lawful-preservation exception. |

See [the existing inventory](HANGOUT_DATA_INVENTORY.md) and [incident handling](HANGOUT_PRIVACY_AND_INCIDENTS.md). Existing lobby PMs still pass deterministic filters and a bounded server moderation buffer; encrypted private-room chat is different. Do not describe all private text as unprocessed or all chat as end-to-end encrypted.

## Current primary-source constraints

These are inputs for qualified applicability review, not a conclusion that every duty applies to this service. Sources were opened on the design date; revisit them when qualifying a release. The implementation choices below are engineering proposals, not quotations of mandatory statutory architecture.

| Source | Consequence to assess |
| --- | --- |
| [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) | Audience classification and actual knowledge matter. A guest nickname or age checkbox does not make collection harmless. Evaluate identifiers and public disclosure before designing the child entry flow; do not assume an age screen can exempt every audience. |
| [16 CFR 312.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5), [312.6](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.6) and [312.10](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.10) | Covered collection/use/disclosure needs the appropriate consent, including separate disclosure choices where required; material changes matter. Parent review/refusal/deletion requires establishing authority. Retention needs a defined purpose and deletion timeframe. Choose an adequate verification process; this design does not default to ID or facial recognition. |
| [18 USC 2258A](https://uscode.house.gov/us/usc/119-118/t18/s2258A/) | Covered-provider reporting and preservation depend on specified circumstances. The statute does not require general monitoring. A completed CyberTipline report triggers one-year preservation of reported material and relevant reasonably accessible context, with restricted secure access. Other process may affect retention. An AI flag or ordinary 24-hour queue is not a completed report or a preservation policy. |
| [FTC TAKE IT DOWN guidance](https://www.ftc.gov/business-guidance/resources/complying-take-it-down-act) | Covered services need accessible intimate-image requests and applicable removal/copy handling; a valid request has a 48-hour deadline. Establish coverage, validation and actual control over content rather than promising erasure of peer devices. Do not require another imagery upload or a community account merely to report. |
| [Copyright Office Section 512 guidance](https://www.copyright.gov/512/) | Safe-harbor conditions and notice/counter-notice/repeat-infringer handling need assessment. A generic contact paragraph is not proof of qualification or a complete formal-notice workflow. |
| [Ofcom children's access assessment](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/childrens-access-assessment-duties-under-the-online-safety-act), [European Commission DSA overview](https://digital-strategy.ec.europa.eu/en/policies/digital-services-act) | Determine territorial/service scope and proportionate child-safety, notice/action and redress duties; do not apply every large-platform requirement indiscriminately or assume US-only duties cover worldwide availability. |
| [Official OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance), [endpoint data controls](https://developers.openai.com/api/docs/guides/your-data#storage-requirements-and-retention-controls-per-endpoint) | The guidance calls for Zero Data Retention before processing under-13/below-digital-consent-age personal data. The endpoint table currently lists no training/abuse-monitoring/application-state retention for `/v1/moderations` and marks it ZDR eligible. Eligibility does not prove this project's account configuration or lawful processing. Keep both existing readiness assertions unqualified until independently established. |

## Decisions needed before any public child entry or real guardian contact

The operator/legal owner must supply a versioned decision record covering: legal operator/contact and markets; intended/actual audience and applicable age/assurance model; service purposes and processors; permitted public text/artifact disclosure, direct contact and media; parental verification/rights process; notice content; processing/retention grounds and deadlines; incident authority and staffing. Record unresolved items as unresolved. No purchases, paid identity service, legal engagement or account signup are authorized here.

Include pre-consent infrastructure in the assessment: CDN/IP handling, Turnstile, existing signed device tokens, local storage, analytics, external media and cached pages can act before someone posts. Do not add a parental form after these operations and call the earlier collection solved. No default full birth date, government ID, biometrics or precise location collection is proposed. A minimal age/permission signal is useful only if the qualified assessment finds it sufficient; a self-declared band is not verifiable guardianship.

Public disclosure, direct contact, camera/audio and external-provider processing are separate purposes. Do not bundle optional AI or media into a mandatory chat checkbox. Confirm which disclosures are integral to a particular feature rather than claiming public chat can operate without disclosure. Provide clear alternatives and honest restricted/pending states without encouraging visitors to falsify their ages.

## Participation authority and data model

Add a dedicated server-owned participation registry. It does not replace the current room-owner account mapping/HMAC key or issue staff powers. Start with storage-injected local primitives and synthetic decisions; deployment binding and any real verification integration need their existing owners. Identity-provider choice is still open: current static band websites do not demonstrate consumer accounts, and the private Access setup is not automatically an approved public guardian-account system.

Suggested strict version-1 records:

| Record | Minimum fields and boundaries |
| --- | --- |
| Participation subject | Random `subjectRef`; opaque binding to an authenticated community principal; `policyVersion`; state; monotonic `revision`; consent-receipt references; purpose permissions; effective/expiry/review times. No public age or guardian identifier. Guest/child enrollment and device recovery must bind to this subject through the approved process; clearing a device token cannot manufacture consent. |
| Guardian authority | Random `guardianRef`; authenticated account reference; restricted verification-provider/method-class and decision reference; authority status/revision. Contact details, if needed, stay in a separate restricted contact store. No raw ID, selfie, payment details or verification transcript copied into community state. A hashed email is still an identifier, not anonymization. |
| Consent receipt | Random `consentRef`; subject/guardian references; notice/policy version and digest; specific approved purposes/disclosures/processors; verification decision reference; issued/effective time; withdrawal/change state; review/retention/deletion fields. No chat, room history, message bodies or browsing-source trail. |
| Pending request | One-use random transaction reference, allowed verification route, purpose, explicit expiry and replay/idempotency state. Store only approved contact information necessary for this step. Pending contact is deleted under its qualified deadline; no reminder marketing, account matching or indefinite abandoned-ticket store. |
| Permission lease/session binding | Subject/revision, audience/community, allowed action classes and bounded expiry; issued by trusted service only. Server lookup or revocable lease validation is still required. A browser-supplied receipt, age, role, source badge or boolean cannot issue or widen it. |

Require bounded record/field/byte counts and explicit finite pending/deletion deadlines. Do not invent one universal legal consent duration: approved policy supplies it; missing/invalid policy refuses activation. In tests use short synthetic deadlines. The retention purpose for an active permission and the justified tail for proof of consent are distinct; retain neither forever merely because a subject once participated.

Suggested state machine: `unknown` → `pending` → `authorized`, with independent transitions to `declined`, `withdrawn`, `expired` or `policy-review-required`. Only an approved verification adapter plus explicit purpose consent can authorize; a staff convenience button is not a substitute. Material policy/processor/purpose changes invalidate affected grants until the required review/consent completes. Permission loss does not delete identity or room ownership accidentally; service eligibility and property ownership are separate records.

| Transition | Required authority / result |
| --- | --- |
| `unknown` → `pending` | Qualified entry policy permits this minimal request; no publishing/provider permission is granted. |
| `pending` → `authorized` | Current approved verifier decision, authenticated guardian relationship and explicit purposes match this subject/notice version; commit receipt and revision together. |
| `pending` → `declined` / `expired` | Verified refusal or recorded deadline; invalidate pending tokens and delete unnecessary contact data. |
| `authorized` → `withdrawn` | Current authorized guardian/rights process; increment revision, revoke affected sessions/work and start purpose-specific deletion. |
| `authorized` → `expired` / `policy-review-required` | Grant deadline or material qualified-policy change; affected permissions stop without trusting a client refresh. |
| Terminal/review state → `pending` | New approved verification/consent transaction; neither replayed callbacks nor an operator readiness flag restore authorization. |

## Capability enforcement

Implement one pure policy evaluator taking **trusted** session/registry state, the qualified operator policy, current role/room authority and service safeguards. Unknown/corrupt/stale/withdrawn consent cannot grant a newly gated child capability. Preserve the existing private-beta behavior behind its existing protections during development; do not silently expose an all-ages production path through a migration fallback.

| Proposed capability | Checks before action |
| --- | --- |
| `publicText` / `publicArtifact` | The particular collection/disclosure purpose is permitted; room membership, host restrictions, filters and quotas also apply. A drawing, room title/topic or saved artifact can contain personal information. |
| `createRoom` / `registerRoom` | Participation permission plus existing creation/ownership authorization. A host cannot widen a member's participation permissions; a registered room is not exempt. |
| `requestDirectContact` / `acceptDirectContact` | Both participants' permitted contact rules plus the existing recipient consent/block flow. Do not implement a directory that reveals children's age/guardian/eligibility to prospective contacts. Determine actual contact restrictions from qualified safety decisions, not an invented universal adults-only policy. |
| `sendCamera` / `sendAudio` / permitted media reception | Appropriate purpose/contact policy and explicit device opt-in. Check before acquisition/signaling/join, not just before drawing a button. Independent P2P/native sessions cannot honestly be described as remotely erased or universally terminated by a lobby switch. |
| `externalProvider` / `aiPublicReview` | Purpose permission, relevant provider policy and existing service-wide qualification, text/public-room exclusions, quota and availability. Unknown audience remains a deployment-level AI blocker where per-subject qualification is not implemented. |
| Report, block, appeal and rights requests | Preserve accessible safety/help routes without granting chat/media or access to incident evidence. A muted/banned participant or person without an account may still need a valid notice/appeal route. Do not make consent to optional AI a prerequisite for reporting. |

Expose only needed action booleans and plain-language status to the client; never send the guardian link, exact age, consent evidence or verification method to public People/chat/directory frames. Missing UI controls are not authorization. Staff privileges remain independently appointed; adding a website, changing an entry badge, acquiring room `@` or registering ownership grants no participation/incident override.

### Guardian withdrawal and concurrent work

1. Authenticate the guardian and confirm the current relationship before reading/changing a subject. A guessed reference or matching email/nickname is insufficient. A compromised/unverified claimant must not learn whether a named child participates.
2. Atomically change consent state and increment the subject revision. Persist before acknowledging. Idempotent repeat withdrawal returns the established result without creating a new grant or extending a deadline.
3. Revoke affected active-session grants across the shared service, including private-room signaling and provider queues. New actions must check current authority; initial implementation can use a fresh authoritative check for each newly gated mutation. Optimize with bounded revocable leases only after their revocation window, failure behavior and cost are explicitly qualified; never keep an indefinite cached approval.
4. Recheck after asynchronous admission/quota/storage work and immediately before newly controlled publication/provider dispatch. Work pending withdrawal must not escape through an old callback; queued AI jobs are dropped. A request already transmitted cannot be recalled, and already delivered peer content cannot be made unseen. Define and test the exact ordering rather than promising impossible retroactive deletion.
5. Close/disable affected connections and clear stale UI state. Keep a bounded retry record if fan-out fails and report partial/unconfirmed completion honestly. A reconnect or a different entry site cannot restore the previous revision. Replayed approval callbacks and restored backups must not resurrect it.
6. Handle access/deletion requests through the separately verified rights workflow. Remove unnecessary ordinary data; a specifically authorized legal hold is handled separately. Do not expose another person's conversation simply because someone claims parenthood, or promise deletion of material lawfully preserved elsewhere.

## Incident preservation without an archive

The initial incident implementation should preserve **selected existing report evidence**, not begin recording every conversation, download suspected illegal media or scan private messages. Ordinary report expiry/dismissal and public join-time history remain independent. Use only benign synthetic text/files in tests.

### Case authority and schema

Create an independent `incidentReviewer` authority with explicit appointments and per-case access. Ordinary room hosts, general moderators, band-site integrations and guardian accounts do not automatically receive it. The current staff endpoint alone must not broadcast cases in `adminState`, room snapshots or health responses. Initial appointments and secure storage/key provisioning require the operator/release owner; no new broad privilege is inferred here.

Suggested strict records:

| Record | Required fields / controls |
| --- | --- |
| Case metadata | Random `caseRef`; type (`safety`, `rights`, `copyright`, `intimate-image`, `legal-process`); status/revision; opened/received timestamps; designated handler; qualified procedure version; restricted source references; explicit access set. A report category is a claim, not a legal finding. |
| Selected evidence | Immutable source message/report ID, source revision/digest, exact selected bytes, provenance/verification label and collection time; server-created evidence ID and integrity digest. Private allegations remain unverified. Do not silently add entry-site history, IPs, decryption keys, invitations, unrelated transcripts or new personal identifiers. |
| Preservation authority | Authorized actor/role; authority/procedure reference; purpose; scope; start; concrete preservation/review/deletion deadlines; any received legal-process/reference and approved extension history. No free-form “hold forever,” client-set expiry or AI-created hold. Qualified handlers decide any required additional context. |
| Request/response tracking | Restricted notice-validation state, received/validated times, applicable deadline and response/disposition reference. Inform the requester using a safe acknowledgement/status reference; knowing it never grants evidence access. No automatic external email, reporting or data export is implemented by this design. |
| Audit event | Time, case/operation ID, authenticated actor reference, action, reason/authority code, expected/resulting revision and outcome. Exclude evidence bodies, keys, contact details and ordinary chat. Bound retention by its defined purpose; “audit log” is not an indefinite-retention exception. |

Separate metadata and encrypted evidence access. Use existing approved secret/key management with purpose separation; do not reuse the account/HMAC signing key for case encryption or put key values in manifests. Do not create a new paid storage/KMS service here. Opaque case references and hashes are still sensitive. Use explicit authorized access, safe rendering, no automatic previews, no arbitrary remote fetch or attachments, and no browser persistent storage of case content.

### Atomic copy, disposition and expiry

An authorized `preserveSelectedReport` command takes a source ID plus expected revision/digest, case purpose and approved authority/deadlines—not a client-supplied replacement transcript. Validate the current session/incident appointment and selected source. Copy it into the restricted store and commit the case/audit/idempotency state before acknowledging; an ordinary report can then expire independently. Where the source and case share a DO storage domain, use a storage transaction plus serialized application updates. A later separate case service needs an explicit durable handoff protocol; do not pretend two independent writes are atomic.

Keep the source evidence if preservation fails or is ambiguous until the documented retry/handoff is resolved; never confirm preservation because a button was clicked. Concurrent dismiss/purge/expiry must either precede the selection (truthful not-found) or follow a completed preserved copy. A restart must not resurrect a dismissed report into visitor chat. Do not accept an arbitrarily supplied quote as independently verified merely to recover unavailable evidence.

Ordinary queue capacity cannot evict an active case. Every store still needs explicit byte/count/throughput budgets and incident-owner escalation when full; never silently truncate legally needed material to fit or claim preservation succeeded. Choosing production limits and the approved overflow procedure is an operator dependency. Safe code tests can use two cases and small synthetic byte caps without setting production policy.

Case closure does not by itself end an active legal hold. A separate authorized transition releases/extends it with a reason and revision check. A release schedules deletion for the applicable purpose deadline; deletion removes evidence, access references and unnecessary metadata with a bounded content-free completion receipt. Required review reminders, failed cleanup and ambiguous writes are visible to the authorized handler. Missing/malformed retention policy fails closed to modifications and alerts the incident owner; it must not silently drop evidence or create a permanent implicit hold.

Model three independent state fields: review `open` → `triaged` → `closed`; preservation `none` → `active` → `released`; evidence `present` → `deletion-due` → `deleted`. Closing review does not release a hold. Only a separately authorized, recorded decision changes preservation. Deletion requires no remaining authorized hold and a satisfied purpose deadline, commits before acknowledgement and cannot be undone by replaying the original copy request. An extension records new authority/deadlines and revision rather than overwriting the original event.

Backups/recovery need qualified retention and deletion handling. Restore must apply committed withdrawals, hold changes and deletion tombstones before reopening access, without recreating ordinary chat. Do not promise active-store deletion erases backups immediately. Release/store recovery and authorized external reporting/export are existing-owner work with purpose-specific evidence, not a new public API or an unattended AI action.

## Safe next application slices and acceptance tests

These proposed filenames/contracts are **not existing implementations**. Keep new public routes, child enrollment, real contacts, providers and case permissions inactive until their prerequisite decisions are supplied.

| Slice | Safe implementation now | Required meaningful acceptance |
| --- | --- | --- |
| C1: `participation-policy.mjs` | Pure evaluator with trusted, versioned input types; no network/storage/UI collection. Synthetic policy only; no fallback granting child capabilities. | Unknown, forged client booleans, badge/role changes, corrupt/stale revisions and withdrawn records never grant gated actions; room authorization and global safeguards intersect permissions. |
| C2: `participation-consents.mjs` | Storage-injected ledger with strict schemas, bounded pending receipts, explicit purposes, revision checks and idempotent state transitions; synthetic verifier adapter. No live verification/contact endpoint. | No success before durable commit; duplicate/replayed/out-of-order callbacks cannot approve; policy changes remove affected grants; pending contact expires; receipt/state mutation is isolated from input aliases and excludes raw proof/chat. |
| C3: session/provider integration | Inject the synthetic registry into local adapters; derive server permissions without changing existing public admission. Add revision-aware revocation and asynchronous-dispatch barriers in a reviewable slice. | Guardian withdrawal blocks later publish/contact/media/provider operations, including in-flight admission/quota callbacks; unconfirmed fan-out stays visible; new entry/device/reconnect/wake cannot restore a withdrawn grant; provider spy sees zero calls for unqualified data. |
| I1: `incident-cases.mjs` | Bounded storage-injected selected-evidence model, role/case ACL, authority/deadline validation, idempotent copy/disposition and audit primitives. Synthetic evidence only; no public intake/export. | Unauthorized roles cannot enumerate/read/preserve/change cases; exact source/digest binding; no acknowledgement before commit; racing expiry/dismiss/copy is deterministic; quota failures preserve existing cases; no evidence in public/staff-general state or ordinary logs. |
| I2: incident review interface | Local test fixture for separately appointed handlers with explicit selection, reason, deadline and status. No default promotion of current moderators and no actual external notifications. | Actual local report → restricted case → report expiry still preserves only selected evidence; unauthorized/stale/revoked handler denied; expiry/release/deletion survive restart; no old case content remains in displayed UI after disconnect. |
| I3: rights/recovery checks | Synthetic guardian-access/deletion and restored-state fixtures, plus an explicit receiving-owner interface for release/backup obligations. | Claimant cannot discover another subject; minimal approved disclosure only; ordinary deletion and narrow hold remain distinct; restored withdrawals/tombstones cannot revive access/evidence; every test receipt states source and environment. |

External-input-dependent work is deliberately identified, not abandoned: select/qualify an adequate guardian/age process and public identity route; approve notices/purpose choices and pre-consent infrastructure behavior; establish child-adult contact/media rules and response coverage; verify provider/project controls; appoint restricted incident handlers; set lawful authority/deadlines and overflow/backup procedures; qualify the actual hosted release. Return these decisions with evidence through the existing owner, without purchases or changes to StoryPool core/Karen/deployments/shared operations here.

Completion of these design/primitives slices would still not establish public all-ages readiness. Acceptance of that product requirement additionally needs the real qualified consent/rights process, enforced capabilities/revocation, incident handling, accessibility and actual hosted journeys across the same shared community. Preserve current release holds, platform trust and paused TURN/vault work throughout.
