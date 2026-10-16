# Stalemate site

Official site for **Stalemate** — a punk rock band with original songs. Featured lyric video: **Manic**. Named cuts: **Better Than Now** and **Manic**. Next date: **Rockin’ October**, Saturday, Oct 24, 2026, Los Amigo’s, Plano, TX. Set 4:45 PM Central.

## Public surfaces

- `/` — stage hero with the Manic lyric video paired to the Oct 24 countdown and next-show block, plus about. Socials: Instagram, YouTube, Facebook (from [linktr.ee/stalemateband](https://linktr.ee/stalemateband))
- `/qr/` — printed-flyer landing for Rockin’ October
- `/epk/` — press kit (short + long bio, marks, stage plot, rider)
- `404.html` — not-on-the-set page

The public pages carry only confirmed facts. No empty shelves, stub forms, dummy embeds or fill-in copy.

## Facts still needed

Do not publish guesses for any of these:

- Member names and roles (do not name anyone on the site)
- Stream / store URLs for Better Than Now and Manic
- A public YouTube watch URL for the Manic lyric video (the band channel lists Andrea and It’s Been Only 18)
- ICS for Rockin’ October
- Booking email
- TikTok handle

The homepage countdown and next-show block hide after `2026-10-24T16:45:00-05:00` and leave no empty slot. The Manic lyric video stays.

## Visual identity

Rad Dad’s palette (`#171410` ink, `#f4f0e6` cream, `#009ee8` listen, `#ed2765` hot accent, `#b5dc08` focus). **Punk first, ska as the accent** — and the checkerboard stays a full-contrast core signature (24px header band, torn 32px belts, large hero field, card top-rails, button feet). Xerox grain and sticker labels sit around the check, never washed over it. Display type stays Barlow Condensed — chunky outline and print-offset shadow, not another band’s lettering. Accent stickers use cream / lime / blue with ink type so they stay AA. Grain and check never sit at full contrast behind body copy. Layout is a signed-band grid, not Rad Dad’s festival collage. Copy matches Rad Dad’s confidence and specificity, in Stalemate’s own punk rock voice — no reused lines or jokes.

## Local checks

```bash
npm ci
npm run test:install-browsers
npm test
```

Unit tests use Vitest. Browser tests use Playwright against a local server on **4320** (override with `STALEMATE_TEST_PORT`). The server also mounts the site at `/StalemateSite/` so the GitHub Pages project path can be exercised. Navigation and song names work with JavaScript disabled.

## GitHub Pages (temporary host)

Intended URL until a custom domain exists:

`https://rupret007.github.io/StalemateSite/`

The workflow in `.github/workflows/ci.yml` runs Vitest + Playwright on every push and pull request. After those checks pass, a **deploy-pages** job runs on **push to `main` only**. This pull request does not enable Pages and does not merge.

When you are ready to publish:

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The deploy job uploads the `dist/` package produced by `npm run package:pages`.

Asset links on the homepage, `/qr/` and `/epk/` are **relative**, so they work at `/StalemateSite/` and later at a domain root. `404.html` detects `/StalemateSite/` vs `/` and sets `<base>` so a nested missing path still finds `styles.css`. The project prefix lives in `site-base.js` as `PROJECT_BASE`.

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
