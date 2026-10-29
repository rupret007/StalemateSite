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

## Evidence and reproduction

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
