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

The scheduled current-version WebKit Art/Jam run waited for the ordinary room
allowance, then [stopped before opening a browser](../pr-assets/beta-collaboration/20261107/composed-private-rc/webkit-guard-stop.json)
at the unchanged resource guard. A subsequent read observed 4,144.19/5,120MB
swap (80.94%), above the existing 80% threshold; load and disk were within their
limits. This is neither a browser pass nor a production defect. Keep the first
stop receipt and recheck actual resources before one later attempt. The full
current WebKit journey remains pending; do not substitute the earlier complete
run's version. The [November 6 receipt](HANGOUT_PRIVATE_RC_20261106.md) remains
historical.

The [two-room workload](../pr-assets/beta-collaboration/20261107/composed-private-rc/two-room-baseline.json)
ran on prior `b61bb41` before this delivery: eight ordinary guests in two rooms,
32 messages, 128/128 deliveries, no cross-room or duplicate deliveries, peer p95
82ms and maximum 88ms. Both own rooms closed. Eight logouts returned 200 and
later state reads returned 401; copied-cookie replay was not checked for those
eight sessions. This is one-Mac hosted chat evidence, not current music or large
distributed capacity. The unchanged backend makes it relevant baseline evidence,
not a repeated load qualification of the new UI.

One [current web mailbox admission](../pr-assets/beta-collaboration/20261107/composed-private-rc/mailbox-admission.json)
returned empty HTTP 204 with no-store from the real protected Join origin.
It consumed one normal admission request. No host offer, TURN mint or media
occurred, and the existing hold file stayed unchanged. This proves mailbox
admission at that time, not full Web Join recovery, monthly credential headroom
or which budget caused the older quota error.

## Remaining release work

The original requirements remain incomplete. Prior hearing on older builds and
the successful automated checks above cannot close these gates:

1. Current Mac native host to physical Windows Chrome guest: clear speech both
   ways, a short musical passage, leave/rejoin and measured dropout/latency.
   The MacBook's older app was still open at the 06:04 UTC read-only check;
   no app was stopped or competing session launched. When Jeff returns, quit
   the old app normally, then verify the staged package and actual audio route.
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
