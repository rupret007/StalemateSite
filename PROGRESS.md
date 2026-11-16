- Done 1 — Required name submission on private invitations and released media previews when the room disconnects.
- Evidence — The original branch exposed the pre-join camera test in both browsers. The focused denial, retry, reconnect and leave/rejoin spec now passes in Chromium and WebKit at 390×844.
- Next — Measure the stage, two tiles, chat and dock at both phone sizes.

- Done 2 — Checked the full-width 16:9 stage with two live camera tiles and chat both closed and open.
- Evidence — Both engines pass viewport, area, stacking and hit-testing assertions at 390×844 and 375×667.
- Next — Fix the late guest’s paused player and verify guest playback controls.

- Done 4 — Retained the newest accepted Paint Along playback when a drawing snapshot arrives.
- Evidence — The guest pauses, plays and seeks for both players, and a late guest inherits the playback position. Both phone projects and the existing Hang Out guest-control test pass.
- Next — Separate local music, video sound and mic controls and verify game sound preferences stay independent.

- Done 5 — Split site-wide Music from Video sound and kept the existing game effects and microphone settings.
- Evidence — Chromium and WebKit verified red and green Music states, independent YouTube mute and a live local and remote microphone.
- Next — Check visible tap targets, camera prominence, filmstrip and chat against the phone screenshots.

- Done 3 — Promoted camera consent, fitted the top bar, enlarged touch targets and arranged live canvas feeds in a horizontal strip above chat.
- Evidence — Both phone projects pass the 48px checks and geometry checks. Paint Along points at the real canvas through the camera and keeps it uncropped.
- Next — Verify Watch opens the same stage, filmstrip, chat and dock from its invitation.

- Done 6 — Watch and Paint Along use the same stage, camera strip, chat and dock. Private movie invitations carry the activity, and video selection stays with the host.
- Evidence — Both engines pass the movie invite, shared layout, live tiles and guest control checks at both phone sizes.
- Next — Capture the four phone screenshots and compare the full unit and e2e runs to 4ab24333.

### Regression comparison

- The lobby keyboard-leave test at 390px and 1280px waits for the on-screen drawing canvas as its signal that Paint Along is open. Paint Along uses live camera feeds of real canvases, so the assertion conflicts with the requested behavior. The test and its assertion stay intact.
- The full run found that the shared layout hid drawing after loading any video in the original room. Movie mode now starts from its own action or invitation. Existing rooms keep their drawing controls and signed playback.
- Phone screenshots use the deterministic YouTube fixture and mock cameras. Karen’s hands-on review is pending.
- The interrupted Mini comparison reached 118 passing e2e cases and three failures. The two lobby keyboard cases above expect the drawing canvas. The background playback case added default metadata when selecting a cached video. The cache fix passed that exact test with one worker.
- The Mini finished the earlier 2,343-case candidate unit run and the baseline’s 2,342 unit and 459 e2e cases before the swap constraint. The candidate’s full exact-branch comparison is pending on Bobserver.
- The movie guest’s play, pause and seek actions operate within the host-selected source. Fast pause-then-seek passed three repetitions in each phone engine. The four reviewed 390×844 images are in `test-evidence/paint-focus-b433f88c/`.

### Bobserver gate

Run the same unit and browser commands on the pushed `codex/paint-along-focus-20261116` head and detached base `4ab24333`. Compare project, spec and test title for every failure. Keep the legacy visibility assertions and the guest pause checks in the run.

```sh
npm run test:unit
npm run test:e2e -- '(^|/)(hangout|lobby|paint-along)[^/]*\.spec\.js$' --workers=1
```
- The final Mini run selected only the six phone specs in each engine. All 12 passed with one worker.
