# Stalemate site

Official site for **Stalemate** — Jeff (guitar/vocals [CONFIRM]), Che (drums), Sean (bass).
Originals on the board: **Better Than Now** and **Manic**.

This is **not** the Southern California pop-punk band of the same name. Do not link that act.

## Public surfaces

- `/` — off-centre hero, Get tickets + Listen, music, upcoming/past shows, video, members, mailing list, merch placeholder
- `/qr/` — printed-flyer landing (next show, listen, follow)
- `/epk/` — press kit (short + long bio, photos, music, video, interview, stage plot, rider, booking)
- `404.html` — empty-square not-found page

Unknown facts are marked in `[BRACKETS]`. Ticket, stream, social and booking URLs stay blank until the band supplies them.

## Visual identity

Rad Dad’s palette (`#171410` ink, `#f4f0e6` cream, `#009ee8` listen, `#ed2765` tickets, `#b5dc08` focus) on a **ska two-tone checkerboard**: belts, card frames and an 8×8 hero board. Chess-square labels (A1 Music, E4 Shows) stay. Layout is not Rad Dad’s festival collage.

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

Che’s Rad Dad server deploy scripts, `worker/`, `private/` areas and historical zips. Fresh static files plus the shared test patterns only.
