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

- The original lobby keyboard-leave test at 390px and 1280px used the visible drawing canvas as its signal that the room was open. That was incompatible with real-canvas Paint Along. The follow-up below records how the drawing and Paint Along cases now establish that the room opened.
- The full run found that the shared layout hid drawing after loading any video in the original room. Movie mode now starts from its own action or invitation. Existing rooms keep their drawing controls and signed playback.
- Phone screenshots use the deterministic YouTube fixture and mock cameras. Karen’s hands-on review is pending.
- The interrupted Mini comparison reached 118 passing e2e cases and three failures. The two lobby keyboard cases above expect the drawing canvas. The background playback case added default metadata when selecting a cached video. The cache fix passed that exact test with one worker.
- The Mini finished the earlier 2,343-case candidate unit run and the baseline’s 2,342 unit and 459 e2e cases before the swap constraint. The candidate’s full exact-branch comparison is pending on Bobserver.
- The movie guest’s play, pause and seek actions operate within the host-selected source. Fast pause-then-seek passed three repetitions in each phone engine. Refreshed 390×844 images for the follow-up are linked below.

### Bobserver gate

Run the same unit and browser commands on the pushed `codex/paint-along-focus-20261116` head and detached base `4ab24333`. Compare project, spec and test title for every failure. Keep the legacy visibility assertions and the guest pause checks in the run.

```sh
npm run test:unit
npm run test:e2e -- '(^|/)(hangout|lobby|paint-along)[^/]*\.spec\.js$' --workers=1
```
- The final Mini run selected only the six phone specs in each engine. All 12 passed with one worker.

### Hosted comparison follow-up

Hosted run [43885398784](https://github.com/rupret007/StalemateSite/actions/runs/43885398784) on `809773a4` reported 1,026 passed, 13 failed, two flaky, and five skipped in its main browser suite. The comparable hosted run [43787445092](https://github.com/rupret007/StalemateSite/actions/runs/43787445092) on base `4ab24333` reported 1,022 passed. The three-person Paint Along spec was added after the base.

- Legacy private playback failed the signed timestamp, guest drift, paused seek and phone-layout transition checks. Its host-driven sync test also retried. The room now keeps one host-signed playback state. Guests can send controls in a host-selected Paint Along or movie session, and an initiating guest keeps its newer scrub when the host echoes a control. The phone call header keeps the Paint Along action.
- Lobby Paint Along failed the lesson-link check and the four starter/material checks across both engines. The camera permission dialog now opens from the camera action so painters can use the room while camera access is off. Custom lesson links stay with the host. The three-person lobby spec now waits for the host player to start before reading the room.
- On this revision, the two older lobby keyboard cases at 390px and 1280px failed in Chromium and WebKit at the original drawing-surface visibility assertion. The follow-up separates drawing and real-canvas activities.
- Done — Restored signed playback and lobby lesson controls after the hosted comparison.
- Evidence — All 24 focused checks passed with one worker, including 12 phone checks in Chromium and WebKit. The rapid guest seek checks passed twice in each selected test. Four 390×844 screenshots are in `test-evidence/paint-focus-5e536127/`.
- Next — Bobserver compares the updated branch with `4ab24333`. Karen’s hands-on verdict is still pending.

### Final hosted comparison on 3ecab61e

- [Hosted candidate](https://github.com/rupret007/StalemateSite/actions/runs/43896524339) passed all 2,343 unit tests. Its main browser run reported 1,036 passes, four failures, one flaky case, and five skips. [Hosted base 4ab24333](https://github.com/rupret007/StalemateSite/actions/runs/43787445092) passed all 2,342 unit tests and all 1,022 main browser cases.
- The four failures on 3ecab61e are the two Paint Along keyboard-leave cases at 390px and 1280px in Chromium and WebKit. At that revision the cases still required the drawing canvas before testing focus return. The follow-up updates the Paint Along readiness assertions.
- The 375px Jam composer case in WebKit passed on the hosted retry. Six focused repeats on base and six on candidate all passed with one worker on the Mini. This did not reproduce the hosted flake.
- Direct access was denied during this comparison. The auto-gate bus now delivers Bobserver and Karen reports for pushed heads.

### Karen review follow-up

- Done — Put the phone spec in the standard Chromium and WebKit projects with the same 390×844 camera fixtures. Only the host can initiate a room activity change. Background player events cannot issue shared playback commands.
- Evidence — The standard projects discover six phone cases each. All 21 focused checks passed with one worker. The Draw together keyboard cases still assert a visible drawing surface, and the added Paint Along cases assert the visible lesson stage and real-canvas hint, the hidden drawing surface, and the same keyboard focus return. The failed guest player still tests Catchup and Retry in a host-selected Paint Along session.
- Next — Send the pushed head to Bobserver and Karen through the auto-gate bus. Compare the full result with `4ab24333` and check the reported WebKit media failures against that run.
- Refreshed the four 390×844 screenshots in `test-evidence/paint-focus-08b4b579/`. The prior screenshots remain in the earlier commit. The current images use deterministic test video and camera tracks.

### Bobserver comparison and Karen review on 3cb0b71a

- [Hosted candidate](https://github.com/rupret007/StalemateSite/actions/runs/43918112680) passed 2,343 unit tests and 1,045 browser tests with five inherited skips. [Hosted base](https://github.com/rupret007/StalemateSite/actions/runs/43787445092) passed 2,342 unit tests and 1,022 browser tests. The candidate passed all six phone checks per engine and the protected Game Night checks.
- Bobserver reported two unit test failures, four failing unit files and eight new browser failure locations against its baseline. The new locations were four WebKit phone checks (stage and live tiles, independent audio, touch targets, Watch layout), the WebKit lobby retained-copy check, Chromium WebJam invite copy/QR, iPhone 15 Pro Max Chess retry and iPhone 15 Arcade seeded free play. The report gives browser locations and aggregate unit counts. A focused run will identify the failing assertions and check repeatability.
- Karen marked all seven product outcomes met. The Paint Along readiness assertion **changed** to require a visible lesson stage, visible video and real-canvas hint, and a hidden on-screen canvas. That hidden assertion fails if the digital drawing canvas returns. Draw together retains the original visible-canvas assertion. Each activity retains the full keyboard Leave, lobby focus and page-error checks at both widths. This is the requested activity-specific update to the test.
- The old `autojoin=1` query in the rejoin test intentionally exercises a stale link. Generated links omit it, and the test proves a stale link still requires the name before entering the room and offering camera consent.

### Room creation allowance and abuse assessment

- Jeff's November 16 decision removed the per-device ten-minute spacing in `6a76e631`, already in the supplied shared-layout starting commit. A household can open separate demo rooms back to back and may exhaust its allowance sooner. An ordinary connection can create at most three rooms within a rolling hour, including when multiple devices share that connection. The temporary trusted-host allowance of ten rooms per hour was also removed in that commit. The existing authenticated staff exemption remains.
- The 30-listed-room cap limits inventory across connections. The Worker also enforces room membership limits, invite-only admission, relay and connection limits, and the existing shield, moderation and participation controls. The spacing change permits a burst of three and removes per-device pacing between connections. The hourly allowance and site limits bound the resulting occupancy and resource use. This branch leaves the Worker and those limits unchanged.
- The unit test `lets one device open rooms back to back while the hourly connection allowance still applies` checks successful consecutive creation and rejection when the allowance is exhausted. The registered-room reopen test separately checks that reopening a founder's existing room preserves the creation allowance.

### Focused Bobserver follow-up on 8cd056b1

- Done — Karen approved the seven product outcomes and the activity-specific keyboard assertions. Bobserver traced the four failing WebKit phone checks to browser crashes when both painters turned on cameras. The fixture now gives each WebKit participant a separate browser and still asserts real peer audio and video. The lobby rechecks focused composer visibility after a saved-message reflow. The WebJam QR test computes the minimum channel value over the same quiet-zone pixels and requires it to exceed 200, preserving the original condition for every pixel.
- Evidence — All 20 focused Mini checks passed with one worker and no retries. The set covers all six phone cases plus both retained-copy and QR widths in each engine. Chromium QR cases fell from 3.3–3.6 seconds to about one second each. Bobserver's focused Chess and Arcade checks passed, and the unit diagnostic was rejected because the bus appended Playwright-only options to Vitest.
- Next — Run the full Bobserver gate on the updated head. Compare existing failures by test title as well as source line and require the WebKit camera, lobby and QR checks to pass. The standard full gate runs Vitest without the focused command wrapper.
