# Hang Out product direction

Updated October 18, 2026. This records confirmed direction, the current development slice, and proposals for subsequent work. It does not authorize public deployment. The user's open-community decision supersedes the old band-absence shutdown rule.

## Confirmed direction

- Welcome anyone visiting Stalemate, with guest access from day one.
- Make the experience visibly retro IRC: nicknames, channels, topics, commands, conversation, and recognizable regulars.
- Anyone visiting can create and host their own text or creative room; room hosts have channel-scoped controls, while authenticated band/site moderators retain site-wide authority.
- Chat starts when someone joins. Keep scrollback for messages received while connected, with no pre-join backlog or replay of missed messages. Jeff's reference is classic EFnet.
- Guest-hosted community activity continues when band members are away. Keep safeguards independent of band presence.
- Build AI-assisted moderation first: flag possible abuse and help humans review it, before creative AI features.
- Start in `#stalemate`; let conversation lead naturally into drawing, watching, music, and other collaboration.
- Make participation useful to non-musicians and comfortable for people who prefer to read quietly.
- Keep guest entry simple. Cameras and microphones remain optional and off initially; retain the recorded age/admission rules.
- Continue development in the hidden preview until publication is separately handled.

**Retention hypothesis:** come to chat → make something together → save an artifact with permission → return for the people or project. This is a hypothesis to test, not evidence that more features automatically produce a community.

## Implemented development slice

These changes are in the current local development branch; they are not a claim about the live website:

- The IRC lobby leads with the main conversation and live room directory, ahead of room-creation tiles.
- Presence uses real connected participants; quiet, disconnected, reconnecting, and read-only states have distinct explanations.
- Conversation starters insert a draft, never send it automatically, and preserve an existing draft.
- Guest copy explains that a remembered nickname is not reserved identity.
- Channel tabs expose unread counts and `@mention` cues, support keyboard navigation, and preserve per-channel drafts in the current tab.
- Reading older messages does not force a jump to the latest; a new-message control provides that action.
- Connection status and retry behavior preserve drafts; a server session reset explains that rooms need to be rejoined.
- The Worker WebSocket handshake queues initial frames until socket acceptance so the browser receives the greeting needed to proceed.
- Local browser coverage exercises discovery, conversation starters, mentions/unreads, drafts, and reconnect behavior. Consult the current test run for results; this document is not a production acceptance record.
- Community operation no longer depends on band attendance. Optional AI public-text review has a human queue, server-only credentials, durable usage limits and visible failure states. Reports require actual delivery; immutable author identity prevents nickname-reuse mistakes; bounded review evidence survives server restart.

Existing creative-room, PM-consent, and moderation capabilities remain the foundation. Join frames no longer include chat history. The client keeps up to 300 received lines per joined channel in memory, clearing them on part/rejoin, reconnection or refresh. The server's bounded `moderationContext` supports abuse reports, remains separate from user-visible scrollback, and is never included in join payloads or persistence snapshots. Dismissing a report no longer rebroadcasts old text. Local drafts and nickname memory are not cross-device accounts or archives.

Guests can now create genuine named text rooms through `/join #name` and Start a chat channel, receiving `@` controls for their room. Text rooms open no media. A host-status line shows current hosts or explains when none are online; `/op nick` shares control. Phone creation failures keep the name and show the server's explanation in the dialog. Browser coverage verifies host handoff, same-device return, and no backlog on lobby entry, room entry, rejoin and refresh.

## Ranked roadmap

### 1. Make quiet visits and hosted visits worthwhile

- Keep one obvious main conversation; display active rooms honestly instead of fragmenting a small audience across empty destinations.
- Show the next **confirmed** gathering hosted by any willing visitor, its host, local time, and what someone can do without equipment. No invented schedule or band-presence prerequisite.
- When quiet, offer a small creative prompt and an approved past creation. When disconnected, explain the service state rather than displaying false emptiness.
- The old 24-hour band-absence global read-only/shield trigger is removed. Manual emergency controls, corruption locks and infrastructure caps remain. Guest hosts do not become site moderators merely by creating a room.
- A recurring gathering is optional; anyone may host spontaneously. No weekly cadence or band hosting commitment has been promised.

The quiet-visit slice renders a confirmed gathering only from a supplied host, a specific time, and an equipment-free activity. Disconnection explains the service instead of calling the room empty. No schedule is seeded, and this slice does not add durable storage. See [quiet visits](HANGOUT_QUIET_VISIT.md).

### 2. Establish continuity and truthful guest identity

- Enforce live chat from join onward. Channel switching may retain already-received scrollback while membership continues; no new visitor gets earlier messages and no fresh visit restores a transcript.
- Reconnection begins a fresh chat buffer; unsent drafts remain separate and can survive within the tab. Keep private-room and PM audiences distinct.
- Remembering a nickname on one device improves convenience but does not reserve a name or establish identity. Clearing storage can lose that continuity.
- Consider optional claimed/reserved identity only when cross-device recognition is wanted; never make it the default guest-entry requirement.
- Authenticate host/band roles independently of nicknames. A display name must not confer authority.

### 3. Add “Made here” with explicit sharing choices

- Start with saved canvas snapshots and concise session artifacts before building a general content feed.
- Separate private export, room sharing, public display, and permission for others to continue/remix a work.
- Provide title, contributor-selected attribution, publication choice, continuation permission, and a clear removal path.
- For shared work, define the session's publication and credit expectations before publishing. Public participation does not silently authorize publishing cameras, audio, or chat.
- An approved artifact can lead back to its project or next gathering. Do not silently index raw chat or record sessions.

### 4. Connect creative media through “Pass it on”

- Pilot a host-pinned prompt manually: a drawing invites a lyric; a lyric invites a story; an original riff invites cover art or a title.
- Let someone ask for a specific contribution to an unfinished idea. Preserve the original and credit participants rather than rewarding message volume.
- Try an asynchronous co-writing pad later: a small text document with explicit sharing, version recovery, attribution, and moderation. Validate demand before adding a document platform.
- Keep the lobby accessible while making things; returning from a room should preserve the visitor's conversation context.

### 5. Make guest hosting dependable; keep global moderation separate

- Room hosting is already open to guests. An owner-appointed trusted site-wide moderator role is implemented locally; the community no longer closes merely because a band member is absent.
- Current lifecycle: guest temporary rooms remain immediate. Optional email-backed registration preserves names and owner/co-host roles across devices and restarts; names expire after 90 days without an owner/co-host visit. Visible handoff, offline co-host removal, reserved owner capacity and room restoration are implemented. See [community improvements](HANGOUT_COMMUNITY_IMPROVEMENTS.md).
- The existing one-room-per-device/10-minute creation cap can interrupt chat → creative collaboration. Revisit the allowance or add an explicit way to turn a chat into an activity before launching; do not silently remove abuse limits.
- Never restore host controls based on nickname alone, silently hand global power to a guest entering `#stalemate`, or imply that a room-op marker identifies a band member.
- StaleBot can explain commands and enforce understandable rules; humans should welcome and respond to people. Never simulate visitors or activity.
- Start event reminders with a calendar download. Email/push require a clear opt-in, an off switch, and truthful delivery behavior.
- A local saved event is not a server RSVP. A connected tab is not proof of an attentive person. Never use either to imply fake attendance or concurrency.
- Keep Ignore, Report, and Leave discoverable; define who receives reports and when a human is available.
- A saved lobby report is acknowledged as queued for review when a moderator is available. That notice does not say a person received it or is reading now. House rules remain the appeal route, and the contact shown there stays the configured placeholder until a monitored address is published. Queue limits are unchanged. See [report coverage](HANGOUT_REPORT_COVERAGE.md).
- See [open-community safeguards and AI review](HANGOUT_SAFEGUARDS_AI.md): review-only public-text classification, bounded evidence queues, visible degraded/off/capped status, and explicit human decisions. AI is configured off until a server-side credential and enable setting are supplied.

## Lean pilot

Propose four sessions hosted by willing visitors with roughly 12–20 recruited participants spanning friends, non-musicians, and phones. No band presence or weekly cadence is required. This is a usability/demand pilot for an eventual public guest product, not a statistically reliable retention experiment. The following thresholds are provisional decision rules, not industry benchmarks:

| Question | Useful measure |
| --- | --- |
| Can a newcomer enter comfortably? | At least 8 of 10 observed guests can post or deliberately choose to lurk without help within one minute. |
| Does someone answer? | During advertised hosted time, at least 80% of first-time speakers receive a substantive human reply within two minutes; bot welcomes do not count. |
| Can people make something together? | Count activities with contributions from at least two distinct participants, completed shared outputs, and actual blockers by device. |
| Does the invitation work? | At least half of accepted activity invitations reach a usable activity and return to chat without help. |
| Is there a reason to return? | At least three participants voluntarily return to continue/discuss/share a work; ask what brought them back. Report actual counts. |
| Is a gathering forming? | Track repeat participation across sessions and whether visitors know each other already; target one-third returning within the next three sessions as an initial hypothesis. |

Track host workload, reconnect failures, and whether guests can find contact controls. Prefer a host tally and voluntary feedback over invasive analytics. Do not optimize page dwell time, raw message count, or bot interactions; a remembered browser is not a proven unique person.

## Integration and release gaps

- The Hang Out PR stack and sibling deployment/open-room work still need integration/release reconciliation; local improvements do not imply those PRs are merged or deployed.
- The recovered live check found `https://stalemate.band/join/` returning 404 while WebJam-generated invitations point there. Recheck before publication and complete the actual hosting/origin configuration.
- WebJam Browser Join merged source, available desktop releases, browser deployment, and permitted origins must agree. The recovered published release predates Browser Join.
- Browser Join, browser-only Sketch Jam, desktop WebJam audio, and Hang Out social calls are distinct paths. Describe the tested route and prerequisites; do not promise musical timing from social-call audio.
- Reconcile the existing Access/TURN/private-room admission checklist and complete real phone/Safari/two-house testing. Local unit/browser results do not establish deployment configuration or real-network musical performance.

## Research basis

- [Libera helper guidance](https://libera.chat/guides/helpers): personal responses and a welcoming channel culture; bots should not substitute for people.
- [Arguello et al., CHI 2006](https://www.cs.cmu.edu/~jaime/ArguelloCHI06.pdf): replies associated with subsequent participation in historical Usenet data. Observational evidence, not a causal Stalemate retention estimate.
- [Discord onboarding](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ) and [events](https://support.discord.com/hc/en-us/articles/4409494125719-Scheduled-Events): focused entry and voluntary event reminders are existing design patterns, not measured proof of our hypotheses.
- [RFC 1459 §1.3](https://www.rfc-editor.org/rfc/rfc1459.html#section-1.3): first join creates a channel and gives channel-op status; it ends when empty. [RFC 2812 JOIN](https://www.rfc-editor.org/rfc/rfc2812.html#section-3.2.1) supplies current topic/members and subsequent messages, not prior chat.
- [EFnet](https://efnet.org/) describes registration-free entry; [OpenChanfix](https://chanfix.org/introduction.html) documents recovery from operator history, not perpetual registered ownership. [mIRC](https://ftp.mirc.com/help/html/other.html) documents local scrollback separately from [optional file logging](https://ftp.mirc.com/help/html/logging.html). Do not claim no backlog prevents copying/logging by recipients.
- [Excalidraw](https://github.com/excalidraw/excalidraw) and [BandLab fork controls](https://help.bandlab.com/hc/en-us/articles/115002945753-What-is-Forking): live creation, saved work, and opt-in continuation can be separate capabilities.
- [W3C chat log technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23.html): semantic, polite message updates; retro styling still needs keyboard, touch, screen-reader, zoom, and contrast testing.
