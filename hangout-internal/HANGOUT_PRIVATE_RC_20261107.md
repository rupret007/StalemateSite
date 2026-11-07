# Current private candidate — November 7, 2026 UTC

**The private website is delivered; the overall release candidate remains pending.**
Use this checkpoint instead of the earlier candidate identities. Preserve all
[62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md), their original
outcomes and the distinctions between generated tests and real listening.

The invitation-only address is
<https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>.
Stalemate and Rad Dad remain two entrances to the same service. Public band
navigation has not been changed. Invitations and credentials are not included.

**Prepared browser update:** this branch imports the access countdown from
[WebJam PR #450](https://github.com/rupret007/webjam/pull/450), source
`1b0c4f56399843747e82655c0d7a994290b54127`, with all thirteen provenance records
verified. Only four runtime files changed: Join HTML, CSS, app and session code.
The connected page shows this browser's access deadline, gives one final-minute
warning, and offers Leave with keyboard focus. Host shutdown may happen sooner.
Existing expiry/shutdown and provider policies are unchanged. This is prepared
source, not a deployment claim; the live identities below remain separate.
The real eight-hour expiry observer is still pending on the unchanged private
runtime. Do not substitute a clock-controlled UI fixture for that observation.

## Exact delivery

| Component | Observed revision or deployment |
| --- | --- |
| Website reviewed head | `b35e5fcf5904eb99e17de653ddd2234e553bbada` |
| Website PR #222 merge | `45fc36450e0542559818897cf7c200f0a346fd0e` |
| Identical whole tree at review and merge | `5d12703740f48136ed905752ffc4642bd0e6b9c9` |
| Private website Worker version | `33862058-10a5-4a6f-9659-38841d70292f` |
| Private deployment, 100% | `f6cc2976-c845-4ca2-89b3-fa930347a16f` |
| Website rollback version | `75655a50-9e13-4966-bb68-22b45a230c1d` |
| WebJam issuer source | `e735a048de82e26c424e31964a30f1dfbd548df9` |
| Issuer Worker version | `4db649fa-a465-44b4-8487-414987b3a660` |
| Issuer rollback version | `60e3f182-2d11-4740-b89a-74377778766d` |
| Native package source, unchanged | `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c` |

Application review, local checks, GitHub Actions and private delivery proceeded
directly, without StoryPool or Karen. The reviewed changes add daily-cap retry
guidance and restore the chat log's inner message-list/landmark semantics.
Both complete website CI runs on the composed head passed:
[42342523061](https://github.com/rupret007/StalemateSite/actions/runs/42342523061)
and [42342518672](https://github.com/rupret007/StalemateSite/actions/runs/42342518672).
Each reports 2,063 unit checks in 137 files, 813 main browser checks and 34+34
root/project smoke checks, with no retry/flaky summary. Public Pages delivery
was skipped. Earlier head checks are not substituted for these runs.

All 69 prepared assets matched the reviewed source. Only six browser payloads
changed from the prior hosted `b61bb41`: the Join provenance, errors and mailbox
files, and the lobby HTML, CSS and JavaScript. Backend code, beta configuration,
workflows and lockfile did not change. API readback matched all 66 deployed
source modules to the prepared bundle. Effective settings, all 17 existing
plain variables, Durable Object namespaces and secret binding names were
preserved, including the exact approved WebJam origin. AI and Hang Out's
separate chat/media TURN remain off; provider limits and release holds remain.

See the [delivery evidence](../pr-assets/beta-collaboration/20261107/composed-private-rc/delivery.json)
and [source readback](../pr-assets/beta-collaboration/20261107/composed-private-rc/source-readback.json).
The issuer's five reviewed sources and unchanged effective settings were
verified separately; its response hint changes no quota, ledger or credential.

## Demonstrated journeys and boundaries

The [current Mac/Windows proof](../pr-assets/beta-collaboration/20261107/composed-private-rc/mac-windows.json)
used ordinary hosted HTTP/WebSockets from Mac Chromium and actual Windows 11
Chrome 156.0.8078.80. The Windows browser used its existing dedicated test profile,
without fake-device, fake-permission, autoplay-bypass or security-disable flags.
The SSH controller reused the previously verified host and loopback-only debug
forward; it did not change Windows services or general browsing tabs.

- Two normal guests entered through Stalemate/Rad Dad, chose nicknames and
  exchanged messages showing the correct arrival-site badge. Both stayed
  ordinary guest/fan identities. A later joiner saw no earlier transcript.
- Five served runtime payloads matched candidate hashes on Windows. The live
  conversation contained the new named message list.
- At 375px/390px, page width was contained, input and Send were visible, and
  the input remained 16px. Controlled socket reconnect retained an unsent
  draft and started fresh scrollback.
- A simulated microphone denial presented the expected error and Try again.
  It did not open a physical mic or qualify Windows audio hardware.
- Both browser-origin logouts returned 200. Cookies copied into fresh contexts
  on their respective browsers worked before logout and returned 401 after it.
  Original Windows tabs were preserved. No native host or recording started.

Single setup observations were 1,371ms on Mac and 1,176ms on Windows. These
include automation/controller overhead, use one household/network and are
neither audio latency nor a service-level guarantee.

A subsequent [complete Intel WebKit run](../pr-assets/beta-collaboration/20261107/current-journeys/intel-webkit.json)
passed all twelve stages on this exact deployment, including both entrances,
13 runtime payload hashes, fresh scrollback/reconnect, drawing, host/guest
permission separation, Jam invitation sharing, normal closure of both own rooms
and copied-cookie logout rejection. Setup samples were 1,671/906ms and manual
reconnect 208ms. Capture requests were zero. These are individual browser
observations, not audio latency.

The unchanged Mini resource guard had stopped the first scheduled attempt
[before browser launch](../pr-assets/beta-collaboration/20261107/composed-private-rc/webkit-guard-stop.json).
It remains stopped; the later run used the Intel laptop's independently passing
resource guard (load below 2, swap 5.32%, over 21GiB free). QA SDK 1.64.1 and its
WebKit runtime were isolated in an app-owned cache. No shared installation,
StoryPool service or OS security setting changed. Preserve the initial SDK
preparation's missing-Node-PATH failure and its corrected child-process PATH;
the first failed preparation was not counted as a browser pass.

The new [375px](../pr-assets/beta-collaboration/20261107/current-journeys/webkit-375.png)
and [390px](../pr-assets/beta-collaboration/20261107/current-journeys/webkit-390.png)
captures were visually inspected. Page width stayed at the viewport width,
input/Send remained visible and input text was 16px. The named message list and
one visible main landmark passed. This is headless WebKit 27.2 on macOS 15.7.9,
not physical Safari/iPhone or screen-reader qualification.

The [two-room workload](../pr-assets/beta-collaboration/20261107/composed-private-rc/two-room-baseline.json)
ran on prior `b61bb41` before this delivery: eight ordinary guests in two rooms,
32 messages, 128/128 deliveries, no cross-room or duplicate deliveries, peer p95
82ms and maximum 88ms. Both own rooms closed. Eight logouts returned 200 and
later state reads returned 401; copied-cookie replay was not checked for those
eight sessions. This is one-Mac hosted chat evidence, not current music or large
distributed capacity. The unchanged backend makes it relevant baseline evidence,
not a repeated load qualification of the new UI.

One [current web mailbox admission](../pr-assets/beta-collaboration/20261107/composed-private-rc/mailbox-admission.json)
returned empty HTTP 204 with no-store. Later, a separate
[credential preflight](../pr-assets/beta-collaboration/20261107/current-journeys/web-credential-preflight.json)
called the deployed Mailbox client's normal credentials method in actual Windows
Chrome, using a fresh unused synthetic invitation context. Its one request
returned a validated web-scoped two-server bundle, 600-second TTL and the normal
256MiB admission budget. The normal endpoint enforces its current request and
monthly usage policies. Values stayed in browser memory and were discarded with
the context; no credentials were printed or stored. Logout returned 200 and
copied-cookie replay 401. The existing hold file remained unchanged.

This confirms current web credential issuance, beyond the earlier mailbox-only
probe. No host offer, peer connection or media ran. It does not establish which
budget caused the older error, successful ICE/media, native desktop-key issuance,
full music recovery or an account-wide spending guarantee. Recheck normal
headroom and admission before any later bounded media trial; change no limits.

## Current unattended Mac/Windows media proof

The subsequent [generated-media trial](../pr-assets/beta-collaboration/20261107/generated-media/mac-windows-generated-media.json)
passed between the physical Intel MacBook and actual Windows Chrome from
07:23:44 to 07:25:24 UTC. The host used exact tracked `76b1fd7` Web Join service
code and the verified package's fabric, Jamulus server and Opus codec. It did
not drive the packaged desktop UI. Native signature, build, component hashes,
normal production credential preparation and ordinary private guest admission
remained enforced. No test credential endpoint or lab candidate policy was used.

| Trial | Windows observations | Native return observation | End/cleanup |
| --- | --- | --- | --- |
| 40 seconds; measured 40,419ms | 160/160 beacon windows; each E/G/A WAV band in 53 windows; 2,021 received / 2,070 sent packets; reported lost 0; no disconnected windows | Generated browser tone detected in 403 windows | Host end displayed fresh-invite guidance; streams, contexts, peers, native owners and mixer stopped |
| Fresh host/invite; 8 seconds; measured 8,141ms | 32/32 beacon windows; 407 received / 435 sent packets; reported lost 0; no disconnected windows | Generated browser tone detected in 83 windows | Normal browser Leave; all owners stopped |

Both selected pairs were Windows-local `relay` / remote `srflx`. The displayed
listening-delay estimates were 46ms and 44ms. These exclude capture and the host
bridge and are not measured instrument-to-ear delay. The browser's output was
muted, its input was generated, and the native peer used original generated
tones/WAV data. There was no physical capture or recording. The WAV was mixed
by a synthetic Jamulus participant; the application's Shared Track sender
backend and physical instruments were not exercised. Human music acceptance
remains pending. See the [fixture/asset receipt](../pr-assets/beta-collaboration/20261107/generated-media/receipt.json).

The [fresh provider check](../pr-assets/beta-collaboration/20261107/generated-media/provider-preflight.json)
confirmed both active versions and unchanged effective settings before media.
The signed-in [billing observation](../pr-assets/beta-collaboration/20261107/generated-media/billing-headroom.json)
displayed 0.01GB of 1,000GB included and $0 current/projected cost. Those rounded
values are a point-in-time headroom observation, not a spending guarantee.
Normal native credential preparation succeeded before each browser joined.
The prior cap marker was retained byte-for-byte; no limit or hold was deleted,
reset or overridden. This proves this admission succeeded, not which budget
caused the older failure or that a future cap cannot recur.

All disposable browser contexts logged out/closed. A subsequent Mac process
scan found zero WebJam/Jamulus/fabric or fixture-controller processes. The owned
idle test GUI had earlier declined normal AppleEvent quit; it was stopped with
SIGTERM only after verifying its exact PID, owner, source, launch age, no network
sockets and no audio children. That cleanup is not a normal-UI-quit pass. No
older user session, OS security setting or shared service was changed.

### Same-network relay limitation

At pinned native `76b1fd7`, `transport/internal/webjoin/endpoint.go` uses
`ICETransportPolicyNoHost`, IPv4 UDP and a remote public-address filter;
`candidate.go` permits public `srflx` and reviewed relay allocations. The browser
uses `iceTransportPolicy: "all"`, then filters its sealed signaling. Private LAN
and Tailscale candidates are therefore excluded in this production Web Join
path. Same-router placement does not guarantee a direct path. Both actual
trials selected a relay; no router NAT-hairpin diagnosis follows from that alone.

This matches the candidate-policy distinction in the
[Pion policy source](https://github.com/pion/webrtc/blob/main/icetransportpolicy.go)
and [WebRTC specification](https://www.w3.org/TR/webrtc/). A future LAN optimization
needs an explicitly reviewed address/privacy policy, authenticated destination
checks and negative tests; changing production filtering to the lab policy
would remove existing protections. No network policy or port forwarding changed.

## Hosted recovery and delivery-pressure checks

The [five-guest private-room run](../pr-assets/beta-collaboration/20261107/overnight-recovery/five-guest-reconnect.json)
passed on the live version below the delivery table: five ordinary WebKit guests,
one keyed/invite-only QA room, and three simultaneous client-initiated socket
closes with code 4000. Automatic reconnect assigned fresh identities in 1,408ms.
Explicit room rejoin retained founder controls and the founder's unsent private
draft, without sending it or moving it into the lobby. Earlier received text
was absent after reconnect. A fresh line appeared once per guest. The own room
closed; all five normal logouts returned 200 and copied cookies went from 200
before logout to 401 afterward. This is controlled socket-recovery evidence,
not an unannounced TCP outage or a sixteen-client hosted storm.

The [original](../pr-assets/beta-collaboration/20261107/overnight-recovery/first-originless-cleanup.json)
and [second](../pr-assets/beta-collaboration/20261107/overnight-recovery/second-nonjson-cleanup.json)
attempts remain failures: all recovery stages passed, but cleanup returned 403.
The first runner omitted exact Origin and JSON; the second used browser fetch
but still omitted JSON. The service correctly retained its request protections
and did not revoke those tokens. Both rooms/contexts closed. The corrected run
used normal same-origin JSON logout; no service rule or assertion was relaxed.
See the [harness correction record](../pr-assets/beta-collaboration/20261107/overnight-recovery/harness-corrections.json).

In the separate [acknowledgement-stall probe](../pr-assets/beta-collaboration/20261107/overnight-recovery/ack-stall.json),
two ordinary guests waited through the existing two-minute PM gate and accepted
their synthetic private conversation. Only one test browser then suppressed its
application delivery acknowledgements. After 129 paced private-message attempts,
it had received 128 sequenced frames and the service closed it with 4413. It
remained paused rather than reconnecting automatically. The healthy peer stayed
connected and received a fresh ordinary help response. Both logouts returned
200; owned contexts closed. No physical capture, provider credential issuance,
new room, quota change or other person's PM content was involved.

This qualifies the exercised hosted application-credit boundary and isolation.
The receiving browser still drained its network socket; physical slow TCP,
browser suspension, larger capacity and deployed hibernation/restart remain
separate. The [receipt](../pr-assets/beta-collaboration/20261107/overnight-recovery/receipt.json)
pins these files to source `b35e5fc` / version `33862058`, rather than claiming
they were run on the prepared countdown update.

## Additional hosted keyboard and many-room evidence

The [overnight follow-up](HANGOUT_OVERNIGHT_CHECKS_20261107.md) records actual
keyboard entry/error recovery and four responsive layouts on this same hosted
version. A separate nine-guest workload used three three-person Art rooms:
36 messages produced all 108 expected deliveries, with no cross-room or duplicate
copies. The three rooms closed and all nine copied cookies were denied after
logout. These are bounded single-Mac/household browser observations, not media,
large capacity, full accessibility or qualification of a later countdown
runtime. Original plain-Tab failures and the controller's post-run summary error
are retained alongside the successful outcomes. The long expiry run remains
pending and unchanged.

## Current Windows Paint Along

Two ordinary Windows Chrome guests also passed
[real hosted Paint Along](../pr-assets/beta-collaboration/20261107/current-journeys/windows-paint-provider.json):
private room creation/invitation, shared drawing, a hidden guest clear control,
four Bob Ross choices with Grandeur of Summer first, and optional official
materials links. Both actual YouTube timelines advanced by more than 2.5 seconds;
host pause/resume propagated and a pasted custom lesson played on both pages.
No fake provider was used. The browser's output was muted with `--mute-audio`,
so this is timeline/control evidence, not a hearing test. Physical capture was
blocked. The own room closed and both logouts returned 200.

Across 159 third-party HTTP requests, no known invitation or first-party cookie
value matched the checked URL, body or referrer. This is a scoped check of those
fields, not blanket privacy certification or every header/protocol. The separate
browser profile used the installed Google-signed Chrome, loopback-only control,
no fake device/permission or security-disable flags, and endpoint resource checks.
The first launcher lookup had malformed path separators; the retained failure
was corrected by resolving the registered, signature-verified Chrome path. No
browser installation or OS security change was needed.

## Remaining release work

The original requirements remain incomplete. Prior hearing on older builds and
the successful automated checks above cannot close these gates:

1. Current Mac native host to physical Windows Chrome guest: clear speech both
   ways, a short musical passage, leave/rejoin and measured dropout/latency.
   The current generated service/component trials above passed. The exact staged
   Intel `76b1fd7` package and codec hash/signature were also rechecked, but its
   desktop physical-audio journey still needs attended acceptance. OS assistive
   automation is unavailable. When Jeff is awake, initial desktop actions may
   still need him: start Music and copy its fresh browser invitation. All own
   native processes are stopped. Keep unattended physical capture off.
2. Audible shared WAV/MP3 mix on a second device. Local decoder/generated-mix
   success does not prove that the physical input plus backing track reaches it.
   The current [read-only Mac route preflight](../pr-assets/beta-collaboration/20261107/generated-media/shared-track-route-preflight.json)
   found no official BlackHole 16ch/64ch device. That prerequisite is absent,
   rather than a proven sender failure. The shipped backend requires the exact
   official UID/name/channel contract at 48kHz. Before an attended sender trial,
   install the official 16ch driver on the host and recheck the route; 2ch and
   renamed aggregates are rejected. The vendor's
   [installation guide](https://github.com/ExistentialAudio/BlackHole/wiki/Installation)
   requires closing audio applications and installing the package. No driver
   installation, device/default change, audio-service restart or reboot was
   performed while Jeff slept. This is not a requirement for ordinary browser
   guests or for hearing another participant's mix.
3. Second-network comparison when available; current same-household results
   are not Internet-distance rehearsal evidence.
4. Real Webex video and an
   [attended manual audio handoff](HANGOUT_WEBEX_AUDIO_HANDOFF.md), with no
   recording. The current integration opens an external meeting and can bring
   verified native Webex forward on Mac. Automatic cross-app muting/switching
   and an embedded browser meeting are not implemented. Local controls/fixtures
   are not a real meeting or browser SDK qualification.
5. Remaining platform and accessibility acceptance. Native Intel/ARM packages
   are separate from browser support. Windows native remote Join still needs
   appropriate trusted signing; no signing purchase is authorized. Linux physical
   audio and installation remain unqualified. Automated accessibility scans are
   not screen-reader, physical Safari/iOS or full WCAG acceptance. Keep
   [WebKit cleanup issue #448](https://github.com/rupret007/webjam/issues/448)
   and its unchanged original assertion; do not fake a closed audio state.
6. Public-launch decisions in the existing privacy/incident and acceptance
   documents, including all-ages/parental paths, human review coverage and
   qualified legal review for the personal Texas operators. No public launch,
   blanket compliance claim, AI activation or expanded spending follows here.

Use the [website integration guide](HANGOUT_WEBSITE_INTEGRATION.md) for the
finite entry toolkit and partner links. Preserve one backend/namespace. Before
any later update or rollback, re-read the active version and effective settings;
carry every existing plain value explicitly, preserve secrets and reconcile
operator changes. `--keep-vars` alone does not override tracked defaults. Use
the beta config explicitly. These releases changed no state schema; rolling
back code does not promise to undo unrelated external resources or user data.

The receiving website session can download the
[eight-file entry toolkit ZIP](../pr-assets/beta-collaboration/20261107/composed-private-rc/community-entry-toolkit-b35e5fc.zip).
Its [archive receipt](../pr-assets/beta-collaboration/20261107/composed-private-rc/entry-toolkit-archive.json)
records SHA256 `07bdb02a673b36dbcfcf061e57645b5e2d7159484e31d27a4cb4084616c732b1`.
Every exported file matches its source-pinned manifest, and ZIP readback passed.
It contains entry tooling and a neutral link, not the application, native builds,
private notes or invitations. Registration starts disabled/unverified. This
packet neither launches the public community nor grants a new code license.
