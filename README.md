# Stalemate site

Official site for **Stalemate** — a punk rock band with original songs. Featured lyric video: **Manic**. Named cuts: **Better Than Now** and **Manic**. Next date: **Rockin’ October**, Saturday, Oct 24, 2026, Los Amigo’s, Plano, TX. Set 4:45 PM Central.

## Public surfaces

- `/` — stage hero with the Manic lyric video paired to the Oct 24 countdown and next-show block, plus about. Socials: Instagram, YouTube, Facebook (from [linktr.ee/stalemateband](https://linktr.ee/stalemateband))
- `404.html` — not-on-the-set page

No press kit, EPK, or QR landing. Those pages are not published.

The public pages carry only confirmed facts. No empty shelves, dummy embeds or fill-in copy. The homepage contact form posts to [FormSubmit](https://formsubmit.co/) (`stalemate.punk@gmail.com`); the first real submission emails Jeff a one-time activation link he must click.

## Facts still needed

Do not publish guesses for any of these:

- Stream / store URLs for Better Than Now and Manic
- A public YouTube watch URL for the Manic lyric video (the band channel lists Andrea and It’s Only Been 18)
- ICS for Rockin’ October
- A genuine approved band photo
- TikTok handle
- Press kit / EPK / QR landing (do not publish until the band has them)

The homepage uses evergreen metadata. Its static show card keeps the confirmed date, set time, venue and direct Saturday ticket link usable when JavaScript is disabled or the countdown fails to load. Checkout guidance asks visitors to choose October 24, then select Stalemate; the full festival lineup stays linked separately. This dated fallback cannot expire without JavaScript and needs an HTML update after the show. When the countdown runs, the existing `2026-10-24T16:45:00-05:00` cutoff controls all dated promotions and show actions together; after it, the band/social links remain. This is a promotion cutoff, not a confirmed set end time. The Manic lyric video stays.

Booking/contact: **stalemate.punk@gmail.com**, supplied by the owner and corroborated October 21, 2026. Mail delivery has not been tested.

Member names and roles, confirmed by the owner October 25, 2026 and published in the existing About section: **Sean — Bass and Vocals; Jeff — Guitars and Vocals; Che’ — Drums and Vocals**.

## Visual identity

Rad Dad’s palette (`#171410` ink, `#f4f0e6` cream, `#009ee8` listen, `#ed2765` hot accent, `#b5dc08` focus). **Punk first, ska as the accent** — and the checkerboard stays a full-contrast core signature (24px header band, torn 32px belts, large hero field, card top-rails, button feet). Xerox grain and sticker labels sit around the check, never washed over it. Display type stays Barlow Condensed — chunky outline and print-offset shadow, not another band’s lettering. Accent stickers use cream / lime / blue with ink type so they stay AA. Grain and check never sit at full contrast behind body copy. Layout is a signed-band grid, not Rad Dad’s festival collage. Copy matches Rad Dad’s confidence and specificity, in Stalemate’s own punk rock voice — no reused lines or jokes.

## Analytics

Privacy-safe [GoatCounter](https://www.goatcounter.com/) events (account `stalemate`). No scores, names, or free text — only fixed event slugs.

**Main site**

- `music-apple`, `music-spotify`, `music-youtube`, `music-bandcamp` — streaming links in Listen (not social icons)
- `manic-video-play` — Manic lyric video play
- `show-details` — Rockin’ October info links
- `show-ticket-rockin-october` — the official Rockin’ October TicketSpice link
- `show-cta-header`, `show-cta-hero`, `show-cta-under-video` — existing show-action placements, recorded alongside the ticket category; `show-cta-next-fallback` remains the evergreen follow action
- `nav-home`, `nav-listen`, `nav-about`, `nav-games`, `nav-contact`, … — header/footer in-page nav
- `social-instagram`, `social-youtube`, `social-facebook`, … — `.social-link` clicks
- `scroll-home-25`, `scroll-home-50`, `scroll-home-75`, `scroll-home-100` (and `scroll-404-*` on `404.html`)

**Play hub**

- `hub-open` — hub load
- `hub-card-<game>` — game card clicks (`turdanoid`, `turdtris`, …)

**Per game** (`<g>` = slug: `turdanoid`, `turdtris`, `turdjack`, `crapeights`, `turdrummy`, `turdspades`, `turdomania`, `neon-arkanoid`)

- `play-<g>-start`, `play-<g>-over`, `play-<g>-dur-<bucket>`, `play-<g>-level-<n>` — buckets: `lt30s`, `30s-2m`, `2-5m`, `5-15m`, `15m+`; levels `1`–`9`, `10plus`
- `gameover-turdanoid-share`, `gameover-turdanoid-listen-manic` — Turdanoid end screen
- `music-ingame-play`, `music-ingame-mute` — shared arcade playlist playback and mute actions; playback is counted once per game page, without inferring which song played

These events measure actual visits and actions. Retention improvements require usage data; the release itself establishes no retention uplift.

## Arcade source and synchronization

Reusable gameplay, shared art, and the playlist player live in [Turdanoid](https://github.com/rupret007/Turdanoid). The arcade offers eight games, including Royal Flush Chess against the computer or two players sharing this device, plus ordinary Turdomania with difficulty choices, new boards and undo. Site-specific branding and analytics live in `scripts/stalemate-overlay/`, `scripts/stalemate-strip.css`, and `scripts/play-track.js`. The generated `play/` files are replaced during synchronization; edit their source instead.

The default import pins the shared arcade polish release `e07511d991ea8cd40b313e45f7b6826b48ac27be`. Synchronize a reviewed branch, tag, or exact commit. A local repository avoids a network clone and imports committed files at the requested revision:

```bash
scripts/sync-turdanoid.sh --source ../Turdanoid <full-upstream-commit-SHA>
# Or fetch a reviewed remote branch, tag, or SHA:
scripts/sync-turdanoid.sh <branch-tag-or-SHA>
cat play/VENDORED.txt
npm run test:unit -- --maxWorkers=2
npm run test:e2e
npm run package:pages
```

The importer records the full resolved upstream revision in `play/VENDORED.txt`, copies the shared playlist audio, applies site security/branding/analytics, and removes upstream test files. Chessground, chess.js, Stockfish and the Spatial artwork retain their separate notices and corresponding source under `play/assets/chess/`; see its `credits.html`. Repeating synchronization with the same committed source should preserve the generated result. Validate with the Node 24 runtime used by this site's CI; review the generated diff before committing.

## Local checks

```bash
npm ci
npm run test:install-browsers
npm test
```

Run `npm run test:live:local` to validate the deployment checker at both local URL prefixes. See [audio diagnostics and live verification](docs/audio-live-verification.md) for manual live commands and the explicitly unverified physical-iPhone checklist.

Unit tests use Vitest. Browser tests use Playwright against a local server on **4320** (override with `STALEMATE_TEST_PORT`). The server also mounts the site at `/StalemateSite/` so the GitHub Pages project path can be exercised. Navigation and song names work with JavaScript disabled.

## GitHub Pages (temporary host)

Intended URL until a custom domain exists:

`https://rupret007.github.io/StalemateSite/`

The workflow in `.github/workflows/ci.yml` runs Vitest + Playwright on every push and pull request. After those checks pass, a **deploy-pages** job runs on **push to `main` only**. The separate `Verify published site` workflow then checks both public hosts against that exact revision, with Chromium/WebKit gameplay and real audio checks. Readiness waits for the independently refreshed band domain; browser failures are not retried. Reports and first-failure diagnostics are retained as Actions artifacts.

When you are ready to publish:

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The deploy job uploads the `dist/` package produced by `npm run package:pages`.

Asset links on the homepage are **relative**, so they work at `/StalemateSite/` and later at a domain root. `404.html` detects `/StalemateSite/` vs `/` and sets `<base>` so a nested missing path still finds `styles.css`. The project prefix lives in `site-base.js` as `PROJECT_BASE`.

### Adding a custom domain later

1. Buy the domain and point DNS at GitHub Pages (A / ALIAS / CNAME per [GitHub’s docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)).
2. Add a `CNAME` file at the repo root containing only the host, for example:

   ```
   stalemateband.com
   ```

3. Set `PROJECT_BASE` in `site-base.js` to `'/'`.
4. Replace `https://rupret007.github.io/StalemateSite/` in canonical, Open Graph and share URLs with the live host.
5. In Pages settings, add the custom domain and wait for HTTPS.

Do not invent a domain name here. Check availability before buying.

## What this repo does not include

Rad Dad server deploy scripts, `worker/`, `private/` areas and historical zips. Fresh static files plus the shared test patterns only.
