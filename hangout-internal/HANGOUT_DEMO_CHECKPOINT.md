# Shared Hang Out / WebJam demo checkpoint

Updated October 30, 2026. Goal active: finish the application for a private Che
demonstration and website integration. This is an application checkpoint, not
deployment approval or a claim that the live beta contains these changes.

## Current work: correlated invitation sharing

Branch: **`codex/jam-share-order-20261030`**, based on PR168 head
`2c4a191915e02c73f95b1c0d2aca1082f6974649`. Preserve PR166/167/168 and all62
requirement outcomes. The source was left uncommitted by a capacity interruption;
the resumed application work preserves those changes and their original logs.

A real-engine browser test reproduced a second lost-paste defect on2c4: an
earlier publication can erase a newer submitted paste even when that later
share is rejected. The matched engine advertises `jamShareResults:1` and returns
caller-only request feedback after staged output. The visible editor allows one
pending Share, keeps the next paste editable, and requires a matching result.
An eight-second waiting advisory does not resend, unlock or claim rejection.
Room/authority/disconnect/Stop boundaries still purge the editor and pending
state. Correlation is not authentication, deduplication or music enrollment.
Read [the protocol/compatibility contract](HANGOUT_JAM_SHARE_FEEDBACK.md).

Current local evidence, with fresh unchanged resource guards:

- 64 focused units passed, including the strict hello-feature expectations;
  the earlier31-case pass and original30-pass/one-new-assertion failure remain.
  The resumed ordinary unit group passed 1,867 cases/112 files, then the separate
  accepted-room-capacity group passed both cases/files. Together these local
  runs cover 1,869 cases/114 files with no failures or pending cases; they are
  separate from CI. The existing capacity thresholds and setup were retained.
- 18 real-client/engine Chromium journeys passed once, with zero retries, skips,
  flakes or report errors. They include manual correction, an old-room result
  arriving during another room's request, and an actual eight-second wait with
  no automatic retry. Seven fresh375/390 images were inspected: host, guest,
  keyboard help and editable waiting status. No horizontal overflow or clipped
  input/Send was observed in those scoped cases.
- Explicit provider-start and separate fifty-guest native Worker/SQLite modes
  passed locally on Mac ARM. The latter delivered 12 publications to 50 guests
  (600 deliveries),
  with admission p95 185.387ms. Both passed intentional process-loss/cold-owner
  recovery and removed owned processes/temporary state. These use synthetic
  consent/provider callbacks and do not prove WebJam audio or hosted capacity.

The original lost-paste browser failure is retained. One browser attempt was
refused before Node at load1 16.77; guards were not relaxed. The first local
provider-start attempt failed its exact hello-feature expectation after the
new capability was added; only the expectation was extended, retaining every
previous flag/assertion, before the passing run. Do not erase those attempts.

Current-source CI and normal review remain to qualify. The explicit eighth
provider-start **CI** mode, matched protected deployment and approved actual
two-way ARM/Intel/Windows music remain owner dependencies. Linux and every
unverified acceptance outcome remain. This application change does not alter
core, workflows, installed services, shared operational files or release holds.

## Previous work: compact Jam setup

Branch: **`codex/jam-mobile-setup-20261030`**, based on PR167 head
`143b3905af12e029a645e96769cc1d04cec018a5`. PR167 remains ready with
`needs-karen`; no formal review or signed local verdict has been observed.
The preceding branches and all 62 requirement outcomes remain preserved.
Exact2c4 push41012559205/job123921483032 later passed1,858 units/114 files and
430 browser cases/430 attempts with no retries, skips, flakes or report errors.
Six CI WebKit375/390 images were inspected; the separate PR event has green
metadata only. PR168 is ready with `needs-karen`, without an observed signed
verdict. This historical result does not qualify the current changed kernel.

The Jam panel now keeps its title, headphone/delay advice, explicit Mac-host and
unsigned-Windows limits, and invitation actions together. Detailed setup uses
native closed-by-default `details`/`summary`, including the full beta-app,
private-invite, hosting, expiry and local-Stop limitations. A host without an
invitation sees the editor instead of waiting for themselves. Labels and fields
wrap; browser Join still needs an explicit click and approved server state.

Six fresh local Chromium images were directly inspected: host/guest375/390 at
844px height, plus keyboard-open help at both widths/667px height. The heading,
warnings and actions are readable in the normal view; input/Send stay visible,
inputs are at least16px, and the page does not overflow horizontally. Help keeps
native focus and scrolls its first paragraph into the panel when opened. No
page opening or capture occurs while using help.

The first15-case local run passed before the screenshot review exposed a timing
gap: transient toast feedback left only one line of opened help visible on short
screens. A default-five-second assertion passed after that feedback disappeared;
it did not prove immediate readability. The stricter one-second check failed
at both widths (visible ratios0.134/0.167), with both original failures retained.
After the panel scroll correction, all15 focused journeys passed once with
zero retries/skips/report errors or stderr. Tested frontend/fixture hashes are
recorded separately. Current-source CI and normal review are still required;
no physical Safari, full accessibility, hosted consent or music proof is claimed.

Owner-controlled application review, the explicit eighth native CI mode,
approved runnable music packages/path and matching protected deployment remain
dependencies. No core/workflow/service/shared operational or hold changes were
made. AI/TURN/vault, trust/release and age/consent/camera safeguards remain.

## Previous work: delayed invitation confirmations

Branch: **`codex/jam-confirmation-races-20261030`**, based on PR166 head
`1504f94837a68ce35844e0590cde469135c287b4`. PR166 remains open/ready with
`needs-karen`; its source is preserved. A scoped independent source comment
found no inspected blocker and identified delayed-confirmation coverage as a
gap. No formal review or signed Karen verdict was observed.

The same connected host's newer invitation edit now survives the synchronous
room redraw caused by confirming an earlier submitted value. It is never
automatically sent. Existing different-room, authority, disconnect and Stop
fences remain. Three new real-engine browser cases hold the complete host-bound
stream in FIFO order to check the newer edit, another room's pending response
and local Stop before a delayed response. Own-status HTTP in the Stop case is
synthetic; already delivered guest capabilities are not revoked by local Stop.

Initial targeted local RED and GREEN attempts were refused **before Node** by
the unchanged below-80-percent swap guard (80.82 percent at both observations).
Later fresh guards admitted actual execution: new tests on parent1504 failed
only the newer-edit assertion, while the room/Stop fence cases passed. Fixed143
passed15 local Chromium cases/15 attempts, with no retries/skips/report errors
and fresh375/390 images. Exact143 push41009684832/job123912504998 independently
passed1,858units/114files plus430browser cases/430attempts, with zero retries,
skips, flakes or report errors. All three new races passed Chromium and WebKit;
fresh CI WebKit375/390 images were inspected. The separate PR event has green
metadata only. [Current source-specific evidence](https://github.com/rupret007/StalemateSite/pull/167#issuecomment-6516077291)
does not qualify the new panel, eighth native CI mode or actual music.

The following PR166 evidence applies only to its exact source:
push41006231478 checked out `1504f94` and passed 1,858 units/114 files plus
424 unique browser cases/424 attempts, with no retries, skips, flakes or report
errors. Its 11 incident-review cases include the forced random-suffix regression.
Fresh CI WebKit host/guest375/390 screenshots were inspected. The PR event's
separate green metadata was observed, without independently decoding its report.
Pages deployment checks were skipped. None of this is music or hosted proof.

All 62 original outcomes remain unchanged. Owner-controlled review admission,
the explicit eighth native CI mode, matching protected deployment and actual
two-way ARM/Intel/Windows music remain dependencies. Linux scope and all holds
are retained. Continue using the application integration handoff; preserve newer
band-site pages and do not substitute a source asset archive for a release.

## Previous work: recover rejected music invitations

Branch: **`codex/irc-webjam-polish-20261029`**. Base:
`ec1eb14cfb2f7d068e5a01467193b70e21495dbc`, the October 29 merge of PR164
into `codex/che-demo-candidate`. Its tree equals tested PR164 head `41916eb`.
Jeff also merged PR160/161/162/163. Preserve those branches and the separate
source-specific Cursor review comments; a merge or a comment is not an
independently verified signed local Karen result.

The current application fix keeps a rejected invitation editable while the same
connected room host retains authority. A successful socket send no longer clears
the paste. Confirmed current-room state clears the matching submitted value,
including a re-share of an unchanged published link. Existing room, host-power,
disconnect, Stop and replacement fences still purge invitations. The server's
exact-origin/permission checks and opaque desktop invitation format are unchanged.

Observed local evidence, with original failures retained:

- On unchanged base client `ec1eb14`, the strengthened real-relay test failed
  because a rejected browser paste became empty. After the fix, 12 focused
  Chromium journeys passed once, without skips/retries or stderr. These cover
  rejection/correction/re-share, both website entrances, drawing, invitation
  lifecycle and unconfirmed Stop. Fresh host/guest 375/390px screenshots were
  captured. This is local browser/fixture proof, not hosted sign-in or music.
- The full local unit run passed 1,856 cases and failed one of 1,857:
  `hangout-incident-review.test.js` attempted to click an absent benign-sample
  button. Its fixture/controller sources are unchanged by this music fix.
  Original logs remain preserved; the cause is under investigation, and this
  run is not recorded as green. A later diagnostic import was refused by the
  unchanged 80-percent swap guard before starting Node.
- Follow-up source investigation found that this local-only fixture used random
  identifier suffixes as nicknames without confirming admission. An admitted
  diagnostic confirmed that `Authorb00b00`/`Visitorb00b00` are rejected by the real
  nickname filter; the original failing run did not retain its random suffix.
  The fixture now uses separate benign counter labels, keeps random opaque IDs
  and requires a real welcome frame. A deterministic regression forces that
  suffix through real report/preservation. Its initial targeted local run was
  refused before Node by the swap guard; no local pass is claimed for that new
  case until executed. Production filtering and the review controller are unchanged.
- On **base `ec1eb14`**, the explicit eighth provider-start mode passed locally
  on macOS ARM64/Node26.12.0. Both phases matched 51 recorded inputs (49 tracked
  inputs tied to this commit) and 68 compiled inputs. Final evidence storage was
  ready, authority available and all three captured-owner failure tokens matched.
  Intentional owned-process SIGKILL/cold recovery produced a fresh owner baseline,
  no old request replay, no live owned processes and removed temporary state.
  Raw stdout SHA256: `5be674c3cd19fd350bf8ec924f9d90b53305c69c7402cd25f5c030dcde7c2e0e`.
  [Full evidence](https://github.com/rupret007/StalemateSite/pull/164#issuecomment-6514936023).
  Inert callbacks/synthetic readiness remain explicit; no provider activation,
  guardian/legal, hosted or native music result is claimed. **This is not CI.**
- Earlier combined PR163 `4fd2d86` site proof passed 1,857 units/412 browser cases;
  native proof ran ten groups/seven modes. PR164 `41916eb` push proof passed
  1,857 units/424 browser cases with one attempt each. Its separate merge run
  had one preserved Chromium moderation timeout/retry. These qualify their
  actual revisions, not this new fix or an eighth CI mode.

Next: current-source CI and normal review admission through the owning session,
then a matching approved private deployment and actual ARM/Intel/Windows two-way
music. Linux and all 62 outcomes remain. The Mini's configured StalemateSite
review exclusion was handed to StoryPool 10-21-26; no protection was changed.
Native WebJam PR402 is now merged, but no newly qualified runnable music package
or deployed beta participation mode has been verified here. Keep the earlier
Intel EPERM, unsigned Windows and protected-browser-route limitations below.

## Previous assembly: one source for the receiving website session

Branch: **`codex/che-demo-candidate`**. This local application assembly merges
these inputs cleanly and updates the handoff; it does not merge GitHub PRs or
authorize deployment. Preserve the input branches and all 62 original outcomes.

| Input | Exact revision | Included work |
| --- | --- | --- |
| PR162 | `772451673574178409725994f0f5a7eea6905662` | Visible desktop/browser music invitation sharing, immediate local Stop/cached-action retirement; includes PR159 and PR161 |
| PR160 | `24c362065df13aff4f6bd243c9ee6c295bd09748` | Five-client real TCP-loss recovery probe and its scope contract |

Evidence remains attached to the revision actually exercised:

- Physical Intel MacBook, macOS15.7.9/Chrome156: source `0705d8e` passed 155
  focused units/3 files and 12 selected browser journeys. Fresh 375/390px images
  were inspected. Temporary software, processes and the exact test key were
  removed. This is browser/loopback proof, with synthetic own-status HTTP and an
  intercepted Web Join destination; it is not physical music or hosted sign-in.
- That source's full site CI passed 1,857 units and 410 browser cases; one existing
  case failed because the copy changed “using Jamulus” to “running Jamulus.”
  `7724516` restores the expected phrase without changing the assertion.
- Its native CI run 40772528981 passed ten existing proof groups/seven session
  modes at checkout `d341113ff7e08d2e40a6c33b2674e77ba3af87e4`, whose tree
  equals `0705d8e`. All 51 recorded/68 compiled inputs matched in both stages.
  This is Linux workerd/SQLite evidence. The eighth provider-start mode has not
  been observed in CI; its workflow remains the core owner's dependency.
- PR160's exact-source site CI passed 1,857 units/408 browser cases, including the
  five-client probe. Its earlier CSP fixture failure remains preserved. This
  assembly must run that probe alongside the new music handoff cases.

Music is still required and unverified. The historical Intel package `5effbc58`
passed hash/architecture/signature inspection, but macOS refused its transport
launch with EPERM; no trust override or audio run followed. Windows remains
unsigned. The browser page matches WebJam source `4263e1f9` with one private-beta
robots-meta addition. Its beta route deliberately returns 503 when participation
enforcement is enabled; an allowed browser-link origin alone does not qualify
that route. Preserve these guards, AI/TURN/vault pauses and release holds.

Next: qualify this assembly's actual CI and normal current-head Karen; supply
the exact approved source to StoryPool 10-21-26 for matched packaging/deployment;
observe both real website entrances, moderator review and the required live
music matrix. Local results and a green badge do not complete that handoff.
Use [website integration](HANGOUT_WEBSITE_INTEGRATION.md),
[browser invitation sharing](HANGOUT_BROWSER_INVITATION_HANDOFF.md) and
[required music acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md).

## Previous source composition (PR158)

Branch: `codex/webjam-demo-readiness`. The application merge commit before this
documentation update is `b713cadf0e7a570454eddbbc6f9054d93514917b`.

| Input | Exact source | Purpose |
| --- | --- | --- |
| PR155 | `6d00f342d760c4a4421bb608fc88724ca9c17b02` | Cursor's provider-start, quiet visit and truthful report acknowledgement work |
| PR157 | `a24f605626daf8f82197623ea1ed97c82e6d7dca` | Wait for the people list before reporting a lobby visitor count |
| PR147 | `023c91a0e5504b2491a12838b96073902f5c0843` | Distinguish invitation failures, service outages and confirmed logout |

Both merges completed without conflicts. The renamed internal identity document
received PR147's changes in `hangout-internal/HANGOUT_BETA_IDENTITY.md`.
This composition does not merge any GitHub PR, replace release ownership, or
qualify combined behavior. Preserve the input branches and their review history.

## Observed state and limits

GitHub metadata was read on October 28 through the installed background read
budget. PR147 remained open/draft at the source above; PR150 remained open at
`9d6297bc456d162de511ec06ade1eb6221e67a41`, with `needs-karen`. PR153, PR155 and
PR157 were also open with `needs-karen`. Listed test checks were successful;
Pages deployment checks were skipped. These metadata observations are not a
signed Karen PASS, inspection of the test contents, or hosted proof.

Cursor fixed the previously recorded native health-witness gap in `0bbc97b`:
the native observer now requires ready evidence storage, an available authority,
matching original-owner failure tokens, and a fresh owner baseline after cold
start. It also narrows the close-retirement claim. Commit `57369e4` records one
local macOS ARM64 provider-start pass in the runtime README. That is an authored
historical receipt; this resumed session has inspected the source assertions and
README but has not independently recovered the original raw run artifacts.
It does not qualify this combined revision, other native modes or music audio.

The first resumed Mini resource observation was load1 6.07, swap
5058/6144 MiB (82.32%), and 16,825,620 KiB available disk. Swap exceeds the
existing below-80% guard, so no application runtime, dependency installation or
tests were started locally. No unrelated process was terminated and no guard
was raised. Take a fresh resource observation before later execution.

## Shortest remaining demo path

| Work | Current evidence | Next required evidence |
| --- | --- | --- |
| Combined source | The three exact inputs above merge cleanly | Current combined unit/browser CI, inspected failures and results |
| Provider-start boundary | Health-witness source fixed; one documented earlier local run; production AI off | Execute the explicit mode on this revision and complete normal review |
| Both entry sites, shared chat and optional badges | Existing application/tests and demo guide | Two independent clients on matching assets/Worker; show/hide badges |
| Guest rooms and collaboration | Existing drawing and guest-journey fixtures | Create/join/draw/leave on combined source |
| Fresh join, reconnect, expiry and role isolation | Existing recovery/security fixtures | Combined tests plus actual session observations |
| Report and moderator review | Truthful queued acknowledgement; Jeff previously dismissed a synthetic report on an earlier release | Verify changed entry/recovery path and cross-entry report with release owner; reuse valid unchanged evidence |
| Mobile/accessibility | Existing 375/390px screenshot tests | Inspect fresh images, keyboard/reflow/reduced-motion behavior; distinguish emulation from physical iPhone |
| Native WebJam music | Website invitation flow exists | Qualify actual native installation and audio separately per platform and network |
| Private deployed demo | Source and historical hosted work only | Owner identifies approved matching deployed revision/address and observes demo |

The full [62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) retain their
original IDs/outcomes. This table is a work checklist, not a substitute for their
completion audit. Public all-ages/legal readiness, capacity, third-site
integration and all advertised platforms remain requirements even when a smaller
private demonstration succeeds. Avoid adding unrelated features before the
working visitor journey is verified.

## Execution and ownership

Start with the existing focused unit tests for beta entry, discovery, session
authority and participation. Then run the existing browser journeys for shared
entry, guest rooms, reporting/recovery and accessibility, including 375/390px
screenshots. Read actual results and inspect images; do not transfer input-PR
passes to this composition. The [demo guide](HANGOUT_DEMO_GUIDE.md) describes
the visitor and moderator journey and distinguishes loopback role fixtures from
real hosted sign-in. Preserve real failures and current resource guards.

The explicit additional native command is:

```sh
npm run --silent test:lobby-session-runtime -- --participation --provider-start
```

The existing durable-runtime workflow does not invoke this mode. A concrete
request was sent to **StoryPool 10-21-26** on October 28 to coordinate the extra
step using the capture pattern in `tests/runtime/lobby-session-authority/README.md`.
Delivery of the request is not acknowledgment, implementation or CI proof.
Do not hide the mode in another mode, remove old checks or increase job limits.
That session owns workflows, Karen/core, deployments and shared operational
files. This session continues application work independently.

Keep AI inactive, TURN/vault work paused, current age/camera/consent guards and
unsigned-build boundaries intact. No public launch or paid service is implied.
Use normal current-head Karen review after relevant checks. Publish an exact
source/evidence handoff to the deployment owner; verify matching hosted behavior
before saying Che can use the live experience.
