# Activity work stays in its original room

Drawing and camera negotiation belong to a particular room lifetime. Switching
channels, leaving, losing admission or disconnecting must not carry an unfinished
gesture or delayed peer callback into another room, even if it has the same name
or participant ID.

The previous browser client kept an 80ms brush flush across activity teardown.
The flush then used the current room name, so old points could be published in a
replacement room. Camera offer/answer awaits and queued ICE callbacks similarly
read the current room when eventually sending. Closing the old peer alone did
not invalidate these JavaScript continuations.

## Corrected behavior

- Teardown cancels brush timers and drops unflushed points. Each stroke also
  carries its original room and generation; delayed callbacks cannot flush a
  replacement gesture. A cancelled touch gesture is discarded. Already sent
  points remain in their original room; this does not recall delivered content.
- Incoming activity frames cannot re-establish a torn-down activity context.
- Each peer captures its original room/generation and must still be the exact
  entry in the current peer map before signaling, setting another description,
  draining queued candidates or adding a received track. Every awaited
  negotiation step rechecks that condition. This also covers replacement peers
  with the same ID in the same room.
- Closing a peer removes its map entry before closing the connection, detaches
  callbacks, clears candidate queues and stops received tracks. A late track
  callback stops the track instead of adding it to the new room.

Current-room wire formats, server authority, media opt-in and beta age guards
remain unchanged. This change does not enable TURN, capture audio/video, record
media or qualify a physical camera connection.

## Joined-room received state

Each joined art, paint-along or watch room now owns a separate received activity
cache. A real join seeds it from that room's server snapshot; subsequent stroke,
clear and video frames update only that joined room. The shared decoder copies
nested state, and each cache keeps at most 400 strokes. It does not copy another
room's canvas or the renderer's optimistic, locally queued paint.

Selecting a room renders a separate copy of its received state without requiring
a leave/rejoin repair. Each actual join initializes the selected activity once,
including a fresh join under the same name. Selecting the already active tab does
not restart it. Received own-stroke echoes update the cache while the renderer
keeps its existing own-echo suppression.

Background updates change received data only: they do not attach a renderer,
load a player/provider, create a peer connection or start media capture. A finite
relay timestamp can update the already-existing community clock when the frame
arrives. A video's original `t` remains its play/seek anchor; selecting its tab
must not sample that old anchor as though it just arrived. A playing video's
position therefore includes the elapsed background time. Existing selected-room,
provider and user media controls still apply.

Only a current joined creative room in a connected, active session accepts these
updates. Local pause, Stop sharing or the room's local read-only state prevents
new cache/render updates. Parting or room closure removes that room's cache;
a fresh join replaces it. A new socket session clears received memberships and
chat history. Activity alone cannot recreate an unknown or departed channel.
Existing gesture and media-generation fences still govern delayed callbacks;
a received cache is not permission to resume sharing.

This is tab-memory received state, not a durable-commit acknowledgment, automatic
retry, saved artifact or recording. Confirmation/reconciliation of queued local
paint is a separate concern. Current activity frames identify the channel name,
not a room-incarnation reference, so this change does not promise rejection of
every delayed frame after a same-name leave/recreation. It adds no backend wire
format, capacity or hosted-provider qualification.

The drawing lifecycle regressions also exercise distinct canvases, background
clear/repaint, leave/rejoin and a playing video while a PM is selected, including
an offset client clock. Sharing-control regressions cover late updates after
Stop and one initialization per join. Exact-source execution receipts define
the measured scope; these fixtures do not qualify real provider playback,
physical media, durability or legal readiness.

## Earlier gesture and camera evidence

`tests/unit/hangout-room-lifecycle.test.js` executes the actual browser activity
client and shared drawing reducer in jsdom. Canvas/media platform APIs are
explicit controlled fixtures. Thirteen cases cover brush navigation/teardown,
cancelled/hidden input, captured stale timers, late frames, delayed offer/answer
steps, same-room peer replacement, ICE/track cleanup and positive current-room
drawing/signaling. The initial ten-case run against the previous source had
nine failures and one positive-control pass.

`tests/e2e/lobby-drawing-lifecycle.spec.js` uses two real browser contexts, the
local authoritative engine and actual WebSockets. Browser mouse and keyboard
events hold a drawing gesture across channel-tab navigation. Playwright's clock
holds the existing 80ms timer; it does not mock server frames. The second room
receives no old points, then receives a new gesture from that room. An initial
test setup assumed activity discovery created a second room; discovery correctly
joined the existing room, so the final test explicitly requests a distinct room.

```sh
npm run test:unit -- tests/unit/hangout-room-lifecycle.test.js
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/raddad-playwright \
STALEMATE_TEST_PORT=4542 \
npm run test:e2e -- tests/e2e/lobby-drawing-lifecycle.spec.js \
  --project=chromium --workers=1
```

Retained logs and the new-room screenshot are under the application-local
`shared-community-20261025/room-lifecycle-*` evidence directory. Final full-suite
receipts must identify their actual source revision. Browser/API fixtures are
not hosted, native-audio, physical-camera or assistive-technology proof.
