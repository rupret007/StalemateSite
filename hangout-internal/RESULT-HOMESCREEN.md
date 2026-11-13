# Hang Out home screen

One icon, one page. Open `/hangout/` and choose Hang Out, Game Night, or WebJam. Add that page to the iPhone or Android home screen and it opens there again.

## Reuse check

Looked at the usual PWA pieces and did not vendor any of them.

- The manifest is the W3C manifest, written for this site. No library.
- [pwacompat](https://github.com/GoogleChromeLabs/pwacompat) (Apache-2.0) only fills in old iOS meta tags. Current Safari reads the manifest, and this page sets the touch icon and Apple meta tags itself.
- [add-to-homescreen](https://github.com/cubiq/add-to-homescreen) (MIT) is an old iOS-only banner. It does not handle Chrome’s install event, and its UI is not this site.
- [pwa-install](https://github.com/khmyznikov/pwa-install) (MIT) covers both platforms, but it is a generic modal plus a dependency. The card here uses the same split (Chrome `beforeinstallprompt`, iPhone Share sheet) with this site’s ink, cream, lime, and checker.
- Workbox (Apache-2.0) is built to cache. The worker here must not cache API, Worker, invite, or grant responses, so a short module worker is the fit.

## What changed

New files, plus two wiring edits. Nothing on the never-edit list was touched (`lobby.js`, `beta-entry.mjs`, `entry-sites.mjs`, `game-night-table.mjs`, `game-night-invitations.mjs`, `lobby/index.html`). No existing page `<head>` needed a tag: `/hangout/` carries the manifest, touch icon, theme color, and Apple tags. The band homepage is unchanged, so its tests and its Add to Home Screen icon stay as they were.

- `hangout/index.html` is the entry. Three large links: the existing Hang Out page, the lobby with `?game-night=1`, and `/join/` for WebJam. Those pages were not edited.
- `manifest.json` is named Hang Out, `short_name` Hang Out, `start_url` `hangout/`, `scope` the site root, `display` standalone, theme and background `#171410`.
- `sw.js` plus `hangout/sw-policy.mjs` register a module worker for installability. It precaches only `hangout/offline.html`. A failed navigation shows “You’re offline.” API, Worker, invite, and grant requests are not intercepted and are not stored. Ordinary successful responses are not stored either.
- `hangout/install-card.mjs` is the card. iPhone (and iPadOS Safari) gets “Tap Share, then Add to Home Screen.” with Share and Add icons. Android Chrome shows Install, enabled when `beforeinstallprompt` fires, and the button calls `prompt()`. Desktop Chrome stays quiet until that event, then shows the same button. The card is hidden in standalone (`display-mode` or iOS `navigator.standalone`) and after “Not now”, remembered in `localStorage`.
- Icons in `assets/hangout-app/` are copies of WebJam’s canonical files: `webjam-mark.svg`, `AppIcon-1024.png`, `icon_512x512.png` (byte-for-byte). 180, 192, and 512 are Lanczos resizes of the 1024 app icon. Maskable 192 and 512 scale that same icon to 80% and center it on the icon’s own background `#121212`, so the mark stays inside the safe zone. The mark was not redrawn.
- `scripts/package-pages.cjs` now copies `manifest.json`, `sw.js`, `hangout/`, and `assets/hangout-app/` into a Pages build. This commit does not package or deploy.
- `tests/unit/hangout-hidden.test.js` still rejects the unlisted path everywhere else. The new entry is the one public file allowed to link the existing Hang Out and Game Night pages. It is `noindex` and is not linked from the band homepage.

## Tests

```
npx vitest run tests/unit/hangout-install-card.test.js tests/unit/hangout-hidden.test.js tests/unit/package-pages.test.js tests/unit/song-title.test.js tests/unit/search-discovery.test.js tests/unit/public-theme-contrast.test.js
```

First run: the five existing files passed. The new file failed to load (`fileURLToPath` rejected Vitest’s module URL). That was fixed by using the repo working directory. Re-run of the home-screen, hidden-path, and Pages package tests:

```
Test Files  3 passed (3)
Tests  33 passed (33)
```

```
npx playwright test tests/e2e/hangout-homescreen.spec.js --project=chromium
```

```
6 passed
```

Checked at 390×844 with an iPhone Safari UA, 390×844 with an Android Chrome UA, and 1440×900 with desktop Chrome. The manifest parses, theme and background are `#171410`, start URL is `/hangout/`, and each icon returns a PNG of the declared size, including 180. The iPhone card shows the Share hint and no Install button. Android shows Install, disabled until `beforeinstallprompt`, then one tap calls `prompt()`. Desktop hides the card until that event. Standalone hides it. “Not now” stays hidden after reload. The three choices return HTTP 200. After fetching beta, invite, and grant URLs, the Cache API holds only `/hangout/offline.html`. Chrome reports no installability errors. Going offline shows “You’re offline.”

The full unit suite and the rest of the Playwright suite were not re-run.

## Screenshots

Outside the repo, in `../hangout-homescreen-shots/`:

- `iphone-390x844.png` — share hint and the three choices
- `android-chrome.png` — enabled Install button
- `desktop-1440x900.png` — choices, card hidden
- `desktop-1440x900-install.png` — same page after Chrome offers install
- `iphone-standalone.png` — card hidden, choices only

## Open questions

- `/hangout/` is not linked from the band homepage. A stranger needs that URL. Should the public nav grow a Hang Out link?
- The entry HTML names the unlisted Hang Out and Game Night paths. It is `noindex` and unlinked from the homepage. Is that disclosure what you want?
- Hang Out opens the page titled Hang Out (draw, watch, talk). Game Night opens the lobby with `?game-night=1`. That query is applied by the beta shell; the static lobby still loads. Should Hang Out open the lobby instead?
- Android may show Install disabled until Chrome fires `beforeinstallprompt`. Chrome often waits for a bit of use before it does.
- The worker is a module script (Safari 16.4 and later). Older iPhones can still use the Share hint without it.
- Relative URLs are meant to work under `/StalemateSite/` as well as the site root. That prefix was not opened in a browser.
- Not checked on a physical iPhone or Android device.

## Phase 2

Four additions on the same home screen. New files, plus head tags on the existing Hang Out room page. The never-edit list is unchanged. Nothing was pushed or deployed.

### Invites open in the app

The manifest still starts at `hangout/` and its scope is still the site root, so `/join/`, the Game Night guest page, and a room link sit inside the app. `handle_links` is `preferred`. `launch_handler.client_mode` is `navigate-existing`, then `auto`, so Android can open that invite in the window that is already running. Chrome’s installability check still reports no errors with those members and the shortcuts below.

iPhone cannot do this. A Safari home-screen icon does not take https links. The in-browser card says so: invite links open in Safari, and the icon cannot take the link. On other browsers, when installation is unknown, the card says this page cannot tell and to switch to the Hang Out icon if the invite stayed in the browser. Standalone hides the card. `getInstalledRelatedApps` missing or empty counts as unknown. There is no `related_applications` list, because a fixed store URL would be wrong on the other hosts this site uses.

The Hang Out room page carries the card in its own head: an invite-only marker, a place marker of `hangout`, the stylesheet, and an empty module tag for `hangout/open-in-app.mjs`. The script records the place name. It does not copy the hash or the query into the page.

`/join/` is pinned, so the worker inserts the same card into a successful HTML navigation after Hang Out has been opened once and the worker is controlling the page. A cold visit to `/join/` before that has no card. Navigations whose path or query contains invite or grant are left alone. `/beta/`, including the Game Night guest page, is left alone, so that page has no card unless the beta shell is edited later. Android can still open those URLs in the installed app because they are in scope.

The inserted script URL has to be the worker’s own origin, and only `https://stalemate.band`, `https://jeffstory.github.io`, `https://rupret007.github.io`, or loopback `http`. A page URL from the navigation can allow that same origin when the worker is the one asking.

### Who’s here

The entry reads `GET /beta/state` and nothing else. No new Worker route. That response is an identity object or a 401 today, not a directory, so the page says “No open rooms right now.”

If a body later includes `rooms` or `tables`, the page shows at most eight open places. Open means a count from 1 up to, and not including, the max, with `key` false and `locked` false. A Game Night table may be locked and still show, because those tables are invite-only. Titles are text. Nicks, emails, secrets, and room ids are dropped. Links use the entry’s existing lobby, Game Night, and WebJam addresses. A browser test stubs that GET to prove the list. Production still shows the empty line.

### Offline

The offline page is the trinity mark, drawn in the page so it shows with no image request, and the heading “You’re offline, we’ll reconnect.” Try again reloads. A failed navigation gets that page, with a base URL so the retry module resolves. The probe is the path only. Any answer, including a 404, reloads. A failed probe waits 1.5 seconds and backs off to 15. The browser’s online event tries immediately. Opening `/hangout/offline.html` itself does not reload, so that visit does not loop.

The worker precaches `hangout/offline.html` and `hangout/offline-retry.mjs` in `hangout-offline-v2`. It still leaves API, Worker, invite, and grant requests alone, and it still does not store ordinary successes. The phase 1 browser check now expects those two cache entries and nothing else.

### Shortcuts

The manifest lists Game Night, WebJam, and Last room. Their URLs are `hangout/?go=game-night`, `hangout/?go=webjam`, and `hangout/?go=last`. No hash and no token. Last room is `localStorage` key `hangout-last-room`, and the value is only `hangout`, `game-night`, or `webjam`. Choosing a link stores that name. The room page stores `hangout`. The join card stores `webjam`. The shortcut follows the matching link already on the entry page. With nothing stored, Last room stays on the entry.

### Tests

```
npx vitest run tests/unit/hangout-phase2.test.js tests/unit/hangout-install-card.test.js tests/unit/hangout-hidden.test.js tests/unit/hangout-room-csp.test.js tests/unit/webjam-join-assets.test.js tests/unit/package-pages.test.js
```

```
Test Files  6 passed (6)
Tests  50 passed (50)
```

```
npx playwright test tests/e2e/hangout-homescreen.spec.js tests/e2e/hangout-homescreen-phase2.spec.js --project=chromium
```

```
14 passed
```

Checked at 390×844 with an iPhone Safari UA, 390×844 with an Android Chrome UA, and 1440×900. The entry shows the empty Who’s here line. The offline page shows the mark and the reconnect line. The room page shows Open in Hang Out, with the Safari limit on the iPhone UA. A stubbed directory shows Drawing room and Royal Flush Chess and hides the nick, the email, and the closed rooms. After the worker controls the page, `/join/` shows the same card. The shortcuts request WebJam and Game Night, and Last room repeats the stored place. Coming back online from a failed navigation loads the 404 page. Screenshot text was checked for a marker string before each shot. No invite or grant value was written into a shot.

The full unit suite and the rest of the Playwright suite were not re-run.

### Screenshots

Outside the repo, in `../hangout-homescreen-shots/p2/`:

- `iphone-390x844.png` — empty Who’s here, share hint, three choices
- `iphone-390x844-offline.png` — trinity mark and the reconnect line
- `iphone-390x844-invite.png` — room page, Safari limit
- `android-chrome.png` — empty Who’s here and Install
- `android-chrome-offline.png`
- `android-chrome-invite.png` — room page, installed state unknown
- `desktop-1440x900.png` — empty Who’s here, card hidden
- `desktop-1440x900-offline.png`
- `desktop-1440x900-invite.png`
- `iphone-whos-here.png` — two open places from a stubbed read
- `android-join-invite.png` — WebJam join with the card

### Limits still open

- Not checked on a physical iPhone or Android device. Android link capture is declared in the manifest; a device still has to be the one that honors `handle_links`.
- The Game Night guest page and the rest of `/beta/` have no in-browser card.
- `/join/` has the card only after a Hang Out visit has installed the worker.
- Who’s here stays empty until `GET /beta/state` includes a room or table list. No directory route was added.
- The lobby removes `?game-night=1` from the address after it loads. The shortcut still requests that URL. The test watches the request.
- Last room with an empty store stays on the entry page.

## FIX1

Moved this report from repository-root `RESULT.md` into `hangout-internal/RESULT-HOMESCREEN.md` so it stays behind the existing `.htaccess` deny on `hangout-internal` and is not a new public root entry. `manifest.json` and `sw.js` remain at the root as packaged public assets. `tests/unit/hangout-hidden.test.js` skips this internal note the same way it skips `HANGOUT_IRC_PREVIEW.md`.

```
npx vitest run tests/unit/apache-public-boundary.test.js tests/unit/hangout-hidden.test.js
```

```
 Test Files  2 passed (2)
      Tests  49 passed (49)
```

```
npx vitest run tests/unit/hangout-phase2.test.js tests/unit/hangout-install-card.test.js tests/unit/hangout-hidden.test.js tests/unit/hangout-room-csp.test.js tests/unit/webjam-join-assets.test.js tests/unit/package-pages.test.js
```

```
 Test Files  6 passed (6)
      Tests  50 passed (50)
```

## FIX2

A stranger who already knows which choice to tap was landing on a closed door. The invite note now leads with one action. A valid room or WebJam link shows **Jump in**, and the iPhone limit is the single line “iPhone opens this link in Safari.” An invalid or missing link shows **Go to Hang Out home**. On iPhone that line still sits under the action.

The WebJam choice and the `?go=webjam` shortcut stay on `/hangout/` and say “Ask your host to send the invite; tap it and you're in.” They do not open `/join/`. That join document is hash-pinned, so a cold visit with no controlling worker still shows its own invalid-invite headline. After the worker is in control, the same note is inserted there. The note is on the home screen before the worker installs.

Android shows menu steps (⋮, then Add to Home screen or Install app) until Chrome fires `beforeinstallprompt`, then the one-tap Install button. Desktop shows “Use the install icon in the address bar, or the browser menu.” until that event. The iPhone Share steps are unchanged.

The three shortcuts use different 192px icons made from the existing WebJam mark: `shortcut-game-night.png`, `shortcut-webjam.png`, and `shortcut-last-room.png`.

`hangout-internal/HOMESCREEN-LOBBY-HOOKS.md` is the lobby work this branch must not do: keep `game-night=1` when `lobby.js` cleans the address bar, and replace the unpublished “Not open yet” gate once the lobby is public.

```
npx vitest run tests/unit/apache-public-boundary.test.js tests/unit/hangout-hidden.test.js
```

```
 Test Files  2 passed (2)
      Tests  49 passed (49)
   Start at  01:17:40
   Duration  897ms (transform 101ms, setup 85ms, import 100ms, tests 567ms, environment 0ms)
```

```
npx vitest run tests/unit/hangout-phase2.test.js tests/unit/hangout-install-card.test.js tests/unit/hangout-hidden.test.js tests/unit/hangout-room-csp.test.js tests/unit/webjam-join-assets.test.js tests/unit/package-pages.test.js
```

```
 Test Files  6 passed (6)
      Tests  50 passed (50)
   Start at  01:18:42
   Duration  4.02s (transform 559ms, setup 316ms, import 671ms, tests 4.36s, environment 4.02s)
```

```
npx playwright test tests/e2e/hangout-homescreen.spec.js tests/e2e/hangout-homescreen-phase2.spec.js --project=chromium
```

```
  15 passed (20.0s)
```

Screenshots are outside the repo, in `../hangout-homescreen-shots/fix2/`:

- `iphone-390x844.png` — Share steps and the WebJam host line
- `android-chrome.png` — menu steps before Chrome offers Install
- `desktop-1440x900.png` — address-bar install hint
- `iphone-390x844-jump.png` — valid room link, Jump in, one Safari line
- `iphone-390x844-invite.png` — invalid room link, Go to Hang Out home
- `android-chrome-invite.png`, `desktop-1440x900-invite.png`
- `webjam-ask-390x844.png` — shortcut stays on the home screen and asks for the host’s link

0 failed. The full unit suite and the rest of the Playwright suite were not re-run.
