# Bridge hooks: WebJam room → Game Night seat (slice 1)

For the Codex multiplayer thread. This is a spec plus proposed patches as text. **Nothing here is applied.** If your own seat hold or route lands first, **drop ours if theirs lands first**: keep yours, and only the small adapter in "Port mapping" needs to match.

- Base: `4f35bc3` (`codex/game-night-rummy-ci-opening-knock-20261112`, contains `e972a46`).
- Branch: `grok/bridge-slice1-worker-20261112`, local only.
- New files only: `hangout-worker/src/game-night-room-grants.mjs` and `hangout-worker/tests/game-night-room-grants.test.js`. No existing file is edited.
- Authority: `VERDICT.md` in the bridge sanity folder ("Security model", task contract 1).

## What the module already does

`createRoomGrants({ storage, table })` returns:

| Function | Behaviour |
|---|---|
| `registerGrants({ room, match, game, hostSubject, hashes, now, ref })` | Host only, and the host must already hold seat 0 of a waiting table. Creates at most one grant per free seat, each with its own hold `{ slot, holder, until }`. Surplus hashes become standby markers. Stores SHA-256 hashes only. |
| `redeemGrant({ value, subject, now })` | Hashes the value, constant-time compares, burns the grant, then seats the guest with `seat: 'next'`. Returns `{ scope, sid, exp }`, the same shape `accept` returns today. |
| `sweep(now)` / `expire(now)` | Deletes expired rows and releases their holds. Never touches the table. |
| `revokeAll(room)` | Host left WebJam or the room closed. |
| `holds(scope, now)` | Live holds for one table. |
| `keepsSeat`, `reconnectDeadline`, `RECONNECT_WINDOW` | Data only: a seated guest keeps the seat for 60 s after a disconnect. |

Constants: grant TTL 2 minutes, claim window 60 s, reconnect window 60 s, at most 16 hashes per request and 32 rows per room. Storage prefix `game-night-room-grant:`.

Results are plain objects `{ ok, status, reason, body }`. Only `body` goes to a client (`grantResponse(result)`).

| Case | Status | Body |
|---|---|---|
| Seated | 200 | `{ scope, sid, exp }` |
| Replay, expired, unknown, malformed, table started or closed | 410 | the existing invitation copy, word for word |
| Host session redeems | 403 | "You are hosting this table and already have a seat." The grant stays valid for the guest. |
| Standby value, or the seat went to someone else | 409 | `{ tableFull: true, message: "Table full, you're up next game" }` |
| Register refused | 403 | "Open a game table with an available seat before seating your room." |

## Port mapping

The module talks to the table through three functions. Hook 1 is what makes them real.

```js
table.status(scope)   // -> null | { waiting, host, free, hostSeat }
table.seat(scope, { subject, holder, seat: 'next', until })   // -> seat name | null
table.releaseHold(scope, holder)   // optional
```

- `free` is the number of unoccupied non-host seats. Holds are **not** subtracted here. The module does that itself.
- `seat` is always called with `seat: 'next'`. The module rejects a result equal to `hostSeat`.
- Today a table subject is only assigned when the guest's socket sends `join` (`arcade-transport.mjs`). So in production `seat` should **move the hold** from the grant hash to the new guest session id, with `until = now + 60 s`, and return the seat name it reserved. The socket `join` from that session then converts the hold into the seat. In the unit tests `seat` joins the real table class directly, which proves the seat rules.

## Hook 1: per-seat holds in `game-night-table.mjs`

Signatures:

```js
holdSeat(id, host, holder, until, now)      // -> boolean
moveHold(holder, nextHolder, until, now)    // -> seat name | null
releaseHold(holder)                         // -> boolean. Never deletes the table.
expireHolds(now)                            // -> boolean (changed)
hasGuestSeat(id, host, now, holder)         // now subtracts live holds not owned by `holder`
join(subject, id, now, requested, holder)   // a matching live hold takes its seat with 'next' only
```

Rules:

1. One hold per seat. A hold is `{ holder, until }`. `holder` is a grant hash, then a guest session id. It is never a raw value and never a player subject.
2. A hold does not count as occupied. A two-seat table does not auto-start on a hold, and a `manualStart` table does not see a phantom player.
3. Releasing or expiring a hold only removes the hold. It must not go through the two-seat "delete the match" path in `releaseSeat`.
4. A hold never applies to `sides[0]`. The host seat is set in the constructor only.
5. While live holds cover every free seat, a `join` without a matching holder returns `false` (the client already shows `seat-unavailable`).

Proposed patch (text only, not applied):

```diff
--- a/hangout-worker/src/game-night-table.mjs
+++ b/hangout-worker/src/game-night-table.mjs
@@ class GameNightTable {
         #votes = [];
         #id;
+        #holds = [];
@@ static restore(record) {
+            if (record.holds !== undefined) {
+                if (!Array.isArray(record.holds) || record.holds.length >= sides.length || record.match
+                    || record.holds.some(hold => !subjectValid(hold?.holder) || !Number.isFinite(hold.until))
+                    || new Set(record.holds.map(hold => hold.holder)).size !== record.holds.length) throw new TypeError('Invalid seat holds');
+                game.#holds = record.holds.map(({ holder, until }) => ({ holder, until }));
+            }
             return game;
@@ checkpoint() {
-                ...this.#rematchView(), ...(mode ? { mode } : {}) };
+                ...this.#rematchView(), ...(mode ? { mode } : {}), ...(this.#holds.length ? { holds: this.#holds.map(hold => ({ ...hold })) } : {}) };
@@
+        #held(now, holder) { return this.#holds.filter(hold => hold.until > now && hold.holder !== holder).length; }
+
-        hasGuestSeat(id, host) {
-            return id === this.#id && !this.#match && this.#seats[first] === host && this.#occupied().length < sides.length;
+        hasGuestSeat(id, host, now = 0, holder = null) {
+            return id === this.#id && !this.#match && this.#seats[first] === host
+                && this.#occupied().length + this.#held(now, holder) < sides.length;
         }
+
+        holdSeat(id, host, holder, until, now) {
+            if (!subjectValid(holder) || !(until > now) || this.#holds.some(hold => hold.holder === holder)
+                || !this.hasGuestSeat(id, host, now)) return false;
+            this.#holds.push({ holder, until });
+            return true;
+        }
+
+        moveHold(holder, nextHolder, until, now) {
+            const hold = this.#holds.find(entry => entry.holder === holder && entry.until > now);
+            if (!hold || this.#match || !subjectValid(nextHolder) || nextHolder === this.#seats[first]) return null;
+            hold.holder = nextHolder;
+            hold.until = until;
+            return twoSeats ? sides[1] : 'next';
+        }
+
+        releaseHold(holder) {
+            const before = this.#holds.length;
+            this.#holds = this.#holds.filter(hold => hold.holder !== holder);
+            return this.#holds.length !== before;
+        }
+
+        expireHolds(now) {
+            const before = this.#holds.length;
+            this.#holds = this.#holds.filter(hold => hold.until > now);
+            return this.#holds.length !== before;
+        }
@@
-        join(subject, id, now, requested) {
+        join(subject, id, now, requested, holder = null) {
             if (id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject)) return false;
+            const mine = holder !== null && this.#holds.some(hold => hold.holder === holder && hold.until > now);
+            if (mine && !twoSeats && requested !== 'next') return false;
+            if (!mine && this.#occupied().length + this.#held(now, null) >= sides.length) return false;
             const seat = twoSeats ? sides[1] : requested === 'next' ? sides.find(side => !this.#seats[side]) : requested;
             if (!sides.includes(seat) || this.#seats[seat]) return false;
+            if (mine) this.releaseHold(holder);
             if (!manualStart && this.subjects.length === sides.length - 1) this.#match = create(id, now);
```

`hasGuestSeat` keeps working for callers that pass no `now` (holds with a real `until` are then live, which is the safe side). `start` and `requestRematch` should clear `#holds`.

The transport needs a matching pass-through. It is not a table change, but hook 1 is useless without it:

- `arcade-transport.mjs` `join`: pass the binding's session id as `holder`.
- `arcade-transport.mjs` exports next to `hasGuestSeat`: `tableStatus(scope, match)`, `holdSeat`, `moveHold`, `releaseHold`, each doing load → call → `storage.put` of the checkpoint. Never `storage.delete` on a hold release.
- `maintain`: call `expireHolds(now)` and checkpoint if it changed.
- `leave` / `revoke` for a subject that only holds: `releaseHold` only.

Until hook 1 lands, the grants module still holds seats against **other grants** (its own rows), but a stranger invite link or a room member's Play tap can still take a held seat. The loser then gets the 409 "table full" result, not an error.

## Hook 2: route registration in `beta-entry.mjs` (and the lobby DO)

Two POST routes under the existing same-origin JSON gate, behind `gameGuestEnabled(env)` plus a new flag `HANGOUT_GAME_NIGHT_ROOM_GRANTS === '1'` (off by default).

```js
export const GAME_ROOM_GRANT_PATH = '/beta/game-night/room-grant';

// POST /beta/game-night/room-grant/register   host session required
//   body: { actor, room, ref, game, match, hashes: string[] }
//   200 { granted, standby, until } | 401 | 403 | 429
// POST /beta/game-night/room-grant/redeem     no session needed
//   body: { value, age13: true }
//   200 { next } + Set-Cookie (existing game-guest cookie) | 400 | 403 | 409 | 410
```

Proposed patch (text only, not applied):

```diff
--- a/hangout-worker/src/beta-entry.mjs
+++ b/hangout-worker/src/beta-entry.mjs
@@ betaRequest, inside the POST block, next to GAME_INVITATION_PATH
+        if (url.pathname.startsWith(GAME_ROOM_GRANT_PATH + '/')) return gameRoomGrant(request, env, url.pathname.slice(GAME_ROOM_GRANT_PATH.length + 1), body);
@@
+async function gameRoomGrant(request, env, path, body) {
+    if (!gameGuestEnabled(env) || env.HANGOUT_GAME_NIGHT_ROOM_GRANTS !== '1' || !['register', 'redeem'].includes(path)) return json({ error: 'Game invitations are unavailable.' }, 404);
+    const session = await betaSession(request, env);
+    if (path === 'register' && !session) return json({ error: 'Private invitation required.' }, 401);
+    if (path === 'redeem' && body.age13 !== true) return json({ error: 'Open the original invitation and confirm the age and house rules to join.' }, 400);
+    const response = await env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(`https://lobby${GAME_ROOM_GRANT_PATH}/${path}`, {
+        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, session: session && { betaSid: session.access.sid } })
+    });
+    const data = await response.json().catch(() => ({ error: 'Game invitations are temporarily unavailable.' }));
+    if (path !== 'redeem' || !response.ok) return json(data, response.status);
+    const scope = gameGuestScope(data.scope);
+    if (!scope) return json({ error: 'This invitation could not be confirmed.' }, 503);
+    const { cookie } = await newAccess(env, { gameGuest: scope, sid: data.sid, exp: data.exp, ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0' });
+    return json({ next: `${LOBBY_PAGE}${GAME_GUEST_QUERY}` }, 200, { 'Set-Cookie': cookie });
+}
--- a/hangout-worker/src/lobby-do.mjs
+++ b/hangout-worker/src/lobby-do.mjs
@@ fetch(request), next to the GAME_INVITATION_PATH branch (same retirementGate, same serialized path)
+        if (path.startsWith(GAME_ROOM_GRANT_PATH + '/') && request.method === 'POST') {
+            return retirementGate(this, async () => {
+                try {
+                    const { body, session } = await request.json();
+                    return await gameRoomGrantRequest(this, path.slice(GAME_ROOM_GRANT_PATH.length + 1), body, session);
+                } catch { return new Response('Game invitations are temporarily unavailable.', { status: 503 }); }
+            });
+        }
```

`gameRoomGrantRequest(lobby, operation, body, session)` is a thin wrapper to write with the hook (about 25 lines):

- **register**: run the same host checks `issue` runs today (`arcadeRoomRequest`, `lobby.arcadeBinding`, `canOpen`, `canPlay`, `!gameGuest`, `session.betaSid === host.betaSid`, `sessionActive`, `arcadeAvailable`, `controlBudget.take`). Then call `registerGrants` with `hostSubject: session.betaSid`. `hostSubject` comes from the session and nowhere else.
- **redeem**: call `redeemGrant({ value: body.value, subject: session?.betaSid ?? null, now })` and return `grantResponse(result)`.
- Call `sweep(now)` from the lobby's existing maintenance tick, and `revokeAll(room)` where the game room closes or the host's session ends.
- Never log `body.value`. Do not put it in a URL query. The guest page reads it from the fragment and strips it, as it does today.

Client pages (not part of this slice, listed so the routes make sense):

- Host page: reads only `hash(g_i)` values from the fragment, shows "Seat 2 people from your WebJam room in Chess?", and calls `register` **only after the host taps confirm**. No issue-on-load.
- Guest page: the **Join game** tap is the 13+ confirmation and sends `age13: true`.
- `entry-sites.mjs` (the public display registry under the lobby root): no change is needed for slice 1. The bridge adds no new entrance. If the multiplayer thread wants the host confirm page listed there, that is their call.

## Threat table

| Threat | What stops it | Where | Test |
|---|---|---|---|
| Replay of a used value | The grant is burned before the seat call. A burned, expired or unknown value returns the existing 410 copy. | `redeemGrant` | "answers a replay with the same 410 shape…", "gives the same value to two concurrent callers only once" |
| Guest captures the host seat | The host is seated by their own session before any grant can exist. Grants only ever ask for `seat: 'next'`. A result equal to the host seat is rejected. A host session cannot redeem. | `registerGrants`, `redeemGrant`, hook 1 rule 4 | "never gives a guest seat 0…", "rejects the host session…" |
| Crafted host link seats an attacker | The link carries only hashes. Registration needs the host's session **and a host confirm tap**. `hostSubject` is taken from the session, never from the body or URL. | hook 2 host page and `register` route | "lets only the seated host register" (module side). The tap is a client test for slice 2/3. |
| Issue-on-load | No route registers grants from a GET or on page load. `register` is a same-origin JSON POST behind the confirm tap. | hook 2 | route test, to write with the hook |
| Stolen stored data | Only SHA-256 hashes are stored, in keys and rows. The raw value is never stored, returned or logged. The module has no console calls. | module | "stores hashes only…", "never writes to the console" |
| Guessing a value | Values are 32 to 128 URL-safe characters from the desktop app's random source. Lookup is by hash with a constant-time compare, and unknown values look exactly like expired ones. | `redeemGrant` | "answers unknown and malformed values like an expired grant" |
| Late joiner | No grant is made automatically. The host registers one more hash ("Seat {name}"), which works only while the table is waiting and has a free, unheld seat. Otherwise it becomes standby. | `registerGrants` | "never creates more grants than free seats…" |
| More people than seats | Grants ≤ free seats, one hold per seat. Surplus values are standby markers and get 409 "Table full, you're up next game". No spectator mode in v1. | `registerGrants`, `redeemGrant` | "tells the third person the table is full" |
| Two guests race for the last seat | Redeems are serialized (module queue, and the Durable Object's own single thread). Exactly one wins. The other gets 409. | `redeemGrant` | "lets exactly one of two concurrent redeems win the last seat" |
| Expiry | Grant TTL is 2 minutes. An expired redeem or a sweep releases the hold only. The table is never deleted and stays waiting. | `redeemGrant`, `sweep`, hook 1 rule 3 | "rejects an expired grant, releases its hold…", "sweeps expired grants…" |
| Guest redeems but never connects | The moved hold lasts 60 s (claim window), then expires and frees the seat. The grant stays burned. | hook 1 `moveHold` + `expireHolds` | table test, to write with the hook |
| Guest drops mid-wait | The seat is kept 60 s (`keepsSeat`). Data only in this slice. | helper | "keeps a disconnected guest seat for 60 seconds" |
| Host leaves WebJam or the room closes | `revokeAll(room)` deletes every unclaimed grant and standby marker for the room. Anything missed expires within 2 minutes. Seated matches follow Hang Out room rules. | `revokeAll`, hook 2 | "revokes every unclaimed grant in one room…" |
| Table starts or closes while grants are out | Redeem re-checks the table. If it is gone, started, or has a different host, the grant is deleted and the answer is 410. | `redeemGrant` | "expires every grant for a table that started or closed" |
| Flooding | 16 hashes per request, 32 rows per room, and the route reuses `controlBudget`. | `registerGrants`, hook 2 | "rejects malformed, duplicate and oversized hash lists" |

## Dependencies and limits to know

- **Hook 1 is required before any real use.** Without it, production has no way to give the module's `seat` call a real effect at redeem time, because table subjects are assigned at socket `join`.
- A burn is final. If the seat call fails after the burn, the guest gets "table full" and the host must issue a fresh grant. There is no retry token like `attempt` in the stranger flow.
- Grants are not tied to `HANGOUT_BETA_INVITE_VERSION` the way stranger invitations are. With a 2-minute TTL this is low risk. The route can call `revokeAll` on a version change if you want parity.
