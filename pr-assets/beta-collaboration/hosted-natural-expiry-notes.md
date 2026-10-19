# Original hosted session observation

The original eight-hour observation ended **without proving natural expiry**.
Keep `hosted-natural-expiry.json` as a failed result; a later run must have its
own receipt.

The observed runtime was `0ee7705e-e381-4cb4-a70a-1f26daa10e78`, with protected
client assets matching product source
`b111bb2aa070cd791834f40f26665996ad406421`. The receipt's prior runtime evidence
and asset checks do not constitute a fresh deployment-state query.

| Check | Original result |
| --- | --- |
| Normally issued eight-hour guest session | Verified; one unlock and one admitted guest |
| One unlisted private room, media and YouTube off | Verified at observed samples |
| Terminal result | Failed at `2026-10-19T15:56:30.679Z` |
| Expected expiry | `2026-10-19T16:00:20.779Z` |
| Stop condition | Seventh observed private WebSocket attempt exceeded the six-attempt observation budget |
| Late same-session lobby connection | Not reached |
| Expired HTTP denial and original-token replay denial | Not reached |
| Server expiry close on both current sockets | Not reached |
| Owned session/browser cleanup | Logout returned 200; context, browser and owned sleep helper closed |

The observer stopped 230.100 seconds before expiry. Playwright's WebSocket
creation events count observed attempts, not confirmed successful handshakes.
The seven final close events include cleanup activity. These counts do not
prove continuous connectivity or explain the connection losses.

The browser held passive close-code, generation and timing observations, but
the original runner serialized them only after the final expiry phase. Its
earlier budget failure skipped that serialization; cleanup then destroyed the
browser-held detail. No preserved artifact can recover the missing close
codes. This is a diagnostic omission in the observer, not evidence of an
authentication-expiry defect.

The observation's six-attempt lifetime budget is separate from the product's
consecutive retry policy, which resets after a successful welcome. Preserve
both limits. Do not increase the observation budget or change the product's
keepalive behavior to obtain a passing result.

## Follow-up preparation

A separate observer should retain bounded, sanitized observations before
assertions and freeze the cached evidence before logout or page closure. It
should distinguish connection attempts from passively confirmed open states,
record allowed close codes and generation timing, and label unavailable
handshake status explicitly. Cached samples must retain their observation
times and must not be presented as a fresh state check.

Preparation and offline diagnostic tests are not a replacement for another
real eight-hour acceptance run. They do not prove physical-device, separate
network, owner/staff, real-media, TURN or native-platform acceptance. The
original runner and failed receipt remain unchanged.

The pure diagnostic helper is covered by offline tests for bounded output,
privacy filtering and immutable evidence before cleanup. A separate private
runner uses that helper; preparation does not mean the replacement observation
has started or passed.
