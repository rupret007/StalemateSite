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
