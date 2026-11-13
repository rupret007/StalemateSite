# Home screen hooks

The home screen opens Hang Out, Game Night, and each Who’s here row on `hangout/door.html`. That page matches the label, keeps the name field and the enter button visible, and puts `game-night=1` back if the address bar is cleaned.

A direct visit to the lobby still runs `lobby/lobby.js`. This branch must not edit that file, `entry-sites.mjs`, or `lobby/index.html`. Apply the patch below there. Until it lands, `sw.js` inserts `hangout/lobby-door.mjs` only after the service worker is already in control, so the first lobby visit still needs this source change.

## Keep `game-night=1`

In `lobby/lobby.js`, stop ignoring the flag outside the beta shell:

```javascript
let gameEntry = gameNightEntry?.(params, location.hash) || null;
```

Just before the address bar is cleaned, keep only that flag (and a single safe table name). Drop `preview`, `relay`, `turn`, and any invite or grant query. Do not write those values back into the URL, storage, or the page text.

```javascript
const tables = params.getAll('table');
const table = tables.length === 1 && /^[a-z][a-z0-9]{2,15}$/.test(tables[0]) ? tables[0] : '';
const keptNight = gameGuestQuery
    ? gameGuestQuery
    : gameEntry
        ? `?game-night=1${table ? `&table=${table}` : ''}`
        : '';
if (location.search) history.replaceState(gameGuest ? { gameSessionRef: history.state?.gameSessionRef || gameGuest.sessionRef, gameExit: gameGuestExit } : null, '', location.pathname + keptNight + location.hash);
const pendingRoomFromInvite = gameEntry ? '' : inviteHash.get('room') || '';
if (pendingRoomFromInvite || gameEntry) history.replaceState(null, '', location.pathname + keptNight);
```

Replace both existing `history.replaceState` calls that use `gameGuestQuery` alone. `keptNight` is `?game-night=1` when `gameEntry` is set and the visitor is not a seated game guest.

## Do not hide the name field or the enter button

Replace the unpublished-lobby branch:

```javascript
if (!previewKey) {
    $('[data-gate-copy]').textContent = 'Not open yet. The band is still building this one.';
    $('[data-enter]').hidden = true;
    $('.nickrow').hidden = true;
}
```

with:

```javascript
if (!previewKey) {
    $('[data-gate-copy]').textContent = 'Pick a name and jump in.';
    $('[data-enter]').hidden = false;
    $('.nickrow').hidden = false;
    if (gameEntry) {
        const heading = document.querySelector('.gate-headline');
        if (heading) heading.textContent = 'Game Night';
        const title = document.querySelector('h1');
        if (title) title.textContent = 'Game Night';
    }
}
```

The later assignment still disables the button whenever `previewKey` is missing. Change it so a public visit can use the button:

```javascript
$('[data-enter]').disabled = Boolean(previewKey) && !relayBase;
```

Drawing room, Watch party, and a named game are not separate lobby URLs. The home screen sends each name to `hangout/door.html` with its own `kind` and `title`, and a game also keeps `game-night=1`.
