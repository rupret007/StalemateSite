# Required live-music acceptance for the shared community

Jeff clarified on October 28, 2026 that live WebJam music is a required part of
this project and the finished private demo for Che. Preserve all 62 original
acceptance outcomes. Chat, drawing, watch rooms and room hosting are browser
features; desktop and browser music connections have separate prerequisites.
Music participation must work, whichever approved implementation path is used.
Each visitor still chooses whether to enable microphone/audio or recording.

The native role and integrity assessment below is bound to WebJam source
`4263e1f9f2718b06c6de0239822c929d44683347`: its README states the Mac Music-host
limit, and `services/native_remote_transport.py` requires platform signatures
for frozen transport builds. This is source assessment, not package/audio
qualification.

## Required machines and honest evidence

| Target | Required outcome | Current evidence limits |
| --- | --- | --- |
| Apple-silicon Mac mini, arm64 | Shared community plus actual live-music participation; qualify its native host path | Earlier same-Mac native forwarding and Qt Join checks are not physical two-way audio or WAN acceptance |
| Intel/x86 MacBook Pro, x64 | Shared community plus actual live-music participation using a matching build or qualified browser path | Actual Chrome checks at site `498646cd907554f2f22ca05d988a84ce227b26fb` passed October 23 through an SSH/Tailscale tunnel; they requested no microphone/camera and claimed no music/audio |
| Windows PC | Shared community plus actual live-music participation through an approved Windows or browser path | Linux CI/WSL, a successful package build and invitation-parser policy checks are not native Windows execution or audio acceptance |
| Linux | Retain the original browser and music requirements | The three named physical machines do not replace the Linux acceptance scope |

Current source-role limits remain explicit: anyone may host a permitted website
room; the native Music host source requires a Mac. Windows/Linux native Music
hosting remains a product gap. Frozen Windows remote transport still requires
a platform signature. An unsigned package does not satisfy that policy.
Browser Web Join is a separate opt-in host capability whose issuer, exact
origin, enrollment and network readiness must be qualified. Do not silently
present either blocked path as working support.

## Demonstrate the complete music journey

1. Identify the exact approved site/Worker revisions and native source/package
   identities, hashes and architecture. Version labels alone are insufficient:
   historical packages with the same label have different invitation support.
   Keep arm64 Mac, x64 Mac and Windows package evidence separate.
2. Enter through Stalemate and Rad Dad into the same community, join as ordinary
   visitors and create/join a Jam room. Website room authority and native music
   host authority remain separate; an invitation grants neither staff access
   nor unintended host powers.
3. Start the supported live-music host. Share the complete actual invitation in
   the room, then use the visible full-invitation copy/open/Join flow, or the
   supported browser Join flow when the host permits it. Keep sealed replies,
   capabilities and invitation fragments out of public logs and screenshots.
4. Use two independent physical machines. With explicit participant consent,
   verify actual two-way audio: A sends and B receives, then B sends and A
   receives, including Windows participation and both Mac architectures in the
   recorded matrix. Use test-generated audio where possible. A moving meter,
   TCP response, Jamulus packet, same-machine echo or codec fixture alone does
   not establish audibility on the participants' devices.
5. Record actual devices, OS/browser or package identity, network route,
   sanitized connection/decoded-audio evidence, observed audibility, latency
   limitations and failures. Separate LAN, Tailscale, hotspot and different-house
   tests. A tunneled browser test is not ordinary Internet music acceptance.
6. Exercise Join/Leave and an interruption/recovery. Verify audio stops when
   requested, stale invitations and old identities do not regain authority, and
   owned test processes/ports are cleaned up. Keep capture consent and existing
   recovery behavior intact; do not start ambient capture or default recording.

The [demo guide](HANGOUT_DEMO_GUIDE.md) supplies browser room and moderation
steps. The [installer assessment](HANGOUT_WEBJAM_INSTALLERS.md) identifies
historical evidence and trust gaps, not a current package selection.

## Remaining dependencies and controls

- Obtain normal current-head Karen review and the release owner's approved
  matching deployment/packages. Site CI is not native desktop/audio proof.
- Keep the additional provider-start native CI mode separate from music audio
  and existing native Worker/SQLite tests. Its prepared workflow patch and
  static checks do not establish that it executed.
- Respect resource admission on each machine. October 28 device discovery found
  the Intel MacBook offline and the Mini/Windows PC online on Tailscale. Earlier
  temporary MacBook test keys were removed after testing. Jeff's testing
  authorization persists; authentication may need to be re-established through
  the approved access path. Recheck availability before physical trials.
- Keep AI, TURN/vault activation, current age/camera/consent safeguards, platform
  trust and release holds unchanged. Do not bypass signature checks or purchase
  signing services. If the approved secure music route needs an external action,
  identify that dependency and hand it to its owner.

Every unperformed or failed music row stays pending/failed. Browser community
proof is valuable progress, but does not complete the required live-music demo
or qualify public launch, all-ages readiness or other unverified requirements.
