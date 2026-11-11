# Private acceptance evidence matrix, November 11, 2026

This is a scoped evidence index, not62 completed checkboxes. The original outcomes
are copied verbatim for review; the canonical requirements file remains unchanged.
`L` means an actual UI observation at its stated revision (historical browser
journey rows are c83; November 10 d53 prejoin/refusal and native67 idle results
are labelled separately); `C` completed CI or local
framework tests at their recorded revision; `S` source/static/package/document
review; `G` generated/simulator evidence; `H` explicit human feedback; `U` unqualified.
One evidence class does not substitute for another or extend to a different revision.

The current guide links immutable revisions and the remaining private release,
resource, device and operator gates. [Actual live observations](../pr-assets/private-readiness/20261109/live-journeys.json)
and [screenshots](../pr-assets/private-readiness/20261109/README.md) are sanitized.
CI for a candidate is not a deployed or physical media pass. All pending facts below
remain pending even when a related source test passes.

The [current-source qualification](../pr-assets/private-readiness/20261110/current-source-qualification.json)
adds merged website PR253 and upstream WebJam PR466, the prepared d53 package,
and actual current-tree application/workerd provider-start CI. It does not mark
any live Music, Shared Track, Webex, legal or newcomer outcome complete.
The [afternoon delivery receipt](../pr-assets/private-readiness/20261110/private-delivery/README.md)
records 31 served files and the Chrome prejoin observations. The
[evening release receipt](../pr-assets/private-readiness/20261110/readiness-release/qualification.json)
records 33 served files, missing-invite recovery, the earlier Chrome entry zoom
checks and the Linux archive. The next rollout added invite-expiry recovery
and verified 33 served files. The responsive expiry screens came from an offline
fixture with the staged website bytes. The deployed Chrome check observed the
private admission prompt. [Invite-expiry evidence](../pr-assets/private-readiness/20261111/web-join-expiry/qualification.json)

The earlier private rollout served the Safari dialog fix. A normal guest session
verified the live lobby markup and 33 other files. The extracted Linux package
also passed hosted startup and dummy-audio checks.
[Safari and Linux evidence](../pr-assets/private-readiness/20261111/safari-dialog/qualification.json)

The private beta serves the lobby timeout and single-frame first-join fixes from
PRs 270 and 271. The rollout preserved access, configuration, stable namespaces
and the issuer. An admitted guest verified five protected assets and logged out.
Two hosted WebKit guests then joined on the first attempt, exchanged a Game
Night invitation, played, chatted, rejoined with fresh scrollback and logged out.
The board and Send button stayed visible at 375 and 390 CSS pixels. Native Safari,
physical iPhone and assistive-technology checks remain open.
[Hosted lobby evidence](../pr-assets/private-readiness/20261111/hosted-lobby/qualification.json)
· [Earlier local browser evidence](../pr-assets/private-readiness/20261111/game-night-follow-up/qualification.json)
· [Private rollout and rollback](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md)

The private keyboard fix shipped after the earlier lobby release. Exact hosted
candidate testing covered room exit focus, and the deployed readback verified
five protected files and logout. The Music room and invite rejection worked
against the prior live release without starting audio.
[Keyboard release and Music room evidence](../pr-assets/private-readiness/20261111/band-rehearsal/qualification.json)

The original 62 ID and outcome cells below are copied verbatim.

| ID | Original required outcome | Evidence and scope | Still required / limit |
| --- | --- | --- | --- |
| F1 | One community, with shared people, channels, rooms, identity and moderation; no brand silos | **L,S** — Shared lobby, people, room discovery and text across the two entry contexts; one source moderation service. | Current cross-entry human moderator review and broader platform journeys. |
| F2 | Guests choose nicknames without needing a band account | **L** — Two ordinary guests chose nicknames and joined without a band account. | Retain this property through remaining platform/newcomer checks. |
| F3 | Anyone may host permitted temporary rooms, not only band/staff | **L,S** — Ordinary guests hosted temporary chat, Draw and Paint rooms; host and guest controls differed. | Current Music host/guest, remaining room lifecycle and platform checks. |
| F4 | IRC channels, commands, presence, room/host controls and welcoming quiet rooms | **L,C** — Live topic/+m commands, presence, quiet-room copy and discovery; broader command tests. | Remaining host handoff/kick/ban and current-platform newcomer journeys. |
| F5 | Chat begins at join; connected-session scrollback only | **L,C** — A fresh join excluded earlier authored text; the connected guest retained its own scrollback. | Current logout/revocation and failure boundaries; narrow evidence exceptions remain separate. |
| F6 | Research current primary sources, read product/evidence docs and revalidate repository/release state | **S** — Current source/tree/CI review plus primary YouTube, Apple and WebKit research; dated receipts retained. | Refresh relevant external state before release; outstanding legal/provider/device facts remain outstanding. |
| F7 | Implement small, reviewable changes; finish usable core before expanding scope | **S,C** — WebJam PR 470 and website PR 259 are merged. AE49 has all four hosted builds, four archive checks and ARM startup and Quit evidence. | Finish current Music, Shared Track, Webex and uncoached newcomer journeys. |
| A1 | Both websites open one shared community address with return navigation | **L,S** — Both private entry contexts reached one address with return context; concrete entry toolkit retained. | Receiving website integration remains staged; public navigation deliberately unpublished. |
| A2 | Small “via Stalemate”/“via Rad Dad” beside names/messages and in People | **L,C** — Source badge shown on new messages and in People in actual cross-entry checks. | Retest remaining platforms and preserve source semantics through delivery. |
| A3 | Badge can be hidden; direct, unknown and repeated source values are neutral | **L,C** — Actual hide/show; source tests cover neutral/invalid entrance values. Earlier message badges are not retroactively erased. | Current third-site/direct-input and privacy-boundary journey beyond the observed Mac check. |
| A4 | Entry badge never establishes verified identity, band membership, room powers or staff permission | **L,C,S** — Actual guests remained guests; entry metadata is separate from host/staff authority. | Current real role/revocation adversarial checks; do not infer staff access from a badge. |
| A5 | Audit real login providers | **L,S** — Configured Cloudflare email-code path previously worked; latest owner-panel visit now requests fresh sign-in. | Current real owner/moderator sign-in and account-provider audit beyond guest entry. |
| A6 | Secure first-party sessions; preserve ownership and verified account linking | **C,S** — Session/ownership/linking implementation and regression evidence retained. | Current live ownership/linking/logout/revocation across devices. |
| A7 | No cross-domain cookies, wildcard origins or copied account credentials | **C,S** — Canonical first-party service, exact origins and preserved configuration; no copied site accounts used. | Repeat applicable configuration comparison before later delivery; broader integration audit. |
| A8 | Preserve canonical service, namespace and IDs through migration/rollback | **S,L** — The latest private rollout matched the live Worker, effective bindings and settings, stable IDs and issuer. Immediate rollback is `1b48de76`. | Verify serving state and configuration whenever rollback is exercised. |
| E1 | Adding a basic Join link is simple and needs no site credential | **S,C** — Concrete allowlisted entry toolkit and hash verification; a neutral Join link needs no site credential. | Receiving-site review/install remains staged, without publishing navigation early. |
| E2 | Optional versioned integration contract with verified domains, exact registered origins, scoped permissions and revocation | **S,C** — Optional contract/policy and exact-origin/revocation source tests; distinct from basic Join links. | Live registered integration qualification, ownership and revocation without expanding permissions. |
| E3 | A third test site reaches the same community | **C** — Third-site fixtures/source exist; no current real third-site journey claimed. | Observed private third-site integration into the same community. |
| E4 | Integration revocation is accurate and grants no staff powers | **C,S** — Revocation/role isolation coverage exists in controlled adapters and tests. | Current live third-site revocation and no-staff-power verification. |
| E5 | Safe public package; no repository/private-file copy or output overwrite | **S,C** — Reviewed package: exact8-file allowlist,7 payloads and matching source/payload hashes. | Preserve safe-output/overwrite checks and settle redistribution/license scope before external reuse. |
| E6 | Federation stays outside this requirement | **S** — Federation remains outside this scope; entry context is not federation. | Do not substitute federation work for unfinished private-use requirements. |
| D1 | Accessible retro IRC design, refined typography/navigation/presence | **L,S** — Actual three-pane retro IRC workspace and refined phone fixtures; native screenshot retained. | Broader newcomer/usability review, platform and assistive-technology qualification. |
| D2 | Clear connection, sign-in, loading and error/retry states | **L,C,S** — Browser invitation expiry asks for a fresh link and releases capture. The lobby now offers retry after a stalled join and retains the nickname. Two fresh hosted WebKit guests joined on the first attempt. | Qualify a real replacement Music invitation and remaining owner/moderator sign-in flows. |
| D3 | Welcoming quiet rooms, room discovery and simple creation/join/switch/leave | **L,C** — Quiet lobby, directory, guest creation/join and host closure observed. | Remaining activity/room recovery/host-transfer paths and uncoached newcomer use. |
| D4 | Keyboard navigation and focus | **L,C** — Earlier Chrome and local native Safari focus evidence is retained. Hosted WebKit covered Game Night invitations and return. The Paint Along candidate restored focus to the lobby for both test guests, and the exact script passed deployed readback. | Repeat Paint Along keyboard leave on the deployed release. Verify joined native Safari, screen-reader speech and native startup/Quit. |
| D5 | Screen-reader behavior | **L,C,S** — Native Safari exposed the candidate’s member, command and channel controls in the accessibility tree. The private release serves the reviewed markup. | Verify the joined dialog in live Safari and listen to VoiceOver and NVDA. |
| D6 | Zoom/reflow and WCAG 2.2 AA | **L,C,S** — Actual Chrome 200% and 400% zoom produced 600 and 300 CSS pixel widths. Scroll width matched the viewport and the tested nickname controls retained visible focus. | Verify joined chat, physical mobile, assistive technology and the remaining WCAG 2.2 AA requirements. |
| D7 | Reduced-motion preference | **C,S** — Reduced-motion CSS and enabled reduced-motion fixtures retained. | Verify remaining actual browser/OS preference behavior; no broad accessibility certification. |
| D8 | 375/390px screenshots, no page overflow, input/Send visible, iOS inputs 16px | **C,L** — Hosted WebKit kept the board and Send button visible at 375 and 390 CSS pixels, with no page overflow and a 16 px input. Captures are retained. | Qualify joined chat on a physical iPhone, including focus and keyboard reflow. |
| D9 | Starter/action rows contain themselves and text wraps | **C,S** — Current fixture geometry/screenshots cover wrapping text and self-contained starter/action rows. | Current delivered/physical-device checks, including unusually long text and controls. |
| D10 | Cameras/microphones remain opt-in | **L,C** — No camera/microphone started in the live chat/creative/PM checks; media remains opt-in. | Fresh consent, stop/revoke and device checks before remaining Music/Webex trials. |
| D11 | Review reused components for license and security | **S,C** — All four actual AE49 archives match generated notices and eleven pinned licenses. Prior 67 archive evidence remains dated. | Complete the remaining license/security review and resolve redistribution of the website toolkit. |
| S1 | Measure busy lobby, fan-out, presence and abuse-control bottlenecks | **G,C** — Local loopback checks passed with 50 and 150 real sockets. Native workerd delivered the 50-socket fan-out workload. Both current browser CI runs admitted 150 synthetic guests through the test SQLite gateway with real clocks. | Measure realistic hosted staging bottlenecks and presence/abuse load. |
| S2 | Separate many-room scaling, one hot room and media limits | **G,S** — Scale documentation separates many rooms, hot-room fan-out and media. | Current staging measurements for each distinct dimension. |
| S3 | Bounded outbound delivery and inbound/pending work | **C,S** — Bounded transport, read/write/admission guards and failure tests retained. | Current slow-reader/overload measurements at the intended deployment boundary. |
| S4 | Staging load tiers and realistic user/message/fan-out workload | **G,S** — Documented controlled tiers and admission/room fixtures. | Realistic staging socket/user/message/fan-out workload under existing cost/limit holds. |
| S5 | Reliability/latency targets and cost ceilings | **S** — Existing caps and cost constraints retained; no broad SLO claim. | Measured reliability/latency targets and account headroom at the actual intended load. |
| S6 | Many rooms under load | **G,C** — The local 150-socket run reached 30 rooms and restored room state. | Measure many-room load on the intended hosted boundary. |
| S7 | Reconnect storms | **G,C** — Local controlled reconnects restored membership without replaying ordinary chat. | Qualify a current realistic hosted reconnect storm and authority recovery. |
| S8 | Slow clients and overload behavior | **G,C** — Controlled outbound/slow-client/admission refusals remain bounded. | Observed staging slow-reader and overload behavior, without increasing production limits. |
| S9 | Restart, hibernation and backing-service failure recovery | **G,C** — SQLite transaction/rollback and lifetime/restart/hibernation failure coverage retained. | Current runtime/deployed restart and backing-service failure qualification at required boundaries. |
| S10 | Honest capacity claims without changing production limits or spending | **S** — Capacity docs explicitly limit generated evidence and keep production limits/spend unchanged. | No universal hosted150/200-user or media capacity claim until appropriate measurements exist. |
| P1 | All ages supported through appropriate features and required parental-consent paths | **U,S** — Private13+ and camera18+ guards remain; all-ages scope is preserved as unfinished. | Appropriate feature/data eligibility and required parental-consent paths; operator/legal qualification. |
| P2 | Minimize personal data; no default ID/biometrics, private-message scanning or media recording | **L,C,S** — No ID/biometrics, PM scanning or recording introduced; live tests used synthetic text and no capture. | Complete current data-flow, device/capture and narrow-retention verification. |
| P3 | Shared report/block/mute/ban controls, not one policy per entry site | **L,C** — Actual identity-bound PM block; host moderation/refusal; shared report/moderator source path. | Current real report/human-review/mute/ban across entries, after fresh owner sign-in. |
| P4 | Human review, appeals and honest coverage | **S** — Review/appeal contact and honest coverage documentation retained. | Current human review/appeal journey and operator coverage; no24/7 promise. |
| P5 | Limited evidence access and no nickname-based punishment | **L,C** — Actual exact-message peer block; source identity/role/evidence access regressions. | Current adversarial identity reuse, restricted evidence and staff-role checks. |
| P6 | Ephemeral chat with narrow lawful-preservation exceptions | **L,C,S** — Session-only user scrollback observed; narrow evidence/storage purposes documented. | Current retention/purge and qualified lawful-preservation assessment; no blanket legal claim. |
| P7 | COPPA/child-data, exploitation reporting, intimate-image takedowns, copyright and jurisdiction assessment | **U,S** — Operator confirmed Jeff/bandmates personally inTexas; required legal topics remain explicit. | Qualified jurisdiction/child-data/reporting/takedown/copyright assessment for the intended service. |
| P8 | Resolve applicable launch duties through qualified legal review; no blanket compliance claim | **U** — No qualified legal launch approval or compliance claim established. | Resolve applicable duties through qualified review; private test success is insufficient. |
| P9 | AI assists humans only on disclosed eligible public content after provider/child-data readiness | **C,S** — AI is off; disclosed eligible-public-content/human-review policy and source boundaries retained. | Provider/child-data/operator readiness before any separately approved AI activation. |
| P10 | Different storage purposes/retention documented accurately | **S,C** — Purposes/retention are documented separately from connected-session scrollback. | Current storage/purge/exception behavior and operator/legal review. |
| V1 | Both sites' visitors exchange messages and show/hide source badges | **L** — Observed private Stalemate/RadDad text and badge show/hide on c83. | Remaining supported platform/newcomer qualification; public entrances remain staged. |
| V2 | Ordinary visitors create/join creative rooms and collaborate | **L** — Actual ordinary guests hosted/joined Draw/Paint/chat and collaborated. | Current native Music/SharedTrack/Webex and other original creative/platform outcomes. |
| V3 | Reporting and moderator review work across entries | **C,S** — Earlier report-review receipts retained at their own revisions; current owner login requires email sign-in. | Current cross-entry report and human review; no new report created while reviewer unavailable. |
| V4 | Fresh-join privacy, logout/revocation and role isolation | **L,C** — The hosted WebKit guest returned with fresh scrollback and an ended board. Both ordinary test guests logged out and lost protected asset access. Earlier topic denial and PM consent/block are retained. | Qualify current moderator revocation, account ownership and broader role isolation. |
| V5 | Failures/recovery are clear and truthful | **L,C,S** — The private site serves browser invite expiry, stalled-join retry and Game Night return. Hosted WebKit returned after reload with fresh scrollback. A rejected Music invitation stayed editable and left guest audio join disabled in the hosted room. | Observe recovery with a real replacement Music invitation and media handoff. |
| V6 | Mac, Windows and Linux support qualified honestly | **C,S,L** — Four AE49 archives passed inspection. Both Mac shortcuts select verified AE49 builds and the Mini passed idle launch and Quit. Replacement run 42997398282 built all four desktop targets, including the mounted Mac packages and hosted Windows install, launch and uninstall. | Verify the replacement archives and publisher trust, local startup and actual platform media roles. |
| V7 | Deliver source, tests, screenshots and small PRs | **S,C,L** — PRs 270 and 271 merged after exact browser and native checks. Five protected assets and a hosted two-guest Game Night journey were verified. The hosted 375/390 px captures and prior screenshots are retained. | Finish media and uncoached newcomer journeys. |
| V8 | Deliver integration instructions and a clean concrete package | **S,C** — Concrete entry toolkit, setup/support and restore/rollback guidance retained. | Receiving-site integration review, remaining package/license/platform qualification. |
| V9 | Deliver a migration/rollback plan with remaining dependencies | **S,L** — The current private rollout records serving version `f5319d4a`, verified configuration preservation and immediate rollback `e1c40ea5`. Original Mac shortcuts are preserved. | Refresh resource and trust checks for later switches and verify any restored serving state. |
| V10 | Completion requires observed application journeys and concrete integration package, with unverified work explicit | **L,S,C,G,H,U** — Observed browser journeys and concrete package now exist; evidence layers remain distinct. | All original outcomes still need appropriate proof; uncoached essential private band journeys remain unfinished. |

## Required media evidence beyond these browser rows

| Journey | Current evidence | Required completion evidence |
| --- | --- | --- |
| Intel/ARM native Music→Windows browser | AE49 archive checks passed. Both Mac shortcuts point to the verified builds. Mini idle launch and Quit passed. | Current selected build, actual bidirectional speech/music, fresh invite, leave/rejoin/recovery and owned cleanup on each host architecture |
| WAV/MP3 Shared Track | Rights-cleared 40-second stereo WAV and MP3 fixtures are staged. The MP3 seek fix passed in-memory tests on both files, including seek, restart, pause and level changes. The Mini recognized official BlackHole 16ch. The replacement hosted build contains the fix and awaits local staging. [WebJam PR 473](https://github.com/rupret007/webjam/pull/473) | Actual desktop sender plus physical primary/separate backing route; hear live input and track together; levels/mute/pause/restart/seek and stop |
| Webex | Mini has the Webex app and a saved Personal Room link that passes validation. Intel setup still needs attention. | Current per-device setup, real join/video/leave and exclusive Music→conversation→Music, with meeting audio disconnected while playing |
| Networks/devices | MacBook default route was Wi-Fi. Mini default route was dock Ethernet with Wi-Fi available. MacBook saw a built-in mic and SSL output. Mini needs a physical mic. | Current SSL2+ guitar/vocal route, Che’s actual Roland/interface and a distinct second-network result; no latency guarantee from the displayed estimate |

The public-entry, recording, AI, permission, cap/hold, trust and spending limits
remain unchanged. Current private13+ / camera18+ behavior does not fulfill all-ages
or legal readiness. No narrower demo success is used to declare this goal complete.
