# WebJam / Hang Out: current private readiness

As of November 11, 2026 (Central time), shared browser chat, guest-hosted creative
rooms and private messaging have demonstrated useful live journeys. **The full
band rehearsal is not yet qualified.** Music, actual Shared Track mixing and
Webex video/audio handoff remain essential acceptance work, not optional extras.
Both public websites and their navigation remain unchanged.

The private beta received the room-leave keyboard fix at 10:37 UTC. An admitted
guest verified the served lobby script and four companion assets. Before the
switch, two hosted WebKit guests used the exact candidate script to return
keyboard focus to the lobby after Paint Along. Two other admitted guests
created and joined a private Music room, recovered from a rejected invitation
paste and logged out without activating media. [Release and test evidence](../pr-assets/private-readiness/20261111/band-rehearsal/qualification.json)

Game Night reached the private site on November 11 at 04:34 UTC. Open
**Rooms → Game Night → Invite players** to meet in the room and launch the
Stalemate Arcade. Turdtris started and paused in desktop Chrome on the live
Arcade. The private rollout was verified through an admitted readback of five
changed assets. Two-player room behavior and the optional external call link
passed in Chromium and WebKit CI. A live two-person Game Night with voice and
video still needs a trial. [Game Night evidence](../pr-assets/private-readiness/20261111/game-night/qualification.json)

The private beta received Four in a Row and its guest-recovery follow-up at
07:18 UTC. The follow-up improves keyboard invitations, returning to the same
room after a disconnect, and playing while reading chat at short heights.
The reviewed revision passed Chromium and WebKit checks and a local Chromium
check at actual 200% page zoom. The private beta received the lobby join fixes
at 09:29 UTC. Two hosted WebKit guests joined on the first attempt, accepted an
invitation, played Four in a Row, chatted and returned after reload with fresh
scrollback. Both logged out and lost protected access. Voice and video still
need their own trial.
[Hosted lobby evidence](../pr-assets/private-readiness/20261111/hosted-lobby/qualification.json)
· [Game Night follow-up PR](https://github.com/rupret007/StalemateSite/pull/266)

The private site received the Safari dialog fix on November 11 at 01:58 UTC.
Native Safari exposed the member, command and channel controls in the local
candidate. Space opened Commands and Escape returned focus to its button.
The admitted live readback verified the updated lobby markup.
[Safari and Linux evidence](../pr-assets/private-readiness/20261111/safari-dialog/qualification.json)

The 00:39 UTC private rollout added the browser invite-expiry fix. When a link expires during audio setup, the browser releases the
microphone and asks the guest to open a fresh link. The staged client showed
the recovery message and returned keyboard focus to it at both phone widths.
The deployed client still requires private admission. [Invite-expiry evidence](../pr-assets/private-readiness/20261111/web-join-expiry/qualification.json)
· [375 px preview](../pr-assets/private-readiness/20261111/web-join-expiry/expired-invite-375.png)
· [390 px preview](../pr-assets/private-readiness/20261111/web-join-expiry/expired-invite-390.png)

The earlier audio-check release records missing-invite guidance, Chrome
keyboard and zoom checks, and the Linux archive inspection. [Earlier release evidence](../pr-assets/private-readiness/20261110/readiness-release/qualification.json)
[Afternoon delivery receipt](../pr-assets/private-readiness/20261110/private-delivery/README.md). The [dated history](HANGOUT_PRIVATE_READINESS_HISTORY_20261110_BEFORE_AUDIO_STATS.md)
preserves the previous checkpoint. The [evidence matrix](HANGOUT_ACCEPTANCE_EVIDENCE_20261109.md)
tracks all [62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md).

## Source, serving state and evidence

| Layer | Qualified evidence | Still required |
| --- | --- | --- |
| Last verified private website | Private merge `3533420b6e5d44e95abd899c7d021a0f89f424be` serves as `f5319d4a-6953-4162-8521-e7a5a15f86d0` at 100%, deployment `aa41b155-1777-4e26-bcda-dd2d37b27078`. The rollout preserved effective configuration, issuer and anonymous admission. An admitted guest verified five protected assets and logged out. [PR 273](https://github.com/rupret007/StalemateSite/pull/273) passed both exact CI runs with 916 browser checks and 34 checks per route style in each. | Repeat the keyboard leave journey on the deployed release. Verify joined native Safari, assistive technology and live Music. |
| Current application source | [PR 270](https://github.com/rupret007/StalemateSite/pull/270) bounds stalled joins and preserves the nickname for retry. [PR 271](https://github.com/rupret007/StalemateSite/pull/271) uses one first-join frame for updated clients. Both exact PR 271 browser runs passed 912 browser cases, 34 checks on each route and 150 test SQLite admissions; both native workerd runs passed. | Continue native Safari, physical mobile and screen-reader checks. |
| Keyboard/playback correction | PR249 merged as `ce319fd73ad12cf43cd67cb96276302698d07d6c`. Its current-head and combined-private CI passed. Full CI originally exposed a network-stalled/playback-status defect; the corrected regression and unchanged real-media browser trials passed. Original failures/traces are retained. | Qualify current delivered keyboard/playback journeys. Neither responsive viewports nor real browser media decoding prove physical iOS or VoiceOver. |
| Current native packages | Exact source `ae49c915070f2951db9ff441c23c7f0a9d90ce1b` completed four desktop jobs across the initial run and Intel retry. All four archives passed source, private target, paths/CRC, architecture, component, generated-notice and eleven-license checks. Both Macs passed five strict signature checks. Windows Setup/ZIP checksums and hosted install/start/uninstall passed. The extracted Linux package passed idle startup, Pocket Stage, Reference Studio and Jamulus startup against dummy JACK. The frozen lesson player also passed on the Linux runner. [ARM startup and archive evidence](../pr-assets/private-readiness/20261110/native-ae49/README.md) · [Linux build job](https://github.com/rupret007/webjam/actions/runs/42888556613/job/130096378059). | Both Mac Desktop shortcuts select the verified AE49 packages. The Mini shortcut passed idle startup and Quit. Intel startup, local Windows and Linux execution, publisher trust and physical media remain open. |
| Replacement rehearsal build | [Private run 42997398282](https://github.com/rupret007/webjam/actions/runs/42997398282) passed all four desktop targets at `23cfae6ac05c128e1caf8a6fd366751686304ba6`. Both Mac disk images passed the mounted-package checks, and Windows passed hosted install, launch and uninstall. Exact artifact IDs and SHA-256 digests are in the [package evidence](../pr-assets/private-readiness/20261111/band-rehearsal/qualification.json). | Verify the downloaded archive bytes and app trust before staging this build on each Mac. Verify local startup and physical media with the selected build. |
| Prior native package baseline | Older `67c7ef08e515c84eb2b0736c474ec2c4b0c21682` and its all-four-archive checks remain in the [unchanged prior receipt](../pr-assets/private-readiness/20261110/README.md). | Its idle UI/Command-Q and disabled native-menu observation remain historical. Do not relabel it AE49 or replay completed checks. |
| Native fixes and CI | [WebJam PR468](https://github.com/rupret007/webjam/pull/468) merged as `3eb71e9892e72062ea6991ccd76a8805f85497a1`; actual tree `50596d2a1e2e18b19832ee8da89faaee86fe8916` equals reviewed AE49 and tested synthetic merge. Startup workaround is Cocoa-only; macOS offscreen keeps modal completion. All nine focused startup cases pass; full source CI passed 12,985 tests, 60 existing skips and all 567 modules exactly once. Both unchanged Mac workspace gates passed 204 cases with 12 existing skips, plus 34 Reference Studio cases. | Intel attempt 1 failed at pinned Opus download with TLS EOF35 after passing the workspace gate; one failed-jobs-only retry succeeded without changing security checks or source. Source/generated tests do not prove physical media. Later misclassified hostname/observer-relaunch probes are explicitly unqualified in the current receipt. |
| Webex audio handoff | [WebJam PR 471](https://github.com/rupret007/webjam/pull/471) merged as `ba4f4c2c9ec24ec99ca3f834095cd505fbd44b35`. The [private desktop packaging run](https://github.com/rupret007/webjam/actions/runs/42960638326) passed all four platforms on `6e26c693c7d8b0160d8a9ea3434954df526e81bd`. Both Mac archives passed full download digest and outer package name checks. The AE49 builds remain selected on the Mac Desktop shortcuts. | Complete package inspection and select the new build under the normal trust and resource checks. Verify a real Personal Room join and video, then switch between Music and meeting audio with both participants. |
| Selected audio connection | Upstream [WebJam PR466](https://github.com/rupret007/webjam/pull/466), reviewed head `098c57250b5ed2b97c233d7e843f5c5d1297a9e8`, merged as `01804299f3940f243b06f88749d488e03f08cf5c`. Delay and receiver adaptation now use the actual selected transport pair rather than a retired pair encountered last. Four regressions failed before the fix. Completed CI passed 44 Web Join unit cases, 69 browser cases, 87 Worker cases and 12,976 application tests with 60 existing skips across 566 modules. The website mirrors the reviewed audio bytes and provenance. | This browser JavaScript fix does not change the native host runtime or relabel existing native packages. Physical latency, acoustic listening, LAN routing and relay admission still need their own evidence. |
| Earlier application provider-start CI | [Run 42780185842](https://github.com/rupret007/StalemateSite/actions/runs/42780185842), job 129708072371, completed the actual `--participation --provider-start` application/workerd mode against website revision `11c9d1f8`. All 15 recorded mode/install/audit exits were zero. Owner/start ordering, duplicate start, Stop/revoke/close fencing and owned cleanup passed. | Real guardian decisions, hosted capacity and media acceptance remain open. |
| Issuer | Last verified `fd37578f-13cd-4fce-b557-35c0d962ef9d` at100%; completed405/204/403 negatives have receiptc209b961. | Reuse that completed result; do not rerun it or mint test credentials. The existing cap/hold and fresh account headroom still govern trials. |
| Rollback | Use `e1c40ea5-653e-47ad-af1f-b80aaeede80e` for the immediate private-site rollback. The earlier `1b48de76` and issuer rollback `4db649fa` remain in the release history. | Recheck the guards and compare serving state and effective configuration after a rollback. |

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
The c83 Safari run showed the original member-dialog omission. VoiceOver speech
and NVDA remain separate device checks.

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
The 01:58 UTC rollout used 70 reviewed assets and the exact c83 Worker. Only
`lobby/index.html` changed. The inactive version passed configuration comparison
before traffic switched. An isolated guest verified the served lobby and 33
other files, then logged out.
The current eight-file entry toolkit was also verified from the actual CI archive;
its manifest is source evidence, not public integration or deployment proof. Its
redistribution-license qualification remains explicitly unfinished.

## Remaining band journey

1. For the next rehearsal, use the replacement build listed above after its
   archive, trust, resource and device checks. On each Mac, confirm the exact
   build ID through the app before hosting. The existing **WebJam Private Band
   Demo** shortcuts still select AE49. Keep the current shortcut and a private
   settings preimage for rollback. Verify idle startup and Quit on both Mac
   architectures before starting the media trial.
2. Use one Mac native Music host and one Windows Chrome guest for at most ten
   minutes, with participant consent, headphones and no recording. The host
   chooses **Music → Host**, then **Copy browser invite** in the browser guest
   panel. In Hang Out, the host opens **Rooms → Jam (WebJam)**, invites the guest
   into the room, pastes the browser link and clicks **Share**. The guest chooses
   **Join in browser**, runs **Check microphone**, selects their interface if the
   **Microphone** picker appears, confirms headphones, then selects **Join with
   microphone**. If the link expires, the host shares a
   fresh link. Verify speech and music both ways, leave/rejoin and cleanup.
   Qualify Intel and Apple Silicon hosts separately. The Windows browser
   participant uses Chrome and their interface.
3. Through the desktop Shared Track sender, load **Original Test Chords.wav**,
   then **Original Test Chords.mp3**. Matching copies of both 40-second stereo
   48 kHz files are staged on both Macs. Keep the primary microphone and
   headphones on the physical route and verify the separate existing
   BlackHole 16-channel 48 kHz backing route. Hear backing plus live
   input together; check levels/mute, pause/restart/seek and stopping. Earlier
   file decoding, locked controls and generated tones do not establish this mix.
   The current sender backend is Mac-only; Windows/Linux cannot send Shared Track
   until their routing isolation is qualified. A Windows browser guest can be the
   listening/playing participant; that full Mac-host-to-Windows mix is still pending.
4. The Mini has the Webex app and a saved Personal Room link that passes
   validation. The Intel Mac has no saved link, and Webex was absent from its
   standard application folders. Use the normal setup or joining flow for the
   test. Verify real Webex join, video, leave and Music→conversation→Music.
   The merged WebJam source labels the action **Open Webex for Audio** and
   explains how to choose **Don't connect to audio** for video only. Older
   packages may still show the previous label. Use Webex's meeting controls
   to disconnect audio and verify the handoff with both participants.
   Disconnect meeting audio at both ends before Music. Leave/end Music before
   connecting meeting audio. Microphone or monitor mute alone is insufficient.
5. On the Mac, open **More → Audio Settings in Jamulus**, select the SSL 2+
   and check that the guitar and vocal mic are mapped to different inputs. Set
   both input gains low to start. Have Che listen to guitar alone, vocal alone,
   then both together. Set the relative levels on the SSL 2+ or use Jamulus
   **Input Balance**. [Jamulus input controls](https://jamulus.app/wiki/Software-Manual#input-balance)

   Jamulus owns the host's saved device and channel settings. In **Mono-in / Stereo-out**
   it combines the two mapped inputs before sending them. In **Stereo** the
   inputs can remain left and right within one participant. The browser receives
   one stereo session mix without separate guitar and vocal faders. Confirm the
   saved mode and actual sound at rehearsal. [Native profile](https://github.com/rupret007/webjam/blob/93497494dd0057a05282033b4208721b6061097c/core/jamulus_profile.py#L490-L498) · [Jamulus input mix](https://github.com/jamulussoftware/jamulus/blob/r3_12_2/src/client.cpp#L1342-L1390) · [Browser audio bridge](https://github.com/rupret007/webjam/blob/93497494dd0057a05282033b4208721b6061097c/docs/web-join-bridge.md#L17-L20)

   Then have Jeff confirm Che's drum input. Record Wi-Fi, dock Ethernet and a
   second-network test separately. Web Join prefers a direct connection and can
   fall back to TURN. Record the selected route from the browser after joining
   on each network. Browser delay omits parts of the capture and bridge path.
   [Browser connection setup](https://github.com/rupret007/webjam/blob/6e26c693c7d8b0160d8a9ea3434954df526e81bd/web/join/session.js#L55-L60)

For a newcomer, send the community invitation privately. The fresh Music link
is a separate, short-lived invitation created by the host. Never put either code
or a private meeting link in a public document. A desktop install is needed for
the current Mac Music host; Che’s planned PC route is the browser. Linux and
Windows native Music hosting and trust still need qualification. The published
v0.29.0 tag predates Web Join. Identify the private host build by its exact
revision and archive receipt. [Published release](https://github.com/rupret007/webjam/releases/tag/v0.29.0)

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
