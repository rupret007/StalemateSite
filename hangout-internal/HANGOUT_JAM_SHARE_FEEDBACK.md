# One pending WebJam share per editor

This application protocol fixes a reproduced race: a host submits an invitation,
then submits a corrected paste before the first publication reaches the browser.
The earlier channel update can erase the newer paste even when the later share
is rejected. The original failure is retained. This is invitation publication,
not music enrollment, capture consent or audio delivery.

## Protocol and boundaries

The engine advertises numeric `features.jamShareResults: 1`. An updated visible
Share form adds `jamRequestId`, exactly 32 lowercase hexadecimal characters, to
its existing `cmd` / `jamlink` envelope. Supported feedback operations are the
existing two-argument `invitation` and `web` forms on a channel context. The
current room-instance reference accompanies the normal permission checks.

After the command's output, the caller alone receives:

```json
{"t":"jam-share-result","id":"0123456789abcdef0123456789abcdef","status":"published"}
```

The other status is `rejected`. Feedback contains no invitation, room roster,
private state or new permission. Malformed IDs and unrelated commands receive
no reflected result. The ID is correlation only: it is not authentication,
authorization, a replay guard, deduplication or exactly-once execution. Existing
command, frame, byte, connection and staging limits remain unchanged.

The ID/status live on the message call stack and staged output, not connection
metadata, room/session snapshots, moderation logs or durable records. A rejected
command still follows its existing refusal path. Failed controlled commits
discard this feedback with the rest of the attempted output; absence of a reply
must not be presented as confirmed rejection or successful publication.

## Client behavior

There is one pending request and one editable paste, without a submission queue
or automatic retry. While the correlated request awaits confirmation, Share is
disabled and programmatic `requestSubmit()` cannot send another command. The
host can edit the next paste. Matching current-room publication preserves that
edit across redraw while retaining the pending request. Only the matching
result completes it; publication clears the submitted text only when matching
room state was observed and the editor still holds that same text.

A matching rejection retains the editor and permits a manual correction. An
eight-second advisory changes the status to “Still waiting”; it does not resend,
unlock an uncertain request, cancel a server operation or claim failure. The
paste remains editable. The status tells the host to copy it before leaving or
reconnecting, because those existing privacy boundaries purge invitation drafts.
The existing Leave/connection controls remain available.

Room changes, changed host authority, disconnect and local Stop clear the
pending request, timer and editor. A result from an old room/request cannot
complete a new request. Matching feedback without matching room state keeps the
paste and explains that limit instead of claiming complete confirmation.
None of this opens WebJam, joins a transport, captures media, recalls an already
copied capability or changes the native host's guest/session controls.

## Compatibility and qualification

Deliver matching browser HTML/CSS/JS and the engine through the reviewed
application path while preserving release holds. The feature bit selects the new behavior. Older clients
omit the ID and keep their existing channel-state protocol. An updated client
on an older engine retains the preceding state-based fallback; that mixed pair
does not establish the new one-request/correlated-rejection guarantee. Do not
claim this correction from frontend assets alone.

This change adds no stored schema or provider activation. A rollback still needs
matched assets/engine and the existing socket/writer drain and state recovery
contracts. Do not delete records, change bindings, weaken admission or clear
release holds to obtain a pass.

Verification includes the original lost-paste reproduction, one-request/manual
correction through the real engine, old-room results while a new request is
pending, and an actual delayed-reply advisory without automatic retry. Unit
checks cover per-caller ordering, malformed IDs, host refusal, unchanged rate
limits, no persisted correlation and controlled-output rollback. The held
commit adapter is a unit fixture; it does not qualify native SQLite execution.

The first focused browser run after the correction passed 16 cases once. The
first focused unit run had 30 passes and one new assertion failure: it inspected
an unrelated lobby channel with no `jam` value. The assertion now selects the
actual target Jam room. Its original log remains. After a fresh guard admitted
execution, all 31 focused unit cases passed, then all 18 focused browser cases
passed once without retries, skips or report errors. A later four-file run passed
all64 focused units, including the exact hello-feature expectations. The first
attempt at the expanded browser cases
was refused before Node by load1 16.77 against the unchanged below-10 guard.
After continuation, the ordinary unit project passed 1,867 cases/112 files and
the separate capacity project passed two cases/files: 1,869 local cases across
114 files in total, with no failures or pending cases. These are local runs,
not CI. No capacity threshold, setup or refusal assertion was relaxed.

The first local provider-start attempt stopped on the exact hello-feature
assertion because this change adds `jamShareResults`. The exact expectation now
includes that flag, retaining all previous flags and assertions. The two matching
unit feature expectations are updated too. The corrected explicit mode passed
locally, including ready evidence/available authority, captured original-owner
checks, intentional process loss and a fresh cold owner baseline. A separate
local fifty-guest mode passed 12 publications/600 deliveries, real logout and
cold no-history recovery; admission p95 was 185.387 ms on this Mac ARM run.
Both modes removed their owned processes and temporary state. These are scoped
local native Worker/SQLite results, not native WebJam music, guardian approval,
hosted performance or CI. The old failed attempt remains retained.

Current-source full unit/browser/native evidence and normal review remain
required. Historical fifty-guest/component comparisons apply to their named
committed source; they do not qualify this changed kernel. The explicit eighth
provider-start CI command is now an explicit application workflow step following
Jeff's independent-implementation direction; its actual execution must still be
verified separately. All 62 original outcomes,
actual ARM/Intel/Windows music, Linux, protected hosted journeys, current
age/consent/camera safeguards and AI/TURN/vault/trust/release holds remain.
