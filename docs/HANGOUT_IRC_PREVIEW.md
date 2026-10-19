# IRC-first Hang Out development preview

October 18, 2026. Private development and testing on `codex/hangout-irc-first`.

A protected hosted pilot is now available alongside the local preview. See [private pilot access, verified behavior and limits](HANGOUT_PRIVATE_PILOT.md). The existing public site and production Worker were not deployed or linked to this pilot.

## Try it

From the repository root:

```sh
npm ci
npm run dev:hangout
```

Open **http://127.0.0.1:4387/__preview/**. The launcher offers Guest, Room owner A/B, Community moderator, and Site owner identities. Each opened tab has isolated device storage, so separate browser profiles are optional. Room/email and staff identities are clearly labeled local stand-ins. Local room and moderation state survive a restart; chat does not. Stop with Ctrl+C. Set `HANGOUT_PREVIEW_PORT` to choose another port. See [local testing instructions](HANGOUT_LOCAL_TESTING.md) for a complete test sequence and state-file details.

The preview uses a development fixture internally, never a production credential. It does not configure Cloudflare, send mail, call an AI provider, or publish the feature. Existing public pages remain unlinked from Hang Out.

## What to try

1. Enter as a guest and explore `#stalemate`. Conversation starters fill the composer and wait for you to send.
2. In a second browser, start Draw together. The first visitor can join it from the room directory, without creating another room.
3. Leave an unsent draft, switch channels, and return. Mention a visitor by nickname from another channel; the tab shows the unread message and `@you`.
4. Use the keyboard to move between channel tabs. While reading older chat, incoming messages leave your position alone and offer a jump control.
5. Disconnect/reconnect during a local test. Offline submission preserves the draft. Reconnection returns to the lobby, removes stale room memberships and keeps room drafts available when rejoining. Cameras stay off and PM-off preference is reapplied.
6. Try the phone layout: Chat, Rooms and People remain separate views, with the composer visible at a 375 × 667 viewport.
7. Choose Start a chat channel and name it `#night-owls`, or type `/join #night-owls`. A guest who creates it gets `@` controls. Use `/topic` and `/op nick` to share hosting. No canvas, player or camera is opened for ordinary chat channels.
8. Send a message, then join from another browser. The newcomer sees the topic and people, but no earlier chat. Messages received while joined remain in that tab (up to 300 lines per channel). Leaving/rejoining, reconnecting or refreshing begins fresh. Shared drawing/video state is separate and still synchronizes on entry.

## Screenshots

These use temporary **local test visitors and example messages**, not live people or site activity. The main local preview does not fabricate participants.

- [Guest entry](../pr-assets/irc-first/entry-desktop.png)
- [Quiet lobby](../pr-assets/irc-first/quiet-desktop.png)
- [Desktop conversation and room discovery](../pr-assets/irc-first/lobby-desktop.png)
- [Phone conversation](../pr-assets/irc-first/lobby-phone.png)
- [Phone room directory](../pr-assets/irc-first/rooms-phone.png)
- [Named channel creation](../pr-assets/irc-first/create-channel-desktop.png)
- [Guest-hosted text channel](../pr-assets/irc-first/chat-channel-desktop.png)
- [Text channel on a phone](../pr-assets/irc-first/chat-channel-phone.png)
- [AI review queue — synthetic fixture](../pr-assets/irc-first/ai-review-desktop.png)
- [Phone AI review and storage warning — synthetic fixture](../pr-assets/irc-first/ai-review-phone.png)

## Development baseline and changes

The fresh checkout starts with PR #26's open-room implementation, then incorporates the current #23 video and #21 lobby branches. Their test conflicts and the lobby's YouTube CSP integration were resolved locally. This does not merge any GitHub PR. The relevant TURN, Access and vault preparation from the separate [#25 deployment branch](https://github.com/rupret007/StalemateSite/pull/25) is now reconciled into this work. Existing cloud resources were inspected before creating the separate guarded pilot; see [deployment notes](HANGOUT_DEPLOY.md).

The new slice adds conversation-first discovery, truthful presence/quiet/offline states, guest identity copy, draft prompts, unread mentions, accessible keyboard tabs, tab-local drafts, connection feedback, fresh bounded Turnstile checks per socket admission and safe session-reset behavior. A dated show announcement was replaced with a timeless default topic, and Art no longer implies a camera requirement.

A production adapter bug was also fixed: the Worker previously emitted `hello` before its socket was available. Initial admission frames now wait until the socket is accepted; refused clients still fail before upgrade. Adapter tests cover new/returning guests, refusal and hibernation. Connected sessions now restore bounded membership and consent metadata after a Worker wake, without replaying chat or resetting the browser buffer. A reconnect still starts fresh. The locked `ws` dependency was patched within its existing version range.

Tests now use isolated same-origin relay namespaces so room creation and moderation state do not leak across cases. Production caps remain unchanged, with an actual WebSocket regression proving both the room cap and namespace isolation.

The open-community follow-up removes band-absence shutdown while retaining emergency controls and safe stored-state validation. Optional AI moderation flags public text for humans; it has no automatic punishment authority. Actual-receipt report checks, immutable author matching, exact-message report resolution and bounded durable evidence queues address gaps found in the moderation audit. Provider failures and persistence failures have distinct visible handling. See [the safeguard design](HANGOUT_SAFEGUARDS_AI.md).

## Validation recorded

- Full unit suite: **43 files / 382 tests passed**.
- Combined Chromium community suite: **93 scenarios passed**. Covers IRC chat, guest hosting, persistent ownership, report review, art/watch synchronization, consent, camera signaling, TURN fallback, reconnection and phone layouts.
- Real protected Cloudflare pilot: two independent browsers verified chat, shared drawing, room registration, cross-device ownership recovery, no pre-join chat, visitor reports, moderator permissions and phone layout. The final idle/restart result is recorded in the [pilot notes](HANGOUT_PRIVATE_PILOT.md).
- Public pages and JavaScript in the pilot both deny unauthenticated access. Provider-response tests for AI, TURN and Turnstile use explicit fixtures; these do not establish live provider integration.

To repeat the checks:

```sh
npm run test:unit -- --maxWorkers=2
STALEMATE_TEST_PORT=4390 npx playwright test tests/e2e/hangout*.spec.js tests/e2e/lobby*.spec.js --project=chromium --workers=1
npm run package:pages
npm run package:pilot
```

## Boundaries and next work

This is a working private collaboration pilot. Public navigation remains unchanged. Guest hosting and classic IRC history are confirmed decisions: no chat backlog or replay is offered. Room settings, host grants and bounded activity snapshots now survive server restart. Chat stays ephemeral. Bounded connection metadata survives a server wake only for the same still-connected socket; an actual disconnect starts fresh. Optional verified-email ownership preserves named rooms across visits; see [community improvements](HANGOUT_COMMUNITY_IMPROVEMENTS.md). The server's bounded moderation buffer supports reports; it is never sent as join history, and dismissing a report does not rebroadcast old text to newcomers. Unsent drafts survive channel switches and reconnection within the current tab; closing the tab loses them. Delivery acknowledgements are not implemented. Long-term saved creations, schedules, notifications and a shared writing pad remain proposals; named room registration is implemented and tested in both the local preview and protected cloud pilot.

The protected pilot verifies real Cloudflare WebSockets and private invitation admission. Production Access/email codes, Turnstile and TURN, Safari/iPhone hardware, WAN music timing and the WebJam `/join/` hosting/release path still need their recorded integration work. The band-absence rule is now resolved: community activity continues independently, with manual emergency controls retained. See [product direction](HANGOUT_PRODUCT_DIRECTION.md) and [AI moderation safeguards](HANGOUT_SAFEGUARDS_AI.md). The default local preview does not call an AI provider; automated AI UI/provider fixtures are explicitly mocked.
