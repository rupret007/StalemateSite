# Hang Out product direction

Updated October 18, 2026. This records confirmed direction, the current development slice, and proposals for subsequent work. It does not authorize public deployment or change existing admission/moderation rules.

## Confirmed direction

- Welcome anyone visiting Stalemate, with guest access from day one.
- Make the experience visibly retro IRC: nicknames, channels, topics, commands, conversation, and recognizable regulars.
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

Existing creative-room, PM-consent, and moderation capabilities remain the foundation. Current recent chat history is bounded in memory (`LOBBY_LIMITS.history` is 50); persistent moderation/network state does not make conversation history durable. Local drafts and local nickname memory are not cross-device accounts or archives.

## Ranked roadmap

### 1. Make quiet visits and hosted visits worthwhile

- Keep one obvious main conversation; display active rooms honestly instead of fragmenting a small audience across empty destinations.
- Show the next **confirmed** hosted gathering, its host, local time, and what someone can do without equipment. No invented schedule or implied live host.
- When quiet, offer a small creative prompt and an approved past creation. When disconnected, explain the service state rather than displaying false emptiness.
- Preserve the existing 24-hour band-absence lockdown. A closed lobby can still explain the situation and display approved information.
- Hosting cadence remains unanswered: ask what Jeff or another named host can sustain before promising a weekly event.

### 2. Establish continuity and truthful guest identity

- Decide whether public chat should persist, for how long, and what deletion/removal means before adding durable replay. Persistence preferences are still unanswered.
- Explain who can read history before posting; keep private-room and PM audiences separate from public channels.
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

### 5. Expand hosting and reminders only with an operating model

- A future trusted community host role could make gatherings less dependent on the band. Who may reopen/moderate the lobby under the 24-hour rule remains unresolved.
- StaleBot can explain commands and enforce understandable rules; humans should welcome and respond to people. Never simulate visitors or activity.
- Start event reminders with a calendar download. Email/push require a clear opt-in, an off switch, and truthful delivery behavior.
- A local saved event is not a server RSVP. A connected tab is not proof of an attentive person. Never use either to imply fake attendance or concurrency.
- Keep Ignore, Report, and Leave discoverable; define who receives reports and when a human is available.

## Lean pilot

Use four hosted sessions with roughly 12–20 recruited visitors spanning friends, non-musicians, and phones. This is a usability/demand pilot for an eventual public guest product, not a statistically reliable retention experiment. The following thresholds are provisional decision rules, not industry benchmarks:

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
- [IRCv3 history](https://ircv3.net/specs/extensions/chathistory): reconnect/catch-up reference; the specification is a draft and does not require changing this application's transport.
- [Excalidraw](https://github.com/excalidraw/excalidraw) and [BandLab fork controls](https://help.bandlab.com/hc/en-us/articles/115002945753-What-is-Forking): live creation, saved work, and opt-in continuation can be separate capabilities.
- [W3C chat log technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23.html): semantic, polite message updates; retro styling still needs keyboard, touch, screen-reader, zoom, and contrast testing.
