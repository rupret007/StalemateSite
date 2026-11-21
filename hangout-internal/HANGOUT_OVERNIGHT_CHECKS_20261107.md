# Overnight application checks — November 7

**The private release candidate remains pending.** These results strengthen the
hosted chat evidence; they do not replace physical music, the actual Shared
Track sender, a second network, real Webex or the remaining public-launch work.
All [62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain intact.

The tested website was source `b35e5fcf5904eb99e17de653ddd2234e553bbada`, private
Worker version `33862058-10a5-4a6f-9659-38841d70292f`. The prepared countdown
import has its own source/CI identity; these are not tests of a later deployed
version. Native packages remain source `76b1fd7`. See the
[current release receipt](HANGOUT_PRIVATE_RC_20261107.md) for delivery and rollback
identities, and the [integration guide](HANGOUT_WEBSITE_INTEGRATION.md) for the
finite two-site entry toolkit. Public band navigation remains unchanged.

## Hosted keyboard and responsive layouts

One ordinary guest entered through Rad Dad using actual keyboard events, opened
the named-channel dialog, received its reserved-name validation error and used
Escape to restore focus to the opener. No room was created. The guest reached
the composer and Send at 375×844, 390×844, 640×512 and 320×256. Both controls
remained within the viewport and uncovered at their tested corners; input fonts
were 16px, Send had a 2px solid focus outline, and the requested reduced-motion
media query matched. A normal private `/help` response arrived without sending
a public message. One main landmark and the Conversation log's Messages list
were present.

This Mac WebKit's plain Tab sequence skipped the entry button. The
[first failure](../pr-assets/beta-collaboration/20261107/overnight-followup/hosted-keyboard-reflow-nov07.json)
and [instrumented isolation](../pr-assets/beta-collaboration/20261107/overnight-followup/hosted-keyboard-reflow-attempt2-nov07.json)
remain failures. The instrumented sequence alternated between the password input
and body rather than reaching the button. No guest was admitted in either run;
their logout/state requests returned 401 and the contexts closed.

Using Option-Tab, the same strict journey
[passed](../pr-assets/beta-collaboration/20261107/overnight-followup/hosted-keyboard-reflow-option-tab-nov07.json).
Apple documents Option-Tab and the related keyboard-navigation setting in its
[Safari keyboard guide](https://support.apple.com/en-az/guide/safari/cpsh003/mac).
No OS or browser setting changed. The successful guest logged out with HTTP 200;
original and copied cookies then returned 401. Physical capture requests were
zero. This was Playwright WebKit 27.2 on the Intel MacBook, not physical Safari,
screen-reader speech, native browser zoom or complete WCAG qualification.

The [375px](../pr-assets/beta-collaboration/20261107/overnight-followup/keyboard-reflow-375x844-nov07.png)
and [320×256](../pr-assets/beta-collaboration/20261107/overnight-followup/keyboard-reflow-320x256-nov07.png)
viewport captures were visually inspected. Geometry checks also covered the
[390px](../pr-assets/beta-collaboration/20261107/overnight-followup/keyboard-reflow-390x844-nov07.png)
and [640px](../pr-assets/beta-collaboration/20261107/overnight-followup/keyboard-reflow-640x512-nov07.png)
captures. Responsive sizes are reflow checks, not proof of native browser zoom.
The reduced-motion preference match alone is not a manual motion audit.

## Nine guests across three temporary rooms

A separate [hosted workload](../pr-assets/beta-collaboration/20261107/overnight-followup/hosted-three-room-workload-nov07.json)
admitted nine ordinary WebKit guests through both site entrances. Three guests
created separate Art rooms through the normal interface; each room held three
test guests under its unchanged eight-person limit. Four paced chat rounds sent
36 messages and produced all 108 expected copies, with no duplicate or cross-room
delivery. Setup took 13,236ms; the message workload took 10,851ms. The 72 peer
delivery observations had median 62ms, p95 72ms and maximum 73ms. They include
controller/input/event-dispatch overhead and are not audio latency or a service
level guarantee.

All three own rooms closed. All nine normal logouts returned 200. Original
contexts returned 401 afterward; nine copied-cookie contexts worked before
logout and returned 401 afterward. The browser closed, capture requests were
zero and no provider credential or media was used. The independent eight-hour
observer remained in its original lobby session. Resource guards stayed within
the existing admission limits. This is one physical Mac and household, three
small rooms and a short paced workload. It does not qualify larger distributed
capacity, one hot room, WAN loss, restart/hibernation or real media.

The [controller record](../pr-assets/beta-collaboration/20261107/overnight-followup/hosted-three-room-workload-controller-nov07.json)
preserves its post-run KeyError: a reused summary parser expected a `checks`
array, while this workload writes metrics. The terminal passed proof had already
been copied. Separate inspection matched the remote proof's SHA256, verified
the runner was no longer present and checked every delivery/room/logout/replay
outcome above. Reporting was reconciled without restarting the test, weakening
an assertion or changing a service. The original stopped summary remains in the
record rather than being relabeled as an initially clean controller run.

## What remains for the next listening session

Follow the [current music sequence](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md#current-listening-sequence--november-7).
The host needs the verified native build; Che can use Windows Chrome for this
browser path. Speech both ways, a musical passage and the actual shared WAV/MP3
sender still need current physical-device acceptance. Generated chords passed
through the normal transport, but that was not the desktop Shared Track sender.
Real Webex video/audio switching and a second network remain separate checks.

The Intel host's last read-only scan found no official BlackHole 16ch/64ch route.
The official 16ch 0.7.1 installer is staged on that host, not installed. Its
[signature/download receipt](../pr-assets/beta-collaboration/20261107/overnight-followup/official-driver-system-download.json)
records SHA256 `57254e2f76cd40db7f3f715238b1a2cb2bd08819d38abf4087f2944f71a3641a`,
valid installer signature and install assessment. The [initial Python HTTPS certificate failure](../pr-assets/beta-collaboration/20261107/overnight-followup/official-driver-staged.json)
remains preserved; ordinary macOS system curl succeeded
with normal TLS verification and the metadata hash matched. No insecure download
flag, administrator prompt, driver installation, audio-service restart or reboot
was used overnight. The [original test WAV](../pr-assets/beta-collaboration/20261107/overnight-followup/shared-track-file-prepared.json)
is also staged: 40 seconds, stereo 48kHz, SHA256
`f5298cbb71fea2a9d394de3c517bea795de97bc445b7020f50f00c8b40e7db45`.
It is generated audio, not a recording. Browser guests need neither this driver
nor the native app.

The real eight-hour guest-expiry observer is **still pending** at this
checkpoint. Its signed deadline is November 7 at 15:55:23UTC / 9:55:23 a.m. Texas.
Keep its clock, TTL, original runtime and existing live process unchanged.
Do not reboot the laptop for driver setup before it finishes or is explicitly
recorded as interrupted. A clock-controlled UI fixture is not its replacement.

AI, separate Hang Out chat/media TURN, all quotas, trust checks and release holds
remain unchanged. No public launch, legal-compliance claim, purchase or recording
follows from these results. Qualified legal review and the documented all-ages,
privacy, moderation and platform decisions remain public-launch dependencies.
The [evidence receipt](../pr-assets/beta-collaboration/20261107/overnight-followup/receipt.json)
pins the source and payload digests.
