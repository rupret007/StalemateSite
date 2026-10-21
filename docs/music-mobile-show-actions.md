# Music controls, mobile results and confirmed show actions

The shared source player saves the current track and playback position locally.
It restores the position after media metadata is available and waits for the
existing user gesture and game/visibility gates before playing. Next advances
through the five songs; Songs opens a keyboard-accessible native selector. Picking
or skipping a song respects music-off and game-pause states. Storage failures
leave music usable. This is device/browser-local continuity, not cross-device sync.

The calendar download represents **Stalemate's set start**, October 24, 2026,
4:45 PM Central / 21:45 UTC. No set finish has been confirmed, so the event omits
DTEND and DURATION; its description makes that clear. Directions use Los Amigo's
Sports Bar + Bites, 8604 Preston Road, Suite 100, Plano, TX 75024. These facts were
checked against the [festival schedule](https://rockinoctober.com/) and the
[venue's event page](https://losamigosplano.com/events) on October 21, 2026.

Calendar and directions links follow the existing show cutoff and disappear when
the next-show promotion expires. The CRLF-folded calendar is a static public asset,
works under both root and project prefixes, and is included in the Pages package.
A future confirmed show needs a new stable UID, verified venue, and an accurate
start time; publish an end only when confirmed. Calendar downloads are snapshots,
so later schedule changes do not silently update visitors' saved events.

Validation covers decoded media resume between games, next/selection/mute,
keyboard access, actual downloaded calendar bytes, timezone equivalence, the
existing cutoff, and result sharing in desktop Chromium and emulated mobile
Chromium/WebKit. Physical phones, installed Maps/calendar apps and native OS
share sheets are not available in this environment; their acceptance remains
unverified. Record any first failures and CI retry counts in the release evidence.
