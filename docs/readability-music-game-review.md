# Readability, music recovery and gameplay review

The homepage video caption and show-action group now have an opaque dark backing.
Their contrast no longer depends on where the checkerboard's light squares land.
The browser regression checks both desktop widths and samples the caption/actions.

The shared music player distinguishes loading, actual playback, media failure and
browser gesture rejection. A failed song offers Retry song inside Songs; Next can
also recover. Retry respects mute, game pause and hidden-page gates and preserves
the current song/position. Game and visibility events never trigger repeated failed
downloads. Older playback promises cannot overwrite the newer song or paused state.
Preference and gesture updates share one native play request; a stalled fetch does
not label already buffered playback as loading. After a restored seek, actual
advancing playback also clears a stale WebKit loading state; the seek alone does
not count as progress.
The footer retains its existing height and control count.

Native keyboard/touch play and graphics review covers all seven games at desktop,
phone portrait and phone landscape. It found and corrected three further layout
defects: Turdanoid's HUD obscured the top bricks; the desktop Hub pill obscured the
music title; and longer blackjack hands wrapped below the landscape card area.
An extra-short blackjack check also found betting chips behind Deal. The corrected
layout retains 44px action targets and card widths, uses a measured overlapping
card row, and reserves actual remaining height on short screens. Unusually long
hands can be scrolled horizontally. Turdanoid rotation reflows the remaining bricks
without resetting their health, layout identity or game progress.

Baseline failures, corrected results, native-play captures and exact release pins
are recorded in the workspace's release-evidence/readability-music-review directory.
Phone browsers and safe areas are emulated; physical phones and native OS share
sheets are unavailable. Initial result captures from earlier releases use fixtures;
this gameplay review changes game state only through normal inputs and seeded RNG.

The user deferred multiplayer and the other suggested features. Live arcade play
against another person remains feasible as a separate project with server-owned
game state and reconnect support. Existing collaboration/watch-room branches do
not supply that game synchronization. [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)
is a reusable room/WebSocket option to evaluate later; no multiplayer library,
account, infrastructure or recurring hosting commitment was added in this release.
