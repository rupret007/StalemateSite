# Website and games polish — October 21, 2026

Authorized scope: implement, test, merge, publish, and independently verify both
public hosts. Keep Daily Dump removed. Preserve seven games, saves, records,
controls, reduced motion, optional music, and root/project-path hosting.

## Baseline and implementation

Workspace: `/Users/jeffstory/Documents/ChatGPT/Stalemate Website`.
Both clean checkouts use `codex/site-game-polish`, based on current remote mains:
Turdanoid `98e6fd8a5bd9984811e45f87acf101f46c8d8c5f`; StalemateSite
`f39341748c2841514e17404f733dcbf1d6709e38`. No applicable AGENTS.md found.
Original checkouts and earlier release branches remain untouched.

- Homepage: evergreen source metadata/no-JavaScript content; one countdown update
  controls dated promotions, header and repeat actions. Keep the existing cutoff
  `2026-10-24T16:45:00-05:00`; do not imply an actual set end time.
- Turdtris: one primary Play honoring selected mode, optional help, genuine resume,
  and a separate accessible hub shortcut to existing Ultra 2:00.
- Phones: complete, accessible records with mode/difficulty context; unobtrusive
  Turdomania first-success hint without covering tiles or reducing controls.
- Music: actual shared-player state/title and confirmed song destinations; retain
  the single engine, preferences and gesture/visibility behavior.
- Contact/bio: use existing verified band facts. Owner supplied
  `stalemate.punk@gmail.com`; account correspondence and contacts corroborated
  the exact address. Delivery has not been tested. No approved photo supplied.

## Acceptance and evidence

Pending: before/at/after cutoff + refresh/back-forward/no-JS/metadata checks;
selected-mode and Ultra-link behavior; full visible/readable phone records;
first-success hint, Undo/New/difficulty/denied storage; actual music track advance,
mute/replay/navigation/hidden-tab behavior; no overlapping controls or page errors.
Run existing required source Node 22 and site Node 24 gates. Preserve failures.
Inspect actual desktop and emulated phone/short/orientation captures.

Reusable changes belong upstream; regenerate `/play/` using the existing sync
script, pin the exact upstream SHA, and verify repeated imports byte-for-byte.
Create reviewable PRs; merge upstream first after checks, then site. Follow Pages
deployment and verify both `https://stalemate.band/` and
`https://rupret007.github.io/StalemateSite/` in fresh browser contexts.

Current status: implementation complete; final gates and publication pending.
Source PR #92 uses `codex/site-game-polish`; final source revision is
`fd35ce12175c4cbd23c0aa8ebc2cfebe97a57847`. Source is merged first only after its
required lint/unit/96 mobile/browser-smoke CI passes. The final site import must
pin this exact SHA, repeat byte-for-byte, then pass the full site gate and package.

Completed evidence: source full local suite 1,865 tests before final guards,
190 focused checks, 96 mobile cases and browser smoke; later directed checks
cover all four Crapjack opening outcomes and actual Max betting. The final local site gate passed 105 unit tests and all 119 browser cases across
all five projects, with zero retries. Packaging passed and repeating the exact
source import produced 160 byte-identical files. Earlier checks also passed the
first 15 new browser cases.
Actual integrated desktop/WebKit-phone screenshots cover every game, orientation,
complete records, the mode picker, track display and homepage before/after cutoff.
Phone checks are emulated. No physical-device or mail-delivery test is claimed.

Failures are retained in the parent evidence folder. The initial music footer
reduced puzzle tiles/covered landscape controls; the existing 32px tile and 44px
control assertions were preserved while layouts were corrected. Screenshot review
then caught a board edge/hint overlap, prompting stronger geometry checks. The
first source CI exposed a real post-blackjack chip overlap; optional Bet Tools
moved into Table Menu with all actions retained. A new test initially targeted an
intentionally hidden duplicate chip shortcut; it now verifies the visible Max
bet action, including exact bankroll behavior. Missing browser-global declarations
were corrected after lint rejected that test. Local site import tests hit their
unchanged five-second limit when browser captures ran concurrently; an isolated
full unit run passed 104/104. A full browser run then exposed a missing allowlist entry for the newly verified
email, and delayed real-time ticks in the new exact-cutoff test. The allowlist now
accepts only that exact mailto address. Boundary tests install the browser clock
before loading and advance its actual timer exactly through the cutoff, keeping
all before/at/refresh assertions. No test assertions/time limits were relaxed.
Tab focus/visibility also refreshes stale promotions immediately. The upstream smoke update targets the primary menu summary after Bet Tools
became nested; all gameplay assertions are retained.

The first remote c818 runs completed green but needed two/three retries. Their
logs showed an immediate Undo touch during the first hint's toolbar reflow, and
one video visibility measurement missing its unchanged 40px requirement by 1px.
The hint now disappears without moving the board or Undo during that visit, with
a regression asserting stable control coordinates. Phone show-card padding now
provides more above-fold video space; touch preparation waits for actual fonts.
All affected cases passed 42 repeated local checks with unchanged assertions.
The previous failure-only artifact upload omitted images from successful runs
with retries; raw first-failure logs are preserved, and CI now always retains
Playwright reports/results so those traces survive future retries.

The social card was an image of an XML error, and its SVG contained a legacy
encoding byte and dated labels. The UTF-8 evergreen SVG now renders a valid
1200×630 PNG; both the actual image and homepage metadata were inspected.

Next: qualify final source/site commits, create the site PR, merge source then
site after required checks, and verify both independently refreshed public hosts.
Evidence directory: `release-evidence/site-game-polish/` at the workspace root.
Missing input: a genuine approved band photo (file or approved original URL).
