# WebJam / Hang Out — Cursor continuation

Resumed October 29, 2026. The October 27 pause checkpoint is retained below
as history. Read the current [demo checkpoint](hangout-internal/HANGOUT_DEMO_CHECKPOINT.md)
first: Cursor has since fixed the native health witness, recorded a local
provider-start run, and moved internal documents from `docs/` to
`hangout-internal/`. The original P9 runtime and unfinished-review statements
below describe the earlier checkpoint, not the current source.

## Start here

Current work is **`codex/jam-mobile-setup-20261030`**, based on PR167 head
`143b3905af12e029a645e96769cc1d04cec018a5`. The Jam panel now puts its title,
platform limits and actions ahead of native expandable setup help. Read the
current checkpoint for the retained short-screen readability failure, local
15-case proof and current CI/review status. All 62 outcomes remain intact.

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

This application workstream owns source, design, tests, documentation and PRs.
**“StoryPool 10-21-26” owns StoryPool core, Karen, CI infrastructure, deployments
and shared operational files.** Hand off those dependencies. Do not edit its
services, locks, maintenance/release holds, `MONITOR.md` or `NEEDS_JEFF.md` here.
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

## Resume sequence

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

## CI-owner dependency — proposed, not applied

`.github/workflows/durable-record-runtime.yml` is unchanged, SHA256
`5b8cb2382b4e324a0e65635c4e7b819d2702c0e99c979f4c34f9bdd0418b51c1`.
Its owner can review an additional step following the existing capture pattern:

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
