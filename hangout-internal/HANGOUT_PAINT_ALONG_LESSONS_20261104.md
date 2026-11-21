# Paint Along: host-selected lessons

Jeff reaffirmed the intended experience on November4: paint along with curated
Bob Ross YouTube episodes, with the option to paste another YouTube video link.
This remains part of Hang Out/WebJam, separate from live music.

The lobby already has six Bob Ross starter buttons, the default episode, and a
shared canvas. Its existing custom YouTube form was hidden in Bob Ross rooms.
This correction exposes that same host-only form in both watch and paint-along
rooms; guest permissions, parsing, synchronization and autoplay recovery remain
in the existing path. The entry tile now describes the episode and custom-link
choices. No episodes are copied or hosted by this change.

Local Chromium open-room suite: all4 cases pass, including a two-visitor Bob Ross
preset switch followed by a custom YouTube-link switch, a visible shared canvas,
and guest-hidden source controls. This suite uses the existing offline YouTube
fixture; it does not prove current provider availability, sound, or live playback.
The initial test command targeted a dependency directory without Playwright;
using the existing readiness worktree's dependencies resolved that setup issue.

Native follow-up branch: codex/paint-along-lessons-20261104 in rupret007/webjam.
It adds a starter episode picker, keeps custom links, changes the misleading
entry summary, and explains the existing Watch a shared lesson path for sound.
The native reference player remains muted; that limitation must remain explicit.
New source/CI, frozen delivery and real listening checks are separate outcomes.
The existing MacBook app and current beta are unchanged by this source-only PR.

All62 acceptance requirements, music trials and private/public release boundaries
remain intact. Do not publish band-site navigation as part of this correction.
