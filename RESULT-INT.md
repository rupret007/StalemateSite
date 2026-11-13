# RESULT-INT: Bridge slice 1 integration and review fixes

**Status: done, local only.** The harness merge is finished and runs against the real grants module. All four review FAIL findings on `be1c46a` are fixed, and each has tests that fail on `be1c46a`. Nothing was pushed, deployed or merged upstream. The never-edit files are untouched (`git diff be1c46a --name-only` lists none of them).

- Branch: `grok/bridge-slice1-int-20261112`, worktree `int`.
- Verification run: Thu Nov 12 2026, about 22:17 to 22:21 CT. Node v26.12.0. The merge and the four fixes were already committed (`462e1c6` through `d7dfad3`) before this pass.

## Commits (after `be1c46a`)

| SHA | What |
|---|---|
| `462e1c6` | Merge `origin/grok/bridge-slice1-e2e-20261112`. RESULT.md keeps both branch results as sections. The adapter wraps the real module and the real `GameNightChess`; the spec's stand-in cases now use them. |
| `90e5c49` | Findings 1–3 in `game-night-room-grants.mjs`, plus 6 new module tests. The test port honours holder/until; the storage double honours `limit`, `startAfter` and key order. |
| `543a365` | Chess bench adapter: table-side holds and paged storage, matching the module test port. |
| `d7dfad3` | Finding 4: BRIDGE-HOOKS.md hook 1 made consistent. The proposal is applied to a test-only copy of the table class and tested there. |

The three module fixes share one commit, because they all change `redeemGrant` and the same test port. The hunks were not split without interactive staging.

## Commands and counts

`npx vitest run tests/unit/bridge-* hangout-worker/tests/game-night-room-grants.test.js`

Repeated after the `be1c46a` comparison below, with the module file restored to `HEAD`:

- "Test Files  3 passed (3)", "Tests  41 passed (41)".
- Start at 22:21:15, duration 1.13s.
- That is 27 module tests, 9 bridge-adapter tests and 5 hook 1 proposal tests.

The same module test file with the `be1c46a` module copied in, then restored (the working tree matches `HEAD` again, and the 41-test run above is the one after the restore):

- "Test Files  1 failed (1)", "Tests  15 failed | 12 passed (27)".
- All 6 new tests fail: the surplus-guest case, both hold-lifetime cases, and the three past-the-first-page cases. The other 9 failures are earlier success paths. Against that module the first redeem returns 409 table-full and the hold list stays empty, so the guest is never seated.

`npx playwright test -c playwright.bridge.config.js` (local preview only, `reuseExistingServer: false`)

- "4 skipped", "7 passed (35.2s)".
- The 7 passed are the 4 in-process grant cases plus the 3 local-preview profile tests. The 4 skipped are the live-route cases, still `test.fixme`.
- The preview started on the first attempt. Workerd printed TLS `CertificateUnknown` lines during the profile tests. Those lines are not failures: pages load with `ignoreHTTPSErrors`, and the three profile tests passed.
- Phone engine: WebKit (`BRIDGE_PHONE_ENGINE webkit`).

## The four fixme e2e cases

| Case | Real module + real Chess table, in-process | Through a Worker route on the preview |
|---|---|---|
| Reused grant returns 410 | **runs, passes** ("reused grant returns the existing 410 expired shape") | still `test.fixme` ("live route: reused grant returns 410") |
| Host session cannot redeem | **runs, passes** ("a host session cannot claim a guest grant") | still `test.fixme` ("live route: a host session cannot redeem a grant") |
| Expiry leaves the table waiting | **runs, passes** ("an expired hold leaves the host table waiting") | still `test.fixme` ("live route: an expired grant leaves the host table waiting") |
| Third person sees "Table full, you're up next game" | **runs, passes** ("the extra person gets the table-full line after the guest sits") | still `test.fixme` ("live route: the extra person sees the table-full line") |

So all 4 cases now run against the real code instead of the stand-in. The 4 live-route versions are still skipped, because no Worker route serves grants (hook 2 is in `beta-entry.mjs` and `lobby-do.mjs`, and the first of those is a never-edit file). They were not pointed at an in-process path to make them pass.

## Phone Join tap to seated Chess

390×844 WebKit phone profile. The clock starts at the guest **Join game** tap and stops when the phone status contains Black and "White to move" and the board has 32 pieces. Raw ms from this run (`BRIDGE_TIMING 1272,1254,1647`):

| Run | ms |
|---|---|
| 1 | 1272 |
| 2 | 1254 |
| 3 | 1647 |

The preview was built at the start of the same Playwright process, before the host-page test, so none of these three joins is a cold server start. Run 3 was the slowest. RESULT.md records 860 / 476 / 458 from the earlier harness run. This flow is the existing stranger-invite Join, not a grant redeem, because no grant route exists yet. The host-page test asserts that no grant path was requested. Screenshots are written outside the repo, to `../shots/`, and the saver refuses a frame whose visible text contains a code. This run refreshed `bridge-slice1-phone-seated.png`, `bridge-slice1-host-seated.png` and `bridge-slice1-overflow.png`. The phone frame shows Black, "White to move", and a full board.

## Fixes

1. **Surplus guest gets 410 after the granted guest sits.** `redeemGrant` checks standby before the waiting test. A standby value gets 409 `{ tableFull: true, message: "Table full, you're up next game" }` while the same host's table exists, waiting or playing, and 410 once it is gone. Tested on a real two-seat `createGameNightTable` that is not reset between the seat and the surplus tap: "gives a surplus guest table-full, not expired, after the granted guest sits at a real two-seat table".
2. **Hold released before `seat` tries to move it.** `registerGrants` places the hold on the table (`table.hold`, new port function); if the table refuses, the hash becomes standby. `seat` moves the hold from the grant hash to the guest session. The burn happens after `seat` answers. A definite no (null, or the host seat) burns, releases both possible holders and returns 409. A throw leaves the grant and the hold untouched. Tests: "places the hold at register and moves it to the guest in seat, without releasing it first" and "leaves the grant and its hold alone when seat throws, and burns on a definite no".
3. **Burned grant re-registered past the 400-row cap.** Register checks each hash with `storage.get`, so a live grant, standby marker or tombstone keeps it out. `rows()` pages through `list` with `limit: 400` and `startAfter`, so sweep, revokeAll, `holds` and the 32-per-room cap see every row. Tests (450 filler rows that sort first): "keeps a burned hash from being registered again past the first page", "applies the room cap to rows past the first page", "sweeps and revokes rows past the first page".
4. **BRIDGE-HOOKS.md hook 1.** Holds are cleared in `start`, `requestRematch` and the auto-start inside `join`, so `restore` keeps refusing a match with holds. Each hold is `{ holder, seat, until }` with a real side chosen at `holdSeat`, so `moveHold` returns `b`, `c`, `d`… and never `'next'`. `join` with a matching holder takes exactly that seat; other joins skip held seats. The port mapping, threat table and limits are updated to match. `tests/unit/bridge-hook1-proposal.test.js` runs the patch on `tests/unit/bridge-hook1-table.mjs`, a test-only copy of the table with the patch applied. It checks seat names at four seats, Chess blocking and expiry, restore after auto-start and after `start`, and that every added line of the doc's diff appears in that copy.

## Remaining gaps

- **Hook 1 and hook 2 are not landed.** Both touch never-edit files (`game-night-table.mjs`, `beta-entry.mjs`), so the 4 live-route cases stay `test.fixme`. Until hook 1 lands, a stranger link or a Play tap can still take a held seat in production; the grant holder then gets 409.
- **The hook 1 copy can drift.** `bridge-hook1-table.mjs` is a copy of the table at `4f35bc3`. If the real table changes before hook 1 lands, re-copy it and re-apply the patch.
- **Crash window.** `burn` is written after `seat` returns. If `seat` succeeds and the Durable Object dies before that write, the grant row is still live. A replay then calls `seat` with a hold that has already moved, gets null, burns and returns 409. It cannot seat a second person, but that guest sees "table full" rather than 410. A throw from `seat` does not burn.
- **Tombstone lifetime.** A burned row keeps the grant's own `until` (2 minutes from register). Sweep deletes it after that, and a host who re-sends the same hash can register it again. Making tombstones last longer would mean changing the room cap to ignore burned rows. That was not done here.
- **Rematch.** Standby is "table full" only while the same host's table is present for that match id. A two-seat rematch swaps seats and changes the match id, so a standby value for the old match gets 410, not "table full", after a rematch.
- **Timing measures the stranger-invite Join**, not a grant redeem. A grant-redeem timing needs hook 2 and the guest page.
- The open questions in RESULT.md (409 vs 410 for table full, invite version, value format agreed with the WebJam side, `ref`) are unchanged.
- The full `npx vitest run` suite was not run this round. Nothing outside the bridge tests imports the module.

## Limits respected

- Local commits only, added by explicit path. No push, PR or deploy.
- `node_modules`, `PROMPT.md` and `PROMPT-R2.md` are untracked and were not added.
- Test values are generated at run time or are obvious placeholders. Grant values are not logged and not in screenshots. Tests contain no `/Users/` or `/home/` paths.
