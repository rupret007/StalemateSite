# Private-entry recovery

A private lobby tab can outlive its invitation session. The browser hides HTTP
status from a refused WebSocket upgrade, so the old client guessed that the room
might be full, locked or banning the visitor. Normal private entry restored the
actual observed stale-tab failure; its original handshake status was not captured.

After an initial protected-shell upgrade fails, the client now makes one
read-only, same-origin `/beta/state` request. Only HTTP 401 offers **Open private
entry**, leading to the ordinary `/beta/` invitation page. The nickname stays in
the gate. An expired reconnect keeps its unsent draft under its original context
and makes it read-only on the existing session-ended surface.

The check stops after three seconds, page departure or a newer join. It never
renews access automatically, follows redirects, reads an invitation or retries.
Healthy/public connections do not probe this private endpoint. Other statuses
and network failures retain neutral recovery. Server authentication, caps,
permissions, source-sharing preferences and public entrances are unchanged.

## Local validation

- The actual client JSDOM harness: 32 passing tests, including 401 vs
  200/403/429/503, network failure, timeout, late result, page departure,
  owner recovery and preservation of the reconnect draft.
- Chromium and WebKit: six passing private-entry browser cases, covering 401
  at 375/390 px and a 503 outage. Tests reject the WebSocket upgrade through
  the real loopback HTTP handler; `/beta/state` is a named fixture.
- Existing Chromium guest and verified-owner refused-reconnect cases both pass.
- The full Chromium moderation journey passes: a selected-person ban still
  blocks the original identity, allows an unrelated device on the same address,
  and removes only the selected stored rule while another ban remains active.
- Screenshots were visually inspected; the recovery link wraps inside the page
  and opens through keyboard activation. Hashes are in `evidence.json`.

The initial CI run on `d2fd6f4` passed all 2,102 unit tests and 859 browser tests;
one existing moderation journey failed because it expected the old admission
wording. Both wording expectations were updated without changing its restrictions
or unban checks. That complete journey then passed locally. Full CI on the new
PR head must pass before merge; these earlier counts are historical evidence.

These checks do not prove live cookie expiration, current native audio, Webex,
full accessibility or all 62 acceptance requirements. The private runtime is
unchanged until separately reviewed delivery and current live verification.

Reproduce from the repository root after installing the normal dependencies:

```sh
npx vitest run --project unit tests/unit/hangout-lobby-client-context.test.js --maxWorkers=1 --no-file-parallelism
STALEMATE_TEST_PORT=4539 CI=1 npx playwright test tests/e2e/lobby-private-entry.spec.js --project=chromium --project=webkit-community --workers=1 --retries=0
STALEMATE_TEST_PORT=4539 CI=1 npx playwright test tests/e2e/lobby-guest-journeys.spec.js --project=chromium --workers=1 --retries=0 --grep 'refused reconnect'
STALEMATE_TEST_PORT=4539 CI=1 npx playwright test tests/e2e/lobby.spec.js --project=chromium --workers=1 --retries=0 --grep 'three fans'
```
