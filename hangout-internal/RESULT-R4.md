# RESULT-R4: Bridge slice 1 public-boundary fix

**Status: done, local only.** `RESULT-R3.md` now lives in `hangout-internal/`, which `.htaccess` already denies. No new tracked file sits at the repository root. The boundary tests pass at the fix commit below. Nothing was pushed or deployed. The never-edit files are untouched.

- Branch: `grok/bridge-slice1-int-20261112`
- Fix commit: `24647d4428dbf762399df4c672d432da92c26f3c`
- Result commit, which added this file: recorded in the following commit.
- The commit after the result commit only records that SHA. That commit is the branch head.

## What changed

- `git mv RESULT-R3.md hangout-internal/RESULT-R3.md`. `.htaccess` was not edited. Line 4 already denies `hangout-internal`. Line 5's root deny list does not need this note, because the note is no longer a root file.
- The R3 status line no longer says both boundary tests pass at the head that tracked the note at the repo root. They passed at `57d2aece9d07f5db7e8e80370d80ce0d541c0ffb`. They failed at `7350266983b6a6ab146fe0a4229058325509f143` and `683277e520d10a13b7b8371ee45549361fa901b0`.
- Fable's review file contained one blocker: the same tracked root file. It had no medium findings. The file was still marked preliminary and said more findings were being added; at this commit it was 32 lines and unchanged since 00:00 CT. That blocker is the move above.
- Karen's misreported boundary line is the correction above. Hook 2 stays spec-only. Applying it would edit the never-edit Worker files.

## Root check

At the fix commit, `git ls-files --cached` has no `RESULT-R3.md` at the repository root. The only branch-added root file had been `RESULT-R3.md`. This note is under `hangout-internal/`, which the boundary test treats as a denied root. `apache-public-boundary.test.js` is the check against the line 5 deny list: every tracked non-public root entry must be denied.

## Commands

Paths in the runner banner are omitted here. The boundary command was re-run after the fix commit. The bridge unit command and Playwright were run on that same tree, immediately before the fix commit. The fix commit only moves and corrects `RESULT-R3.md`.

`npx vitest run tests/unit/apache-public-boundary.test.js tests/unit/hangout-hidden.test.js`

```
 Test Files  2 passed (2)
      Tests  49 passed (49)
   Start at  00:10:15
   Duration  723ms (transform 85ms, setup 81ms, import 70ms, tests 408ms, environment 0ms)
```

Exit 0. 0 failed. Head `24647d4428dbf762399df4c672d432da92c26f3c`.

`npx vitest run tests/unit/bridge-grants.test.js tests/unit/bridge-hook1-proposal.test.js tests/unit/bridge-shots.test.js hangout-worker/tests/game-night-room-grants.test.js`

```
 Test Files  4 passed (4)
      Tests  44 passed (44)
   Start at  00:09:30
   Duration  1.80s (transform 837ms, setup 310ms, import 907ms, tests 782ms, environment 1ms)
```

Exit 0. 0 failed. That is 29 module tests, 9 bridge-adapter tests, 5 hook 1 proposal tests and 1 screenshot-guard test.

`npx playwright test -c tests/playwright.bridge.config.js`

```
BRIDGE_PHONE_ENGINE webkit
BRIDGE_TIMING 1603,1510,1580
  4 skipped
  7 passed (1.0m)
```

Exit 0. The 7 passed are the 4 in-process grant cases plus the 3 local-preview tests. The 4 skipped are the live-route `test.fixme` cases. Workerd printed TLS `CertificateUnknown` lines. Those are not failures.

## Limits

- Local commits only, added by explicit path. `node_modules` and `PROMPT*.md` were not added. No push.
- Hook 2 is still spec-only in `hangout-internal/BRIDGE-HOOKS.md`.
- The full vitest suite was not re-run. The extra failure at `683277e` was the boundary case on `RESULT-R3.md`. That case passes at the fix commit.
