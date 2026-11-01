# Watch playback control and initialization

October 25, 2026 application fix. This changes browser playback interpretation
for private watch rooms and lobby watch activities. It changes no host signing,
replay sequence, room/participation authority, consent, invitation, provider
qualification or wire format.

## Distinguish readiness, playback and local policy

The YouTube API documents `onReady` as the point where the iframe can receive
API calls. `onStateChange` provides a player state and target; it does not
identify a trusted user gesture. Autoplay denial is a separate event. See the
[official YouTube IFrame API events](https://developers.google.com/youtube/iframe_api_reference#Events).
Consequently, a constructed guest iframe or a blocked guest is not evidence that
the host's iframe is ready or has started playback.

Each current source now tracks actual observed PLAYING state and a pending
scripted play attempt. While shared intent requests playback, initialization
PAUSED state cannot become a shared pause before the iframe has actually played.
An initially shared-paused source remains eligible for host scrubbing even if it
has never played. A delayed autoplay denial is relevant
only while such a play attempt is pending; after actual playback it cannot latch
the block flag over a subsequent host pause. State callbacks must match the
current player instance and its current state. Source replacement, failure and
teardown reset this local evidence.

The existing 900 ms synchronization window still suppresses a matching
programmatic state/position echo. It no longer discards an opposing host control
in lobby watch activities. Actual pause/play after readiness can publish during
that window. Private rooms retain their existing matching-echo distinction.
Polling still covers a paused host scrub that produces no state-change event.

Deferred publications recheck current host/operator authority and bind to the
player/source, plus the lobby room generation. A queued callback from a retired
or rejoined activity cannot publish into the replacement. Existing loader
retirement, autoplay prompt, blocked-host, late-callback, signed-host and replay
guards remain.

This does not invent a user-gesture signal from the YouTube callback. It uses
observed playback and current shared intent to prevent initialization echoes
from being confused with controls. An iframe that never started is already
locally paused; its initial PAUSED state is not a command to pause everyone.

## Reproduction and validation scope

The original combined-source full browser failure is preserved separately. Its
private shared-pause test passed five isolated repeats, so that result alone did
not establish a deterministic production cause. A controlled delayed-host-ready
fixture reproduces the setup race: the guest is blocked while the host has not
received `onReady`; a preready pause callback is correctly ignored by the loader,
and initial shared playback follows readiness. The test now establishes actual
host PLAYING before using its controls, retaining the shared-pause assertion and
existing timeout.

Scoped browser and unit scenarios exposed concrete
behavior gaps, including a host pause inside the lobby synchronization window,
initial PAUSED before delayed autoplay denial in a private room, stale blocked
events and a queued callback crossing a rejoined activity lifetime. The new
actual-client unit tests control time and callbacks. Browser tests use two
contexts, the actual application, local WebSockets and real signing/authority
paths with a deterministic offline YouTube stand-in. The immediate-control test
fixes `Date.now` inside the 900 ms window while browser timers and sockets run;
other policy and readiness tests use normal time.

Final focused checks passed 21 unit tests and all 14 policy browser cases. The
same frozen playback source also passed all 20 existing loader/reconnect browser
cases. The final policy run replaced a timed readiness delay with a manually
released provider fixture gate; its default remains the existing 10 ms callback.
An earlier combined run had 33 passes and one new test setup timeout on a hidden
Bob control; that setup failure is retained, and the final test opens the panel
before using its actual Hold button. No assertion or timeout was relaxed.

These fixtures do not qualify YouTube network behavior, physical browser autoplay
policies, assistive technology, native WebJam audio or hosted capacity. Real
provider/device checks remain separate. No deployment or operational ownership
changes are included; StoryPool 10-21-26 retains those responsibilities.
