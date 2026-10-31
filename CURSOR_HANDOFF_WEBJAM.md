# WebJam / Hang Out — Cursor continuation

Current application checkpoint: October 31, 2026. Start with the
[demo checkpoint](hangout-internal/HANGOUT_DEMO_CHECKPOINT.md) and the receipts
linked below. Older dated sections retain their original evidence and limits;
their pending-CI and StoryPool-admission statements are historical.

## Start here

**Latest native source: `bb40fac`, qualified application CI.** Read the
[current native readiness checkpoint](hangout-internal/HANGOUT_NATIVE_READINESS_20261031.md).
PR #409 includes the existing Windows work and merged launcher/accessibility fix;
its full module loop passed 12,760 cases across all 553 tracked modules, with 60
skips. Actual Windows CI passed eight ACL/API cases and four sharing controls.
Its matching package dispatch was resource-refused before CLI execution; read
the dated checkpoint and actual branch runs before starting one. The latest
completed packages still use83d2950. Physical music and fixed-package macOS AX
are unqualified. Native PR #401 is merged; #403–405 are closed as superseded, with
their source/failures retained. No StoryPool application gate was used.

**October31: the ARM app's normal Join was exercised.** Read the
[native accessibility observation](hangout-internal/HANGOUT_NATIVE_ACCESSIBILITY_20261031.md)
for the actual screenshot and macOS accessibility snapshot. Source83 correctly
refused a malformed invitation before opening a workspace. Its accessibility
tree omitted the visible recovery explanation; application PR408 merged as
`a62f01f` after all550 test modules ran once (12,626 passed,60 skipped).
A new package's native accessibility behavior still needs observation.
The test app is closed and saved settings metadata is unchanged. This was not
a music/capture test. Windows PR409 subsequently merged as`bb40fac`; its full CI
and actual Windows diagnostic are qualified in the newer checkpoint above.
Its167 portable cases remain separately recorded. Portable, native CI and
physical music evidence remain separate.

**Matching native test packages are built.** Read
[the current package receipt](hangout-internal/HANGOUT_NATIVE_CANDIDATE_20261031.md).
Source83d2950 produced successful ARM Mac, Intel Mac, Windows and Linux artifacts;
signing/public-release jobs were skipped. The ARM download, signature, embedded
source and production transport lifecycle are verified. Earlier GUI resource
refusals remain in the evidence; admission later succeeded. Physical music
remains unqualified. The website remains
on96/runtime629 during the real eight-hour observer; do not redeploy it yet.

**October30 evening: the private demo has now been upgraded.** Read
[the current release and test receipt](hangout-internal/HANGOUT_PRIVATE_DEMO_20261030.md)
before older checkpoint statements. PR170 merged application source
`96f356a6f2a9af4bbd2834bb94f1e5df81d200dd`; the protected beta now runs
`6293386f-31b8-4415-bf0b-f81296190a4d`. Both merged-head CI workflows passed.
The source-identical PR head has fully decoded website and eleven-group native
proof, including the actual eighth provider-start mode. Hosted ordinary guests
exchanged chat across both entry badges, created/discovered a room and passed
375/390 layout checks. After honoring the real creation allowance, protected
Jam creation/invitation, outsider denial, exact invitation delivery and two-way
drawing also passed in hosted Chromium/WebKit at375/390. Music and the full demo
remain incomplete. Four
native packages built successfully. ARM transport executed and shut down
cleanly. Real Chromium/WebKit reload and copied-cookie revocation now also pass.
The native GUI test's string was accepted as a valid legacy hostname; its
invalid-input assumption was corrected. PR407's incomplete dialog/factory guard
merged as`83d2950` after all550 tracked modules ran once:12,622 passed and60
skipped. Matching four-target private packaging completed in run41168394794;
the package receipt records the bounded ARM checks and remaining device work. Do not call
these package/transport checks two-way audio, or reactivate paused providers.
One benign report has an actual server acknowledgement; only Jeff's disposition
remains. A new real eight-hour observer started at04:08UTC on October31, with
natural expiry due12:08:30UTC. It is running, not a pass. Keep this private beta's
source/assets/settings/keys unchanged until its owned journal is terminal; read
the current receipt for the exact evidence paths and remaining requirements.
PR166 is merged; PR167–169 are closed as superseded with branches/evidence kept.

**October30 ownership clarification:** Jeff directed this application work to
proceed here independently of StoryPool. Application code, project CI, tests,
documentation and application PRs are handled in this workstream. Do not route
them through StoryPool/Karen or wait for its admission. Existing GitHub checks
and protections still apply. Shared StoryPool core/services/configuration,
installed checkouts, locks and operational files remain outside this task;
security, provider and release holds remain unchanged. Earlier StoryPool
application handoffs below are historical, not current prerequisites.

The preceding work is **`codex/webjam-native-ci-20261030`**, based on PR169 head
`43457849374bfa00e68fcf3f224954e3f3832026`. This repository's workflow now invokes
the eighth provider-start session mode as an explicit eleventh proof group,
retaining the previous ten groups, timeout, diagnostics and failure propagation.
Its actual new CI results are now qualified in the receipt above. Earlier local
passes remain separate evidence. No installed/shared StoryPool files changed.

The preceding **`codex/jam-share-order-20261030`** is based on PR168 head
`2c4a191915e02c73f95b1c0d2aca1082f6974649`. It fixes another reproduced
lost-paste race when a newer Share is submitted before an older confirmation.
The matched client/engine now allow one pending visible Share, keep the next
paste editable, and correlate publication/rejection without automatic retry.
Read the [protocol and rollback contract](hangout-internal/HANGOUT_JAM_SHARE_FEEDBACK.md)
and current checkpoint. Local proof includes 64 focused unit cases, 18 browser
journeys and separate provider-start/fifty-guest native Worker runs. These are
not current-head CI, deployed, native WebJam audio or approval evidence.
The resumed local ordinary and separate capacity unit projects also passed
1,869 cases/114 files in total, with no failures or pending cases.

The preceding **`codex/jam-mobile-setup-20261030`** is based on PR167 head
`143b3905af12e029a645e96769cc1d04cec018a5`. The Jam panel now puts its title,
platform limits and actions ahead of native expandable setup help. Read the
checkpoint for the retained short-screen readability failure. Its exact2c4
push41012559205 passed1,858 units and430 browser cases once; fresh CI WebKit
images were inspected. PR168 is preserved ready with `needs-karen`, without an
observed signed current-head verdict. That proof does not qualify this changed
engine/client. All62 outcomes remain intact.

The preceding **`codex/jam-confirmation-races-20261030`** is based on PR166
head `1504f94837a68ce35844e0590cde469135c287b4`. It preserves a same-host newer
edit when a delayed publication redraw arrives and adds ordered-response cases
for a room switch and local Stop. Later local proof reproduced the parent
failure and passed 15 fixed-client journeys. Exact143 CI passed 1,858 units and
430 browser cases, each once. PR166/167 remain preserved and await their normal
owner-controlled review route; those results do not qualify the new panel.

The preceding **`codex/irc-webjam-polish-20261029`** is based on merged demo
commit `ec1eb14cfb2f7d068e5a01467193b70e21495dbc`. Its tree equals PR164's
tested `41916eb`; Jeff merged PR163/164 on October 29. The new work retains
rejected music invitations until confirmed room state, with 12 focused local
Chromium journeys passing and fresh 375/390px images. See the current checkpoint
for source hashes, the separately observed local eighth-mode proof and remaining
CI/review/music gates. This branch is not deployment approval.

The preceding application assembly is **`codex/che-demo-candidate`**. It combines
PR162's visible browser-invitation/Stop fixes with PR160's bounded reconnect
probe, inheriting PR159's access-request recovery and PR161's required music
acceptance. Read the checkpoint's current-assembly section for exact input
revisions and evidence limits. Combined CI, current-head Karen, matching
deployment and actual music remain to qualify.

The earlier **`codex/webjam-demo-readiness`** / PR158 assembly combines PR155,
PR157 and PR147. It remains in this candidate's history. Preserve all separate
source branches; do not select an older branch solely because its checks passed.

The original handoff used **`codex/lobby-provider-start-fence`**. Its WIP was
saved in `38b8d88b068133a727d8044d120f51bdfc6b4e5a`; subsequent commits add this
handoff. Preserve existing work and inspect `git status` before switching or
pulling. No reset, force-push, push to main, deployment or service restart is
authorized by this note.

The complete product scope is preserved in
[all 62 acceptance requirements](hangout-internal/HANGOUT_ACCEPTANCE_REQUIREMENTS.md).
Keep those IDs and outcomes intact. This checkpoint does not reduce the project
to the current P9 safety slice or claim the other requirements are complete.

## Product and ownership

**October 28 clarification: live WebJam music is required for the finished
demo.** Verify two-way audio involving the Apple-silicon Mac mini, Intel/x86
MacBook Pro and Windows PC. Browser chat, drawing and invitation copying are
partial evidence. Follow the [music demo acceptance](hangout-internal/HANGOUT_MUSIC_DEMO_ACCEPTANCE.md)
and preserve Linux and all other original requirements. A desktop or browser
music path is an implementation choice; music itself is not an optional project
deliverable. Individual visitors still choose whether to enable audio.

Build **one shared community** entered through Stalemate, Rad Dad and future
sites. Both band sites open one community address; visitors share people,
channels, rooms, identity and moderation. Entry badges say “via Stalemate” or
“via Rad Dad,” can be hidden, and grant no identity or permissions. Direct or
unknown entry is neutral. A basic Join link needs no credential; richer site
integration uses verified domains, exact origins, scoped permissions and
revocation. Federation is outside scope.

Keep the EFnet experience: guest nicknames, anyone hosting permitted rooms,
channels/commands/presence, chat starting when someone joins, and scrollback
only for the connected session. Make the quiet lobby welcoming and creative
rooms easy to discover. Preserve keyboard/focus, screen-reader, zoom/reflow,
reduced-motion and mobile behavior. Input/Send stay visible at 375/390px; iOS
inputs remain at least 16px. Camera and microphone use stays opt-in.

Jeff and bandmates will operate personally in Texas, without an existing
organization. Jeff alone is the initial owner/moderator/report reviewer;
bandmates do not automatically receive staff access. The objective is all-ages
participation with appropriate features and required parental-consent paths.
**Retain existing beta13+/camera18+ guards until a qualified replacement exists.**
Minimize data; no default ID/biometrics, PM scanning or media recording.
Moderation assists human review; legal readiness requires qualified review,
not a compliance claim. AI remains off.

This workstream owns application source, design, project CI, tests, documentation
and application PRs independently of StoryPool. Shared StoryPool core, services,
installed checkouts, configuration and operational files remain outside scope.
Do not edit its locks, maintenance/release holds, `MONITOR.md` or `NEEDS_JEFF.md`.
TURN/vault work remains paused. Do not inspect/unlock credentials, activate
providers, buy signing services or change platform trust. Windows builds remain
unsigned; Mac/Windows/Linux audio and installation must be qualified honestly.

## Tested baseline: PR150

[PR150](https://github.com/rupret007/StalemateSite/pull/150) is the parent of
this branch. Exact head: `9d6297bc456d162de511ec06ade1eb6221e67a41`.

- Both retained SITE runs passed **1,801 units/114 files and406 browser cases**,
  with zero failures, flakes, retries or skips. Exact run40500569764;
  merge run40500572853 checked out `f8705f9bf8ef6220f00f1c80cdc62b865f603a2f`.
- Both native runs40500569909/40500572862 passed ten functional groups and seven
  fresh session modes, with51 recorded/68 compiled inputs verified. This is
  local Worker/SQLite proof, not native music/audio, hosted capacity or WAN proof.
- The PR was made ready and the normal `needs-karen` request was accepted.
  Last observation still showed the same green head and `needs-karen`.
  **No signed Karen PASS, merge or deployment has been verified here.**
- Directly inspected local375/390px images showed wrapped text and visible
  input/Send. This does not establish physical iPhone/Safari or deployed behavior.

That baseline fixes selected-person actions across nickname reuse, identity-only
Block/Ban, confirmed preferences, exact stored-rule Unban, durable target/room
checks, permanent-lobby nonce restoration after wake, and historical ban labels.
Read [the person-action contract](hangout-internal/HANGOUT_PERSON_ACTIONS.md). New strict
stored fields require matched browser/core/reader/writer rollout, socket/writer
drain and compatible-state rollback. Do not reset state or assume code-only
downgrade is safe. Preserve historical failures and warnings; quiet later native
runs do not clear the earlier184-byte ACK TimeoutNegativeWarning, whose impact
is still unqualified.

## Historical pause checkpoint: inactive provider-start fence (P9)

**At the October 27 pause, the new work had not run.** Fresh local guards stopped before Node/tests at
82.49% and86.85% swap, against the unchanged below80% limit. No baseline RED or
new-source runtime PASS was claimed at that pause. The current checkpoint records
the later source-bound local mode run; parent results do not transfer by intent.

The implementation is in:

- `hangout-worker/src/lobby-do.mjs`: original composition owner, one-use request
  identity, actual socket/live-binding/failure-token checks, owner event gate,
  contained errors and a nonthenable response box.
- `hangout-worker/src/lobby-session-authority.mjs`:
  `validateParticipationStart` uses the existing initialized/configured real
  codec transaction and exposes readonly `get`/`list`. Native poison must finish
  propagating before start; ordinary denial is normalized inside validation.
- `hangout-worker/src/lobby-participation.mjs`: optional private dispatcher
  composition; `providerQualified` remains false.
- `hangout-worker/src/participation-enforcement.mjs`: immutable primitive
  `aiPublicReview` intent and actor derived from the prepared slot. Ordinary
  chat or another purpose cannot substitute for provider qualification.

The original owner pins engine, authority and opaque storage-failure token.
A delayed old request must never adopt a new engine. A socket beginning closure
must fail even while durable retirement is queued. Exact-true validation must
finish its native transaction before one synchronous start under the same owner
gate. Await the response outside the gate, so Stop/logout/chat can progress.
This is application invocation ordering, not physical delivery, recall or
crash-level exactly-once dispatch.

**Every production activation stopper remains:** `providerQualified:false`,
`session-start-fence-not-qualified`, and the existing authority-mode moderator
and provider-callback exclusions. No key/provider has been configured or called.
Quota/result composition, guardian/child-data/provider/legal readiness remain
separate requirements. Read [the fence contract](hangout-internal/HANGOUT_PROVIDER_START_FENCE.md).

## Tests and the unfinished native review

`tests/unit/hangout-lobby-session-authority.test.js` adds38 cases, preserving the
old86-case file prefix byte-for-byte: **124 expected file cases**, not observed
passes. The full suite would be1839 cases if no other changes intervene.
Independent source review found no unit-oracle blocker. Tests use real SQLite,
real admitted DO/socket IDs, and actual authority/participation paths. Their
FIFO owner queue is explicitly a unit double, not native scheduling proof.

Coverage includes real Stop/revoke, expiry/profile/role/policy changes, readonly
validation, false/nonboolean denial, native poison including an error named
`participation-denied`, old owners, closing sockets, request mutation, callback
replay/rejection, ordinary-purpose refusal and healthy work while a response is
held. Clock expiry cases can cover both session and consent expiry; do not
claim that they isolate every expiry guard.

The three files under `tests/runtime/lobby-session-authority/` add a separate
**`--participation --provider-start`** mode. It uses four signed fixture guests,
the real Worker/authority/dispatcher and inert zero-network callbacks. It is
intended to prove transaction-before-start, held-response Stop/chat, prior
logout, callback-initiated close, reuse refusal and process-loss cleanup.
The original seven journeys/limits remain; the new mode does not use the
retention diagnostic facade that replaces authority identity.

Native source review was interrupted for this pause. Finish these points before
calling that proof qualified:

1. Add a bounded final health witness to provider state. `storageFailed()` can
   degrade `evidenceStorage` without setting `authorityUnavailable`. Require
   ready evidence storage, no unavailable authority, and the captured original
   owner's failure token still matching the current token after scenarios.
   Establish a fresh appropriate owner baseline in the cold phase. The current
   `privacy()` check of `authorityUnavailable:false` alone is insufficient.
2. Keep retirement claims narrow: the close promise is awaited after dispatch;
   current event assertions do not establish the exact semantic retirement-start
   point relative to gate exit. Strengthen the witness if claiming more.
3. Execute the new mode. Source review, a FIFO unit double or compiling it in
   another mode cannot establish its native result.

## Historical October27 resume sequence

The sequence below is preserved as earlier evidence. For current application
ownership and the eleventh CI group, follow Start here and the current checkpoint.

1. Read this note, the62 requirements and relevant linked source contracts.
   Revalidate branch/PR/release state. Preserve other work and original evidence.
2. Finish the native review above without changing guards, limits, assertions,
   deadlines or production-off behavior.
3. Before any application runtime on the Mini, require a fresh resource check:
   load1<10, swap used<80%, available disk>=15GiB. Do not kill unrelated processes
   or raise a guard to obtain a pass. Respect other hosts' existing admission.
4. With locked dependencies and adequate resources, start with:

   ```sh
   npx vitest run --project unit --maxWorkers=1 --no-file-parallelism tests/unit/hangout-lobby-session-authority.test.js tests/unit/hangout-participation-enforcement.test.js tests/unit/hangout-participation-partitions.test.js
   npm run --silent test:lobby-session-runtime -- --participation --provider-start
   ```

   Preserve actual failures. Fix source/test defects rather than weakening
   negative oracles. The native fixture supports macOS ARM64 and Linux x64 GNU
   libc; that is not Windows or Intel Mac audio qualification.
5. Coordinate the CI step below with its owner, then inspect actual current-head
   exact/merge runs. Existing workflow execution covers only7 modes/10 groups;
   green results from it cannot qualify the additional mode.
6. Create/update a draft PR stacked onPR150, attach current evidence and obtain
   normal exact-head Karen review. Any push invalidates an older signed pass.
   No extra human approval layer was requested, but preserve existing holds and
   release ownership. Do not merge/deploy on a historical or different-head pass.
7. Continue the complete shared-community goal, including actual composed entry
   journeys, accessibility, capacity/recovery, legal/guardian readiness and honest
   platform qualification. A passing P9 slice is not project completion.

## Historical CI-owner handoff — now implemented in application CI

At that earlier checkpoint, `.github/workflows/durable-record-runtime.yml`
was unchanged, SHA256
`5b8cb2382b4e324a0e65635c4e7b819d2702c0e99c979f4c34f9bdd0418b51c1`.
The proposed capture pattern below is now the explicit application CI step.
Its actual current execution must still be qualified:

```yaml
- name: Prove native permission ordering for moderation start
  shell: bash
  run: |
    set +e
    npm run --silent test:lobby-session-runtime -- --participation --provider-start > runtime-proof-artifacts/lobby-provider-start-runtime.stdout.log 2> runtime-proof-artifacts/lobby-provider-start-runtime.stderr.log
    status=$?
    set -e
    cat runtime-proof-artifacts/lobby-provider-start-runtime.stdout.log
    cat runtime-proof-artifacts/lobby-provider-start-runtime.stderr.log >&2
    printf '%s\n' "$status" > runtime-proof-artifacts/lobby-provider-start-runtime.exit-code.txt
    exit "$status"
```

The existing artifact upload covers these files. Do not increase the existing
ten-minute job limit, remove old steps or hide the new mode inside an old one.
Only after actual execution can the complete count become8 fresh modes/11 groups.

## Separate entry integration and useful reading

The portal work remains separate in
[PR147](https://github.com/rupret007/StalemateSite/pull/147), last source
`023c91a0e5504b2491a12838b96073902f5c0843`. Its three paths are
`hangout-internal/HANGOUT_BETA_IDENTITY.md`, `hangout-worker/src/beta-entry.mjs` and
`tests/unit/hangout-beta-entry-context.test.js`. Revalidate before composing;
the mechanical9d+portal tree was reconstructed, but combined runtime was not
qualified. Do not overwrite newer entry code or infer deployment from a merge.

Read [product direction](hangout-internal/HANGOUT_PRODUCT_DIRECTION.md),
[shared community](hangout-internal/HANGOUT_SHARED_COMMUNITY.md),
[website integration](hangout-internal/HANGOUT_WEBSITE_INTEGRATION.md),
[identity](hangout-internal/HANGOUT_BETA_IDENTITY.md),
[production participation](hangout-internal/HANGOUT_PRODUCTION_PARTICIPATION.md),
[safeguards](hangout-internal/HANGOUT_SAFEGUARDS_AI.md) and the relevant beta/incident docs.
Older handoffs retain their historical source/count scope.

Private local evidence, if available, is under
`.local/webjam-product-finish/shared-community-20261025/`; it is intentionally
not a required GitHub dependency for this note. The P9 checkpoint is under
`usability-reliability-delivery/current-readiness-polish-first/p9-provider-start-fence-first/paused-20261027-first/`.
No raw vault values, credentials or private operational state belongs in this
repository handoff. No deployed behavior, signed verdict or public launch is
established by the saved branch.
