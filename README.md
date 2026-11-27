# Stalemate site

Official site for **Stalemate**, a punk rock band with original songs. The homepage features the **Manic** lyric video.

## Public surfaces

- `/` has the Manic lyric video, band information, Hang Out and Arcade links, and booking contact.
- `/play/` has nine Arcade games.
- `/qr/` and `/tap/` are entry points for printed links and NFC tags.
- `/404.html` helps visitors get back to the band site or Arcade.

The band links to Instagram, YouTube, and Facebook. [Stalemate Linktree](https://linktr.ee/stalemateband)

The public pages carry only confirmed facts. No empty shelves, dummy embeds or fill-in copy. The homepage contact form posts to [FormSubmit](https://formsubmit.co/) (`stalemate.punk@gmail.com`); the first real submission emails Jeff a one-time activation link he must click.

## Facts still needed

Do not publish guesses for any of these:

- Stream / store URLs for Better Than Now and Manic
- A public YouTube watch URL for the Manic lyric video (the band channel lists Andrea and It’s Only Been 18)
- A genuine approved band photo
- TikTok handle
- Press kit / EPK

The homepage uses evergreen metadata. Its static show card keeps the confirmed date, set time, venue and direct Saturday ticket link usable when JavaScript is disabled or the countdown fails to load. Checkout guidance asks visitors to choose October 24, then select Stalemate; the full festival lineup stays linked separately. This dated fallback cannot expire without JavaScript and needs an HTML update after the show. When the countdown runs, the existing `2026-10-24T16:45:00-05:00` cutoff controls all dated promotions and show actions together; after it, the band/social links remain. This is a promotion cutoff, not a confirmed set end time. The Manic lyric video stays.

Booking/contact: **stalemate.punk@gmail.com**, supplied by the owner and corroborated October 21, 2026. Mail delivery has not been tested.

Member names and roles, confirmed by the owner October 25, 2026 and published in the existing About section: **Sean — Bass and Vocals; Jeff — Guitars and Vocals; Che’ — Drums and Vocals**.

## Visual identity

Rad Dad’s palette (`#171410` ink, `#f4f0e6` cream, `#009ee8` listen, `#ed2765` hot accent, `#b5dc08` focus). **Punk first, ska as the accent** — and the checkerboard stays a full-contrast core signature (24px header band, torn 32px belts, large hero field, card top-rails, button feet). Xerox grain and sticker labels sit around the check, never washed over it. Display type stays Barlow Condensed — chunky outline and print-offset shadow, not another band’s lettering. Accent stickers use cream / lime / blue with ink type so they stay AA. Grain and check never sit at full contrast behind body copy. Layout is a signed-band grid, not Rad Dad’s festival collage. Copy matches Rad Dad’s confidence and specificity, in Stalemate’s own punk rock voice — no reused lines or jokes.

## Analytics

Sign in to the [Stalemate GoatCounter dashboard](https://stalemate.goatcounter.com/) to compare visits by date and review top pages, referring sites, devices, and the events below. Page reports use the public path and the referring site’s origin. Missing pages use one `/404.html` label. The tracker sends fixed event names and omits URL query strings, fragments, names, scores, and free text. [GoatCounter’s privacy policy](https://www.goatcounter.com/help/privacy) describes how it handles IP addresses.

Look for `engagement-home-30s`, `engagement-home-120s`, and `engagement-home-300s` to see how many homepage visits reach each amount of foreground time. The `engagement-arcade-*` series measures the Arcade landing page. Each milestone can fire once per page load and the timer pauses in hidden tabs. A five-minute view reaches all three milestones.

**Main site**

- `music-apple`, `music-spotify`, `music-youtube`, `music-bandcamp` — streaming links in Listen (not social icons)
- `manic-video-play` — Manic lyric video play
- `hangout-open` — opening Hang Out from the homepage
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

The Arcade offers nine games, including Royal Flush Chess against the computer or two players sharing one device, Turd Rush, and Turdomania with difficulty choices, new boards, and undo. Site-specific branding and analytics live in `scripts/stalemate-overlay/`, `scripts/stalemate-strip.css`, and `scripts/play-track.js`. Edit the source files for changes to the generated `play/` directory. Reusable gameplay, shared art, and the playlist player live in the [Turdanoid repository](https://github.com/rupret007/Turdanoid).

The default import uses Turdanoid `8fa052dc3f2cf09961e285e2a63bc87227ab7b3f`, as recorded in `play/VENDORED.txt`. This revision is available in the local canonical Turdanoid repository until its source branch is published. Import the committed revision from that repository:

```bash
bash scripts/sync-turdanoid.sh --source ../Turdanoid 8fa052dc3f2cf09961e285e2a63bc87227ab7b3f
# Or fetch a reviewed remote branch, tag, or SHA:
scripts/sync-turdanoid.sh <branch-tag-or-SHA>
cat play/VENDORED.txt
npm run test:unit -- --maxWorkers=2
npm run test:e2e
npm run package:pages
```

The importer records the full resolved upstream revision in `play/VENDORED.txt`, copies the shared playlist audio, applies site security/branding/analytics, and removes upstream test files. Chessground, chess.js, Stockfish and the Spatial artwork retain their separate notices and corresponding source under `play/assets/chess/`; see its `credits.html`. Repeating synchronization with the same committed source should preserve the generated result. Validate with the Node 24 runtime used by this site's CI; review the generated diff before committing.

## Hang Out homepage entry

The homepage Hang Out link takes visitors to the shared app with the Stalemate entry label. The Arcade remains available from the homepage and the Play solo link.

Before publishing this entry, test the shared app build at the final destination. Open it from both band sites, check that each can return to its own site, and send a room link from one entry to a guest who arrived from the other. Confirm homepage copy matches the activities enabled there. Use the browser checks at both the domain root and the GitHub Pages project path.

## Local checks

```bash
npm ci
npm run test:install-browsers
npm test
```

Run `npm run test:live:local` to validate the deployment checker at both local URL prefixes. See [audio diagnostics and live verification](docs/audio-live-verification.md) for manual live commands and the explicitly unverified physical-iPhone checklist.

Unit tests use Vitest. Browser tests use Playwright against a local server on **4320** (override with `STALEMATE_TEST_PORT`). The server also mounts the site at `/StalemateSite/` so the GitHub Pages project path can be exercised. Navigation and song names work with JavaScript disabled. The missing-page links lead to the canonical site at [stalemate.band](https://stalemate.band/) when JavaScript is off, including from the GitHub Pages project path.

## GitHub Pages and the band domain

The published-site workflow checks the [band domain](https://stalemate.band/) and the [GitHub Pages project site](https://rupret007.github.io/StalemateSite/).

The workflow in `.github/workflows/ci.yml` runs Vitest + Playwright on every push and pull request. After those checks pass, a **deploy-pages** job runs on **push to `main` only**. The separate `Verify published site` workflow then checks both public hosts against that exact revision, with Chromium/WebKit gameplay and real audio checks. Readiness waits for the independently refreshed band domain; browser failures are not retried. Reports and first-failure diagnostics are retained as Actions artifacts.

When you are ready to publish:

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The deploy job uploads the `dist/` package produced by `npm run package:pages`.

Asset links on the homepage are **relative**, so they work at `/StalemateSite/` and at the band domain root. `404.html` detects the mount and sets `<base>` so a nested missing path still finds `styles.css`. The project prefix lives in `site-base.js` as `PROJECT_BASE`.

## What this repo does not include

Rad Dad server deploy scripts, `worker/`, `private/` areas and historical zips. Fresh static files plus the shared test patterns only.
