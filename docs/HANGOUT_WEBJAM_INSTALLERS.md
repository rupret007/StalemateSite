# WebJam packages for the community beta

Checked October 19, 2026 UTC. **Mac, Windows and Linux are all required for this
beta. None currently has a completed candidate installation-and-audio receipt.**
The protected website's native handoff passed against source; that does not
establish that the installers visitors download contain the same implementation.
Windows native remote Join additionally needs a signed transport executable;
the ordinary unsigned candidate cannot satisfy its existing runtime policy.

## What each computer can do

| Experience | Mac | Windows PC | Linux |
| --- | --- | --- | --- |
| Host a Hang Out website room; chat, draw and watch | Required | Required | Required |
| Native WebJam Music Join | Required | Required, x64; unsigned frozen v3 blocked | Required, Ubuntu 22.04 x64 baseline |
| Native WebJam Music Host | Supported source path | Not supported by the current app | Not supported by the current app |
| Native WebJam Art LAN Host/Join | Preview | Preview | Preview |

Website room hosting and native Music hosting are different capabilities.
Anyone admitted to the community can host a website room. The current native
Music session requires a Mac host; Windows and Linux join that host. Native
Music hosting on Windows/Linux remains a product gap, outside this bounded
installer work. Linux distributions and architectures beyond Ubuntu 22.04 x64
are not covered by the existing package baseline. The source's four-target
[builder](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/.github/workflows/ci.yml),
[product scope](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/README.md)
and [release runbook](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/docs/DESKTOP_RELEASE_RUNBOOK.md)
are the upstream references.

## Public v0.29.0 does not implement current remote invitations

[Published v0.29.0](https://github.com/rupret007/webjam/releases/tag/v0.29.0) is
the September 30 unsigned/ad-hoc test release, source
`7aa74be14446e907f1116b0da9a264667ae22937`. The verified native handoff used later
source `5effbc58db706254f8ca8b52de4a0520c482294a`. Both report version 0.29.0;
the version label and filename alone cannot identify a compatible package.

The official public Apple Silicon DMG was downloaded and its SHA-256 matched
both GitHub's asset digest and the publisher's checksum manifest:

```text
885e002f91d03845b88386d25b35874596de6089fc754b676fa5f67f663c6141
```

It was mounted read-only, without running installation helpers or replacing the
installed app. Its candidate metadata and embedded build ID identify `7aa74be`.
Its valid ad-hoc signature has no developer Team ID. Loading the actual frozen
invitation parser in an isolated interpreter established that it contains only
the `reference-local` remote profile and rejects a complete current
`direct-stun` invitation as `unsupported`. A v2 private-LAN invitation was
accepted. Selecting Mac/Windows/Linux parser-policy values does not execute
the Windows or Linux application. It is compatibility evidence, not physical
platform acceptance.

The machine's existing `/Applications/WebJam.app` is 0.27.2 and was left alone.
Other local DMGs labeled 0.29.0 had different build IDs and hashes; they are not
the published package or the tested `5eff` candidate.

## Exact-source candidate build

The existing `WebJam CI` workflow was dispatched on branch `master` at exact
commit `5effbc58db706254f8ca8b52de4a0520c482294a`:

- [Build run 39197407138](https://github.com/rupret007/webjam/actions/runs/39197407138),
  `workflow_dispatch`, attempt 1.
- `final_build=true`; signing rehearsals, one-hour certification and
  unapproved headless evidence all false; diagnostic-source input empty.
- Four native builders: Apple Silicon macOS, Intel macOS, Windows x64 and
  Ubuntu 22.04 x64. Each uses its upstream target-specific locked dependencies.
- Branch dispatch cannot enter the tag-only GitHub Release publisher. No tag,
  release, source change or default application/protocol association was made.

**Build status: running.** Apple Silicon Mac, Windows and Linux packages passed
their native CI jobs and downloaded-artifact verification. Intel Mac is still
building. Windows remote v3 Join remains blocked as described below. The sanitized
[installer receipt](../pr-assets/beta-collaboration/webjam-installers.json)
records the observed run status and public-release provenance. A dispatched or
green source-test run is not a successful packaging run. If a prerequisite or
target fails, record that failure and its cause; do not substitute older bytes.

| Computer | Expected CI artifact | Candidate files inside it | Required package trust description |
| --- | --- | --- | --- |
| Apple Silicon Mac | `webjam-macos-arm64` | arm64 DMG and ZIP | Ad-hoc signed, unnotarized test candidate |
| Intel Mac | `webjam-macos-x64` | x64 DMG and ZIP | Ad-hoc signed, unnotarized test candidate |
| Windows 11 x64 PC | `webjam-windows-x64` | Setup EXE, portable ZIP and checksum manifest | Unsigned test candidate; native remote Join blocked |
| Ubuntu 22.04 x64 | `webjam-linux-x64` | Linux ZIP | Portable private test candidate |

Artifacts require access to the GitHub run and expire: non-Windows artifacts
are retained for 14 days, Windows for 90 days. No stable visitor download is
published by this work. Before tester distribution, record the run/attempt,
artifact ID, exact package SHA-256, embedded build ID and platform. Keep these
packages separate from the immutable public v0.29.0 assets with similar names.

For example, download each successful target into a distinct empty directory:

```sh
gh run download 39197407138 -R rupret007/webjam -n webjam-macos-arm64 -D candidate/macos-arm64
gh run download 39197407138 -R rupret007/webjam -n webjam-macos-x64 -D candidate/macos-x64
gh run download 39197407138 -R rupret007/webjam -n webjam-windows-x64 -D candidate/windows-x64
gh run download 39197407138 -R rupret007/webjam -n webjam-linux-x64 -D candidate/linux-x64
```

Verify the Windows manifest on Windows with `Get-FileHash -Algorithm SHA256`,
Mac packages with `shasum -a 256`, and Linux with `sha256sum`. An Actions
artifact ZIP digest and the package digest inside it identify different bytes.
Record both when available. Require the package's embedded build ID to equal
the full `5eff` source hash above before testing the invitation flow.

## Candidate package hashes

Snapshot frozen 2026-10-19T04:54:06.478726Z. These are inner package hashes from run
`39197407138`, source `5effbc58db706254f8ca8b52de4a0520c482294a`. Intel remains
pending; the live run can advance after this record. ZIP fallback hashes and
outer Actions artifact identities are in the JSON receipt.

| Computer | Preferred candidate package | SHA-256 |
| --- | --- | --- |
| Apple Silicon Mac | `WebJam-v0.29.0-macos-arm64-ADHOC-TEST-ONLY.dmg` | `a2c2188e9afa2f804cdfa8cb7382f4be94189877c9574b43aababa7b5a4054cb` |
| Intel Mac | Pending upstream packaging | Pending |
| Windows x64 | `WebJam-v0.29.0-windows-x64-UNSIGNED-TEST-ONLY-setup.exe` | `e72fde40f4a70466d21fe57c96404b2b3f686d700435f173d5cb7eea5321ed1c` |
| Ubuntu 22.04 x64 | `WebJam-linux-x64.zip` | `c0ff84e9ebf1660380a0ccef03987f00c93c85eb7fde00fd4a882dc1bece57da` |

## Checks already executed on the candidate

- **Apple Silicon Mac:** downloaded Actions ZIP digest, DMG/ZIP hashes and
  embedded source ID passed. The actual DMG was verified and mounted read-only,
  its app copied to an owned folder, and its deep/strict ad-hoc signature
  verified. The actual frozen executable passed its upstream isolated
  Reference Studio runtime smoke. The package's own native fabric passed
  mandatory hash/signature/architecture and ready/hello/stop checks.
- **Native handoff from that Mac package:** its unmodified bundled Python code
  was loaded in an isolated Python 3.11 interpreter, including the actual Qt
  Join dialog and frozen transport integrity policy. Its own fabric and
  Jamulus server authenticated a native guest and returned a real Jamulus
  packet using the explicit sealed-reply fallback. The frozen application
  process was checked separately; this does not claim a human-clicked Join in
  that process, physical audio, WAN timing or another computer.
- **Windows x64:** downloaded Actions digest, Setup/ZIP checksums, the generated
  manifest, embedded source ID and fabric manifest passed. Native Windows CI
  installed Setup, launched the installed app, checked owned shortcuts and
  uninstalled it while preserving an unowned file. Actual packaged ingress
  accepts full v2/v3 messages. The downloaded fabric PE has no Authenticode
  certificate table, so remote v3 remains blocked by its unchanged policy.
- **Ubuntu 22.04 x64:** downloaded Actions digest, inner ZIP checksum, embedded
  source ID, x64 ELF fabric and manifest passed. Native CI launched the actual
  frozen package, checked its native transport and exercised Jamulus against a
  private dummy JACK graph with authenticated loopback RPC and cleanup checks.
- The actual packaged ingress was loaded from each checked package's original
  PYZ archive: full v2/v3 messages passed and incomplete bare v3 links failed.
  Switching parser-platform arguments is policy testing, not Windows/Linux
  execution on this Mac. The native CI jobs are separate OS execution evidence.

No installation helper was run on the user's Mac; the installed app stayed at
0.27.2, no owned native test process remained, and the default `webjam:` handler
still resolved to `/Applications/WebJam.app` after the candidate checks. All
physical three-computer installation/audio rows remain pending.

## A genuine v2 invitation uses the separate LAN route

The existing v2 private-LAN Music Join path remains intended on Mac, Windows
and Linux. It performs authenticated LAN room discovery and starts ordinary
Jamulus against the host's LAN address. It does not create a
`NativeGuestTransportBackend` or launch `webjam-fabric`, so the Windows fabric
signature requirement below does not apply to that route. This is an existing
protocol path, not a relaxation of the v3 check. The
[startup dispatch](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/webjam_qt/controllers/application_controller.py#L5136)
keeps it separate from v3;
[LAN admission](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/webjam_qt/controllers/room_participant.py#L294)
hands a discovered Music room to direct Jamulus startup.

Use only a genuine invitation copied by a LAN host, on the same private
network. The unchanged public v0.29.0 Mac Host generates the LAN invitation
under its normal non-lab policy. The current `5eff` Mac package instead selects
v3 when its sidecar is available; no ordinary LAN Music selector was found.
Do not remove the sidecar, force integration-test flags, strip a remote invite,
or treat a private-LAN address as a cross-household solution.

Evidence remains narrower than a completed three-device LAN session:
the actual public Mac frozen parser accepts v2; the source's v2 Music
discovery-to-Jamulus journey is tested with audio startup intercepted. Native
Windows CI runs real authenticated loopback HTTP for the Art LAN owners, while
its frozen continuity smoke uses a v1 endpoint invitation with startup
intercepted. Neither is a Windows v2 Music audio pass. Record a separate LAN
installation/Join/audio/Leave acceptance on actual Mac, PC and Linux computers,
using exact package hashes. Keep that result separate from remote v3 acceptance.

## Windows remote Join needs a signed candidate

The unmodified frozen app's
[`_integrity_options`](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/services/native_remote_transport.py#L148)
requires platform signature verification before launching its native transport.
On Windows,
[`_verify_platform_signature`](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/services/transport_runtime.py#L693)
requires `Get-AuthenticodeSignature` to report `Valid`. The ordinary candidate
builder explicitly requires its fabric executable to be `NotSigned`. Therefore
its installer/frozen-launch CI can pass while current v3 Music Join fails
before the transport starts. Parser acceptance alone does not test this gate.
This conclusion is from the exact source policy; physical Windows execution is
still pending.

The existing `windows-release-trust` workflow can produce a signed test
candidate without a public release, but its `windows-release` environment
and this personal repository currently expose no secret or variable names. It requires
`WINDOWS_CODESIGN_PFX`, `WINDOWS_CODESIGN_PASSWORD` and
`WINDOWS_CODESIGN_SUBJECT`. Provision a real approved signing identity through
the existing signing workflow, then bind the final signed package's hashes and repeat
installation and native Join on Windows. Do not disable the signature check or
describe an unsigned launch pass as remote Join readiness. The ordinary
four-target build remains useful for package provenance and installation checks.
Read-only GitHub metadata reports no protection rules or branch policy on this
environment. Configure the required reviewer protections before supplying
signing credentials; an environment binding alone does not provide them.

## Installation and actual joining still to execute

For attended installation, GUI and audio acceptance, use a disposable OS user
profile on each physical computer. A separate app folder alone does not isolate
WebJam's home-directory settings. Windows Setup also reuses its stable per-user
AppId, previous install location and shortcut names; a different folder in the
primary profile can still affect the existing installation. A disposable VM
can cover an additional installer check, labeled separately from physical
audio acceptance. Record the default `webjam:` handler before and after.

Within that test profile, Mac testers choose the matching architecture and copy
the candidate app to a separate test folder. Windows testers exercise the
candidate per-user Setup, its normal bundled Jamulus setup and later its
uninstaller; the portable ZIP is a separate fallback, not proof that Setup
works. Ubuntu testers extract the entire ZIP together and follow its included
Jamulus setup instructions, whose helper verifies the pinned package before
invoking the OS installer. The local Mac checks above used the app's isolated
runtime hook and explicitly owned settings; an ordinary GUI launch needs the
profile isolation described here. Native CI launch/process/installation checks
do not replace the following human device observations.

1. Record physical OS/version/architecture, exact package SHA-256 and build ID,
   installed path, signature/trust prompt, and actual app launch.
2. A Mac starts a real native Music session and uses **Copy Invite**. It shares
   the complete message into an invite-only Hang Out jam room.
3. On the other computer, use **Copy full WebJam invitation**, open the exact
   candidate, choose **Join**, and paste the whole message. The `webjam://`
   line by itself omits required sealed signaling. Windows/Linux private
   invites use explicit paste, not a command-line deep link.
4. If requested, return WebJam's short reply to the host and use **Paste Reply**.
   Use separate households/networks for the cross-network test. Keep working
   invitations in the private session, out of screenshots and support logs.
5. Verify actual microphone/interface input and headphone output, authenticated
   participant presence, reconnect behavior, and normal **Leave/End** cleanup.
   Record automatic-signaling versus explicit-reply behavior, audibility,
   dropouts and measured timing honestly.
6. Verify Windows uninstall and absence of owned WebJam/Jamulus/fabric residue;
   check normal process/port cleanup on Mac and Linux too. Do not stop another
   running user's session to manufacture a clean result.

Record Mac, Windows and Linux separately in the
[first-session acceptance sheet](HANGOUT_BETA_FIRST_SESSION.md). A same-Mac
native forwarding pass, a CI runner launch, or successful parser-policy checks
cannot fill a physical PC/Linux, cross-network audio or musical-timing row.
Browser Web Join remains disabled and is not an installer substitute.
