# RESULT: Bridge slice 1

This file keeps both slice-1 results as written by their runs. The integration result is in `RESULT-INT.md`.

## Worker room grants (branch `grok/bridge-slice1-worker-20261112`)

**Status: DONE.** The grants module, its tests, and the hook spec are committed locally. Nothing was pushed, merged or deployed, and no existing file was edited.

- Base SHA: `4f35bc3` (`codex/game-night-rummy-ci-opening-knock-20261112`, contains `e972a46`)
- Branch: `grok/bridge-slice1-worker-20261112`
- Run: Thu Nov 12 2026, 21:26 to about 21:45 CT, model `claude-fable-5-2`

### What was built

| File | What it is |
|---|---|
| `hangout-worker/src/game-night-room-grants.mjs` | Pure, storage-injected module: `registerGrants`, `redeemGrant`, `sweep` / `expire`, `revokeAll`, `holds`, plus reconnect helpers. No route wiring. |
| `hangout-worker/tests/game-night-room-grants.test.js` | 20 vitest cases. They run against the real `createGameNightTable` class through a small adapter. |
| `BRIDGE-HOOKS.md` | Two-hook spec for the Codex multiplayer thread, with signatures, proposed patches as text (not applied) and the threat table. |

Commits: `ed1c6d0` (module and tests), `f05a459` (hook spec), plus the commit that adds this file.

### Commands run and results

| Command | Result |
|---|---|
| `npx vitest run hangout-worker/tests/game-night-room-grants.test.js` | **20 passed, 0 failed** (1 file) |
| `npx vitest run` (full suite, new file included) | 2136 passed, 28 failed, 2 skipped. 130 files passed, 14 failed, 1 unhandled error. The new file passed. |
| `npx vitest run --exclude hangout-worker/tests/game-night-room-grants.test.js` (baseline without the new file) | 26 failed tests across 17 files. I did not capture the pass count for this run. |

The failures are not from this slice. The new module is imported by nothing but its own test, and the baseline run without that test fails in the same area. Most failures are 5-second timeouts, and the set changes between runs (14 files in one run, 17 in the other), so they look load-dependent. I did not investigate or fix them.

Files that failed in the baseline run:

- `hangout-worker/tests/lobby-session-integration.test.js`
- `tests/unit/apache-public-boundary.test.js`
- `tests/unit/community-toolkit.test.js`
- `tests/unit/hangout-ai-review-engine.test.js`
- `tests/unit/hangout-hidden.test.js`
- `tests/unit/hangout-keep-signin.test.js`
- `tests/unit/hangout-lobby-client-context.test.js` (also the source of the unhandled error)
- `tests/unit/hangout-lobby-incident-sources.test.js`
- `tests/unit/hangout-lobby-media-blocking-capacity.test.js`
- `tests/unit/hangout-lobby-session-authority.test.js`
- `tests/unit/hangout-lobby-session-recovery-capacity.test.js`
- `tests/unit/hangout-message-recovery-client.test.js`
- `tests/unit/hangout-participation-partitions.test.js`
- `tests/unit/hangout-report-receipts.test.js`
- `tests/unit/hangout-sharing-controls-client.test.js`
- `tests/unit/package-pages.test.js`
- `tests/unit/sync-turdanoid.test.js`

### Required cases and where they are tested

| Case | Test |
|---|---|
| Register by host only | "lets only the seated host register" |
| Host seated first | "requires the host to be seated at a waiting table first" |
| Grants ≤ free seats, one hold per seat | "never creates more grants than free seats, with one hold per seat" |
| Redeem success burns | "seats the guest in the next seat, burns the grant…" |
| Replay → 410, same shape as stranger invitations | "answers a replay with the same 410 shape…" (compared against a real `gameInvitationRequest` 410) |
| Host subject redeem rejected | "rejects the host session and leaves the grant for the guest" |
| Guest never gets seat 0 | "never gives a guest seat 0, even when the table port misbehaves" |
| Expiry releases the hold, table stays waiting | "rejects an expired grant, releases its hold and leaves the table waiting" |
| Third person → table full | "tells the third person the table is full" |
| Two concurrent redeems for the last seat | "lets exactly one of two concurrent redeems win the last seat" |
| `revokeAll` | "revokes every unclaimed grant in one room when the host leaves" |
| Raw value never stored | "stores hashes only, never the one-time value" |
| No logging | "never writes to the console" |
| Reconnect 60 s as data | "keeps a disconnected guest seat for 60 seconds" |

### Decisions taken (safest default, per the retry note)

- **Host check is session-bound.** `hostSubject` must equal the subject in seat 0 of a waiting table. The route must take it from the host's session, never from request data.
- **Surplus hashes become standby markers.** A standby value gets "Table full, you're up next game" (409) rather than the 410 copy. It is not promoted if a seat frees up later; the host registers a fresh grant instead.
- **A burn is final, with no retry.** The grant is burned before the seat call. If seating then fails, the guest sees "table full" and the host has to issue a new grant.
- **Host redeem does not burn.** The host gets 403 and the guest's grant stays valid.
- **Unknown and malformed values look expired** (410), so a caller cannot tell them apart.

### Open questions

1. **Hook 1 is a hard dependency.** Table subjects are assigned when the guest's socket sends `join`, not at redeem time. In production the module's `seat` call should move the hold to the new guest session for 60 s, and the socket `join` then takes the seat. That needs the hold support specified in `BRIDGE-HOOKS.md`. Until it lands, holds only protect a seat against other grants, not against a stranger invite link or a room member's Play tap.
2. **Result status for table full.** I used 409. If the guest page would rather reuse the 410 path with different copy, it is a one-line change.
3. **Invite version.** Grants are not tied to `HANGOUT_BETA_INVITE_VERSION` the way stranger invitations are. With a 2-minute TTL I judged it low risk. Say if you want parity.
4. **Value format.** The module accepts 32 to 128 URL-safe characters and hashes them as UTF-8 with SHA-256, hex output. The WebJam side (task 2) must produce the same hash. This is not yet agreed with that branch.
5. **`ref`.** The existing guest cookie mint (`gameGuestScope`) needs the room's `ref`. `registerGrants` takes it as an optional extra argument beyond the contract's signature and passes it through.
6. **Route tests and the host confirm tap** are not covered here, because this slice has no routes or pages. They are listed in the threat table as tests to write with hook 2.

### Limits respected

- No push, PR, merge or deploy. Local commits only, added by explicit path.
- `node_modules` and `PROMPT.md` are untracked and were not added.
- No tokens, IPs, invite links or meeting links are in any file. Test values are obvious placeholders.

## Two-profile harness (branch `grok/bridge-slice1-e2e-20261112`)

Base SHA: `4f35bc3` (Codex Game Night head `4f35bc3ccbb4bedcac8c961906af3de9259aee3f`).
Branch: `grok/bridge-slice1-e2e-20261112`. Local preview only. No deploy.

### Commands and counts

`npx vitest run tests/unit/bridge-*`

- 9 passed, 0 failed. File: `tests/unit/bridge-grants.test.js`.

`npx playwright test -c playwright.bridge.config.js`

- 7 passed, 0 failed.
- 4 worker-hook tests are `test.fixme`. Playwright's list reporter counts those as skipped (`4 skipped`). They did not run and were not passed against the stand-in.
- Phone engine: WebKit (Playwright WebKit 27.2). Chromium iPhone emulation was not needed.
- Profiles: phone WebKit 390×844, host Chromium 1440×900, third Chromium context 1440×900.

The local preview is `npm run dev:game-night`, started by `tests/e2e/support/bridge-preview-launch.mjs`. Miniflare was missing, so `npm ci --ignore-scripts` was run in `tests/runtime/durable-records` (its `node_modules` is gitignored). That package asks for Node >= 24; this machine is Node v22.22.1 and npm printed an engine warning. The preview still started and the tests passed. Workerd logged `CertificateUnknown` during TLS handshakes; pages still loaded with `ignoreHTTPSErrors`, and those lines are not failures.

### Join tap to seated Chess board

Raw milliseconds, guest **Join game** tap until the phone shows Black and 32 pieces:

| Run | ms |
|---|---|
| 1 | 860 |
| 2 | 476 |
| 3 | 458 |

The host is seated first, by the **Open Chess match** tap, and the status is "You're White" before the guest is Black. Loading the host page leaves Chess on "Open a ten-minute match" and does not call a grant route. There is no "Seat 2 people from your WebJam room" card in this worktree; that confirm control is part of the worker hook that is still `test.fixme`.

Screenshots (no codes in the files): `../shots/bridge-slice1-phone-seated.png`, `../shots/bridge-slice1-host-seated.png`, `../shots/bridge-slice1-overflow.png`.

### Negative cases

Passing against the in-test stand-in (`USING_STAND_IN = true`):

1. A reused grant returns HTTP 410 and the existing invitation error: "This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite."
2. The host session gets 403 and the guest grant stays unburned.
3. A hold older than 60 seconds is released by `sweep`. The table stays, status stays `waiting`, and the host remains in seat `w`.
4. A second grant on the one free Chess seat returns "Table full, you're up next game" with `enabled: true` and `disabled: false`.

The same four cases against the live Worker are `test.fixme` because `hangout-worker/src/game-night-room-grants.mjs` is not in this worktree and no grant route is registered. On the live preview, the third person (ExtraGuest) joins the room and is not seated as White or Black. The current lobby does not render the table-full sentence; the screenshot shows the room without a Chess board and without a disabled Chess button.

### Point this at the real grants module

In `tests/e2e/support/bridge-grants-adapter.mjs`, after that module exists, replace the stand-in with this one line and delete the stand-in factory:

```js
export { createRoomGrants } from '../../../hangout-worker/src/game-night-room-grants.mjs';
```

If the landed module exports `registerGrants`, `redeemGrant`, `sweep`, and `revokeAll` instead of `createRoomGrants`, keep the adapter as the wrapper and call those four from `createRoomGrants`. Do not import the file before it exists. Leave the four `test.fixme` tests in place until the table-hold hook and the route registration are live; do not point them at the stand-in to make them pass. Set `USING_STAND_IN` to `false` only then.
