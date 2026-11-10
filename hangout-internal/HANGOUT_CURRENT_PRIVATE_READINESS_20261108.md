# WebJam / Hang Out: current private readiness

As of November 10, 2026 (Central time), shared browser chat, guest-hosted creative
rooms and private messaging have demonstrated useful live journeys. **The full
band rehearsal is not yet qualified.** Music, actual Shared Track mixing and
Webex video/audio handoff remain essential acceptance work, not optional extras.
Both public websites and their navigation remain unchanged.

The browser audio-check update reached the private site on November 10 at
22:35 UTC. The [release evidence](../pr-assets/private-readiness/20261110/readiness-release/qualification.json)
records the served version, CI, keyboard and zoom checks, and current Linux
archive inspection. The [earlier delivery receipt](../pr-assets/private-readiness/20261110/private-delivery/README.md)
retains the afternoon rollout and screenshots. The [dated history](HANGOUT_PRIVATE_READINESS_HISTORY_20261110_BEFORE_AUDIO_STATS.md)
preserves the previous checkpoint. The [evidence matrix](HANGOUT_ACCEPTANCE_EVIDENCE_20261109.md)
tracks all [62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md).

## Source, serving state and evidence

| Layer | Qualified evidence | Still required |
| --- | --- | --- |
| Last verified private website | Frontend merge `7a5486a90c4a64e9b0431959e1e2ffd05b0bf55f` serves as version `31f8271c-27d9-4d52-ab33-23884c79bae9` at 100%, deployment `270923f6-49ab-4f09-babc-f8101334df25`. The `c83dfaff` Worker, all 28 bindings, namespace IDs and effective settings matched the prior private version. The admitted readback matched 33 files, including all four changed files. Logout returned 200 and the next session check returned 401. | The live missing-invite screen showed the full-link recovery instructions. The guest agreement, joined chat and attended media checks remain pending. |
| Current application source | Website [PR257](https://github.com/rupret007/StalemateSite/pull/257) mirrors 13 upstream files from [WebJam PR469](https://github.com/rupret007/webjam/pull/469). Both website CI runs passed 2,110 unit tests, 904 browser cases, and 34 root plus 34 project-path checks. The tested tree `939ba09e7d2eeb2fad54e6c7aab325739969a7b5` matches the merge. | Current physical input, meeting and connected recovery need attended checks. |
| Keyboard/playback correction | PR249 merged as `ce319fd73ad12cf43cd67cb96276302698d07d6c`. Its current-head and combined-private CI passed. Full CI originally exposed a network-stalled/playback-status defect; the corrected regression and unchanged real-media browser trials passed. Original failures/traces are retained. | Qualify current delivered keyboard/playback journeys. Neither responsive viewports nor real browser media decoding prove physical iOS or VoiceOver. |
| Current native packages | Exact source `ae49c915070f2951db9ff441c23c7f0a9d90ce1b` completed four desktop jobs in [run 42888556613](https://github.com/rupret007/webjam/actions/runs/42888556613), final attempt 2. All four actual archives passed source, private target, paths/CRC, architecture, component, generated-notice and eleven-license checks. Both Macs passed five strict signature checks. Windows Setup/ZIP checksums and hosted install/start/uninstall passed. [ARM startup and earlier archive evidence](../pr-assets/private-readiness/20261110/native-ae49/README.md). | ARM idle startup and native Quit were observed. Local Intel startup, Windows and Linux execution, publisher trust and physical media remain open. Existing desktop shortcuts may still open older builds. |
| Prior native package baseline | Older `67c7ef08e515c84eb2b0736c474ec2c4b0c21682` and its all-four-archive checks remain in the [unchanged prior receipt](../pr-assets/private-readiness/20261110/README.md). | Its idle UI/Command-Q and disabled native-menu observation remain historical. Do not relabel it AE49 or replay completed checks. |
| Native fixes and CI | [WebJam PR468](https://github.com/rupret007/webjam/pull/468) merged as `3eb71e9892e72062ea6991ccd76a8805f85497a1`; actual tree `50596d2a1e2e18b19832ee8da89faaee86fe8916` equals reviewed AE49 and tested synthetic merge. Startup workaround is Cocoa-only; macOS offscreen keeps modal completion. All nine focused startup cases pass; full source CI passed 12,985 tests, 60 existing skips and all 567 modules exactly once. Both unchanged Mac workspace gates passed 204 cases with 12 existing skips, plus 34 Reference Studio cases. | Intel attempt 1 failed at pinned Opus download with TLS EOF35 after passing the workspace gate; one failed-jobs-only retry succeeded without changing security checks or source. Source/generated tests do not prove physical media. Later misclassified hostname/observer-relaunch probes are explicitly unqualified in the current receipt. |
| Selected audio connection | Upstream [WebJam PR466](https://github.com/rupret007/webjam/pull/466), reviewed head `098c57250b5ed2b97c233d7e843f5c5d1297a9e8`, merged as `01804299f3940f243b06f88749d488e03f08cf5c`. Delay and receiver adaptation now use the actual selected transport pair rather than a retired pair encountered last. Four regressions failed before the fix. Completed CI passed 44 Web Join unit cases, 69 browser cases, 87 Worker cases and 12,976 application tests with 60 existing skips across 566 modules. The website mirrors the reviewed audio bytes and provenance. | This browser JavaScript fix does not change the native host runtime or relabel existing native packages. Physical latency, acoustic listening, LAN routing and relay admission still need their own evidence. |
| Earlier application provider-start CI | [Run 42780185842](https://github.com/rupret007/StalemateSite/actions/runs/42780185842), job 129708072371, completed the actual `--participation --provider-start` application/workerd mode against website revision `11c9d1f8`. All 15 recorded mode/install/audit exits were zero. Owner/start ordering, duplicate start, Stop/revoke/close fencing and owned cleanup passed. | Real guardian decisions, hosted capacity and media acceptance remain open. |
| Issuer | Last verified `fd37578f-13cd-4fce-b557-35c0d962ef9d` at100%; completed405/204/403 negatives have receiptc209b961. | Reuse that completed result; do not rerun it or mint test credentials. The existing cap/hold and fresh account headroom still govern trials. |
| Rollback | Use `2b205a24-392c-4cdb-9d0b-daaf8c065d0b` for the immediate private-site rollback. Prior version `49f19821`, original version `2c5c81e5` and issuer rollback `4db649fa` were available at the release check. | Recheck the guards and compare serving state and effective configuration after a rollback. |

The [sanitized live receipt and screenshots](../pr-assets/private-readiness/20261109/README.md)
cover actual Mac Chrome/Safari observations on c83:

- Stalemate and Rad Dad entry context reached one lobby; text flowed both ways,
  source badges could be hidden, and a fresh join excluded earlier authored text.
- Ordinary guests created and joined temporary chat, Draw and Paint rooms. Both
  browsers received drawing strokes. Grandeur of Summer loaded first; a custom
  official Northern Lights link reached the guest and their paused positions
  matched at the observed moment. Jeff confirmed hearing Bob Ross on the Mini.
- Guest topic changes were refused. Host topic and moderation controls worked.
  A refused guest message retained a local copy; Restore did not send it, while
  an explicit subsequent Return delivered it. The host closed the test channel.
- PM requests respected the existing two-minute warmup and explicit acceptance.
  Messages arrived both ways. Blocking closed both conversations; a closed-PM
  reply stayed in its original local draft. The block and test draft were undone.

Both guests disconnected and owned test tabs closed. No microphone, camera,
Music relay, AI or recording was started. An earlier tab-controlled Chrome video
attempt timed out, while later normal-window Chrome host and guest playback
worked. Its cause remains unproven; do not weaken CSP/referrer/browser protections.
Safari’s native member-dialog AX output also remains unexplained. Option-Tab and
normal visible actions worked; that is not a full screen-reader qualification.

## Release and device gates

This application session owns code, UI, tests, docs, ordinary GitHub PR/CI and
remaining guarded private delivery, independently of StoryPool. Do not route it
through Karen, the bus, conductor, installed infrastructure checkouts or shared
services. Public entry links, AI, recording, separate Hang Out media TURN,
permissions, caps and existing release/provider holds stay unchanged.

Jeff approved the one-time continuity proposal for the missing local relay-cap
record. It substituted only that file's presence/hash proof; the missing marker
was not recreated and no counter, cap, permission or other hold was reset. Fresh
v4 snapshot, resource, billing/headroom, version, configuration and rollback
checks passed before the private upload and switch. A first read-only GraphQL
budget refusal was preserved; after its normal five-minute cooldown, one reduced
UTC-month query succeeded without a reset. Current-period billing displayed
1,000 GB included, 0.01 GB used and $0; 999.99 GB unused is derived at displayed
precision, not an exact real-time balance or future-cost guarantee. Whole-account
UTC-month TURN usage was 25,089,204 bytes, a conservative upper bound below both
unchanged 800/200 GB caps. These are dated admission facts, not perpetual trial
permission. Any fresh quota refusal, configuration mismatch, resource failure or
other failed gate still stops work.

The application resource gate remains swap below 90%, load below 10 and disk at
least 15 GiB; the stricter 80% native-GUI gate is separate. Fresh checks are required.
A readback below the disk floor stopped work before provider activity. Space later
recovered before deletion for an unattributed reason. Three cold extracted Mini
app caches were then removed only after full byte/CRC/path/symlink comparison with
retained, restore-verified archives, no active process and no launcher reference.
The observed free-space gain was about 1.29 GiB, reaching about 18.99 GiB at that moment;
that is dated evidence, not a future resource admission. Current `67c7ef0` and the
selected older `4c4` app, source, profiles, recordings, archives, Desktop links and
shared services were preserved. Earlier verified external-drive offloads remain
historical; do not restart completed offloads, inspectors or observation jobs.
Exact operational paths and restore receipts remain private and untracked.

Before a later switch, use the applicable approved v4ccbf21e9 procedure, never
dd65999f. Snapshot actual live configuration and preserve every effective
variable, secret binding, namespace/stable ID, exact origin, admission control,
cap and hold. Defaults and `--keep-vars` alone are insufficient. Require reviewed
source/CI, current resource/headroom checks, ready rollback, exact served hashes,
configuration comparison and a normally admitted private session afterward.
The 22:35 UTC rollout used 70 reviewed assets and the exact c83 Worker. It
changed the Web Join HTML, JavaScript, stylesheet and provenance record. The
other 66 staged assets matched the afternoon package byte for byte. The
inactive version passed the configuration comparison before the traffic switch.
The served-byte check sampled 33 files through ordinary guest admission.
The current eight-file entry toolkit was also verified from the actual CI archive;
its manifest is source evidence, not public integration or deployment proof. Its
redistribution-license qualification remains explicitly unfinished.

## Remaining band journey

1. Use the current AE49 package identities above. All four hosted desktop builds
   passed. Actual archive inspection covers all four packages, and ARM idle
   startup and native Quit have local evidence. Intel startup and local Windows
   and Linux execution still need their own checks.
   Select the appropriate candidate through normal Finder/UI after fresh trust,
   device/resource and existing provider/release checks. Existing Desktop
   selections were preserved; a familiar icon may open an older build. Do not
   bypass privacy/quarantine or count an archive as a launch. Earlier packages
   and rollback receipts remain available. Take a private settings preimage
   before a state-changing UI probe; a manual hostname is not an invalid invite.
   No current-build physical Music trial is inferred from package/startup checks.
2. Use one Mac native Music host and one Windows Chrome guest for at most ten
   minutes, with participant consent, headphones and no recording. The host
   creates a fresh browser invitation and shares it in the private Jam room.
   The guest needs no native install or BlackHole. Verify speech/music both
   ways, leave/rejoin/recovery and cleanup. Qualify Intel and ARM host roles.
3. Through the actual desktop Shared Track sender, load the rights-cleared WAV,
   then MP3. Keep the primary microphone/headphone route physical and verify
   the separate existing BlackHole16ch48k backing route. Hear backing plus live
   input together; check levels/mute, pause/restart/seek and stopping. Earlier
   file decoding, locked controls and generated tones do not establish this mix.
   The current sender backend is Mac-only; Windows/Linux cannot send Shared Track
   until their routing isolation is qualified. A Windows browser guest can be the
   listening/playing participant; that full Mac-host-to-Windows mix is still pending.
4. Set up the existing WebJam Personal Room normally on each participating
   device. Verify real Webex join, video, leave and Music→conversation→Music.
   WebJam opens the external meeting; it does not control or verify its audio.
   Disconnect meeting audio at both ends before Music. Leave/end Music before
   connecting meeting audio. Microphone or monitor mute alone is insufficient.
5. Qualify the actual SSL2+ guitar/vocal inputs and Che’s Roland/interface route
   when connected; his exact interface/module model is still unknown. Keep
   Wi-Fi, dock Ethernet and a second-network test as distinct results. Browser
   delay estimates omit parts of the capture/bridge path and are not acoustic
   latency or a guarantee of tight rehearsal.

For a newcomer, send the community invitation privately. The fresh Music link
is a separate, short-lived invitation created by the host. Never put either code
or a private meeting link in a public document. A desktop install is needed for
the current Mac Music host; Che’s planned PC route is the browser. Linux and
Windows native Music hosting/trust remain explicit gaps, not renamed passes.

Fresh moderator email sign-in is also needed for current human report review and
revocation checks. No new synthetic report was created while that sign-in was
unavailable; only Jeff disposes moderation reports. Chrome keyboard focus and 200%/400% reflow were observed on the disconnected
nickname screen before the evening rollout. The evidence matrix keeps joined
chat, VoiceOver/NVDA, physical mobile, current platform media, realistic hosted
capacity and all-ages/operator/legal work open. The current
private13+ / camera18+ guards remain; this is not public or all-ages launch approval.

The [concrete entry toolkit](HANGOUT_WEBSITE_ENTRY_HANDOFF_20261109.md) remains
available for later website integration. A basic Join link needs no site
credential and its badge grants no identity or staff powers. Public navigation
stays unpublished until the intended application and receiving-site work is ready.
