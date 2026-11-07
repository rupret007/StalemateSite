# Direct private demo delivery — November 4, 2026

Jeff's new goal assigns WebJam application builds, private Cloudflare delivery
and testing directly to this chat. It supersedes the earlier delivery handoff
to StoryPool. StoryPool core, Karen, installed services and shared operational
state remain untouched. The prior recipient was notified to prevent duplicate
work. This remains one private community; neither public band navigation nor
public launch is enabled. All 62 acceptance requirements and their full audit
remain unchanged.

## Delivered website and actual guest use

Qualified application source `de2b01725925d2f78ee21af33f68f3eb4eb95407`
(website PR201) now runs on the existing invitation-protected beta as Worker
`c0586c29-3d43-4ffa-96e4-646b9e7dde06`. The approved music-origin configuration
was applied at 18:07 UTC; all 68 assets remain identical to201. Its immediate
rollback is `dbcaddf5-dd3f-48e3-9826-0d7998ffdbc0`.

Private address: <https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>.
The invitation remains in the owner-only local note, not this document.

For the earlier 08:28 delivery of `dbcaddf5`, the previous version
`a9724702-3ce5-418a-bbd4-950f2e169c9e` remains its recorded rollback target.
Before that delivery, every plain variable matched the live
configuration. After deployment, all effective bindings, secret binding names,
Durable Object namespace IDs and runtime settings were identical. Existing
legacy session authority, sessions, keys, ledgers and reports were preserved;
no authority migration or provider activation occurred in that deployment.
The separately approved18:07 music configuration changed only
`WEBJAM_WEB_ORIGINS`; all other bindings, secret names, namespace IDs, sessions,
reports and runtime settings remain identical. AI and the separate Hang Out
chat/media TURN remain off.

All 68 packaged asset files matched source. Authenticated reads also verified
served lobby JavaScript/CSS and Web Join app/session bytes against source.
The [scoped receipt and captures](../pr-assets/beta-collaboration/20261104/direct-private-delivery/receipt.json)
record the following actual private-service observations:

- Three independent guest/fan clients exchanged lobby and ordinary guest-channel
  messages. Stalemate/Rad Dad entry choices displayed the corresponding badges
  on real messages; hiding a badge removed it from a new message. These are
  canonical private entrance choices, not navigation from the public band pages.
- A late visitor received post-join messages but neither earlier lobby text nor
  earlier channel text. All three logout requests returned200 and subsequent
  state requests returned401.
- Chromium and WebKit guests created/joined a temporary art channel and drew in
  both directions, verified by received stroke events and changed counterpart
  canvas pixels. They left and logged out; subsequent state requests returned401.
- Four inspected captures cover375/390px in both engines. Page/body widths stayed
  contained, input and Send remained visible, and input text stayed16px. No media
  capture was requested. Captures contain only the synthetic QA participants.
- A real anonymous browser received401 for beta state, protected Join and lobby
  JavaScript. A separate Python probe was rejected by Cloudflare with403/error1010;
  it is retained as a distinct observation, not relabeled as application401.

The first drawing/layout run remains FAILED at its plain-Tab assertion on Mac
WebKit; preceding two-way drawing is scoped evidence only. A targeted diagnostic
found both viewports contained and Send enabled, with plain Tab skipping Send
and Option+Tab reaching it. The follow-up retains the focus assertion using the
observed platform chord and passes the full drawing/layout/leave/logout journey.
No application focus repair, system preference change, skip or timeout increase
was introduced. See the retained first result and separate diagnostic alongside
the receipt. [Apple's keyboard guide](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)
describes configurable Tab/Option-Tab navigation; these captures qualify tested
Mac WebKit, not a physical iPhone or complete screen-reader/WCAG acceptance.

[Additional delivered checks](../pr-assets/beta-collaboration/20261104/direct-private-delivery/completion/receipt.json)
record deliberate local socket close/manual reconnect in both Chromium and
WebKit. An unsent draft survived without being transmitted; old and missed chat
were absent after reconnect, new messages arrived, and reload started fresh.
Copied session cookies worked before logout and returned401 after the actual
logout. Both engines ended with confirmed cleanup and zero capture requests.
This is not a physical network interruption or a new expiry observer. The first
attempt remains FAILED: after Chromium passed those assertions, its helper
incorrectly required a second logout of the already-revoked session to return200
instead of401. The follow-up tracks completed logouts; no app code changed.

A benign message from an ordinary guest was reported by another guest, with a
real server acknowledgement and truthful queued-for-review UI. **Only Jeff may
dismiss “Private demo acceptance report test only November four 5ca199”**
(message `mmw1wi7st1`). Its human disposition remains pending; leave all other
reports, including older synthetic reports, unchanged. Earlier human dismissals
do not qualify this report's current review.

## Actual physical Wi-Fi chat and corrected native package cohort

At 18:44 UTC, installed Chrome on the ARM Mini and Intel MacBook exchanged real
ordinary-channel messages through the private service. They used the Stalemate
and Rad Dad entrances, displayed both badges, and the later MacBook visitor saw
no earlier channel text. Both normal logouts returned200 and subsequent state
requests returned401. Capture requests were zero. Tailscale/SSH carried test
administration; website traffic used the normal Internet route. The MacBook's
default network interface was Wi-Fi. This does not establish an off-site pair.

The MacBook's actual Chrome 375/390 viewport captures were visually inspected:
page/body stayed contained, input text was16px, and input/Send remained visible.
These are viewport tests on physical Intel hardware, not physical iPhone tests.
See the [afternoon receipts and captures](../pr-assets/beta-collaboration/20261104/direct-private-delivery/afternoon/receipt.json).

Live testing then reproduced a real music-setup blocker on both Macs: the
default Python HTTP identity received Cloudflare 403/error1010. Honest WebJam
and Go identities received 204 for the same nonexistent mailbox. Native
[PR428](https://github.com/rupret007/webjam/pull/428) sets `User-Agent: WebJam`
on both production HTTP mailbox clients. Cloudflare's
[workers.dev1010 guidance](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)
supports a descriptive application identity. No server security protection,
certificate verification, redirect policy or response validation was weakened.

Both new regression cases fail on the parent;105 focused cases pass after the
fix. Both corrected production source clients receive204 from the live service.
An initial broader local run retained four failures from a missing pinned
WebSocket dependency; installing that dependency only in this worktree produced
the105-case pass. No global environment or shared cache was repaired/deleted.

Reviewed head `640fa3c5ae44f9caaca47c8ec35510880c673ecc` and actual CI checkout
`bffdf9437be8063c318a5ce856a4c0a2123de7cd` share whole tree
`fa148576d2c64d23250e53f20a76ff99947ab3f3`. All six required checks passed;
all 562 tracked Python modules ran once: 12,911 passed and 60 existing skips.
PR428 merged normally as `12d939af29ae2b28f8d25cd21186d8c2d1eb8927`.
Its original missing-changelog CI failure is retained;640 adds only that fragment.

Exactly one corrected private cohort,
[41886309202](https://github.com/rupret007/webjam/actions/runs/41886309202),
uses actual source `e101465df5d204809619aafc8b65fd7925950e8a`. Its main CI
independently ran the same 562-module loop:12,911 passed / 60 skipped, and both
real Jamulus integrations passed. This build contains the runtime correction;
later640 and merge12d add no further runtime inputs. Do not dispatch another
cohort for the changelog, relabel e101 archives as640/12d, or use old d3 archives
as proof of the correction. The run completed with16 successful and6 skipped
jobs. All four actual archives matched GitHub's digest and size, embedded e101
private-beta target and expected executable architecture. Both Mac bundles pass
normal deep/strict ad-hoc signature verification. The
[afternoon package receipt](../pr-assets/beta-collaboration/20261104/direct-private-delivery/afternoon/native-fixed-packages.json)
records each actual archive and verification boundary:

| Platform | Actions artifact | Actual executable | Qualification boundary |
| --- | --- | --- | --- |
| ARM Mac |13353961921 |Mach-O arm64 |Deep/strict signature; actual startup, Join recovery and normal close |
| Intel Mac |13353864438 |Mach-O x86-64 |Deep/strict signature; no physical native launch or audio claimed |
| Windows |13354401820 |PE x86-64 |Verified unsigned test archive; physical installation/audio unqualified |
| Linux |13354580740 |ELF64 x86-64 |Verified archive; physical installation/audio unqualified |

Windows remains an unsigned private test
build; no public tag/release or platform trust bypass is authorized.

The corrected ARM archive's digest, source/private target, arm64 executable and
deep/strict ad-hoc signature pass. Its actual native Join screen refused a
malformed non-secret invitation with visible/accessibility feedback; editing
cleared the error, Return restored it, and Back returned to Music/Art. Normal
Close left no owned process and preserved saved config/mix content and mtime.
Host/capture never started. This is frozen-app recovery proof, not live music.

## Earlier d3 native package cohort — retained scope

[Run41798291653](https://github.com/rupret007/webjam/actions/runs/41798291653)
uses merged source `d3ea7c55b95b155e355d96d59491eb704d895bd2` on the dedicated
branch `codex/private-web-join-test-d3ea7c5-20261104`. It includes the qualified
lifecycle/adaptive fixes and subsequent documentation merges. Inputs select
`final_build=true`, `web_join_target=private-beta`; signing rehearsals, manual
certification and unapproved component evidence are off. No tag/public release
was requested. Inventory and an exclusive dispatch-attempt receipt prevented a
second cohort.

The complete run passed:16 successful jobs,6 intentionally skipped, no failed
jobs. All four actual downloaded Actions archives matched GitHub's digest and
size; inner payloads matched source/private-beta target and expected architecture.
The earlier09:00UTC receipt is retained as a dated snapshot, not the final status.
The [completion package receipt](../pr-assets/beta-collaboration/20261104/direct-private-delivery/completion/native-packages.json)
pins archive IDs, digests, inner packages and applicable signature checks:

| Platform | Actions artifact | Actual executable | Qualification boundary |
| --- | --- | --- | --- |
| ARM Mac |13308123307 |Mach-O arm64 |Deep/strict signature passes; actual first screen and normal close observed |
| Intel Mac |13310245250 |Mach-O x86-64 |Deep/strict signature passes; not launched on physical Intel hardware |
| Windows |13309440164 |PE x86-64 |Unsigned private test package; no trust bypass, installation or audio claimed |
| Linux |13308581107 |ELF64 x86-64 |Archive inspected; no physical installation or audio claimed |

Both Mac signatures are ad-hoc private test signatures, not notarization. ARM's
normal Music/Art chooser opened from the verified package without requesting
capture; Host/Join were not clicked. Window Close ended the processes normally,
with both saved settings files' content and modification times unchanged.
App-specific UI readback had reopened the app after earlier closes; final exit
was verified through the process list and global app inventory instead. No
forced termination or platform security changes were used.

The first Intel verifier failed because it counted a legitimate PyInstaller
manifest symlink as a second manifest. That failure is preserved. A corrected
verifier requires one regular canonical manifest and validates all aliases,
paths, source and target against the unchanged archive. It does not remove an
application check or alter a package to make it pass.

Documentation head 6fb7653 and actual PR checkout b854cea share whole tree
`0acaadf85a3ce063dd11515f0ebb4c108cbaab90`. Both full CI jobs passed 2,061 units
in 137 files, 763 main browser cases and separate 34/34 deployment-path checks,
without retry/flaky summaries; Pages jobs skipped. See the
[source-bound qualification](../pr-assets/beta-collaboration/20261104/direct-private-delivery/afternoon/website202-6fb-ci.json).
These are the previous documentation head's results, not automatic qualification
of a later documentation push or physical music.

## Physical device findings after the afternoon package checks

[Hardware and installation receipts](../pr-assets/beta-collaboration/20261104/direct-private-delivery/hardware/receipt.json)
retain both failed real ARM-native attempts. Jamulus selected
`in: BlackHole 16ch/out: Jabra Evolve 75`. Disconnecting only Jamulus while the
WebJam session remained active caused the owned engine to restart; Jeff also
observed that restart. Normal **End Session → Yes** returned WebJam to
**Start Session / Audio: Stopped**, with no owned engine/server/sidecar left.
No browser music guest connected and the test requested no recording.

For the second attempt, the operator backed up the dedicated WebJam Jamulus
profile and changed only its encoded audio-device selector to the actual Jabra
input/output names. A normal Start Session still showed the BlackHole input
in Jamulus. This reproduces the route fallback; it does not prove its precise
driver/application cause or qualify Bluetooth-native music. Do not repeat that
capture path as a successful microphone test. Global audio routing was unchanged.
An auxiliary standalone/reopened Jamulus process also produced a SIGABRT/malloc
crash report during cleanup. It lacked the managed-profile arguments; its cause
and regular-profile byte preservation remain unqualified. This is distinct from
the parent WebJam process and the normal End Session cleanup observations.

The user connected the Jabra to the Mini and retained the MacBook's internal
microphone and wired headphones. At19:57UTC, after unplugging the HP dock's
Ethernet cable, the Mini's actual default route was `en1`, **Wi-Fi**. The earlier
18:44 chat qualifies the MacBook's Wi-Fi use; the Mini route was not measured
then. A later wired observation must not be silently relabeled as Wi-Fi or vice versa.

The actual verified e101 Intel archive was transferred to the physical MacBook.
The first Desktop extraction failed normal `codesign --verify --deep --strict`
with “resource fork, Finder information, or similar detritus not allowed”; its
bundle had FinderInfo/file-provider attributes. That failed copy is preserved.
The **same unchanged archive**, extracted into the private cache, passed normal
verification on the MacBook; verification through its new Desktop shortcut also
passed. No attributes were stripped, no quarantine/security setting changed,
and no code was re-signed. **WebJam Private Demo** on the MacBook Desktop points
to this verified cache copy. Native GUI startup and actual music are still pending.

A headed MacBook Chrome guest created a normal private Jam room for the upcoming
native **Copy web invite → Share** flow. No invitation arrived before its bounded
wait expired: the original TimeoutError is retained, with logout200/state401 and
zero capture requests. This is preparatory room evidence, not an invitation or
audio pass. The Mini browser-guest harness is prepared but has not run. Its planned
per-page Jabra hardware selection must be recorded as operator test setup; it is
not evidence that the shipping site exposes an output-device picker.

The exact documentation head `dc863c1a0910e4511f9db356541214a7bd049be5` and actual
PR checkout `7210765dd1a5bd99f1d91e1ec3afdb0c8cc1380d` share tree
`5e44020f099386ff8380c2c5e23cf9805a5c8c21`. Both terminal jobs passed2,061 units
in137 files,763 main browser cases and separate34/34 path checks without failure
or flaky summaries; both Pages jobs skipped. The
[exact CI receipt](../pr-assets/beta-collaboration/20261104/direct-private-delivery/hardware/website202-dc863-ci.json)
qualifies that documentation tree, not a later push or physical music.

## Provider readiness and next actions

Read-only dashboard inspection verified actual successful, unfiltered,
account-wide TURN and SFU GraphQL responses and their dates, together with the
current subscription and billing cycle. The query windows cover the observed
current billing period to date. The bounded private-trial headroom preflight is
qualified at that observation; account financial values and raw responses remain
owner-only. Recheck before a trial and retain analytics-lag/concurrent-usage
limits. A chart saying No data alone does not establish zero usage. Primary
references: [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)
and [billing-period reporting](https://developers.cloudflare.com/billing/manage/billable-usage/).

Jeff explicitly approved the separate `webjam-private-web` application and
installation in the existing `webjam-turn-credentials` Worker. Both new bindings,
`WEB_TURN_KEY_ID` and `WEB_TURN_KEY_API_TOKEN`, are stored as encrypted secrets.
Existing desktop/account secrets were preserved. Full credential values were
neither printed nor committed. No vault unlock, purchase or plan upgrade was needed.

Secret-only version `0293048a-6440-4e31-ad41-85b3d8f4074b` precedes the actual
issuer configuration version `60e3f182-2d11-4740-b89a-74377778766d`; it is the
issuer rollback. Normal Wrangler deployments preserved variables/secrets and
added only four reviewed issuer variables: exact origin list, production mode,
3,000 daily web requests and 200 GB web monthly cap. Existing desktop 800 GB cap,
600-second TTL, quotas, namespaces and runtime settings remain unchanged.

Fresh successful account-wide TURN/SFU GraphQL responses at 17:56/17:58 UTC cover
the observed billing period to date, with one account, no app/key filter, no
errors and no usage groups. This supports a bounded-trial headroom inference at
observation, not a provider spending guarantee. Recheck before actual media.

Actual protected-browser CORS/invalid-request handling passed. Separate live API
checks with an honest application identity returned 204 for both exact allowed
origins and 403/no allow header for an unknown origin. One random syntactically
valid test-session request issued a 600-second/256 MiB web credential document,
without recording its values or creating any relay allocation. It expired before
18:44. This does not prove a real native invitation, authenticated host ownership,
relay performance or music. The original Python edge rejection remains distinct
from the actual Worker-level CORS denial.

The current ordered checklist is:

1. Use the verified e101 package cohort above, preserving exact source/digests,
   private target and normal platform trust. Do not rebuild for 640's changelog
   or rerun unchanged successful tests. Preserve all earlier failures. Later
   documentation pushes need their own normal CI;6fb's evidence stays separate.
2. Jeff opens **WebJam Private Demo** on the MacBook Desktop and confirms the
   Music/Host/Join screen before starting another bounded trial. Use its internal
   microphone and wired headphones as native host; use the Mini's real Jabra
   microphone/headphones as browser guest. Preserve the failed ARM-native route
   and verify each actual physical route before counting audio. The first
   publisher is terminal; prepare a new normal private Jam-room session only
   after Jeff is ready. The intended flow is native **Web Join → Allow a web
   guest → Copy web invite**, then the normal website **Share / Join in browser**.
   Jeff approved Mini/MacBook microphones with headphones and no recording.
   Windows audio readiness is still unconfirmed. Demonstrate actual
   reciprocal ARM/Intel/Windows music and a separate-network pair: one native host
   and one browser guest, at most 10 minutes per trial. Record hearing, dropouts,
   interruption, Stop/leave and recovery. **Wi-Fi first**, then a separate Ethernet
   comparison; do not substitute wired results for the primary wireless journey.
   Synthetic audio, WSL and same-machine
   echo do not qualify. If a human check is unavailable overnight, leave the
   shortest precise morning action without inventing a pass.
3. Remove only the temporary MacBook test key and owned test sessions/processes
   after device testing; do not alter other keys, services or system settings.
4. Complete only Jeff's current synthetic-report review through normal access;
   leave unrelated reports unchanged. Preserve all remaining accessibility,
   hosted-capacity, all-ages, legal/operator and other 62-outcome audit gaps.

Overall private music demo readiness remains UNPROVEN. Delivered chat and
package/CI checks do not substitute for actual reciprocal music.

## Short morning walkthrough

1. Open the original private invitation. The plain beta URL alone does not
   provide admission; never publish the invitation or paste it into a report.
2. Select **Choose a nickname and join**, choose a nickname and enter. In a
   second browser/device, use the invitation and a different nickname. Exchange
   messages in `#stalemate`; an arriving visitor should see new chat only.
3. Select **Start a room** and a shared canvas. Let the other visitor join and
   draw; then leave back to `#stalemate`. Camera/microphone are unnecessary.
4. Jeff can use **Moderator sign-in**, complete his normal email verification,
   then **Open moderation panel**. Find the exact5ca199 report above; dismiss
   only that report and confirm it disappears. Other guests get no staff access.
5. Music requires the first two remaining actions above. Once the MacBook door is confirmed, use the
   matched Intel Mac package as native Music host, allow Web Join intentionally,
   and share its complete generated invitation through the private Jam room.
   Use Intel/Windows browser guests in separate bounded trials with headphones
   and capture consent. Never substitute a hand-built invitation or claim a
   successful chat/drawing visit demonstrates music.
