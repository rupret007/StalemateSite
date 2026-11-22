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
- The keyboard status test exercises toast visibility while focused across the real dismissal deadline and disappearance after focus leaves. The inherited cooldown-removal commit substituted a deterministic unknown-command server error as the toast trigger and kept those lifetime and focus assertions. The room allowance is covered independently.

### Focused Bobserver follow-up on 8cd056b1

- Done — Karen approved the seven product outcomes and the activity-specific keyboard assertions. Bobserver traced the four failing WebKit phone checks to browser crashes when both painters turned on cameras. The fixture now gives each WebKit participant a separate browser and still asserts real peer audio and video. The lobby rechecks focused composer visibility after a saved-message reflow. The WebJam QR test computes the minimum channel value over the same quiet-zone pixels and requires it to exceed 200, preserving the original condition for every pixel.
- Evidence — All 20 focused Mini checks passed with one worker and no retries. The set covers all six phone cases plus both retained-copy and QR widths in each engine. Chromium QR cases fell from 3.3–3.6 seconds to about one second each. Bobserver's focused Chess and Arcade checks passed, and the unit diagnostic was rejected because the bus appended Playwright-only options to Vitest.
- Next — Run the full Bobserver gate on the updated head. Compare existing failures by test title as well as source line and require the WebKit camera, lobby and QR checks to pass. The standard full gate runs Vitest without the focused command wrapper.

### Follow-up on 4d58ad05

- Done — Bobserver no longer reports the lobby composer or QR failures. The four WebKit dual-capture cases still failed in the full run after process isolation. Their inputs now come from generated video and audio tracks. Camera consent, preview, tile playback and remote audio continue to run through the application and native WebRTC. The single-participant consent spec still exercises the browser's mock-device capture and denial/retry path.
- Evidence — The WebKit phone checks passed twice on the Mini. All 18 checks in the combined focused run passed with one worker and no retries. The set includes both standard phone projects, keyboard status in both engines, the Chromium multi-peer check and the two iPhone Arcade variants reported by Bobserver. GitHub CI passed on 4d58ad05, while its Bobserver full comparison reported seven new browser failure locations and two unit failures.
- Next — Run focused Bobserver diagnostics to verify the media input change and collect direct WebKit, multi-peer, Arcade and Vitest failure details. Karen will review the clarified intent of the inherited keyboard status test. A clean focused run will be followed by the full comparison against 4ab24333.

### WebKit native crash diagnostics

- Done — Bobserver and hosted CI both use Playwright 1.64.1. Bobserver recorded native ALSA and GStreamer GL warnings before WebKit crashed as the guest confirmed sharing. A null ALSA output, software video sink and the GTK port all left failures. The two-camera scenarios now verify stable one-way WebRTC with both host tracks before the guest starts sharing. They retain all subsequent two-way video, audio, consent, layout and playback checks.
- Evidence — All 12 phone checks passed on the Mini with one worker and no retries. GitHub CI on 3368fbb0 passed 2,343 unit and 1,045 browser tests. The Game Night storage and timing diagnostics reproduced recovery timeouts and measured one existing case at 5.6 seconds. Those measurements establish runner timing pressure. They cover a different head and do not establish a matched comparison for every unit timeout.
- Next — Run the three reported WebKit cases on Bobserver with native capture and signaling diagnostics. Run the full gate and Karen review after that focused check passes.

### Remote media attachment follow-up on 3dbe6be8

- Done — Bobserver reproduced the WPE crash during the host's one-way media, before the guest enabled capture. The native log reported a 400ms GStreamer frame conversion timeout. Remote tiles now attach a playback stream built from the currently live tracks. They replace that stream once when its tracks change, avoiding the empty source and repeated attachment of the mutable signaling stream.
- Evidence — All 12 phone checks, Chromium multi-peer playback, mic-only playback, and camera off/on with the mic kept live passed on the Mini with one worker and no retries.
- Next — Re-run the three affected WebKit phone cases on Bobserver. Queue the full comparison and Karen review if they pass.

### Bobserver video codec follow-up on aedea850

- Done — The standalone WebRTC receiver failed without the room app when it played video. Audio alone passed. The identical video reproduction passed with H.264, closed the receiver with VP8, and timed out with VP9. The two-camera WebKit fixture now negotiates H.264 when available. The exploratory room playback change was removed to keep the application on its previously reviewed media path.
- Evidence — All 12 focused Mini checks passed with one worker and no retries. They still exercise the two camera feeds, the decoded video, guest pause and seek, live audio, 48px tap targets, independent mute controls, and shared phone layout. The Bobserver codec evidence is in the `WEBKIT-NATIVE-CODECS` receipt.
- Next — Verify all three previously failing WebKit phone cases on Bobserver. If they pass, request the full comparison on this head with Karen review.

### Full Bobserver comparison on 47d44ef9

- Done — The H.264 fixture passed all three previously failing WebKit phone cases on Bobserver. The full run reported zero new Paint Along, Watch a Movie Together, or lobby failures. Karen passed the exact head using the required branch starting point `27698d21`; that commit already includes Jeff's approved removal of the ten-minute cooldown. The `4ab24333` comparison remains the test gate.
- Evidence — GitHub CI passed 2,343 unit and 1,045 browser tests. The Bobserver full run logged three iPhone WebKit game failures against the pinned baseline: Arcade seeded free play on iPhone 15 and iPhone 15 Pro Max, plus Chess computer retry on iPhone 15 Pro Max. Matched repeats with one worker and no retries passed 8/8 on each revision. All four failing candidate unit files also appear in the saved Bobserver base unit logs. The full Bobserver gate still reports FAIL.
- Next — Profile Chess's delayed engine failure and trace Arcade's slow real input and navigation on Bobserver. Keep every asserted condition and the existing deadlines. The timing comparison reported Chess recovery at 20.4 seconds; turning off test video recording left both journeys near 26–28 seconds.

### Game failure follow-up

- Done — In Bobserver's Chess diagnostic, the aborted engine binary triggered an unhandled worker rejection around 6.3 seconds; the worker stayed open until about 21.0 seconds. The Stockfish loader now forwards terminal rejections to the existing worker error handler. Arcade runs independent checks for the same game state together, while keeping navigation, font readiness, touch input, undo and every assertion in order.
- Evidence — The loader's source and published copy match. A focused Node harness verified that the worker error is scheduled immediately, carries the rejection as its cause, and preserves the successful WASM response and MIME type. Syntax and diff checks passed. The Bobserver Arcade trace measured multiple navigation and browser inspection calls taking seconds apiece.
- Next — Run the two original game specs with their existing deadlines on Bobserver, along with the six WebKit phone cases. Then request the full Bobserver gate and Karen review on the same head.

### Late guest camera lock notice

- Done — GitHub CI on `5d83b714` exposed an intermittent late-guest failure. The echo tip replaced the host lock explanation just as a newcomer tried to start their camera. The tip now leaves that explanation visible while the guest's camera and mic are locked out.
- Evidence — A focused Node check exercised the room's actual echo-tip function with a locked viewer, then after unlock. The existing browser assertion remains. GitHub CI also measured Chess recovery at about 2.5–2.6 seconds on both iPhone projects, down from 17.6–17.8 seconds.
- Next — Let the already queued `5d83b714` game and phone checks finish. Then verify the lock notice on the updated head and submit the full gate with Karen review.

### Paint Along invite from the room

- Done — The Paint Along join-order test now opens the link generated by the host's invite button. It checks that the link identifies Paint Along and excludes preview access. Watch a Movie Together uses the same test helper and retains its invite assertions.
- Evidence — Five focused Mini checks passed at one worker with no retries: join flow and Watch layout in Chromium and WebKit, and the Chromium late-guest camera lock case. The first launch could not find the browsers at the default path. The successful run used the worktree's existing Playwright browser cache.
- Next — Collect the queued `5d83b714` Bobserver receipt, then submit the updated head to the full gate and Karen. The invite test intercepts the share action in the browser; the native phone share sheet remains to be verified.

### Turdomania on iPhone WebKit

- Done — Reduced-motion tile reparenting no longer forces layout to restart a disabled transition. Normal animation follows the existing path, and both game specs keep their existing assertions and deadlines.
- Evidence — All six checks for the two original Arcade journeys passed across the iPhone SE, 15 and 15 Pro Max WebKit projects with one worker and no retries. A check of the actual render function confirmed the same final tile positions and the unchanged normal-motion transition setup. Karen passed `5a0d9a43`, but its full gate failed. Three of the five reported new Arcade keys map to the baseline's ordinary Turdomania test at its old line number. The remaining two were seeded free play on iPhone 15 and 15 Pro Max. All five failed unit filenames appear in saved baseline logs.
- Next — Compare the shipped branch against `4ab24333` again via the full Bobserver gate and Karen review. The focused passes do not establish recovery under full-gate load.

### Lane A TURN plan — 2026-11-21 19:42 CT

- Done — Wrote `TURN-PLAN.md` before any production edit. Cloudflare STUN stays free and unlimited. Realtime TURN shares the 1,000 GB/month free egress allowance with SFU, then $0.05/GB. Credentials are minted server-side from the Hangout TURN key. The Music web key is a different issuer and is not used.
- Next — Ship `HANGOUT_TURN_ENABLED=1` on the private beta toml only, then add official-inventory relay, expiry, and fallback tests. Playwright stays idle while the official lock is held.

### Lane A TURN tests — 2026-11-21 19:53 CT

- Done — Private beta `HANGOUT_TURN_ENABLED` is `1`. The TURN key stays a vault secret. Public and pilot tomls stay off. `deploy.test.js` still expects the public file to say disabled and passed (8). `beta.test.js` plus the loopback TURN fixture unit test passed together (33) on Node v22.23.5, Vitest 4.1.12, two workers, about 6.7s. Load stayed under 30.
- Not run — Playwright. The official lock was held by gate `54d41e71` (unit phase, no receipt), so the new relay, Paint Along, expiry, and fallback browser tests were not started. They are in the Chromium inventory with no skip and the default 30s budget.
- Next — After the lock is free and load is under 30, run only `tests/e2e/hangout-turn-relay.spec.js` on Chromium with one worker. Official fullgate and Karen stay with the integrator.
