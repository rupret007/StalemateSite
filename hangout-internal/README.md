# Internal Hang Out notes

These files are repository notes for review and development. They are not the
public site.

GitHub Pages for this repository is built by the Test and Pages workflow. That
workflow packages `dist/` with `scripts/package-pages.cjs` and uploads only
that directory. The Pages API still reports `source.path` as `/` for a
workflow build. A change whose new path is under `docs/` is therefore treated
as a published-root change.

Keep internal notes in this directory. `package-pages.cjs` refuses to copy
`docs/`, `hangout-internal/`, tests, the worker, or dependencies into the
artifact. The package test checks that the built `dist/` contains neither
`docs/` nor `hangout-internal/`. Do not move these notes back under `docs/`
to satisfy a link or a preview.
