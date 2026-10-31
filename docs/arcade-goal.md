# Stalemate Arcade release record

New record created October 21, 2026. Full authorized scope: [arcade-scope.md](arcade-scope.md).

## Current goal: website and game polish

The user activated a new goal to implement, test, merge, publish and verify homepage
rollover, clearer Turdtris modes, complete phone records/first-pop guidance, actual
music-track display, and verified band contact/bio. Daily Dump stays removed.
Current implementation, validation, missing photo input and next steps are recorded
in [site-game-polish.md](site-game-polish.md). Earlier release/removal sections below
are historical. The root ARCADE-RELEASE-HANDOFF.md tracks publication receipts.

## Historical scope change: remove The Daily Dump

On October 21, 2026, the user requested removing The Daily Dump and publishing that
removal under the existing deployment authorization. This replaces the daily-challenge
requirements in the historical scope; `arcade-scope.md` remains unchanged as that history.
The first release was published from site merge `983644c560c8a4f4d48a7c14d3ea2d678d0c8665`
and source merge `1c612ff746e9827db6c00313753854aaf17db627`, and was verified on Pages
and `https://stalemate.band/` before this request.

Removal work uses `codex/remove-daily-dump` in the same isolated checkouts. The site
starts at `983644c`; upstream starts at `1c612ff`. Preserve all seven games, ordinary
Turdomania, the visual/mobile improvements, shared optional music, and Turdanoid result
sharing. Former daily links must open ordinary Turdomania. Existing free-play preferences
and records remain supported; removing a feature does not require deleting device-local data.

- Site source: replace the homepage challenge promotion with an arcade primary action,
  retain the seven direct game links, and remove daily-specific analytics.
- Upstream source: remove challenge rules/UI/assets and hub promotion while retaining
  ordinary Turdomania controls, artwork, records, and the shared arcade presentation.
  Removal revision: `bf35c83ec2d18a4df3ded7c258db5e133cd36592` (imported exactly).
- Browser regressions now cover root/project paths, former daily URLs, playable free play
  and undo, completed-game record compatibility, and denied storage across all five projects.
- The exact committed removal was imported twice: all 160 generated files were byte-identical.
  Site full unit checks passed 103/103 and packaging passed; all 20 changed browser cases
  passed across the five projects, with no retries. The full upstream CI runs on PR #91.
  Integrated desktop/phone screenshots were inspected. A 375×667 score-row wrap was found
  during review, fixed upstream, and verified independently in Chromium and WebKit; all
  three stats now remain above the board. Eight focused source browser cases pass.
  The final integrated 13-check smoke passes with no page errors, including actual phone
  pop/undo and unchanged saved scores. WebKit external SVG faces settle after row moves;
  captures wait for actual painted symbol bounds rather than capturing an intermediate frame.

Site source checks with Node 24.22.0: four targeted unit files / 22 tests passed; all three
changed browser files passed syntax checks. The post-import browser results are recorded above.
The first source check rejected new copy containing a word prohibited by the existing content
boundary test; the copy was corrected and the assertion retained. Successful raw output is
`/private/tmp/stalemate-arcade-evidence/remove-daily-source-unit.log`.

Next executable step: finish the required remote site/upstream gates,
then publish and verify the removal on both Pages and the band domain. The domain served the first release after a later host refresh; verify its
actual content rather than assuming both hosts update together.

## Historical first-release investigation

The sections below retain the initial candidate investigation and its pre-publication
checkpoint. The scope change above is the current instruction.

## Outcome and release boundary
First-release candidate implements Stalemate Arcade presentation, mobile/onboarding improvements,
Daily Dump, result sharing, returning-player hub and shared optional music. No retention gains
are claimed. No main merge or public deployment has been performed. Review/merge remains the
next external step after validation below; physical-phone acceptance is still unverified.

## Checkouts and exact source
Candidate root: `/Users/jeffstory/Documents/ChatGPT/Stalemate Website`.
- `StalemateSite/`, branch `codex/arcade-release`, base `bfbd8dd8190925330e874d402197bec4450e5e8e`.
- `Turdanoid/`, branch `codex/arcade-release`, final upstream `5160ba6a0520fca5ba4a0ed9ec739eea3f19539e`, base `76b7bc8e8f017f2b68062636e764b91a4ed924b5`.
- Both remote mains were rechecked and matched those bases. Site's old import was `d87b967`.
- `play/VENDORED.txt` records the full upstream revision above. Source changes belong upstream;
  site transforms belong in `scripts/`, and generated `play/` changes must come from sync.
- Original site beta checkout at `/Users/jeffstory/Documents/Codex/2026-10-18/not-sure-which-project-or-folder/StalemateSite`
  had modified `NEEDS_JEFF.md` and untracked `MONITOR.md`; untouched. Older site mobile clone had
  staged deletions; untouched. Original common `/Users/jeffstory/Turdanoid` checkout also untouched.
- No applicable AGENTS.md or existing arcade goal record was found. Candidate clones use independent Git metadata.

## Milestones
- [x] Preserve existing work, audit current mains/PRs and resolve overlaps.
- [x] Implement coherent reusable game changes, mobile kit, onboarding and Daily Dump upstream.
- [x] Implement portable site sync, single shared music owner and robust sharing.
- [x] Integrate returning-player hub and homepage Daily entry.
- [x] Inspect actual integrated candidate screenshots for every game, daily/result and hub.
- [x] Required local gates, repeatable import, packaging and independent visual checks pass.
- [x] Published review branches and draft PRs; remote checks are tracked on the PRs.

## Decisions and compatibility
- Daily v1 pins Chicago date, rules/generator versions, normal difficulty, 8x10, four kinds and
  deterministic seed. Rendering adapts; logical daily dimensions never follow viewport fitting.
- A dated URL freezes the active challenge through midnight and refresh. DST reset tests cover
  23/25-hour days. Invalid/future/versioned links receive visible guidance.
- First daily run has no undo/restart; first completed result persists. Clearly labeled practice
  supports undo and never replaces that result. Per-date replay saves plus a bounded 30-date
  discovery index retain older runs; older stored runs remain reachable through dated links.
- Replay validation rejects altered identities, impossible moves, corrupt/old saves and supplied
  score/board fields. Denied/quota storage stays playable with honest device-local guidance.
- Free-play records and supported existing table sessions retain their original namespaces.
  Continue appears only for actual supported sessions; no invented scores or empty achievements.
- Local OFL fonts, checkerboard details and original silhouette-based SVG puzzle tiles extend
  the existing kit. Turdanoid's visible ball, power-up labels, damage pips/cracks and brief impact
  effects were retained; site checkerboard is a narrow edge so it does not obscure damage cues.
- Shared playlist owns audio, music preference/index and gesture gating. Explicit game pause
  leaves music playing; hidden tabs pause it. Replay retains one player and its track position.
  Correct title: “It’s Only Been 18.” Legacy overlay creates no audio. Effects and music remain optional.
- Native result sharing includes branding, result/date/rules and valid challenge link, with PNG
  where supported, text/copy/manual fallback, and graceful cancellation. No automatic posting.
- Pages API verified `cname:null`, `html_url:https://rupret007.github.io/StalemateSite/`.
  Both Pages and `https://stalemate.band/`/its game path returned HTTP 200 without redirect.
  Result links preserve actual origin/project path; OG image uses verified Pages URL.
- Fixed-name analytics distinguish daily start/completion/share attempts from practice; no date,
  score, arbitrary text or player identity enters event names. Share clicks are attempts, not proof of posting.

## PR reconciliation
All nine reviewed PRs were open/unmerged on October 21. No existing PR was closed or merged.
| PR | Reviewed head | Resolution |
|---|---|---|
| #75 | 285e9e5a8be142db95e62d909ff6e70eb06cf92d | Merge visual kit/fonts/nonblocking hints into candidate. |
| #89 | fd744aef85c9fb49564c07d7f2c3f82b2611c383 | Merge mobile foundation; extend required regressions. |
| #87 | daae3b4c2d5c0f21f2e060a29c12b2e0c040b480 | Supersede competing DOM mount/offsets with #89 ownership. |
| #88 | d805fde1f84bb7a988d76be924b3efbc8fbde090 | Supersede offsets; #89 already handles modal focus. |
| #78 | cf98b67a2527e511b17cdb0951fd54a571a7b024 | Reuse compact Boss Flush relaunch/life-grace fix and tests. |
| #73 | 5bd1324d18aa308e6b1d90960992b2f30b66bd88 | Reuse Fire expiration fix and meaningful regression cases. |
| #71 | 840438683f2a5e9fbfc4e7589f177aff4ee7a221 | Include safe storage-property access and denied-storage browser checks. |
| #70 | dc824540e5200deda820467e98ef68794897225c | Include generation-guarded pop cancellation and actual restart regression. |
| #69 | b9738b6b03d57dc1c6636c18019af341d830dbf8 | Include accurate Crapjack phone-menu help copy. |
Unrelated collaboration/watch-room branches are outside this release.

## Repeatable import and packaging
Run from the site with a committed upstream checkout:
```sh
bash scripts/sync-turdanoid.sh --source '../Turdanoid' 5160ba6a0520fca5ba4a0ed9ec739eea3f19539e
npm run package:pages
```
Remote SHA/branch/tag imports remain supported. The Node-backed script is portable to macOS,
transforms staging before replacement, preserves the previous import on failure, and ignores
uncommitted source edits. Two final imports yielded 164 identical files; manifest digest and
provenance are in `pr-assets/arcade-release/sync-evidence.json`. Packaging passed and copies
play/assets while excluding internal docs/evidence from public output.

## Validation and evidence
Runtime: upstream Node22.22.3; site Node24.22.0. Locked `npm ci` completed for both. Matching
Chromium1228 used from `/private/tmp/stalemate-playwright` upstream; site Chromium1248/WebKit2370
used its normal cache. Upstream CI uses Node22, site CI Node24.
- Site full unit gate on the final repin: 104/104 passed with `--maxWorkers=2`; packaging passed.
  After the touchscreen-driver fix, all 20 Daily browser cases passed across all five projects,
  zero retries, retaining result/share/storage assertions and checking each actual move.
- Final integrated full browser gate: 98/98 passed directly across Chromium, three emulated
  WebKit iPhones and emulated Chromium Android; zero retries. Earlier complete run also passed 98/98.
- Upstream full local gate at `4dc8730`:137 files /1883 tests passed, zero skips/errors, two workers.
  Full browser smoke passed; both mobile matrices passed 96/96 including added status/menu checks.
  Lint passed with one existing warning. Followups `123adb4`/`5160ba6` add visible next-arrival results and deterministic opening-hand setup;7 Daily browser and59 related music/modal checks pass.
- Daily core17/17; focused Daily/browser/layout28/28; actual native PNG/text/cancel/manual-copy,
  denied-storage getter, refresh/resume, rollover, stale-pop, keyboard and control hit tests pass.
- Candidate captures: `pr-assets/arcade-release/{hub-desktop,hub-phone,daily-phone,daily-landscape,
  daily-result-phone,turdanoid-phone,turdtris-phone,turdjack-phone,crapeights-phone,turdrummy-phone,
  turdspades-phone}.png`; `capture.json` records source and zero exercised page errors.
- Screenshots inspected at gameplay sizes; independent review also inspected the 1200x630 PNG
  result image, small-screen stats, invalid-link guidance and landscape result controls.

First failures are retained separately, not replaced by retry results. Initial upstream run hit
sandbox bind errors and missing browser1228; initial site concurrent runs timed out under load.
Actual failures exposed stale title/test harness imports, hub content/record clipping, sub-32px
free-play tiles, Aim overlap and a random Rummy round ending before a test could act. Product
layouts and harness setup were corrected without weakening behavior assertions; Rummy uses a
deterministic shuffled fixture. A native-share test stub needed writable property setup and
music tests needed to initialize the lazy shared player. Enlarged-text clipping checks retain
actual viewport/clipping behavior instead of treating normal font ink beyond line boxes as hidden.
Raw local logs: `/private/tmp/stalemate-arcade-evidence`; persisted release logs/artifacts are
under `pr-assets/arcade-release/validation/` and `failed-site-first/`.

## Known limits and next step
No physical-phone or real native share-sheet acceptance is claimed. Local scores are not
server-verified or cross-device; storage can be cleared. No retention study has been collected.
Upstream locked dependency audit reported four existing advisories; lockfile unchanged. Lint
retains one existing unused-variable warning and zero errors. This release does not add offline,
public leaderboards, new achievements or verified band scores.
Upstream draft review: https://github.com/rupret007/Turdanoid/pull/90 (exact `5160ba6`).
Site draft review: https://github.com/rupret007/StalemateSite/pull/70.
Initial site product/evidence revision:`4987120588be15955f93a6ac159689d0dd494738`; final followups are recorded by PR head. The imported upstream revision above is authoritative.
Both branches are pushed. Upstream final CI [39612388898](https://github.com/rupret007/Turdanoid/actions/runs/39612388898)
passed at `5160ba6`: lint, 137 unit files (1882 passed/one existing local-fixture skip),
96 mobile cases and browser smoke. Site final CI is visible on its PR; do not infer acceptance
from draft status or local results. First upstream CI (39610502854) failed a test waiting for an
active Crapjack hand after an immediate natural blackjack. Deterministic natural/insurance/
even-money/live-hand coverage fixes the setup without raising timeouts or changing layout assertions.
First site head9702ba0 PR/push CI (39611152493/39611145068) passed104 units and95 browser cases;
all3 WebKit Daily-completion cases exceeded total time under slow mouse input and failed their
automatic retry too. Trace showed visible unobstructed targets and cumulative click latency.
The phone driver now uses actual touchscreen taps, checks hit targets and exact move increments.
Raw first CI logs and later results are retained in validation/; all six first-CI failure
screenshots/contexts are in failed-site-ci-first/. Linux upstream CI lacks one
historical on-device captured-save fixture; its existing optional compatibility case passed locally.
Next executable step: inspect the PR checks and ordinary reviewer feedback, then review upstream
#90 before site #70. Preserve the exact imported upstream commit through merge. Main updates
would trigger Pages publication; neither merge nor deployment is authorized by this candidate.

## Prioritized follow-on backlog
1. Beat the Band weekly challenge using actual Jeff/Che/Sean scores.
2. Short Turdanoid score attack and better exposure of existing Turdtris timed/sprint modes.
3. Earned cosmetics and cross-game achievements.
4. Home-screen installation/selective offline support.
5. Credibly validated public leaderboards and abuse handling.
6. Search discovery and noindex-policy review.
