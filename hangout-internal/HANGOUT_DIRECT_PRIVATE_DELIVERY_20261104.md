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
`dbcaddf5-dd3f-48e3-9826-0d7998ffdbc0`.

Private address: <https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>.
The invitation remains in the owner-only local note, not this document.

The previous version `a9724702-3ce5-418a-bbd4-950f2e169c9e` is the recorded
rollback target. Before deployment, every plain variable matched the live
configuration. After deployment, all effective bindings, secret binding names,
Durable Object namespace IDs and runtime settings were identical. Existing
legacy session authority, sessions, keys, ledgers and reports were preserved;
no authority migration or provider activation occurred.

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

## One matching native package cohort

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

Documentation head3d7edb1 and actual PR checkoutdc3707c share whole tree
`ec04816c18bf3f68de0be29e41d2ec5397b108da`. Both full CI jobs passed2,061 units
in137 files,763 main browser cases and separate34/34 deployment-path checks,
without retry/flaky summaries; Pages jobs skipped. See the
[source-bound qualification](../pr-assets/beta-collaboration/20261104/direct-private-delivery/completion/website202-ci.json).
These are the previous documentation head's results, not automatic qualification
of a later documentation push or physical music.

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

Current issuer version `e7cda1bb-be95-4824-a363-924ff6f2948b` has its existing
account analytics binding but no separate browser TURN secret pair. The
`webjam-private-web` creation form is prepared. Browser-use policy requires
confirmation immediately before creating persistent security credentials; that
specific creation/installation question is pending. No key was created, copied,
printed or committed. The expected CLI vault is locked and no temporary session
handoff exists; no unlock was attempted.

Both owner-only proposed issuer and beta music configurations bundled successfully
in normal Wrangler dry runs. Neither was applied. The issuer proposal preserves
existing desktop/account bindings and adds the reviewed exact private origin;
the beta proposal changes only `WEBJAM_WEB_ORIGINS`. Existing namespaces,
sessions, ledgers and reports remain intact. Dry runs are configuration evidence,
not active credentials or a working music route.

The current ordered checklist is:

1. After the pending credential confirmation, complete the reviewed separate
   browser-key/issuer/exact-origin setup directly here, preserving existing
   desktop secrets, state and limits. Keep AI and separate Hang Out media TURN off.
2. Obtain current device/headphone/capture readiness. At10:05UTC the Intel
   MacBook is offline on Tailscale and Windows NucBox is online; online status
   does not establish consent, headphones, remote access or audio readiness.
   Demonstrate actual
   reciprocal ARM/Intel/Windows music and a separate-network pair: one native host
   and one browser guest, at most10 minutes per trial. Record hearing, dropouts,
   interruption, Stop/leave and recovery. Synthetic audio, WSL and same-machine
   echo do not qualify. If a human check is unavailable overnight, leave the
   shortest precise morning action without inventing a pass.
3. Complete only Jeff's current synthetic-report review through normal access;
   leave unrelated reports unchanged. Preserve all remaining accessibility,
   hosted-capacity, all-ages, legal/operator and other62-outcome audit gaps.

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
5. Music requires the first two remaining actions above. Once qualified, use the
   matched ARM Mac package as native Music host, allow Web Join intentionally,
   and share its complete generated invitation through the private Jam room.
   Use Intel/Windows browser guests in separate bounded trials with headphones
   and capture consent. Never substitute a hand-built invitation or claim a
   successful chat/drawing visit demonstrates music.
