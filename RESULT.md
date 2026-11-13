# Bridge slice 1 — two-profile harness

Base SHA: `4f35bc3` (Codex Game Night head `4f35bc3ccbb4bedcac8c961906af3de9259aee3f`).
Branch: `grok/bridge-slice1-e2e-20261112`. Local preview only. No deploy.

## Commands and counts

`npx vitest run tests/unit/bridge-*`

- 9 passed, 0 failed. File: `tests/unit/bridge-grants.test.js`.

`npx playwright test -c playwright.bridge.config.js`

- 7 passed, 0 failed.
- 4 worker-hook tests are `test.fixme`. Playwright's list reporter counts those as skipped (`4 skipped`). They did not run and were not passed against the stand-in.
- Phone engine: WebKit (Playwright WebKit 27.2). Chromium iPhone emulation was not needed.
- Profiles: phone WebKit 390×844, host Chromium 1440×900, third Chromium context 1440×900.

The local preview is `npm run dev:game-night`, started by `tests/e2e/support/bridge-preview-launch.mjs`. Miniflare was missing, so `npm ci --ignore-scripts` was run in `tests/runtime/durable-records` (its `node_modules` is gitignored). That package asks for Node >= 24; this machine is Node v22.22.1 and npm printed an engine warning. The preview still started and the tests passed. Workerd logged `CertificateUnknown` during TLS handshakes; pages still loaded with `ignoreHTTPSErrors`, and those lines are not failures.

## Join tap to seated Chess board

Raw milliseconds, guest **Join game** tap until the phone shows Black and 32 pieces:

| Run | ms |
|---|---|
| 1 | 860 |
| 2 | 476 |
| 3 | 458 |

The host is seated first, by the **Open Chess match** tap, and the status is "You're White" before the guest is Black. Loading the host page leaves Chess on "Open a ten-minute match" and does not call a grant route. There is no "Seat 2 people from your WebJam room" card in this worktree; that confirm control is part of the worker hook that is still `test.fixme`.

Screenshots (no codes in the files): `../shots/bridge-slice1-phone-seated.png`, `../shots/bridge-slice1-host-seated.png`, `../shots/bridge-slice1-overflow.png`.

## Negative cases

Passing against the in-test stand-in (`USING_STAND_IN = true`):

1. A reused grant returns HTTP 410 and the existing invitation error: "This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite."
2. The host session gets 403 and the guest grant stays unburned.
3. A hold older than 60 seconds is released by `sweep`. The table stays, status stays `waiting`, and the host remains in seat `w`.
4. A second grant on the one free Chess seat returns "Table full, you're up next game" with `enabled: true` and `disabled: false`.

The same four cases against the live Worker are `test.fixme` because `hangout-worker/src/game-night-room-grants.mjs` is not in this worktree and no grant route is registered. On the live preview, the third person (ExtraGuest) joins the room and is not seated as White or Black. The current lobby does not render the table-full sentence; the screenshot shows the room without a Chess board and without a disabled Chess button.

## Point this at the real grants module

In `tests/e2e/support/bridge-grants-adapter.mjs`, after that module exists, replace the stand-in with this one line and delete the stand-in factory:

```js
export { createRoomGrants } from '../../../hangout-worker/src/game-night-room-grants.mjs';
```

If the landed module exports `registerGrants`, `redeemGrant`, `sweep`, and `revokeAll` instead of `createRoomGrants`, keep the adapter as the wrapper and call those four from `createRoomGrants`. Do not import the file before it exists. Leave the four `test.fixme` tests in place until the table-hold hook and the route registration are live; do not point them at the stand-in to make them pass. Set `USING_STAND_IN` to `false` only then.
