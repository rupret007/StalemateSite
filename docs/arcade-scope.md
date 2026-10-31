Adopt the following as the ongoing goal for this session. Continue through implementation, testing, and preparation of a reviewable release candidate. Maintain a persistent progress record so another session can resume without repeating the investigation.

GOAL

Turn Stalemate’s existing browser arcade into a polished destination that gives visitors a reason to return regularly, while introducing them naturally to the band’s music.

Deliver a coherent first release containing:
1. Reconciled existing game improvements and a reliable integration into StalemateSite.
2. Consistent Stalemate Arcade presentation and usable mobile layouts.
3. Faster first-time gameplay.
4. A daily Turdomania challenge called “The Daily Dump.”
5. Useful result sharing.
6. An arcade homepage that serves returning players.

Success means these capabilities work together in a tested candidate. Do not claim improved retention before collecting actual usage data.

Use your existing session context, repository instructions, and current source as authoritative. This handoff records observations from a separate review on October 21, 2026. Recheck anything that may have changed.

1. TAKE OVER THE CORRECT PROJECTS

Repositories:
- StalemateSite: https://github.com/rupret007/StalemateSite
- Turdanoid: https://github.com/rupret007/Turdanoid

Public surfaces reviewed:
- https://rupret007.github.io/StalemateSite/
- https://rupret007.github.io/StalemateSite/play/
- https://rupret007.github.io/StalemateSite/play/TurdAnoid.html
- https://rupret007.github.io/StalemateSite/play/turdomania.html

A local StalemateSite checkout was created in the reviewing ChatGPT session at:

/workspace/scratch/8f73929c2de9/StalemateSite

Its origin is:
https://github.com/rupret007/StalemateSite.git

Its verified HEAD:
bfbd8dd8190925330e874d402197bec4450e5e8e

The checkout was clean when this handoff was prepared. It was a shallow clone. No code changes, commits, PRs, merges, or deployments were made by the reviewing session. No dependency installation or automated test suite was run there.

That path belongs to a separate session’s temporary workspace. It may not exist in your environment. Do not assume it is a Mac path or that files transfer automatically between sessions.

First locate the existing StalemateSite and Turdanoid checkouts available to this session. Inspect their instructions, branches, remotes, worktrees, and uncommitted changes. Preserve existing work. Do not create competing implementations before checking what is already underway.

No local Turdanoid checkout was created by the reviewing session. Its source and PRs were inspected through GitHub.

2. UNDERSTAND THE INTEGRATION AND VERSION GAP

StalemateSite contains an imported copy of Turdanoid under `/play/`.

At review time:
- StalemateSite main was bfbd8dd8190925330e874d402197bec4450e5e8e.
- StalemateSite’s `play/VENDORED.txt` identified the imported Turdanoid revision as d87b967.
- Turdanoid main was 76b7bc8e8f017f2b68062636e764b91a4ed924b5.
- Turdanoid main included a shared Stalemate playlist in `assets/suite-music.js`.
- StalemateSite used an older Turdanoid-specific overlay that switched songs by level.

Check the current revisions and determine precisely what has changed since those observations.

The integration script is `scripts/sync-turdanoid.sh`. In the reviewed version, it:
- Clones a named Turdanoid branch/tag, defaulting to main.
- Replaces the destination `/play/` directory.
- Copies game pages, assets, and game modules.
- Removes upstream game tests from the imported copy.
- Adds site content-security policies and noindex metadata.
- Applies Stalemate branding, music/score overlays, and analytics.
- Writes `play/VENDORED.txt`.

Direct edits only to generated `/play/` files can disappear during a later sync.

Implement reusable gameplay changes in Turdanoid. Implement Stalemate-specific integration in the relevant StalemateSite source scripts. Update the synchronization process where necessary and verify that regenerating the imported games preserves the intended result.

The script’s existing branch/tag interface is not the same as an arbitrary commit-SHA interface. Inspect it before attempting to pin imports. Record the exact resolved upstream revision in the release evidence.

3. LOCAL FILE MAP

All paths in this section are relative to the StalemateSite checkout root. In the reviewing session that root was:

/workspace/scratch/8f73929c2de9/StalemateSite

Website:
- `index.html`: homepage and arcade entry section.
- `styles.css`: main site presentation.
- `script.js`: homepage behavior.
- `site-base.js`: project-path handling.
- `countdown.js` and `show-state.js`: show-date behavior.
- `README.md`: project overview; verify against source because some descriptions are stale.
- `assets/games/turdanoid.webp` and `assets/games/turdomania.webp`: homepage game imagery.
- `assets/mark.svg`: existing site mark.
- `pr-assets/`: historical screenshots; do not present these as new candidate evidence.

Import and Stalemate integration:
- `scripts/sync-turdanoid.sh`: imports and transforms the games.
- `scripts/stalemate-overlay/stalemate-overlay.js`: source music, checkerboard-brick, and score-sharing integration.
- `scripts/stalemate-overlay/stalemate-overlay.css`: source overlay styles.
- `scripts/stalemate-overlay/og-play.png`: existing social-preview image.
- `scripts/stalemate-strip.css`: hub branding strip.
- `scripts/play-track.js`: source game analytics integration.
- `play/VENDORED.txt`: imported upstream revision.
- `play/stalemate/`: generated copies of the overlay, audio, social image, and analytics.
- `play/stalemate-strip.css`: generated hub strip stylesheet.

Existing source audio files under `scripts/stalemate-overlay/`:
- `manic.m4a`
- `andrea.m4a`
- `only-been-18.m4a`
- `wham-bam.m4a`
- `planet-of-the-flakes.m4a`

Arcade pages:
- `play/index.html`: arcade hub.
- `play/hub.html`: legacy hub redirect.
- `play/TurdAnoid.html`: Turdanoid, including substantial inline gameplay/UI code.
- `play/turdomania.html`: puzzle page, sizing, controls, and gameplay wiring.
- `play/turdtris.html`
- `play/turdjack.html`: displayed as Crapjack 21.
- `play/crapeights.html`
- `play/turdrummy.html`
- `play/turdspades.html`
- `play/neon-arkanoid.html`: legacy game outside the main seven-game lineup.

Shared arcade code:
- `play/assets/turdsuite.js`
- `play/assets/turdsuite.css`
- `play/assets/suite-hub-stats.js`: reads existing local records for hub badges.
- `play/assets/suite-hub-attract.js`
- `play/assets/suite-back-pill.js`
- `play/assets/suite-a11y.js`
- `play/assets/suite-touch.js`
- `play/assets/suite-audio.js`
- `play/games/table-continue-core.js`
- `play/games/table-continue.js`

Key gameplay modules:
- `play/games/turdomania-core.js`: seeded board generation and puzzle rules.
- `play/games/turdtris-modes.js`: Classic, Sprint 40L, and Ultra 2:00.
- `play/games/turdanoid-worlds-core.js`: five-world, 30-level structure.
- `play/games/turdanoid-levels-core.js`
- `play/games/turdanoid-coach-core.js`
- `play/games/turdanoid-storage-core.js`
- `play/games/turdanoid-boss-core.js`
- `play/games/turdanoid-sprites-core.js`
- `play/games/turdanoid-brick-sprite-core.js`
- `play/games/turdanoid-fx-core.js`
- `play/games/turdanoid-layout-core.js`
- `play/games/suite-feel.js`

Many modules have corresponding wrapper files without `-core`. Inspect the actual script loading before deciding which files to change.

In the Turdanoid repository, these imported game and asset paths generally appear without the `play/` prefix. Confirm their current locations.

Packaging and testing:
- `package.json` and `package-lock.json`
- `scripts/package-pages.cjs`
- `scripts/serve-test.cjs`
- `scripts/lib/e2e-test-server.cjs`
- `scripts/capture-screenshots.cjs`
- `playwright.config.js`
- `vitest.config.js`
- `.github/workflows/ci.yml`
- `tests/e2e/play.spec.js`
- `tests/e2e/phones.spec.js`
- `tests/e2e/homepage.spec.js`
- `tests/e2e/links.spec.js`
- `tests/e2e/analytics.spec.js`
- `tests/e2e/public-contrast.spec.js`
- `tests/e2e/assert-test-origin.setup.js`
- `tests/unit/play-vendored.test.js`
- `tests/unit/package-pages.test.js`
- `tests/unit/public-surface-security.test.js`
- `tests/unit/content-boundaries.test.js`
- `tests/unit/track.test.js`

Analytics:
- `js/count.js`
- `js/track.js`
- `js/site-track.js`
- `scripts/play-track.js`

The reviewed configuration uses the Stalemate GoatCounter account and fixed event names rather than names, scores, or arbitrary free text.

4. RECONCILE EXISTING PR WORK

These Turdanoid PRs were open during the review:

#75 — Shared Stalemate Arcade visual kit and faster onboarding:
https://github.com/rupret007/Turdanoid/pull/75
Observed branch: feat/stalemate-arcade-kit

#89 — Every game fits one mobile screen:
https://github.com/rupret007/Turdanoid/pull/89
Observed branch: codex/mobile-no-scroll

#87 — Mobile control-overlap corrections:
https://github.com/rupret007/Turdanoid/pull/87

#88 — Small-screen color-accessibility toggle positioning:
https://github.com/rupret007/Turdanoid/pull/88

PR #75 described a shared `assets/arcade.css`, self-hosted fonts, mobile controls, and replacing Turdanoid’s blocking coach with a small contextual hint. Its description said visual approval was pending.

PR #89 described viewport fitting across the suite. Its reported tests were not independently rerun in the reviewing session.

Also inspect relevant held bug-fix PRs, including #78, #73, #71, #70, and #69, before changing overlapping behavior. Do not treat their titles as proof a bug remains or their descriptions as proof it is fixed.

Determine which work should be reused, updated, or superseded. Avoid blindly stacking overlapping CSS patches.

StalemateSite also had separate collaboration/watch-room work in open PRs. Keep that outside this arcade release unless a real dependency requires it.

5. FIRST RELEASE REQUIREMENTS

Presentation and usability:
- Brand the destination as Stalemate Arcade.
- Retain individual game names and identities.
- Build on the existing visual kit where suitable.
- Use consistent menus, buttons, typography, pause screens, and results.
- Keep Stalemate’s checkerboard signature and playful punk personality.
- Favor a ’90s melodic-punk feel and cartoon bathroom humor.
- Preserve readable gameplay, reduced motion, keyboard access, and useful color-independent cues.

Turdomania’s reviewed graphics rely heavily on emoji. Evaluate original, expressive tile artwork with consistent silhouettes and styling. Inspect any generated assets at actual gameplay sizes.

For Turdanoid, prioritize ball visibility, recognizable power-ups, readable brick damage, and satisfying but brief impact/combo effects.

First-time play should have a clear primary action and short contextual guidance. Aim to reach meaningful gameplay in roughly ten seconds. Keep detailed help optional.

Mobile layouts must accommodate short screens, orientation changes, browser chrome, safe areas, readable cards, and usable controls. Avoid achieving “no scroll” by hiding essential content.

Preserve working records and supported saved sessions.

Music:
- Reconcile the newer shared player with the Stalemate overlay.
- Prevent duplicate audio and competing mute controls.
- Preserve user preferences and browser gesture requirements.
- Verify behavior on pause, hidden tabs, game transitions, and replay.
- Keep music enjoyable and optional.
- Do not publish incorrect song titles.

6. DAILY DUMP REQUIREMENTS

Build a daily Turdomania puzzle using its existing deterministic-board foundation.

The challenge identity must include:
- Challenge date.
- Rules/generator version.
- Fixed board dimensions and difficulty.
- Deterministic seed.

Everyone must receive the same logical board for the same challenge, regardless of screen size.

Important existing behavior: the reviewed `turdomania.html` changes board dimensions based on viewport fitting. Using the same seed alone is insufficient. Standardize daily rules and adapt rendering instead.

Use America/Chicago for the displayed daily reset, including daylight-saving transitions. Do not interrupt an active run at midnight. Keep its original challenge identity until completion.

Provide:
- Clear challenge date and rules.
- Local resume after refresh.
- A recorded first completed daily result.
- Clearly distinguished practice/replay.
- A deliberate, visible undo policy.
- A useful result screen.
- Sharing with the correct challenge link.
- An invitation to free play after finishing.
- A clear indication of when the next puzzle arrives.

Keep free-play modes and records separate.

Handle denied storage, corrupt/stale saves, and version changes gracefully. Explain device-local persistence honestly. A static client-side daily mode is not a server-verified competition; do not claim otherwise.

7. RETURNING-PLAYER HOME AND SHARING

Extend the existing hub behavior rather than replacing it unnecessarily.

Prioritize:
- Today’s challenge.
- Continue for games that genuinely support saved sessions.
- Daily result or relevant personal best.
- Easy access to every game.

Do not display invented activity, fake band scores, empty achievements, or unavailable functionality.

Extend result sharing from the existing Turdanoid implementation to Daily Dump first.

Include:
- Game and challenge identity.
- Result.
- Readable Stalemate branding.
- Working destination link.
- Share image when supported.
- Text/copy fallback.
- Graceful cancellation and errors.

Validate incoming challenge parameters. Use the verified canonical deployment configuration. Existing references to `stalemate.band` must be checked against the actual production domain; do not blindly preserve or replace them.

Do not automatically post to social accounts.

8. KEEP LATER WORK VISIBLE WITHOUT EXPANDING THIS RELEASE

Record a prioritized backlog for:
- Beat the Band weekly challenges using actual Jeff, Che, and Sean scores.
- Earned cosmetics and cross-game achievements.
- A short Turdanoid score-attack mode.
- Better exposure of existing Turdtris timed/sprint modes.
- Home-screen installation and selective offline support.
- Public leaderboards with credible validation and abuse handling.
- Search discovery and whether the current noindex policy should change.

These are follow-on items. Do not turn the first release into an unlimited redesign or build placeholder UI for them.

9. VALIDATION AND DEPLOYMENT DETAILS

The reviewed StalemateSite package exposes:
- `npm ci`
- `npm run test:install-browsers`
- `npm run test:unit`
- `npm run test:e2e`
- `npm test`
- `npm run package:pages`

Its reviewed CI uses Node 24. Turdanoid’s README referred to Node 22; inspect each repository’s actual current CI before selecting runtimes.

StalemateSite’s test server defaults to port 4320, supports `STALEMATE_TEST_PORT`, and serves a project-prefix route for `/StalemateSite/`.

The reviewed Playwright configuration includes desktop Chromium and emulated iPhone/Android projects using Chromium and WebKit. New test filenames must actually match the intended projects; do not assume every test runs in all phone configurations.

The reviewed deployment workflow publishes `dist/` after successful checks on pushes to main. A main-branch update can therefore trigger publication.

Packaging explicitly lists selected root assets while copying the `play`, `qr`, and `tap` directories. Verify that any newly introduced root assets are included.

Required evidence:
- Same daily board across screen sizes.
- Date rollover and daylight-saving behavior.
- Refresh/resume and storage-failure handling.
- Separation of daily and free-play results.
- Existing save compatibility.
- Audio and mute behavior.
- Mobile layout/control usability.
- Sharing fallbacks and valid links.
- Root and project-subpath support.
- Repeatable upstream synchronization.
- No new errors in exercised flows.
- Rendered screenshots of the actual candidate.

Use meaningful tests and existing required gates. Preserve failed-run evidence and distinguish first-pass results from retries. Do not relax tests merely to obtain green results.

Label emulated-phone checks accurately. The reviewing session performed only desktop visual/interaction spot-checks and source review; it did not establish physical-phone acceptance or a full gameplay test pass.

10. PROGRESS RECORD AND DEFINITION OF DONE

Create or update the project’s existing handoff/progress record. If none exists, use a clearly named repository document such as `docs/arcade-goal.md`, marked as newly created rather than a pre-existing file.

Track:
- Goal and scope.
- Actual repository paths.
- Branches and exact commit revisions.
- Imported upstream revision.
- Milestone status.
- Decisions and rationale.
- PR dependencies and overlap resolutions.
- Commands and validation outcomes.
- Screenshot locations.
- Known limitations.
- Deployment status.
- The next executable step.

Checkpoint after substantial milestones and before handing off. Keep the record concise enough to use.

The goal is complete when:
- All first-release capabilities are implemented coherently.
- The existing suite and saves remain functional.
- Upstream and Stalemate integration are reproducible.
- Required checks pass, with remaining limitations explicitly disclosed.
- Actual candidate screenshots have been inspected.
- Changes are available as reviewable commits/PRs.
- The progress record supports another session taking over.
- Any remaining approval or deployment step is clearly identified.

Do not mark the goal complete merely because a plan, code, screenshot, or passing unit suite exists.

Proceed autonomously through ordinary implementation choices. Honor prior authorization and repository review requirements. Do not invent new approval gates. Unless this session already explicitly authorizes merging and deployment, finish with a ready-to-review candidate rather than updating main.

Start by reporting the actual current checkout/branch state and the smallest integration plan, then execute it through the definition of done.