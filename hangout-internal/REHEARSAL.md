# G7 · Two-iPhone rehearsal

**Pending.** Run after the exact private site and issuer are serving and Jeff has approved the live $0 window in [ACTIVATE-MUSIC.md](ACTIVATE-MUSIC.md). Start with two physical iPhones in clean Safari sessions, headphones, agreed microphone use and recording off. Close the previous session and confirm its relay allocations have retired. Allow at most two host starts per ten minutes and schedule the four starts below across approved windows.

1. [ ] **Offer 1 · Private entry and one-tap join.** Open the privately shared Hangout invite on each phone and choose distinct nicknames. In Jam, iPhone A taps **Host Music on this device**, selects B, taps **Continue to Music**, confirms headphones and taps **Start with microphone**. B taps **Accept and join** once to reach audio consent in Hangout, then enables the microphone.
2. [ ] **Hear both directions.** A plays a short phrase and B confirms hearing it. Swap roles. Mark audible quality and interruptions, and record the route class as direct or relay.
3. [ ] **Paint and chat while Music is open.** Open Paint Along on both phones. Confirm the same lesson and see a guest pause and resume reflected on both. Then use **Draw together** and join the same shared canvas while staying in Jam. Draw one distinct stroke on each phone and verify both phones show both strokes. Exchange one chat line each and confirm audio still works both ways.
4. [ ] **Leave.** B returns to the Jam room and taps **Leave**. Both phones show Music ended and microphone indicators clear. Verify the old offer is unusable and its allocations are revoked or expired.
5. [ ] **Offer 2 · Kick.** Start a fresh approved offer, accept on B, and have A kick B from Jam using **Host tools**. Repeat the ended, mic, old-offer and allocation checks.
6. [ ] **Offer 3 · Stop.** In the next approved window, join again and have A tap **Stop Music**. Repeat the ended, mic, old-offer and allocation checks.
7. [ ] **Offer 4 · Rejoin and finish.** Accept a fresh offer and hear Music both ways again. With Paint open, use **End Music** in Music controls. Check room confirmation and both phones’ cleanup, then have both leave. Record any missing confirmation and hold further trials until the old offer and allocations are confirmed retired.

If foreground recovery is in the approved scope, verify Music resumes after a brief Safari background and remains closed after a missed heartbeat in a separately scheduled check. Stop on unexpected access, spend, capture or relay behavior.

**Record per window** UTC time, site and issuer versions, both iOS versions, network classes, direct or relay, each check’s result, usage readback and cleanup confirmation. Omit private links, addresses, credentials and captured media.

## Pick one desktop WebJam build for the presenter

The desktop choice covers the Music and Art walkthrough. Both phones use the private Hangout website.

- **Intel Mac · Private Band Demo** — `23cfae6ac05c128e1caf8a6fd366751686304ba6`, macOS x64 artifact `13847713990`. The recorded Intel Desktop shortcut selects this checked archive. [Private packaging run](https://github.com/rupret007/webjam/actions/runs/42997398282)
- **Apple Silicon · Existing Mini build** — `ae49c915070f2951db9ff441c23c7f0a9d90ce1b`, arm64 artifact `13798543646`. The Mini’s recorded selection passed idle startup and Quit. [Private packaging run](https://github.com/rupret007/webjam/actions/runs/42888556613)
- **Apple Silicon · Replacement package** — `23cfae6ac05c128e1caf8a6fd366751686304ba6`, arm64 artifact `13846183965`. Use after confirming the package and starting it on the Mini. [Private packaging run](https://github.com/rupret007/webjam/actions/runs/42997398282)
- **Matched source walkthrough** — `e8fd00c7fe9a64290be603f21affaaaa1de8309e`, run `.venv/bin/python webjam_qt_main.py` from that checkout for the local Music and Art walkthrough.
- **Published desktop walkthrough** — WebJam `v0.29.0` at `7aa74be14446e907f1116b0da9a264667ae22937`, using the matching platform download for local desktop features. Current private native invitations require a private build. [Pinned release](https://github.com/rupret007/webjam/releases/tag/v0.29.0)

Record the selected platform, exact build ID and package SHA-256 from its receipt before rehearsing.
