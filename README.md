# Stalemate site

Official site for **Stalemate** — punk rock originals. Named cuts: **Better Than Now** and **Manic**. Studio session taped **8 October 2026**. Shows are coming.

This is **not** the Southern California pop-punk band of the same name. Do not link that act.

## Public surfaces

- `/` — stage hero, Get tickets + Listen, music, upcoming/past shows, video, about, mailing list, merch shelf
- `/qr/` — printed-flyer landing (next show, listen, follow)
- `/epk/` — press kit (short + long bio, stills, music, video, interview, stage plot, rider, booking)
- `404.html` — not-on-the-set page

Unknown facts stay off the public page. Needed blanks live in the list below — do not invent them in copy.

## Facts still needed

Do not publish guesses for any of these:

- City / hometown
- Member names and roles (do not name anyone on the site)
- Stream / store URLs for Better Than Now and Manic
- Manic lyric-video watch URL
- Studio interview watch URL
- Next show date, venue, city, door time, age limit, ticket link, ICS
- Mailing-list tool
- Merch items
- Booking email
- Instagram / TikTok / Facebook handles

Operational tokens (`[DATE/VENUE/TICKET LINK NEEDED]`, `[MAILING LIST TOOL NEEDED]`, `[MERCH NEEDED]`, `[BOOKING EMAIL NEEDED]`, `[HANDLE NEEDED]`) stay in the HTML as screen-reader-only markers so tests can lock them. They are not shown in the hero.

## Visual identity

Rad Dad’s palette (`#171410` ink, `#f4f0e6` cream, `#009ee8` listen, `#ed2765` tickets, `#b5dc08` focus) with a **two-tone checkerboard signature**: a 16px band under the header, a large faded field bleeding off the hero (not a floating square), 16px belts after the hero and mid-page, card left-rails, and footer bands. One low-contrast check texture sits in the shows ground only — never full-contrast checker behind body text, and not card wallpaper. Type is Barlow Condensed + Source Sans 3. Layout is a signed-band grid, not Rad Dad’s festival collage. Copy matches Rad Dad’s confidence and specificity, in Stalemate’s own punk rock voice — no reused lines or jokes.

## Local checks

```bash
npm ci
npm run test:install-browsers
npm test
```

Unit tests use Vitest. Browser tests use Playwright against a local server on **4320** (override with `STALEMATE_TEST_PORT`). The server also mounts the site at `/StalemateSite/` so the GitHub Pages project path can be exercised. Navigation, tickets, song names and the mailing-list copy work with JavaScript disabled. Previews load only after an explicit tap.

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
4. Replace `https://rupret007.github.io/StalemateSite/` in canonical, Open Graph and share URLs with `https://your-domain/`.
5. In Pages settings, add the custom domain and wait for HTTPS.

Do not invent a domain name here. Check availability before buying.

## What this repo does not include

Rad Dad server deploy scripts, `worker/`, `private/` areas and historical zips. Fresh static files plus the shared test patterns only.
