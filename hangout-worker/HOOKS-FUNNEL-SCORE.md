# Proposed call sites for the join funnel and night score

Not wired. Do not edit the files below in the change that adds `join-funnel.mjs` and `game-night-night-score.mjs`. Those files are owned by other threads. This note is the later wiring map.

Both modules take an injected Durable Object storage (`get` / `put` / `list` / `delete`) and an injected `now()` in epoch milliseconds. Use the lobby Durable Object storage (`HangoutLobby`, name `stalemate`). Prefixes are `jf:v1:` and `ns:v1:`. `pruneLogs` lists only `log:` and must stay that way; call `prune()` itself.

Construct once on the lobby object:

- `createJoinFunnel({ storage: state.storage, now: () => Date.now(), retentionDays: 30 })`
- `createNightScore({ storage: state.storage, now: () => Date.now() })` (time zone defaults to `America/Chicago`)

A failure inside `record`, `recordResult`, `report`, or `prune` must not change the match, invitation, or admission response. Do not log keys, counts, nicks, or sources.

## What a call may pass

`record(event, source)` accepts only the fixed event names. `source` may only be the connection's already normalised `entrySource` (`stalemate`, `rad-dad`, or empty). Anything else is stored as `unknown`. Do not pass an IP, user agent, invite code, token, beta sid, device id, nick, room name, or timestamp.

`recordResult(roomId, { winnerNick, players, draw })` takes the room name (`scope.room`, shape `#game-…`) and display nicks only. Do not pass `scope.ref`, `scope.actor`, a beta sid, a seat id, or a match id. Do not copy nicks into the arcade checkpoint.

There is no per-visitor dedupe. A dedupe key would be an identifier. Repeated `details` calls and repeated install-card impressions each count.

## Events

| Event | File | Function | When |
| --- | --- | --- | --- |
| `invite_created` | `hangout-worker/src/game-night-invitations.mjs` | `gameInvitationRequest` | `operation === 'issue'`, after the invitation `storage.put` succeeds and before the `{ code, until }` reply. Not on 403 or 429. Source is the host connection's `entrySource`, added to the in-memory `session` argument by `HangoutLobby.fetch` (the `GAME_INVITATION_PATH` branch). Do not persist that source on the invitation row. |
| `invite_opened` | `hangout-worker/src/beta-entry.mjs` | `gameInvitation` | `path === 'details'` and the lobby response is ok. Source is `entrySourceFromParams` on that request URL, or `unknown`. Do not read the invite code into the funnel. |
| `redeemed` | `hangout-worker/src/beta-entry.mjs` | `gameInvitation` | `path === 'accept'`, lobby response ok, `gameGuestScope` confirmed, and the guest cookie from `newAccess` is being returned. Not on 410. Same source rule as `invite_opened`. |
| `room_joined` | `hangout-worker/src/lobby-core.mjs` | `enter` inside `createLobby` | Returns true and the member was not already in the room, and `roomKind(chan) === 'game'`. This is the single choke point for the `join` command and for the game-guest branch of `hello`. Do not also count in `hello` or `join`. Do not count `#stalemate`. Source is `c.entrySource` (empty becomes `unknown`). |
| `seated` | `hangout-worker/src/arcade-transport.mjs` | `receive` inside `createArcadeTransport` | After the match checkpoint `put` succeeds: one count for a successful `open` (host seat) and one count for a successful `join`. Not for `sync`, `start`, `leave`, a failed seat, or a rematch that only swaps the same people. |
| `game_finished` | `hangout-worker/src/arcade-transport.mjs` | `receive`, and `maintain`, inside `createArcadeTransport` | Once, when `command` or `expire` moves that match from unfinished to finished, after the checkpoint `put` succeeds. |
| `rematch` | `hangout-worker/src/arcade-transport.mjs` | `receive` inside `createArcadeTransport` | `frame.action === 'rematch'`, `requestRematch` returns true, and the match id changed (the vote that starts the next match). A non-final rematch vote does not count. |
| night score | `hangout-worker/src/arcade-transport.mjs` | `receive` and `maintain`, same finish transition as `game_finished` | `recordResult(scope.room, { winnerNick, players, draw })`. Nicks come from live lobby connections. `arcadeActor` in `createLobby` (`lobby-core.mjs`) already returns the acting connection's `nick`; resolve every occupied seat the same way. A finished view with no winner is `draw: true`. Drop a seat whose connection is already gone. |
| `install_card_shown` | `hangout-worker/src/beta-entry.mjs` | `betaRequest`, triggered from `draw` in the `CLIENT` script in the same file | The Hang Out home is the shell `betaRequest` serves for `/`, `/beta`, and `/beta/`. There is no install card in the tree yet. When one is shown from `draw`, the page POSTs same-origin JSON to a new path handled in `betaRequest`. The body may only be `{ event: 'install_card_shown' }`. The admitted session is the same check as `/beta/state`. `betaRequest` re-derives source from that session's entry source and calls `record`. It does not store the body. |

`entrySource` is not on the arcade binding today. A later change may add the live string `entrySource: c.entrySource` to the object `arcadeActor` returns. That object is not the checkpoint. Until that field exists, seated / finished / rematch use `unknown`. Do not read a source off the socket attachment or the invite code.

Four finishes in `command` inside `createLobby` (`lobby-core.mjs`), outside `createArcadeTransport`. It is not one of these call sites.

## In-room score

`tonight(roomId)` is for people already in that room. The call site is `publish` inside `createArcadeTransport` (`arcade-transport.mjs`): attach the returned `display` string to the match state for that `scope.room`. Do not put the standings on the ops route below. That route would become a directory of nicks.

## Admin read

Funnel report only.

- Worker: `betaRequest` in `hangout-worker/src/beta-entry.mjs`, next to the existing `GET /beta/health` branch. New path: `GET /beta/ops/join-funnel`. The only accepted query parameter is `days` (integer). Any other parameter is a 400. No invite code, room, or token in the URL.
- Auth: same rules as `betaHealth` in `hangout-worker/src/beta-ops.mjs` (protected mode, `HANGOUT_BETA_OPS_KEY` bearer, GET only). Check the bearer in the Worker before forwarding. The lobby DO must not see the key. Guest cookies and `adminGate` do not authorize this route.
- DO: `HangoutLobby.fetch` in `hangout-worker/src/lobby-do.mjs`, beside the `INTERNAL_HEALTH_PATH` branch. Call `report({ days, minCell: 3 })` and return that JSON with the same no-store headers `healthJson` already sets. Do not call `record` here.

## Prune

`HangoutLobby.alarm` in `hangout-worker/src/lobby-do.mjs`. Both branches already call `pruneLogs` and `maintainArcade` (the `authorityMode` path and the legacy path). After `maintainArcade` in each branch, call `joinFunnel.prune()` and `nightScore.prune()`. If storage itself fails, keep the alarm's existing failure path. Do not log the deleted keys.
