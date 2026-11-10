# WebJam / Hang Out: current private readiness

As of November 9, 2026 (Central time), shared browser chat, guest-hosted creative
rooms and private messaging have demonstrated useful live journeys. **The full
band rehearsal is not yet qualified.** Music, actual Shared Track mixing and
Webex video/audio handoff remain essential acceptance work, not optional extras.
Both public websites and their navigation remain unchanged.

Read this page for the current handoff. The previous page is preserved byte for
byte in the [dated history](HANGOUT_PRIVATE_READINESS_HISTORY_20261109.md); it is
not an instruction to repeat completed downloads, helpers, observations or CI.
All [62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain intact.
The [evidence matrix](HANGOUT_ACCEPTANCE_EVIDENCE_20261109.md) records their limits.

## Source, serving state and evidence

| Layer | Qualified evidence | Still required |
| --- | --- | --- |
| Last verified private website | Runtime `c83dfaff1fe924ea0a70cfc902731234113f0c09`, serving version `49f19821-e3cf-4699-8698-3dd3f446ca3b`. The serving Worker and effective variables/binding names, namespace IDs, origins and controls matched the preserved live snapshot. Normal browser response saves also matched the reviewed lobby JavaScript and CSS. | No new provider readback after the later hold-continuity stop. Newer application changes are not assumed deployed. |
| New application source | PR247/248/249/250 are merged into private base `ba8e994a70df285f23a2940dfc09cfaf02bd94ff`, tree `4e81f2913bdc911bbd8d28ff68e2663f598c2eae`. Combined CI42737754264 passed2104unit,904browser and34root+34project-path checks; full logs and actual checkout/tree were reviewed. | Guarded private delivery remains pending. Private-entry renewal, video-failure guidance and short-composer/playback corrections are not live acceptance claims yet. |
| Keyboard/playback correction | PR249 merged as `ce319fd73ad12cf43cd67cb96276302698d07d6c`. Its current-head and combined-private CI passed. Full CI originally exposed a network-stalled/playback-status defect; the corrected regression and unchanged real-media browser trials passed. Original failures/traces are retained. | Qualify the eventual delivered candidate. Neither responsive viewports nor real browser media decoding prove physical iOS or VoiceOver. |
| Native packages | Exact source `7153994c0a9db0ac5faccc11e51978583e56302b` built all four desktop targets in run42740471963. All four actual archives passed source/private-beta, path, CRC, architecture and component checks. Both Mac bundles passed strict nested signatures; Windows Setup and ZIP matched their checksum manifest. [Sanitized package receipt](../pr-assets/private-readiness/20261109/native-packages-715.json). | Desktop demos still select source533514d. Only the ARM715 idle Music/Art screens were opened and closed; Intel, Windows and Linux715 were not locally executed. No current physical Music or meeting proof. Mac ad-hoc signatures are not notarization; Windows is unsigned. |
| Native guidance correction | WebJam PR462 source715 above merged normally as `cf527697941ae989e72053ee50362fef497318eb`, reviewed tree `1b94f36f13e5aca73d348418faa7894dafef1751`. Full source CI passed12971unit/60existing skips/565modules,69browser and11RPC+7generated JACK cases for each pinned Jamulus version. Post-merge CI passed. Missing `jack_lsp` was fixed through its explicit Ubuntu package, without weakening tests. | Source715 packages contain this correction. Prior6b packages do not. ARM idle launch is not a Music, Shared Track, Webex or VoiceOver pass. Later wording-only PR463 head `d527ce700cc2178a114b40513902e150de3ea041` merged as `d6962f7be9e6a5c35c2aef311a72f0f7eba030e5` after full source CI passed. No715 artifact is relabeled as that later head. |
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
The old PR247-only prepared assets are not a combined release candidate.

## Remaining band journey

1. The reviewed guidance correction is now present in the verified715 packages.
   Select the appropriate app through normal Finder/UI only after fresh trust,
   device/resource and existing release/provider checks. The ARM idle startup
   was observed; the other local packages have static evidence only. Do not
   bypass macOS privacy or quarantine, stop an independently opened session,
   or count a cached archive as a launch. Prior6b packages remain historical.
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
