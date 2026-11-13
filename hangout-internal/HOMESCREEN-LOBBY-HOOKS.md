# Home screen hooks for the lobby thread

The Hang Out home screen links Game Night at `lobby/?game-night=1`. Two lobby behaviors then close the door. This branch must not edit `lobby.js`, `entry-sites.mjs`, or `lobby/index.html`. The notes below are for the multiplayer Codex thread.

Paths are under `r/45662413410ed051/`.

## Keep `game-night=1` when the address bar is cleaned

`entry-sites.mjs:56` defines `GAME_NIGHT_QUERY` as `game-night=1`. `entry-sites.mjs:58-68` `gameNightEntry` accepts that flag only when it appears once and equals `1`. It may also carry a table name or a `#game` / `instance` pair. It does not carry an invite, a grant, or a preview key.

`lobby/lobby.js:42` treats the page as the beta shell only when `/beta/bootstrap.js` is present. `lobby/lobby.js:50` reads `gameEntry` from `gameNightEntry` only in that shell. On the static lobby the flag is ignored, so a stranger who followed the home screen still gets the ordinary lobby gate.

`lobby/lobby.js:45` sets `gameGuestQuery` to `?game-guest=1` for a seated game guest and to an empty string otherwise. `lobby/lobby.js:92-99` reads `preview` once, then `history.replaceState` replaces the whole query with `gameGuestQuery`. `lobby/lobby.js:103` does that again when `gameEntry` is set. Both calls drop `game-night=1`.

When the shell cleans the address bar, keep `?game-night=1` if `gameEntry` was non-null. Still drop `preview`, `relay`, `turn`, and any invite or grant query. Do not put those values back into the URL, storage, or the page text. The home screen shortcut and the Who’s here Game Night link both request `?game-night=1` and then rely on the lobby to remember it.

## What a stranger should see once the lobby is public

While the lobby is unpublished, `lobby/lobby.js:558-561` is the right closed door. With no preview key it sets `[data-gate-copy]` to “Not open yet. The band is still building this one.” and hides `[data-enter]` and `.nickrow`. The static copy those elements start with is in `lobby/index.html:106`, `lobby/index.html:113`, and `lobby/index.html:119`.

Once the lobby is public, a stranger who opened Game Night should see the name row and the enter button again. The lede should say “Pick a name and jump in.” If a table is still invite-only after publish, the lede should say “Ask your host to send the Game Night link; tap it and you're in.” and the page should offer a way back to `/hangout/`. It should not hide the name row and the enter button behind “Not open yet.”

Who’s here on the home screen will keep sending people into this gate until that copy lands. No directory route was added here.

## WebJam join page

`/join/` is not a page this branch can change. `tests/unit/webjam-join-assets.test.js:18-29` hash-locks the directory, and `join/index.html` may only load `app.js` and `style.css`. An empty visit throws “Invalid Web Join invite” at `join/crypto.js:24`. `join/app.js:85-94` shows that headline. The home screen therefore does not send the WebJam choice or the `?go=webjam` shortcut there. It stays on `/hangout/` and says “Ask your host to send the invite; tap it and you're in.”

A direct visit to `/join/` still shows the pinned headline until a controlling service worker can insert the Hang Out note. The worker cannot insert that note before it is installed, and the pinned document has no script slot of its own.
