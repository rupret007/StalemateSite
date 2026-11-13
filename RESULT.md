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
