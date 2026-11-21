# WebJam / Hang Out: current private readiness

As of November 10, 2026 (Central time), shared browser chat, guest-hosted creative
rooms and private messaging have demonstrated useful live journeys. **The full
band rehearsal is not yet qualified.** Music, actual Shared Track mixing and
Webex video/audio handoff remain essential acceptance work, not optional extras.
Both public websites and their navigation remain unchanged.

Read this page for the current handoff. The previous page is preserved byte for
byte in the [dated history](HANGOUT_PRIVATE_READINESS_HISTORY_20261110.md); it is
not an instruction to repeat completed downloads, helpers, observations or CI.
All [62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain intact.
The [evidence matrix](HANGOUT_ACCEPTANCE_EVIDENCE_20261109.md) records their limits.

## Source, serving state and evidence

| Layer | Qualified evidence | Still required |
| --- | --- | --- |
| Last verified private website | Runtime `c83dfaff1fe924ea0a70cfc902731234113f0c09`, serving version `49f19821-e3cf-4699-8698-3dd3f446ca3b`. The serving Worker and effective variables/binding names, namespace IDs, origins and controls matched the preserved live snapshot. Normal browser response saves also matched the reviewed lobby JavaScript and CSS. | No new provider readback after the later hold-continuity stop. Newer application changes are not assumed deployed. |
| New application source | PRs #247–#251 merged privately as `1159c8e6f7e888534399d2a13e9eabc291a1806b`, reviewed tree `88e1568a36bb76c87af0d8cd7f2ff33bae076fd0`. Both #251 source CI runs 42752646548/42752641391 passed 2,104 unit tests, 904 browser cases and 34 root plus 34 project-path checks; actual tested/merged trees and full logs were reviewed. This refresh adds evidence only. | Guarded private delivery remains pending. Private-entry renewal, video-failure guidance and short-composer/playback corrections are not live acceptance claims yet. |
| Keyboard/playback correction | PR249 merged as `ce319fd73ad12cf43cd67cb96276302698d07d6c`. Its current-head and combined-private CI passed. Full CI originally exposed a network-stalled/playback-status defect; the corrected regression and unchanged real-media browser trials passed. Original failures/traces are retained. | Qualify the eventual delivered candidate. Neither responsive viewports nor real browser media decoding prove physical iOS or VoiceOver. |
| Native packages | Exact source `67c7ef08e515c84eb2b0736c474ec2c4b0c21682` built all four desktop targets in [run 42761983020](https://github.com/rupret007/webjam/actions/runs/42761983020). All four actual archives passed source/private-beta, paths/CRC, architecture, component, generated-notice and all 11 pinned license checks, including the corrected own-MIT copy. Both Mac bundles passed five strict signature checks; Windows Setup/ZIP checksums and hosted install/start/uninstall passed. [Current package receipt and screenshots](../pr-assets/private-readiness/20261110/README.md). | Desktop selections were last verified at source `533514d` and were not changed here. Only ARM `67c7ef0` idle Music/Art and normal Command-Q exit were observed locally; Intel/Windows/Linux `67c7ef0` were not locally executed. Native macOS menu Quit is still reported disabled and remains unqualified. Mac ad-hoc is not notarization; Windows is unsigned. No current physical Music or meeting proof. |
| Native fixes and CI | WebJam PRs `#462–#465` are merged; exact `67c7ef0` source tree `1e0126b23cc309159ca2e4bb92c0d96ad7083f3a` matches merged native revision `7b6e6612a99518f28aff93d36b29698be86d57ea`. Current private build passed 12,976 unit tests, 60 existing skips and 566 modules, plus 11 RPC and 7 generated JACK boundary cases for each pinned Jamulus version (3.12.2 and 3.12.3), and all four package jobs. It includes meeting-audio guidance, restored lesson/Conversation context, dialog-owned Quit shortcut and own-license packaging. | Older `7153994` and `6b89ddd` packages remain distinct historical sources. Source tests and generated JACK cases do not prove physical Music/Shared Track/Webex. Current ARM idle screenshots do not resolve the native menu Quit limitation or VoiceOver. |
| Issuer | Last verified `fd37578f-13cd-4fce-b557-35c0d962ef9d` at100%; completed405/204/403 negatives have receiptc209b961. | Reuse that completed result; do not rerun it or mint test credentials. The existing cap/hold and fresh account headroom still govern trials. |
| Rollback | Retained site2c5c81e5 and issuer4db649fa; the completed c83 delivery needed no rollback. | A new delivery must preserve actual live configuration and stable IDs and verify its rollback path before any switch. |

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

Private delivery stopped before provider authentication/API/upload/switch because
the recorded relay-cap hold marker is missing. A bounded search found no matching
backup. Do not recreate/reset/waive it. Genuine continuity or an owner resolution
is required. The Mini also fell below its15GiB free-disk floor, then later passed a fresh
resource readback before local tests resumed. That positive change has no
attributed cause and does not waive the missing hold. The application resource
gate remains swap below90%, load below10 and disk at least15GiB;
the stricter80% native-GUI gate is separate. Fresh checks are required before use.

Five verified archive files were offloaded to the existing external drive with
hash-checked copies and original-path links. No current app or Desktop selection,
credentials, holds or shared services changed. This did not establish adequate
available disk headroom; the external drive also has little room remaining.
Exact private operational paths and restore receipts stay outside this repository.
Do not restart the completed offload, package inspectors or older observation jobs.

Before a later switch, use the applicable approved v4ccbf21e9 procedure, never
dd65999f. Snapshot actual live configuration and preserve every effective
variable, secret binding, namespace/stable ID, exact origin, admission control,
cap and hold. Defaults and `--keep-vars` alone are insufficient. Require reviewed
source/CI, current resource/headroom checks, ready rollback, exact served hashes,
configuration comparison and a normally admitted private session afterward.
The prepared 70-asset candidate was built at reviewed source `f098d4c`; every output
byte matches the protected inputs in merged `1159c8e6`, and its Worker is unchanged.
That is offline preparation, not admission or delivery. The older PR247-only
two-asset delta is historical and must not be used as the combined candidate.

## Remaining band journey

1. The reviewed fixes are now present in the four verified `67c7ef0` packages above.
   Select the appropriate app through normal Finder/UI only after fresh trust,
   device/resource and existing release/provider checks. ARM `67c7ef0` idle startup and
   Command-Q exit were observed; the other local packages have static evidence
   only. The native menu Quit limitation remains explicit. Do not bypass macOS
   privacy/quarantine, stop an independently opened session, or count a cached
   archive as a launch. Existing Desktop selection and older packages remain
   unchanged; no current-build Music trial is inferred from these checks.
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
unavailable; only Jeff disposes moderation reports. VoiceOver/NVDA, physical
mobile/zoom, current platform media, realistic hosted capacity and all-ages/
operator/legal outcomes remain unqualified where the matrix says so. The current
private13+ / camera18+ guards remain; this is not public or all-ages launch approval.

The [concrete entry toolkit](HANGOUT_WEBSITE_ENTRY_HANDOFF_20261109.md) remains
available for later website integration. A basic Join link needs no site
credential and its badge grants no identity or staff powers. Public navigation
stays unpublished until the intended application and receiving-site work is ready.
