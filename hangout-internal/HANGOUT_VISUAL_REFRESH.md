# Hang Out visual refresh

October 18, 2026. Implemented in StalemateSite on `codex/hangout-irc-first`.
The existing [invitation-only pilot](HANGOUT_PRIVATE_PILOT.md) is the place to test
these changes. The public site and its navigation remain unchanged.

## Assessment and changes

| Observed issue | Implemented improvement |
| --- | --- |
| Brown surfaces, heavy bevels and competing bright controls obscured the main actions. | Charcoal layers, fine borders, warm text and restrained lime accents. Join and Send lead; optional camera controls are quieter. |
| Entry was a long form, with the join action low on phones. | A welcoming two-column desktop entry, compact phone layout, one nickname field and a small random-name control. Age agreement, rules and conditional AI disclosure remain available before entering. |
| Room discovery and creation were buried in explanation. | Compact search/filter controls, clearer room rows, distinct creation cards and expandable hosting guidance. |
| A stretched desktop canvas and crowded phone activity displaced chat. | Native 5:3 canvas sizing, bounded activity, a collapse control, nonshrinking composer and navigation in the app layout. |
| Local and hosted preview banners overlapped or consumed too much room. | Compact status strips in normal document flow. |
| Brush colors had no names or visible selected state; reports were hard to tap. | Named brushes with pressed state and visible selection, 44-pixel phone color controls, larger report targets and clear keyboard focus. |
| The local preview script's nickname attribute collided with the real input. | Separate preview metadata; a browser regression proves the chosen nickname is used and survives reload. |

Channel names, timestamps, nickname colors, host prefixes and slash commands retain
the IRC character. Presence stays truthful: the UI does not invent participants,
conversation, typing indicators or activity. Guest hosting and connected-session
history behavior are unchanged.

The pilot portal, private invite rooms, moderation panel and house rules use the
same visual palette. No remote fonts, generated artwork, additional analytics or
new frontend dependencies were introduced. Private room artwork retains its
existing canvas background.

## Rendered evidence

Screenshots use explicitly controlled local test identities:

- [Desktop entry](../pr-assets/irc-first/polished-entry-desktop.png)
- [Desktop lobby](../pr-assets/irc-first/polished-lobby-desktop.png)
- [Phone drawing and chat](../pr-assets/irc-first/polished-art-phone.png)
- [Phone room discovery](../pr-assets/irc-first/polished-rooms-phone.png)

At 375 × 667, the host canvas retains 5:3, the palette and Clear control fit,
chat keeps over 100 pixels, and the composer ends above navigation. Collapsing
activity expands the chat area while retaining the room, actual canvas pixels
and shared stroke state. Keyboard focus remains visible. Narrow and landscape
checks at 320 × 568 and 667 × 375 keep the composer above navigation;
activities scroll internally when space is limited.

Validation: **382 unit tests** and **94 Chromium community browser scenarios**.
The suites cover the underlying
chat, ownership, moderation, watch/drawing and camera flows. Real Cloudflare
browsers also verify invitation admission, two-browser chat and shared drawing,
ownership recovery, fresh history, reporting and limited moderator review.
WebKit was unavailable locally; physical Safari/iPhone testing remains launch
work and is not implied by Chromium viewport checks.

Repeat automated checks from the repository root:

```sh
npm run test:unit -- --maxWorkers=2
STALEMATE_TEST_PORT=4390 npx playwright test tests/e2e/hangout*.spec.js tests/e2e/lobby*.spec.js --project=chromium --workers=1
npm run package:pages
npm run package:pilot
```

AI review and TURN stay off in the private pilot. Email identities remain clearly
labeled stand-ins. The visual refresh does not claim those production integrations
are active.

Protected pilot deployment: `d22c2228-f490-4473-8faa-c42837ffeba4`.
