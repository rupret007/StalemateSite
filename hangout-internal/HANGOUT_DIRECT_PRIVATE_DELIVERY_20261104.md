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

## One matching native package cohort

[Run41798291653](https://github.com/rupret007/webjam/actions/runs/41798291653)
uses merged source `d3ea7c55b95b155e355d96d59491eb704d895bd2` on the dedicated
branch `codex/private-web-join-test-d3ea7c5-20261104`. It includes the qualified
lifecycle/adaptive fixes and subsequent documentation merges. Inputs select
`final_build=true`, `web_join_target=private-beta`; signing rehearsals, manual
certification and unapproved component evidence are off. No tag/public release
was requested. Inventory and an exclusive dispatch-attempt receipt prevented a
second cohort.

At the09:00UTC observation ARM Mac, Windows and Linux packaging passed; Intel Mac
was still running. The actual ARM Actions archive digest matched GitHub's digest.
Its inner package source and private-beta manifest match the requested source,
its executable is arm64, and normal deep/strict code-signature verification
passed. It is explicitly an ad-hoc private test build; no notarization, installed
workflow, capture or music is established by those checks. Other downloads,
platform checks and actual use remain separate. Follow the live run and the
receipt's dated platform snapshot rather than assuming this paragraph is final.

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

The current ordered checklist is:

1. Finish and inspect this single native cohort; verify each actual archive,
   source, private target, architecture and applicable normal platform trust.
   Preserve Linux and unsigned Windows limits; Windows browser joining remains
   the permitted route where native transport trust is blocked.
2. After the pending credential confirmation, complete the reviewed separate
   browser-key/issuer/exact-origin setup directly here, preserving existing
   desktop secrets, state and limits. Keep AI and separate Hang Out media TURN off.
3. Obtain current device/headphone/capture readiness. Demonstrate actual
   reciprocal ARM/Intel/Windows music and a separate-network pair: one native host
   and one browser guest, at most10 minutes per trial. Record hearing, dropouts,
   interruption, Stop/leave and recovery. Synthetic audio, WSL and same-machine
   echo do not qualify. If a human check is unavailable overnight, leave the
   shortest precise morning action without inventing a pass.
4. Verify current reporting and only Jeff's human review through normal access;
   leave unrelated reports unchanged. Preserve all remaining accessibility,
   hosted-capacity, all-ages, legal/operator and other62-outcome audit gaps.

Overall private music demo readiness remains UNPROVEN. Delivered chat and
package/CI checks do not substitute for actual reciprocal music.
