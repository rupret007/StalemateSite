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
| `registerGrants({ room, match, game, hostSubject, hashes, now, ref })` | Host only, and the host must already hold seat 0 of a waiting table. Creates at most one grant per free seat, each with its own hold `{ slot, holder, until }`, and places that hold on the table (`table.hold`). If the table refuses the hold, the hash becomes standby. Surplus hashes become standby markers. A hash that already has a row (live, standby or burned) is skipped, checked with `storage.get` per hash. Stores SHA-256 hashes only. |
| `redeemGrant({ value, subject, now })` | Hashes the value, constant-time compares, then checks standby **before** the waiting test: a standby value gets 409 table full for as long as the same host's table exists, waiting or playing. A grant asks the table to move its hold to a new guest session with `seat: 'next'`, and is burned only once `seat` answers. A definite no (null, or the host seat) burns, releases the hold and returns 409. A throw leaves the grant and its hold untouched. Returns `{ scope, sid, exp }`, the same shape `accept` returns today. |
| `sweep(now)` / `expire(now)` | Deletes expired rows and releases their holds. Never touches the table. Reads every `list` page (400 rows a page, `startAfter`), as `revokeAll`, `holds` and the room cap do. |
| `revokeAll(room)` | Host left WebJam or the room closed. |
| `holds(scope, now)` | Live holds for one table. |
| `keepsSeat`, `reconnectDeadline`, `RECONNECT_WINDOW` | Data only: a seated guest keeps the seat for 60 s after a disconnect. |

Constants: grant TTL 2 minutes, claim window 60 s, reconnect window 60 s, at most 16 hashes per request and 32 rows per room. Storage prefix `game-night-room-grant:`.

Results are plain objects `{ ok, status, reason, body }`. Only `body` goes to a client (`grantResponse(result)`).

| Case | Status | Body |
|---|---|---|
| Seated | 200 | `{ scope, sid, exp }` |
| Replay, expired, unknown, malformed; a grant whose table started or closed; a standby value whose table closed | 410 | the existing invitation copy, word for word |
| Host session redeems | 403 | "You are hosting this table and already have a seat." The grant stays valid for the guest. |
| Standby value while the same host's table exists (waiting or started), or the table said no to the seat | 409 | `{ tableFull: true, message: "Table full, you're up next game" }` |
| Register refused | 403 | "Open a game table with an available seat before seating your room." |

## Port mapping

The module talks to the table through four functions. Hook 1 is what makes them real.

```js
table.status(scope)   // -> null | { waiting, host, free, hostSeat }
table.hold(scope, { holder, until, now })   // -> boolean      maps to holdSeat(scope.match, scope.host, holder, until, now)
table.seat(scope, { subject, holder, seat: 'next', until, now })   // -> seat name | null   maps to moveHold(holder, subject, until, now)
table.releaseHold(scope, holder)   // optional         maps to releaseHold(holder)
```

- `free` is the number of unoccupied non-host seats. Holds are **not** subtracted here. The module does that itself.
- `hold` is called once per grant at register, with the grant hash as `holder` and `until` = grant expiry.
- `seat` is always called with `seat: 'next'`. The module rejects a result equal to `hostSeat`.
- Today a table subject is only assigned when the guest's socket sends `join` (`arcade-transport.mjs`). So in production `seat` **moves the hold** from the grant hash to the new guest session id, with `until = now + 60 s`, and returns the seat name that hold reserves (`b` at Chess, a real side name at a larger table, never `'next'`). The socket `join` from that session then converts the hold into that seat. In the unit tests and the Chess bench, the port keeps holds as `holder -> until`, refuses to seat without a live hold for `holder`, moves it, then joins the real table class directly.

## Hook 1: per-seat holds in `game-night-table.mjs`

Signatures:

```js
holdSeat(id, host, holder, until, now)      // -> boolean. Reserves one real guest seat for `holder`.
moveHold(holder, nextHolder, until, now)    // -> seat name | null. The name is the side the hold reserves.
releaseHold(holder)                         // -> boolean. Never deletes the table.
expireHolds(now)                            // -> boolean (changed)
hasGuestSeat(id, host, now, holder)         // now false when every free seat is under someone else's live hold
join(subject, id, now, requested, holder)   // a matching live hold takes exactly the seat it reserved
```

Rules:

1. One hold per seat. A hold is `{ holder, seat, until }`. `seat` is a real side name chosen when the hold is placed (the first guest side that is neither occupied nor held). `holder` is a grant hash, then a guest session id. It is never a raw value and never a player subject.
2. A hold does not count as occupied. A two-seat table does not auto-start on a hold, and a `manualStart` table does not see a phantom player.
3. Releasing or expiring a hold only removes the hold. It must not go through the two-seat "delete the match" path in `releaseSeat`.
4. A hold never applies to `sides[0]`. The host seat is set in the constructor only.
5. A `join` without a matching holder cannot take a seat under someone else's live hold (the client already shows `seat-unavailable`).
6. `moveHold` returns the held side: `b` at Chess, `b`/`c`/`d` at a four-seat table. It never returns `'next'`.
7. Holds exist only while the table waits. `start`, `requestRematch` and the auto-start inside `join` set `#holds = []`, so a checkpoint never has a match and holds together, and `restore` keeps refusing that combination. (We picked "clear on start" over "restore accepts match + holds": a hold on a started table has no meaning, and keeping the restore check strict catches a bad write.)

Proposed patch (text only, not applied):

```diff
--- a/hangout-worker/src/game-night-table.mjs
+++ b/hangout-worker/src/game-night-table.mjs
@@ class GameNightTable {
         #votes = [];
         #id;
+        #holds = [];   // [{ holder, seat, until }], waiting tables only (rule 7)
@@ static restore(record) {
                 if (finished(game.#match) && Array.isArray(votes) && votes.length < occupied.length &&
                     new Set(votes).size === votes.length && votes.every(seat => occupied.includes(seat))) game.#votes = [...votes];
             }
+            if (record.holds !== undefined) {
+                // Rule 7: start, requestRematch and join's auto-start clear holds, so match + holds is a bad record.
+                if (!Array.isArray(record.holds) || record.match
+                    || record.holds.some(hold => !subjectValid(hold?.holder) || !Number.isFinite(hold.until)
+                        || !sides.slice(1).includes(hold.seat) || game.#seats[hold.seat] || game.seat(hold.holder))
+                    || new Set(record.holds.map(hold => hold.holder)).size !== record.holds.length
+                    || new Set(record.holds.map(hold => hold.seat)).size !== record.holds.length) throw new TypeError('Invalid seat holds');
+                game.#holds = record.holds.map(({ holder, seat, until }) => ({ holder, seat, until }));
+            }
             return game;
@@ checkpoint() {
-                ...this.#rematchView(), ...(mode ? { mode } : {}) };
+                ...this.#rematchView(), ...(mode ? { mode } : {}),
+                ...(this.#holds.length ? { holds: this.#holds.map(hold => ({ ...hold })) } : {}) };
@@
+        #live(now, except = null) { return this.#holds.filter(hold => hold.until > now && hold.holder !== except); }
+
+        // The first guest side that is neither occupied nor under someone else's live hold.
+        #openSeat(now, except = null) {
+            const held = this.#live(now, except).map(hold => hold.seat);
+            return sides.slice(1).find(side => !this.#seats[side] && !held.includes(side)) ?? null;
+        }
+
-        hasGuestSeat(id, host) {
-            return id === this.#id && !this.#match && this.#seats[first] === host && this.#occupied().length < sides.length;
+        hasGuestSeat(id, host, now = 0, holder = null) {
+            return id === this.#id && !this.#match && this.#seats[first] === host && this.#openSeat(now, holder) !== null;
         }
+
+        holdSeat(id, host, holder, until, now) {
+            if (!subjectValid(holder) || !(until > now) || this.seat(holder)) return false;
+            this.#holds = this.#live(now);   // an expired hold must not keep its seat name
+            if (this.#holds.some(hold => hold.holder === holder) || !this.hasGuestSeat(id, host, now)) return false;
+            this.#holds.push({ holder, seat: this.#openSeat(now), until });
+            return true;
+        }
+
+        moveHold(holder, nextHolder, until, now) {
+            const hold = this.#holds.find(entry => entry.holder === holder && entry.until > now);
+            if (!hold || this.#match || !subjectValid(nextHolder) || !(until > now) || this.seat(nextHolder)
+                || this.#holds.some(entry => entry.holder === nextHolder)) return null;
+            hold.holder = nextHolder;
+            hold.until = until;
+            return hold.seat;   // a real side, never 'next', never sides[0]
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
+            this.#holds = this.#live(now);
+            return this.#holds.length !== before;
+        }
@@
-        join(subject, id, now, requested) {
+        join(subject, id, now, requested, holder = null) {
             if (id !== this.#id || this.#match || !subjectValid(subject) || this.seat(subject)) return false;
-            const seat = twoSeats ? sides[1] : requested === 'next' ? sides.find(side => !this.#seats[side]) : requested;
+            const mine = holder === null ? null : this.#holds.find(hold => hold.holder === holder && hold.until > now) ?? null;
+            if (mine && !twoSeats && requested !== 'next' && requested !== mine.seat) return false;
+            const seat = mine ? mine.seat : twoSeats ? sides[1] : requested === 'next' ? this.#openSeat(now) : requested;
             if (!sides.includes(seat) || this.#seats[seat]) return false;
-            if (!manualStart && this.subjects.length === sides.length - 1) this.#match = create(id, now);
+            if (!mine && this.#live(now).some(hold => hold.seat === seat)) return false;
+            if (mine) this.releaseHold(holder);
+            if (!manualStart && this.subjects.length === sides.length - 1) {
+                this.#match = create(id, now);
+                this.#holds = [];
+            }
             this.#seats[seat] = subject;
             return true;
         }
@@ start(subject, id, now) {
             this.#match = create(id, now, occupied);
+            this.#holds = [];
             return true;
@@ requestRematch(subject, id, nextId, now) {
             this.#id = nextId;
             this.#match = match;
             this.#votes = [];
+            this.#holds = [];
             return true;
```

`hasGuestSeat` keeps working for callers that pass no `now`: with `now = 0`, every hold with a real `until` counts as live, which is the safe side. The existing `issue` / `accept` callers in `game-night-invitations.mjs` then refuse a stranger link for a seat a grant holds, with no change on their side.

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
| Replay of a used value | The grant is burned as soon as `seat` answers, in the same serialized step, so no second caller gets in between. A burned row is a tombstone: register checks each hash with `storage.get`, so it cannot be re-registered however many rows exist. A burned, expired or unknown value returns the existing 410 copy. | `redeemGrant`, `registerGrants` | "answers a replay with the same 410 shape…", "gives the same value to two concurrent callers only once", "keeps a burned hash from being registered again past the first page" |
| Guest captures the host seat | The host is seated by their own session before any grant can exist. Grants only ever ask for `seat: 'next'`. A result equal to the host seat is rejected. A host session cannot redeem. | `registerGrants`, `redeemGrant`, hook 1 rule 4 | "never gives a guest seat 0…", "rejects the host session…" |
| Crafted host link seats an attacker | The link carries only hashes. Registration needs the host's session **and a host confirm tap**. `hostSubject` is taken from the session, never from the body or URL. | hook 2 host page and `register` route | "lets only the seated host register" (module side). The tap is a client test for slice 2/3. |
| Issue-on-load | No route registers grants from a GET or on page load. `register` is a same-origin JSON POST behind the confirm tap. | hook 2 | route test, to write with the hook |
| Stolen stored data | Only SHA-256 hashes are stored, in keys and rows. The raw value is never stored, returned or logged. The module has no console calls. | module | "stores hashes only…", "never writes to the console" |
| Guessing a value | Values are 32 to 128 URL-safe characters from the desktop app's random source. Lookup is by hash with a constant-time compare, and unknown values look exactly like expired ones. | `redeemGrant` | "answers unknown and malformed values like an expired grant" |
| Late joiner | No grant is made automatically. The host registers one more hash ("Seat {name}"), which works only while the table is waiting and has a free, unheld seat. Otherwise it becomes standby. | `registerGrants` | "never creates more grants than free seats…" |
| More people than seats | Grants ≤ free seats, one hold per seat. Surplus values are standby markers and get 409 "Table full, you're up next game", before and after the granted guest sits (standby is checked before the waiting test). No spectator mode in v1. | `registerGrants`, `redeemGrant` | "tells the third person the table is full", "gives a surplus guest table-full, not expired, after the granted guest sits…" |
| Seat lost between redeem and seat | The hold is placed at register and only moved by `seat`; nothing releases it first. A definite no from `seat` burns and releases; a throw leaves the grant and hold for a retry. | `registerGrants`, `redeemGrant`, hook 1 | "places the hold at register and moves it…", "leaves the grant and its hold alone when seat throws…" |
| Two guests race for the last seat | Redeems are serialized (module queue, and the Durable Object's own single thread). Exactly one wins. The other gets 409. | `redeemGrant` | "lets exactly one of two concurrent redeems win the last seat" |
| Expiry | Grant TTL is 2 minutes. An expired redeem or a sweep releases the hold only. The table is never deleted and stays waiting. | `redeemGrant`, `sweep`, hook 1 rule 3 | "rejects an expired grant, releases its hold…", "sweeps expired grants…" |
| Guest redeems but never connects | The moved hold lasts 60 s (claim window), then expires and frees the seat. The grant stays burned. | hook 1 `moveHold` + `expireHolds` | table test, to write with the hook |
| Guest drops mid-wait | The seat is kept 60 s (`keepsSeat`). Data only in this slice. | helper | "keeps a disconnected guest seat for 60 seconds" |
| Host leaves WebJam or the room closes | `revokeAll(room)` deletes every unclaimed grant and standby marker for the room. Anything missed expires within 2 minutes. Seated matches follow Hang Out room rules. | `revokeAll`, hook 2 | "revokes every unclaimed grant in one room…" |
| Table starts or closes while grants are out | Redeem re-checks the table. If it is gone, started, or has a different host, a grant is deleted and the answer is 410. A standby value gets 409 while the table exists and 410 once it is gone. | `redeemGrant` | "expires every grant for a table that started or closed", "keeps the table-full line for the third person after the match has started" |
| Flooding | 16 hashes per request, 32 rows per room (counted over every list page), and the route reuses `controlBudget`. | `registerGrants`, hook 2 | "rejects malformed, duplicate and oversized hash lists", "applies the room cap to rows past the first page" |

## Dependencies and limits to know

- **Hook 1 is required before any real use.** Without it, production has no way to give the module's `seat` call a real effect at redeem time, because table subjects are assigned at socket `join`.
- A burn is final, and it happens only after `seat` answers. If `seat` says no, the guest gets "table full" and the host must issue a fresh grant. If `seat` throws, the grant is not burned and the guest can tap again. One window is left: if `seat` succeeds and the Durable Object dies before the burn is written, the value is still a live grant whose table hold has already moved, so a second redeem gets `seat` → null → 409 and burns it. It cannot seat a second person.
- A burned tombstone lives as long as the grant would have (2 minutes from register). After the sweep removes it, the host could register the same hash again. The desktop app makes a fresh value per seat, so this needs a host who re-sends an old hash on purpose.
- Grants are not tied to `HANGOUT_BETA_INVITE_VERSION` the way stranger invitations are. With a 2-minute TTL this is low risk. The route can call `revokeAll` on a version change if you want parity.
