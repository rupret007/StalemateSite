# Score sharing and arcade search discovery — October 21, 2026

The owner selected recommendations 2 and 6 and authorized implementation and
publication. The approved scope is completed-result sharing for Turdtris and
Turdomania, plus an indexable arcade hub. Keep Daily Dump removed and preserve
all seven games, records/saves, optional audio, keyboard access and both hosts.

Reusable sharing lives upstream in Turdanoid PR #94, source
`37cf287862191eb05d861e108142a67571c157dc`. It prepares a branded 1080-square PNG
before the sharing gesture, includes actual mode/difficulty and clean game URL,
and distinguishes completed Sprint times from unfinished runs. Save image,
clipboard and selectable-text fallbacks work without automatic posting.
Cancellation does not copy; Undo/replay invalidate stale images and status.

The site importer now opts only `play/index.html` into `index,follow`. It supplies
one canonical URL, `https://stalemate.band/play/`, and static metadata/social image
using the band domain for both hosted copies. Individual games and legacy pages
retain `noindex,nofollow`. Robots permits crawling so crawlers can see those meta
rules. The sitemap contains only the band homepage and arcade hub; both new files
are included in the Pages package. No search ranking or immediate indexing claim.

Checks cover actual completed-game snapshots, PNG decode/download, native sharing
API stubs, cancellation, denied clipboard/manual copy, replay, Undo, keyboard and
phone touch, plus no-JavaScript discovery metadata at root and project paths.
Sixteen focused browser cases passed across Chromium and emulated WebKit/Android.
An initial PNG test used a CSP-blocked blob fetch; it now uses allowed image
decoding while retaining the strict CSP. A multi-mode test then assumed the first
welcome screen always appears; its trace showed the correct returning-player
flow. The test now accepts that flow and asserts the actual selected mode. Initial
failures/artifacts are retained; assertions and timeouts were not relaxed.
An initial non-escalated unit run could not bind its local test server; rerun the
unchanged full Node 24 gate with the necessary execution permission.

Release evidence: parent workspace `release-evidence/sharing-discovery/`.
The initial full Node24 gate passed107units/135browsercases,zero retries.
Visual review then found that the normal HUD could draw above the phone result
sheet; the corrected sheet now escapes the playfield stacking layer. Sharing
feedback scrolls into view. New hit checks cover visible stat labels and status.
The first local release smoke also exposed the same returning-player assumption
in its helper, which now waits for the enabled button to be attached and clicks
only when visible. Earlier failure receipts and images are retained.
The final source import repeated identically across161files. Current23-check
local smoke passed without page/requesterrors. Six selected actual score exports
and phone result captures are in pr-assets/sharing-discovery with fixture labels.
Final full source/site gates, source-first merge, deployment and independent
live verification remain pending.
Native OS share sheets and physical phones have not been tested; browser API
stubs verify payloads/fallbacks, and phone layouts/inputs use emulation.

Primary references:
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
