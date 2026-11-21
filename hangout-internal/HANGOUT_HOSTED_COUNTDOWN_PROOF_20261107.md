# Delivered browser countdown and generated media — November 7

**One automated generated-media trial passed on the delivered private repair.
The overall release candidate and separate real-duration expiry test remain
pending.** All [62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) are preserved.

This observation used website source
`d8c08fb88b94429f03d13d9beaf01d8ffd301e1a`, private version
`c2271048-aaa3-4649-8e9e-48dd46212da5`, unchanged issuer
`4db649fa-a465-44b4-8487-414987b3a660`, and verified Intel native package
components/source `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c`. It is later than the
chat/Art-only post-update checks in the [repair checkpoint](HANGOUT_PRIVATE_REPAIR_20261107.md).
That earlier packet did not demonstrate a connected music countdown; this
separate packet does.

Later [Mac and Windows browser checks](HANGOUT_CURRENT_BROWSER_CHECKS_20261107.md)
also passed on this exact delivered version. They cover chat, mobile layout and
recovery, with physical capture excluded; they do not extend this Linux media
trial into a Windows listening or Shared Track claim.

## Scope and results

The Intel host used the verified package components and tracked services
with a synthetic Jamulus participant. The guest was sandboxed headless Linux
Chromium 156 on NucBox's already running Ubuntu environment. It entered as an
ordinary guest through the real private service, checked thirteen served runtime
hashes, used normal native/browser credential issuance, and supplied a generated
440Hz microphone stream. Browser output was muted. No physical microphone,
camera, human voice, instrument, recording, desktop GUI sender or Shared Track
action was used.

The original forty-second WAV remained byte-identical at SHA256
`f5298cbb71fea2a9d394de3c517bea795de97bc445b7020f50f00c8b40e7db45`.
During forty seconds, all 160 beacon windows were detected, with 54/53/53
windows for its E/G/A chord sections. The guest received 2,065 packets and sent
2,115, with zero observed packet loss or disconnected sampling windows. The
native participant also detected the guest's generated tone. The selected pair
was relay/srflx; same-household transport does not establish second-network or
local-direct behavior. The displayed 46ms estimate excludes capture/host-bridge
delay and is not measured physical musical latency or a service guarantee.

The connected page displayed its actual access countdown, decreasing naturally
from 594 to 593 seconds in 1,209ms. Join was hidden, Leave received focus, and the
timer disappeared after normal Leave. No clock or TTL changed. The inspected
[connected screenshot](../pr-assets/beta-collaboration/20261107/hosted-access-countdown/connected-countdown.png)
shows the single Leave action, remaining browser time, host-may-end-sooner
explanation and relay status. It contains no private invite or user transcript.

Normal Leave ended generated streams, peer connections and audio contexts.
Logout returned 200, and original/copied cookies subsequently returned 401.
The native fabric, fixture, mixer, second bridge and tone thread stopped
normally. Independent readback matched the exact remote proof/harness and found
no owned browser-harness process. The final read-only check reconfirmed native
idle state, all 32 source hashes, the unchanged WAV, deployed identities,
settings and the existing cap-marker hash. The native host's original
155-second deadline was retained.

## Retained stops and remaining work

The initial preflight stopped with AssertionError before starting any native
session or minting provider credentials. Its failing provider response was not
retained, so its exact cause is unestablished. The first diagnostic also
incorrectly assumed GraphQL's `errors` could not be null; that diagnostic stopped
without starting media. Later separately timestamped normal TURN and SFU reads
succeeded. The continued preflight retained those responses, fresh billing
corroboration, native/source/resource checks, settings and the cap marker before
admitting this one bounded trial. Empty SFU rows were not treated as zero usage
or headroom. No quota, marker, trust, release or resource guard was cleared.

This proves a connected browser countdown and generated transport on the
delivered repair. It does not qualify actual desktop Shared Track, Windows
physical hearing, instruments, a second network, Webex video/manual audio
handoff, or public all-ages readiness. The [Shared Track next check](HANGOUT_SHARED_TRACK_NEXT_CHECK_20261107.md)
records the actual missing MacBook route prerequisite. No driver or physical
audio session was started while Jeff slept. The distinct repaired eight-hour
lobby observation is still running until its original November 8,
01:16:36.764 UTC expiry; the earlier failed observation remains failed.

The [preparation manifest](../pr-assets/beta-collaboration/20261107/hosted-access-countdown/receipt.preparation.json)
records exact hashes and declared public excerpts. Original unabridged receipts
remain owner-only. Application work is isolated from StoryPool, Karen, shared
operations and public band-site navigation.
