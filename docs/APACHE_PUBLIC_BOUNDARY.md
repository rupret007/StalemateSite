# Apache repository-root public boundary

The custom-domain Apache mirror can serve files from the repository root, while
the GitHub Pages workflow publishes the explicit public package. An October 25,
2026 GET/status-header-only check of `https://stalemate.band/` found `200` responses for
`README.md`, `package.json`, `package-lock.json`, `scripts/package-pages.cjs` and
`tests/e2e/homepage.spec.js`. These paths are excluded from the public package.
No response bodies were read, decoded or saved during that check.

The root `.htaccess` returns `404` for the exact root development/source/build
directories, dependency/test configuration files and environment metadata. It
also recognizes the existing `/StalemateSite/` project prefix. Matching is
case-insensitive and bounded by a complete path segment or filename, rather
than denying public JavaScript, media or archive extensions. Public pages,
game assets, music, QR/tap routes, calendar files, licensing notices and the two
GPL corresponding-source archives remain available. `.well-known` is untouched.

The implementation uses Apache 2.4 `mod_alias` `RedirectMatch` with a numeric `404`
and no redirect destination. The official [RedirectMatch documentation](https://httpd.apache.org/docs/2.4/mod/mod_alias.html#redirectmatch)
permits this directive in `.htaccess` with the FileInfo override; [Redirect status documentation](https://httpd.apache.org/docs/2.4/mod/mod_alias.html#redirect)
defines the no-destination form for non-redirect statuses. No server directives,
DNS, SSH access, hosting credentials, content, audiences or workflows change.
The Pages packager remains an explicit allowlist and does not publish source
directories or this Apache configuration.

`tests/unit/apache-public-boundary.test.js` checks the observed source paths,
root/project variants, complete package file inventory, GPL downloads and
neighboring public names. It also derives tracked non-public root entries from
Git and compares them with the packager allowlist, so a newly added root source
file fails the boundary test until the policy accounts for it. Actual Apache
qualification is recorded separately
in the release evidence; the configuration-policy unit checks alone do not
prove a running server honors `.htaccess`. After the normal release reaches
the custom domain, repeat unauthenticated GET/status-header-only checks and
verify public game/assets/media paths. Until that succeeds, the original five
public `200` responses remain an open deployment defect.
