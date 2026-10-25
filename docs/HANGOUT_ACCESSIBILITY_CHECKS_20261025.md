# Hang Out keyboard and responsive checks — 2026-10-25

The local application candidate passed **11 new Chromium checks plus 6 existing browser regressions: 17 total**. This is scoped, pre-commit evidence. It is not a WCAG conformance claim or proof of the deployed service. The release owner must associate subsequent full-suite results with the final commit.

## Defects corrected

- Error notices previously covered the focused composer at 375px, 390px and 640px widths. Notices now occupy their own bounded, scrollable grid row, above the mobile section navigation, and remain available from Rooms and People as well as Chat.
- The command, camera-confirmation and person-action dialogs had visible headings but no accessible names. Each dialog now references its existing heading with `aria-labelledby`.
- Notices previously hid after four seconds, or twelve seconds with actions, even while a keyboard user was reading or operating them. Dismissal pauses while the notice or any descendant holds focus and resumes after focus leaves.
- A queued native dialog `close` event could clear the request from a newer opening. The room joined successfully while its modal remained open with “Joining…”, trapping Tab. The listener now clears the request only while that dialog is actually closed.
- In a narrow 256px-high viewport, the return link and connection indicator could turn the header into an 80px row. Compact header sizing, smaller vertical spacing and ordinary vertical page scrolling preserve the composer and a readable chat line. The short workspace has a 252px minimum height; vertical scrolling is intentional when the viewport cannot contain its controls. Horizontal page scrolling remains disallowed.

Application changes are limited to [lobby markup](../r/45662413410ed051/lobby/index.html), [styles](../r/45662413410ed051/lobby/lobby.css), and the close-listener/notice-focus handling in [the client](../r/45662413410ed051/lobby/lobby.js). Existing chat, admission, moderation and transport limits were not weakened for these checks.

## New coverage

[lobby-accessibility.spec.js](../tests/e2e/lobby-accessibility.spec.js) uses actual Tab, Enter, Space, Escape, Home, End and select-all keyboard events for the core journey. DOM inspection measures results; it does not focus or click through that journey.

The checks cover guest entry; a reserved activity-name error and correction; room creation; real local WebSocket chat; roving channel-tab focus and preserved connected-session messages; modal focus containment and Escape return; a visible keyboard focus outline; all three dialog names; long unbroken 300-character messages with a 20-character nickname; actual room-creation-limit errors; and invitation actions between two isolated browser contexts sharing the same local relay.

The responsive probes require the entire composer to fit both the viewport and its clipping chat pane. They hit-test the center and four inset corners of the input and Send button, verify no page/log/topic horizontal overflow, check 16px input text at phone widths, and retain at least one full line of log content. Geometry JSON and screenshots are saved before assertions.

| Viewport | Purpose | Page width | Send right edge |
| --- | --- | ---: | ---: |
| 375 × 844 | Phone layout | 375px | 357px |
| 390 × 844 | Phone layout | 390px | 372px |
| 640 × 512 | 200% layout equivalent of 1280 × 1024 | 640px | 622px |
| 320 × 256 | 400% layout equivalent of 1280 × 1024 | 320px | 304px |

Reduced-motion emulation verifies the media query, automatic scroll behavior and zero button-transition duration. The announcement checkbox is operated with the keyboard; its `aria-live="off"` state persists while switching between connected-session buffers, and it can be restored to polite announcements. This checks DOM behavior, not spoken output.

Two tests intentionally wait beyond the real four-second and twelve-second notice deadlines. Browser fake timers are avoided so local server and WebSocket control clocks stay aligned. A separate native-event-order regression uses one explicitly named 150ms response-delay fixture, forwards frames from the real local server in order, and performs close/reopen/submit in one browser task. That fixture is not presented as an all-keyboard journey or a measured network delay.

## Reproduce

Use the repository's installed Playwright version and matching browser cache. On this Mini the existing cache is `/private/tmp/raddad-playwright`; no browser or dependency download was needed.

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/raddad-playwright \
STALEMATE_TEST_PORT=4504 \
npx playwright test tests/e2e/lobby-accessibility.spec.js \
  --project=chromium --workers=1 \
  --output=/private/tmp/webjam-accessibility-browser-20261025-compact-acceptance \
  --reporter=list
```

Result: **11 passed**, 32.3 seconds. This browser suite uses isolated local relay namespaces and blocks external media/analytics requests. It does not call production services or AI providers.

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/raddad-playwright \
STALEMATE_TEST_PORT=4505 \
npx playwright test tests/e2e/lobby-command-navigation.spec.js \
  tests/e2e/lobby-collaboration-phones.spec.js \
  --project=chromium --project=webkit-iphone-se --project=chromium-android \
  --workers=1 --output=/private/tmp/webjam-accessibility-browser-20261025-mobile-final \
  --reporter=list
```

Result: **6 passed**, 24.5 seconds: two Chromium channel-navigation tests, two WebKit iPhone SE collaboration tests, and two Chromium Android collaboration tests. These existing tests cover real chat/drawing, reconnect drafts, no missed-message replay and authorized watch-state synchronization. YouTube playback is a named player fixture; hardware media is outside that result. Client JavaScript syntax checking also passed.

## Retained local evidence and limits

The main checkout's ignored `.local/webjam-product-finish/shared-community-accessibility-20261025/` contains `receipt.json` with source SHA-256 values, `keyboard.log`, `existing-mobile.log`, and the complete test artifact folders. In `keyboard/`, each phone/reflow scenario retains `*-lobby-long-message.png`, `*-long-message-error.png`, and geometry JSON; invitation scenarios retain `*-invitation.png`. Initial failing cases remain in the original `/private/tmp/webjam-accessibility-browser-20261025-*` directories rather than being relabeled as passes.

The 200%/400% checks reduce the CSS viewport. They do not exercise native browser zoom, text-only enlargement, operating-system magnification or every WCAG reflow requirement. W3C's [Reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) explains the 320 CSS-pixel relationship; its separate [Resize Text guidance](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) requires checking text enlargement without loss of content or function. That broader text-resizing assessment remains outstanding.

The new keyboard/accessibility suite runs in Chromium. The existing mobile regressions additionally use emulated WebKit/iPhone and Chromium/Android. Neither proves physical iPhone Safari behavior, iOS focus zoom or virtual-keyboard/safe-area behavior. No VoiceOver/NVDA speech, switch input, contrast audit, complete activity-canvas alternative, all-dialog/error combinations, native WebJam audio/camera journey, or full accessibility review is claimed. Those need distinct acceptance evidence before a conformance or universal-accessibility statement.
