# Keyboard and short-viewport recovery

At a 320 × 256 zoom-equivalent viewport, WebKit could bring the message input
into view while leaving its enclosing composer border one pixel off-screen.
The client now reveals the complete composer after native focus only if it is
vertically clipped in a short viewport. It keeps the focus and draft unchanged,
coalesces rapid focus events and cancels pending work on page leave. Ordinary
visible layouts are untouched. A proposed CSS-only inset failed and was reverted.

The existing accessibility journeys now run in the WebKit community project as
well as Chromium. The macOS WebKit tests use Safari’s documented Option-Tab
sequence; other engines/platforms retain Tab. The manual-invite-copy test records
its natural layout first, then scrolls past Copy invite deliberately so keyboard
return must reveal it. Its focus, complete-button bounds and hit-testing checks
remain strict. No browser preference is changed.

Validation: 60 cases passed across the two engines. Before the correction, 57
passed and three failed: the clipping defect plus two scroll-setup assumptions.
93 related actual-client unit cases also passed; exact-head CI is reported on the PR. All 62 original
requirements remain byte-identical. These are local browser/relay and responsive
viewport results, not physical iOS, native zoom, VoiceOver speech, deployed
candidate, native Music, Shared Track hearing or Webex qualification.

The screenshots show 375/390px long-message wrapping and composer/Send visibility
in both engines, plus the 320px short viewport. Vertical document scrolling at
that short height is intentional. No real invitation, credentials or provider
media request is present in these fixtures.

Primary references:
- [Apple: Safari keyboard shortcuts](https://support.apple.com/en-lamr/guide/safari/cpsh003/mac)
- [WebKit: native dialogs and focus](https://webkit.org/blog/12209/introducing-the-dialog-element/)

A separate live Safari observation omitted the member dialog from native AX
output although Option-Tab and normal visible actions worked. Its cause is not
proved; it is not treated as a reason to replace native dialogs or weaken modal
behavior. Actual Chrome/Safari PM consent/delivery/blocking checks were retained
as private local evidence, separately from these distributable fixtures.

## Playback-status defect found by full CI

The first push at62996c4 passed890 browser cases, but its separate PR run failed
one iPhone15ProMax playback case and marked the same iPhone15 case flaky.
The retained original trace showed real audio advancing from3.45s to10.57s
while a later network `stalled` event replaced its confirmed playing label with
Loading. WebKit reported readyState2 despite a fully buffered track.

The player now uses `waiting` for actual playback buffering. A stalled network
fetch alone neither promotes loading to playing nor demotes confirmed playback.
The HTML media standard distinguishes these events; mute, pause, visibility,
seek-progress checks and playback/retry calls are unchanged. Existing browser
assertions, five-second expectations and retry policy were not relaxed.

The new readyState2 regression failed on the original implementation; all13
related unit tests passed after the correction. The unchanged real-media
playback/persistence/mute/hidden-tab journey then passed twice in each of
Chromium and WebKit iPhoneSE/15/15ProMax (8cases, no retries). These are automated
browser results, not physical iPhone hearing or WebJam Shared Track qualification.

Before this playback change, a detached merge of the keyboard fix with current
private base8b4c2db passed101 related unit and85 Chromium/WebKit keyboard/video
recovery cases. That combined-tree result is distinct from the later head’s CI.

Reference: [HTML media events](https://html.spec.whatwg.org/multipage/media.html#mediaevents).
