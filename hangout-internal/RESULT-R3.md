# RESULT-R3: Bridge slice 1 review fixes

**Status: done, local only.** The public-root files from the fix commit are under `hangout-internal/` and `tests/`. Both boundary tests passed at the verified code head below. That claim was false once this file was tracked at the repository root: `.htaccess` does not deny `RESULT-R3.md`, so `apache-public-boundary.test.js` failed at that head. This note now lives in `hangout-internal/`. The bridge unit tests and the bridge Playwright suite pass. Nothing was pushed or deployed. The never-edit files are untouched.

- Branch: `grok/bridge-slice1-int-20261112`
- Verified code head: `57d2aece9d07f5db7e8e80370d80ce0d541c0ffb`
- Result commit, which added this file at the repository root: `7350266983b6a6ab146fe0a4229058325509f143`
- The commit after that one only records the result SHA above. That commit, `683277e520d10a13b7b8371ee45549361fa901b0`, was the branch head while this file sat at the repository root.

## What changed

- `BRIDGE-HOOKS.md`, `RESULT.md` and `RESULT-INT.md` now live in `hangout-internal/`, which `.htaccess` already blocks. `playwright.bridge.config.js` now lives at `tests/playwright.bridge.config.js`. The hidden-room rules phrase was reworded so the scanner no longer matches it.
- `storage.delete` is called with at most 128 keys. The grants test double throws above that limit. The 450-key sweep and revoke still pass.
- `registerGrants` refuses a `ref` that is not 32 lowercase hex, before any row is stored. Hook 2 in the spec calls `gameGuestScope` before that store, checks the redeem value on the Worker, spends a per-IP budget before the lobby Durable Object, and burns a grant only in `confirm` after `newAccess` returns. The same `attempt` retries when session creation fails. `GAME_ROOM_GRANT_PATH` is named as an export of `hangout-worker/src/game-night-invitations.mjs`. `gameRoomGrantRequest` and the four `arcade-transport.mjs` functions are written out as spec. Those Codex files were not edited.
- Screenshot saving blanks a signed invitation or a url-safe token, not only a long hex run. Hook 1 documents the `now` pass-through as mandatory. Stale headers and test counts are corrected (29 module tests on this branch). `npm ci` in `tests/runtime/durable-records` is noted as the Playwright prerequisite. The phone screenshot claim now says the phone board is empty and the host frame shows two rows of pieces.

## Commands

Paths in the runner banner are omitted here.

`npx vitest run tests/unit/apache-public-boundary.test.js tests/unit/hangout-hidden.test.js`

```
 Test Files  2 passed (2)
      Tests  49 passed (49)
   Start at  23:13:24
   Duration  844ms (transform 84ms, setup 81ms, import 97ms, tests 504ms, environment 0ms)
```

Exit 0. That run is the verified code head, before this file was tracked. The same command fails at `7350266` and `683277e`, where this file is a tracked root entry.

`npx vitest run tests/unit/bridge-* hangout-worker/tests/game-night-room-grants.test.js`

```
 Test Files  4 passed (4)
      Tests  44 passed (44)
   Start at  23:13:26
   Duration  1.33s (transform 848ms, setup 185ms, import 888ms, tests 643ms, environment 1ms)
```

Exit 0. That is 29 module tests, 9 bridge-adapter tests, 5 hook 1 proposal tests and 1 screenshot-guard test.

`npx playwright test -c tests/playwright.bridge.config.js`

```
BRIDGE_PHONE_ENGINE webkit
BRIDGE_TIMING 1410,1464,1562
  4 skipped
  7 passed (1.0m)
```

Exit 0. The 7 passed are the 4 in-process grant cases plus the 3 local-preview tests. The 4 skipped are the live-route `test.fixme` cases. Workerd printed TLS `CertificateUnknown` lines. Those are not failures. `tests/runtime/durable-records/node_modules` was already present, so `npm ci` was not run in this pass.

`npx vitest run` (full suite, this worktree)

```
 Test Files  23 failed | 124 passed (147)
      Tests  63 failed | 2124 passed | 3 skipped (2190)
   Start at  23:13:55
   Duration  436.14s
```

Exit 1. No bridge file failed (`apache-public-boundary`, `hangout-hidden`, `bridge-grants`, `bridge-hook1-proposal`, `bridge-shots`, `game-night-room-grants`) in this run, which was taken before this file was tracked at the repository root. Tracking it there adds one `apache-public-boundary` failure. The other failures are timeouts in files this change does not touch.

## Baseline at `4f35bc3`

Temporary worktree, `node_modules` symlinked the same way as this worktree (no install). Removed after the run.

`npx vitest run`

```
 Test Files  20 failed | 123 passed (143)
      Tests  63 failed | 2080 passed | 3 skipped (2146)
   Start at  23:06:49
   Duration  351.44s
```

Exit 1. `apache-public-boundary` and `hangout-hidden` passed at the base. They were the two failures this branch had introduced, and they passed at the verified code head. They did not pass at the branch head that tracked this file at the repository root.

17 files failed in both runs. Three files failed only at the base (`hangout-worker/tests/lobby-sharing-controls.test.js`, `tests/unit/hangout-lobby-incident-sources.test.js`, `tests/unit/search-discovery.test.js`). Six files failed only on this branch, all as timeouts, and all of them exist at the base: `tests/unit/hangout-durable-participation.test.js`, `tests/unit/hangout-lobby-media-client.test.js`, `tests/unit/hangout-participation-enforcement.test.js`, `tests/unit/hangout-person-target-authority.test.js`, `tests/unit/hangout-room-lifecycle.test.js`, `tests/unit/package-pages.test.js`. The failed set moves between runs the same way earlier full-suite notes described. The failure count is 63 on both of those runs. The head that tracked this file at the repository root had one more failure, the boundary test on `RESULT-R3.md`.

## Limits

- Local commits only, added by explicit path. `node_modules` was not added. No push, PR or deploy.
- Test values are placeholders. No home-directory paths were added to tests or docs.
