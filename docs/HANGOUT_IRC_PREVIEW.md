# IRC-first Hang Out development preview

October 18, 2026. Local research and development on `codex/hangout-irc-first`.

## Try it

From the repository root:

```sh
npm ci
npm run dev:hangout
```

The command prints the complete local lobby link and runs the site plus a loopback-only relay on port 4387. Choose a guest nickname. Use another browser profile or private window for a separate visitor. Stop with Ctrl+C. To choose a different port, set `STALEMATE_TEST_PORT` before the command.

The printed `local-preview-key-0001` value is the development fixture, not a production credential. The preview does not configure Cloudflare, send mail, or publish the feature. Existing public pages remain unlinked from Hang Out.

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

The fresh checkout starts with PR #26's open-room implementation, then incorporates the current #23 video and #21 lobby branches. Their test conflicts and the lobby's YouTube CSP integration were resolved locally. This does not merge any GitHub PR. The separate #25 deployment branch has not been folded into this work.

The new slice adds conversation-first discovery, truthful presence/quiet/offline states, guest identity copy, draft prompts, unread mentions, accessible keyboard tabs, tab-local drafts, connection feedback, fresh bounded Turnstile checks per socket admission and safe session-reset behavior. A dated show announcement was replaced with a timeless default topic, and Art no longer implies a camera requirement.

A production adapter bug was also fixed: the Worker previously emitted `hello` before its socket was available. Initial admission frames now wait until the socket is accepted; refused clients still fail before upgrade. Four adapter tests cover new/returning guests, refusal and hibernation admission. The locked `ws` dependency was patched within its existing version range.

Tests now use isolated same-origin relay namespaces so room creation and moderation state do not leak across cases. Production caps remain unchanged, with an actual WebSocket regression proving both the room cap and namespace isolation.

The open-community follow-up removes band-absence shutdown while retaining emergency controls and safe stored-state validation. Optional AI moderation flags public text for humans; it has no automatic punishment authority. Actual-receipt report checks, immutable author matching, exact-message report resolution and bounded durable evidence queues address gaps found in the moderation audit. Provider failures and persistence failures have distinct visible handling. See [the safeguard design](HANGOUT_SAFEGUARDS_AI.md).

## Validation recorded

- Full unit suite: **35 files / 300 tests passed** after the community roles, persistent ownership and safeguard changes.
- Combined focused Chromium lobby and AI-admin browser suite: **25 scenarios passed**. Includes two-browser art/video behavior, guest admission, moderation, phone layout and rejected creation feedback, host handoff, no pre-join chat, draft/mention behavior, reconnect, fresh challenges, bounded challenge-load failure, and explicitly mocked AI review/status/permissions/disclosures.
- Pages packaging succeeded; whitespace checks passed. Screenshots captured with no browser page errors.
- A mocked external Turnstile callback requires disabling Chromium's local-network provenance check in the discovery test fixture. The app's CSP stays enforced; this is not a claim to have tested a live Turnstile service.

To repeat the focused checks:

```sh
npm run test:unit -- --maxWorkers=2
STALEMATE_TEST_PORT=4388 npx playwright test tests/e2e/lobby.spec.js tests/e2e/lobby-open-rooms.spec.js tests/e2e/lobby-discovery.spec.js tests/e2e/lobby-ai-admin.spec.js tests/e2e/lobby-community.spec.js --project=chromium --workers=1
npm run package:pages
```

## Boundaries and next work

This is a working local collaboration slice, not a public launch. Guest hosting and classic IRC history are confirmed decisions: no chat backlog or replay is offered. Room settings, host grants and bounded activity snapshots now survive server restart. Connection membership and chat stay ephemeral. Optional verified-email ownership preserves named rooms across visits; see [community improvements](HANGOUT_COMMUNITY_IMPROVEMENTS.md). The server's bounded moderation buffer supports reports; it is never sent as join history, and dismissing a report does not rebroadcast old text to newcomers. Unsent drafts survive channel switches and reconnection within the current tab; closing the tab loses them. Delivery acknowledgements are not implemented. Long-term saved creations, schedules, notifications and a shared writing pad remain proposals; named room registration is implemented locally.

Real Cloudflare admission/Access/TURN, Safari/iPhone hardware, WAN music timing and the WebJam `/join/` hosting/release path still need their recorded integration work. The band-absence rule is now resolved: community activity continues independently, with manual emergency controls retained. See [product direction](HANGOUT_PRODUCT_DIRECTION.md) and [AI moderation safeguards](HANGOUT_SAFEGUARDS_AI.md). The default local preview does not call an AI provider; automated AI UI/provider fixtures are explicitly mocked.
