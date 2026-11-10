# Acceptance evidence matrix — November10CT, 2026

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
The [November 10 private delivery receipt](../pr-assets/private-readiness/20261110/private-delivery/README.md)
adds current configuration/rollback preservation, 31 exact served static files,
Chrome invitation/prejoin and missing-Music-invite refusal. It is not current
joined-chat, physical media or full recovery acceptance. The 62 original
ID/outcome cells below remain byte-for-byte unchanged.

| ID | Original required outcome | Evidence and scope | Still required / limit |
| --- | --- | --- | --- |
| F1 | One community, with shared people, channels, rooms, identity and moderation; no brand silos | **L,S** — Shared lobby, people, room discovery and text across the two entry contexts; one source moderation service. | Current cross-entry human moderator review and broader platform journeys. |
| F2 | Guests choose nicknames without needing a band account | **L** — Two ordinary guests chose nicknames and joined without a band account. | Retain this property through remaining platform/newcomer checks. |
| F3 | Anyone may host permitted temporary rooms, not only band/staff | **L,S** — Ordinary guests hosted temporary chat, Draw and Paint rooms; host and guest controls differed. | Current Music host/guest, remaining room lifecycle and platform checks. |
| F4 | IRC channels, commands, presence, room/host controls and welcoming quiet rooms | **L,C** — Live topic/+m commands, presence, quiet-room copy and discovery; broader command tests. | Remaining host handoff/kick/ban and current-platform newcomer journeys. |
| F5 | Chat begins at join; connected-session scrollback only | **L,C** — A fresh join excluded earlier authored text; the connected guest retained its own scrollback. | Current logout/revocation and failure boundaries; narrow evidence exceptions remain separate. |
| F6 | Research current primary sources, read product/evidence docs and revalidate repository/release state | **S** — Current source/tree/CI review plus primary YouTube, Apple and WebKit research; dated receipts retained. | Refresh relevant external state before release; outstanding legal/provider/device facts remain outstanding. |
| F7 | Implement small, reviewable changes; finish usable core before expanding scope | **S,C** — Small website PRs and native PRs `#462–#468` are merged. Current AE49 has all four hosted builds, three independent actual-archive checks and ARM startup/native-Quit evidence. | Private frontend delivery is qualified; finish essential Music/SharedTrack/Webex and newcomer outcomes rather than add unrelated features. |
| A1 | Both websites open one shared community address with return navigation | **L,S** — Both private entry contexts reached one address with return context; concrete entry toolkit retained. | Receiving website integration remains staged; public navigation deliberately unpublished. |
| A2 | Small “via Stalemate”/“via Rad Dad” beside names/messages and in People | **L,C** — Source badge shown on new messages and in People in actual cross-entry checks. | Retest remaining platforms and preserve source semantics through delivery. |
| A3 | Badge can be hidden; direct, unknown and repeated source values are neutral | **L,C** — Actual hide/show; source tests cover neutral/invalid entrance values. Earlier message badges are not retroactively erased. | Current third-site/direct-input and privacy-boundary journey beyond the observed Mac check. |
| A4 | Entry badge never establishes verified identity, band membership, room powers or staff permission | **L,C,S** — Actual guests remained guests; entry metadata is separate from host/staff authority. | Current real role/revocation adversarial checks; do not infer staff access from a badge. |
| A5 | Audit real login providers | **L,S** — Configured Cloudflare email-code path previously worked; latest owner-panel visit now requests fresh sign-in. | Current real owner/moderator sign-in and account-provider audit beyond guest entry. |
| A6 | Secure first-party sessions; preserve ownership and verified account linking | **C,S** — Session/ownership/linking implementation and regression evidence retained. | Current live ownership/linking/logout/revocation across devices. |
| A7 | No cross-domain cookies, wildcard origins or copied account credentials | **C,S** — Canonical first-party service, exact origins and preserved configuration; no copied site accounts used. | Repeat applicable configuration comparison before later delivery; broader integration audit. |
| A8 | Preserve canonical service, namespace and IDs through migration/rollback | **S** — Completed c83 delivery compared effective configuration and stable namespace IDs against its snapshot. | New candidate requires a fresh snapshot/rollback comparison after hold/resource gates. |
| E1 | Adding a basic Join link is simple and needs no site credential | **S,C** — Concrete allowlisted entry toolkit and hash verification; a neutral Join link needs no site credential. | Receiving-site review/install remains staged, without publishing navigation early. |
| E2 | Optional versioned integration contract with verified domains, exact registered origins, scoped permissions and revocation | **S,C** — Optional contract/policy and exact-origin/revocation source tests; distinct from basic Join links. | Live registered integration qualification, ownership and revocation without expanding permissions. |
| E3 | A third test site reaches the same community | **C** — Third-site fixtures/source exist; no current real third-site journey claimed. | Observed private third-site integration into the same community. |
| E4 | Integration revocation is accurate and grants no staff powers | **C,S** — Revocation/role isolation coverage exists in controlled adapters and tests. | Current live third-site revocation and no-staff-power verification. |
| E5 | Safe public package; no repository/private-file copy or output overwrite | **S,C** — Reviewed package: exact8-file allowlist,7 payloads and matching source/payload hashes. | Preserve safe-output/overwrite checks and settle redistribution/license scope before external reuse. |
| E6 | Federation stays outside this requirement | **S** — Federation remains outside this scope; entry context is not federation. | Do not substitute federation work for unfinished private-use requirements. |
| D1 | Accessible retro IRC design, refined typography/navigation/presence | **L,S** — Actual three-pane retro IRC workspace and refined phone fixtures; native screenshot retained. | Broader newcomer/usability review, platform and assistive-technology qualification. |
| D2 | Clear connection, sign-in, loading and error/retry states | **L,C,S** — Live truthful refusal/draft states; merged247 admission,248 video recovery and249 composer/playback corrections; combined ba8 CI passed. | Current delivered assets are qualified; joined-chat and remaining live failure/recovery still need observation. |
| D3 | Welcoming quiet rooms, room discovery and simple creation/join/switch/leave | **L,C** — Quiet lobby, directory, guest creation/join and host closure observed. | Remaining activity/room recovery/host-transfer paths and uncoached newcomer use. |
| D4 | Keyboard navigation and focus | **L,C** — Actual Safari Option-Tab/PM action and PR #249 keyboard checks; current AE49 startup regressions pass and actual ARM startup native Quit is enabled and exits. | Physical/assistive coverage, Intel startup UI and workspace native Quit remain unqualified. Initial startup Quit proof is separate from a later misclassified-hostname/observer-relaunch probe. |
| D5 | Screen-reader behavior | **L,C,S** — ARIA/log semantics and announcement controls exist; native member-dialog AX omission recorded. | Actual VoiceOver/NVDA behavior and the unresolved Safari AX observation; no speech pass claimed. |
| D6 | Zoom/reflow and WCAG 2.2 AA | **C,S** — 249 responsive/zoom-equivalent cases include320x256 and strict composer bounds. | Actual browser zoom, assistive technology and full WCAG2.2AA assessment, beyond viewport fixtures. |
| D7 | Reduced-motion preference | **C,S** — Reduced-motion CSS and enabled reduced-motion fixtures retained. | Verify remaining actual browser/OS preference behavior; no broad accessibility certification. |
| D8 | 375/390px screenshots, no page overflow, input/Send visible, iOS inputs 16px | **C,L** — 375/390px prejoin deployed evidence plus joined249 fixtures; 16px fields, contained composer/Send. | 249 assets are privately delivered; qualify actual phone/keyboard behavior. Responsive emulation is not physical iOS. |
| D9 | Starter/action rows contain themselves and text wraps | **C,S** — Current fixture geometry/screenshots cover wrapping text and self-contained starter/action rows. | Current delivered/physical-device checks, including unusually long text and controls. |
| D10 | Cameras/microphones remain opt-in | **L,C** — No camera/microphone started in the live chat/creative/PM checks; media remains opt-in. | Fresh consent, stop/revoke and device checks before remaining Music/Webex trials. |
| D11 | Review reused components for license and security | **S,C** — Current ARM/Intel/Windows actual AE49 archives match generated notices and eleven pinned licenses; prior67 all-four evidence remains historical. No Halloy code copied. | Complete relevant license/security review, including current Linux where needed. Archive checks do not certify legal compliance or license the separate website toolkit for redistribution. |
| S1 | Measure busy lobby, fan-out, presence and abuse-control bottlenecks | **G,C** — Controlled admission/fan-out/presence regression evidence; limits and original failures retained. | Measured realistic hosted staging bottlenecks, not inferred from unit counts. |
| S2 | Separate many-room scaling, one hot room and media limits | **G,S** — Scale documentation separates many rooms, hot-room fan-out and media. | Current staging measurements for each distinct dimension. |
| S3 | Bounded outbound delivery and inbound/pending work | **C,S** — Bounded transport, read/write/admission guards and failure tests retained. | Current slow-reader/overload measurements at the intended deployment boundary. |
| S4 | Staging load tiers and realistic user/message/fan-out workload | **G,S** — Documented controlled tiers and admission/room fixtures. | Realistic staging socket/user/message/fan-out workload under existing cost/limit holds. |
| S5 | Reliability/latency targets and cost ceilings | **S** — Existing caps and cost constraints retained; no broad SLO claim. | Measured reliability/latency targets and account headroom at the actual intended load. |
| S6 | Many rooms under load | **G,C** — Controlled many-room fixtures remain distinct from hosted capacity. | Current observed many-room staging load. |
| S7 | Reconnect storms | **G,C** — Reconnect-storm and recovery regressions retained. | Current realistic staged reconnect storm and authority/recovery checks. |
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
| V4 | Fresh-join privacy, logout/revocation and role isolation | **L,C** — Live fresh-join privacy, guest topic denial, PM consent/block and local closed draft. | Current live logout/revocation, account ownership and full role isolation. |
| V5 | Failures/recovery are clear and truthful | **L,C,S** — Live refusal/draft recovery;247/248/249 fixes merged and combined ba8 CI passed. | Current missing-Music-invite refusal is observed; connected recovery and remaining media handoff checks are pending. |
| V6 | Mac, Windows and Linux support qualified honestly | **C,S,L** — AE49 builds all four targets; actual ARM/Intel/Windows archives checked, both Mac signature sets passed and ARM idle startup/native Quit observed. Current Linux has hosted CI evidence only. | Current physical media roles/devices and publisher trust remain unqualified; Mac ad-hoc is not notarization, Windows unsigned, and no native hosting equivalence is claimed. |
| V7 | Deliver source, tests, screenshots and small PRs | **S,C,L** — Reviewed website PRs and native `#462–#468`, exact-tree source CI, current AE49 package receipts and actual ARM idle screenshot/native-Quit evidence retained. | Private frontend delivery is qualified; current media/newcomer journeys, Intel local UI and workspace native Quit remain unqualified. |
| V8 | Deliver integration instructions and a clean concrete package | **S,C** — Concrete entry toolkit, setup/support and restore/rollback guidance retained. | Receiving-site integration review, remaining package/license/platform qualification. |
| V9 | Deliver a migration/rollback plan with remaining dependencies | **S** — Existing migration/rollback identities, configuration requirements and exact dependency stops documented. | Fresh gated rollback readiness and effective-config preservation for any later switch. |
| V10 | Completion requires observed application journeys and concrete integration package, with unverified work explicit | **L,S,C,G,H,U** — Observed browser journeys and concrete package now exist; evidence layers remain distinct. | All original outcomes still need appropriate proof; uncoached essential private band journeys remain unfinished. |

## Required media evidence beyond these browser rows

| Journey | Current evidence | Required completion evidence |
| --- | --- | --- |
| Intel/ARM native Music→Windows browser | AE49 all-four hosted builds; actual ARM/Intel/Windows archives and ARM idle startup/native Quit only. A hostname-startup probe does not qualify physical audio or a valid invite. | Current selected build, actual bidirectional speech/music, fresh invite, leave/rejoin/recovery and owned cleanup on each host architecture |
| WAV/MP3 Shared Track | Offline GUI decoding and generated codec/transport results remain separate | Actual desktop sender plus physical primary/separate backing route; hear live input and track together; levels/mute/pause/restart/seek and stop |
| Webex | Existing PMR saved on Mini; verified client detection; manual audio-handoff guidance | Current per-device setup, real join/video/leave and exclusive Music→conversation→Music, with meeting audio disconnected while playing |
| Networks/devices | Earlier Wi-Fi/wired/generated samples are scoped to their original runs | Current SSL2+ guitar/vocal route, Che’s actual Roland/interface and a distinct second-network result; no latency guarantee from the displayed estimate |

The public-entry, recording, AI, permission, cap/hold, trust and spending limits
remain unchanged. Current private13+ / camera18+ behavior does not fulfill all-ages
or legal readiness. No narrower demo success is used to declare this goal complete.
