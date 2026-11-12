# Video failure guidance

Watch and Paint Along now distinguish a service connection failure, a player
connection timeout, an unavailable video, a video that disallows embedded playback,
and a player-identification error. Retry stays local. When a different video is
needed, hosts are directed to choose one and guests are directed to ask the host.
Unknown errors retain neutral guidance. Raw provider values and exception messages
never become user-facing text.

## Using recovery

- For a connection failure or timeout, check the connection and choose **Retry
  video** when ready. Changing microphone permissions does not fix video loading.
- For an unavailable or embedding-restricted video, the host can use the existing
  YouTube field or Bob Ross choices to select another lesson. On a phone, these
  controls follow Retry inside the activity panel; keyboard focus scrolls them
  into view. Guests can ask the host in chat.
- A player-identification error needs investigation if it persists. This change
  does not ask for API keys or relax privacy, referrer, CSP or browser protections.

The classifications follow the [official YouTube IFrame API error reference](https://developers.google.com/youtube/iframe_api_reference#onError).
Embedding identification requirements are documented in [YouTube's required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).
The existing origin-only iframe metadata, 15-second deadlines, cancellation,
source/room fencing, host authority and shared playback intent are unchanged.

## Evidence and limits

- All 25 actual-client loader/recovery browser cases pass against explicit offline
  provider fixtures. They cover errors before/after readiness, 100/101/150/153,
  unknown-value privacy, source changes, cancellation, retries and host/guest roles.
- Both invitation/privacy browser cases pass; no query/fragment reaches the embed.
- All 97 related client/control/lifecycle unit cases pass. These keep the actual
  failure presenter while mocking only player construction and native interfaces.
- The phone case passes at 375/390 px: no page overflow, visible Retry, keyboard
  access to the 16px YouTube input, and a replacement video shared to both guests.
  Screenshots were inspected; their hashes are in `evidence.json`.

These are local source/fixture checks. The real Chrome video-frame connection
stall remains open; earlier Safari playback does not qualify Chrome. This does
not deliver code, activate a provider, run native music/Webex trials or complete
all 62 requirements. Application PR review and CI precede any guarded private
release; all existing public, recording, AI, spending and relay holds remain.

Reproduce after installing the repository's normal dependencies:

```sh
npx vitest run --project unit tests/unit/hangout-watch-controls.test.js tests/unit/hangout-room-lifecycle.test.js tests/unit/hangout-lobby-media-client.test.js --maxWorkers=1 --no-file-parallelism
STALEMATE_TEST_PORT=4541 CI=1 npx playwright test tests/e2e/hangout-watch-loader.spec.js tests/e2e/hangout-watch-privacy.spec.js --project=chromium --workers=1 --retries=0
```
