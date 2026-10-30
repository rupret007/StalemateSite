# Shared Hang Out / WebJam demo checkpoint

Updated October 29, 2026. Goal active: finish the application for a private Che
demonstration and website integration. This is an application checkpoint, not
deployment approval or a claim that the live beta contains these changes.

## Current work: recover rejected music invitations

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
