# Mobile chat verification

The pilot chat keeps long text within its pane, uses 14px chat/welcome copy on
small phones and 16px form fields, and preserves the complete input and Send
button. Starter buttons and action chips scroll within their own rows with
44px touch targets. The visual viewport keeps the composer above a mobile
keyboard while preserving drafts and allowing browser pinch zoom.

WebKit screenshots, using local test identities and the local relay:

- [375 × 667](chat-375.png)
- [390 × 844](chat-390.png)
- [375px, simulated keyboard viewport](keyboard-simulated-375.png)
- [390px, simulated keyboard viewport](keyboard-simulated-390.png)

Validation: 382 unit tests and 104 chat/room browser scenarios passed, including
both widths in Chromium, Android emulation and three WebKit iPhone profiles.
The keyboard cases simulate a 300px visual viewport and 25px offset; they do
not show an actual iOS keyboard. Physical iPhone Safari remains a manual check.
Both public and private packaging commands passed. This change is a PR;
these screenshots do not claim that the hosted pilot has been updated.

Reproduce: `npm run test:unit -- --maxWorkers=2`, then
`STALEMATE_TEST_PORT=4396 npx playwright test tests/e2e/hangout*.spec.js tests/e2e/lobby*.spec.js --workers=1`.
