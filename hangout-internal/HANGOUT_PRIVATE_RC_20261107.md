# Current private candidate — November 7, 2026 UTC

**The private website is delivered; the overall release candidate remains pending.**
Use this checkpoint instead of the earlier candidate identities. Preserve all
[62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md), their original
outcomes and the distinctions between generated tests and real listening.

The invitation-only address is
<https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>.
Stalemate and Rad Dad remain two entrances to the same service. Public band
navigation has not been changed. Invitations and credentials are not included.

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
   Jeff closed the older app. The exact staged Intel `76b1fd7` package and
   codec hash/signature were rechecked; normal launch opened it at idle. Its
   default route is the built-in mono mic and external wired headphones.
   No audio children or capture were observed. OS assistive automation is
   unavailable, and a normal AppleEvent quit returned User canceled; no force
   termination or permission override was used. When Jeff is awake, two initial
   desktop actions may still need him: start Music and copy its fresh browser
   invitation. Keep unattended physical capture off.
2. Audible shared WAV/MP3 mix on a second device. Local decoder/generated-mix
   success does not prove that the physical input plus backing track reaches it.
3. Second-network comparison when available; current same-household results
   are not Internet-distance rehearsal evidence.
4. Real Webex video and exclusive audio switching, with no recording. Local
   controls/fixtures are not a real meeting or browser SDK qualification.
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
