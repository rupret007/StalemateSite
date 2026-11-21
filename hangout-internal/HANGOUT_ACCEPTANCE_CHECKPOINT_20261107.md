# Entrances, accessibility, decoding and report submission — November 7

**The private release candidate remains pending.** This adds observed application
evidence while the original expiry test continues. No runtime, provider setting,
workflow, public site or release hold changes. Preserve all
[62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md).

| Evidence target | Exact identity |
| --- | --- |
| Hosted website source | `b35e5fcf5904eb99e17de653ddd2234e553bbada` |
| Private Worker, 100% | `33862058-10a5-4a6f-9659-38841d70292f` |
| Unchanged issuer Worker | `4db649fa-a465-44b4-8487-414987b3a660` |
| Existing native packages and decoder CI | `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c` |
| Hosted browser | Sandboxed, headless Chromium 156.0.8078.4 on Ubuntu 26.04.1 / WSL2 |

These results supplement the [private receipt](HANGOUT_PRIVATE_RC_20261107.md),
[generated-media checkpoint](HANGOUT_LINUX_BROWSER_MUSIC_20261107.md) and
[integration guide](HANGOUT_WEBSITE_INTEGRATION.md). Source review, native CI,
actual hosted behavior and human acceptance remain separate.

## A neutral third website reaches the same community

The [hosted entrance proof](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-three-entrances-current-nov07.json)
used three distinct loopback website origins. Their links opened the actual
invitation-protected service; no site credential, registry change, cross-domain
cookie or signed identity fixture was supplied. Stalemate and Rad Dad displayed
their built-in badges and approved return links. The third site's plain link
joined the same lobby with neither a badge nor registered return link. This
proves basic neutral linking, not ownership or registration of a public partner
domain.

Neutral messages reached all three guests. Hiding Rad Dad's entrance removed it
from People and new messages; an already delivered line kept its original badge.
All remained ordinary guests and received 403 at the moderator page. Their
actual community cookies were hostname-scoped, Secure, HttpOnly and SameSite=Lax.
Fixture websites received no private invitation, authorization header or cookie.
All three normal logouts returned 200; copied cookies were denied with 401.
The [independent readback](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-three-entrances-final-readback-nov07.json)
matched the remote proof/harness hashes and found the owned Node process gone.
Capture and media-provider credential requests were zero.

A [return-link readback](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/public-return-destination-readback-nov07.json)
fetched both existing band homepages over normal HTTPS and confirmed their
canonical addresses. Neither response exposed private invitation values or a
private-beta destination link. A web-reader failure for Stalemate was checked
with normal system HTTPS requests, rather than assumed to be a site outage.
This read-only observation proves neither domain ownership nor permission to
publish.

## Eight-screen automated accessibility check

The [hosted axe audit](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-axe-current-nov07.json)
checked the nickname gate and connected lobby at 390px/1280px, plus mobile
People, Rooms, the new-channel dialog and command palette. The audit created
no room or public message. Axe-core 4.14.0 reported **zero automated violations**
on those eight states. Selected tags were `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa`, `wcag22aa` and `best-practice`; this is not a full conformance audit.

The original `color-contrast` and `label-content-name-mismatch` incomplete items
remain in the packet. No rule was suppressed or incomplete item relabelled as
an automated pass. A [focused source review](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-axe-focused-source-review-nov07.json)
checked the gate's maximum dot coverage, window chrome and normal/hover starter
text. All seven calculated text pairs exceeded 4.5:1 without rounding the
threshold; the lowest exceeded 6.87:1. This does not qualify every raster/emoji
pixel, overlapping element or clipped control.

The slash button's accessible name is “Commands.” Our review treats `/` as its
action symbol: W3C's [symbolic-character guidance](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html#symbolic-text-characters)
supports naming that function. Its [contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
supports evaluating underlying foreground/background colors. Actual speech
control, screen readers, physical Safari/iOS and full WCAG review remain pending.
The [cleanup/hash readback](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-axe-final-readback-nov07.json)
confirmed normal logout, copied-cookie denial, zero capture and process exit.

[Official engine metadata](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/axe-core-official-metadata-nov07.json)
and the [preparation receipt](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/axe-core-isolated-preparation-nov07.json)
pin npm SHA512 integrity and file hashes. The MPL-2.0 engine and third-party
licenses stayed only in the owned QA cache: no install scripts, global package,
application dependency or production CSP change. The
[initial harness stop](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-axe-first-formatting-stop-nov07.json)
occurred before authentication/browser startup because a string guard expected
different whitespace. The correction kept sandboxing required. As
[axe's documentation](https://github.com/dequelabs/axe-core#the-accessibility-rules)
explains, automated findings still need manual review.

## Reuse packaged MP3 evidence

The [existing CI review](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/packaged-mp3-existing-ci-reviewed-nov07.json)
re-read successful native run 42169901070, attempt 1, at source `76b1fd7`.
The actual packaged Reference Studio smoke passed on macOS x64, macOS ARM64,
Windows x64 and Linux x64. This reused evidence; no new native run was requested.

The [immutable source review](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/packaged-mp3-source-review-nov07.json)
confirmed the frozen smoke unconditionally exercises MP3 and fails if the
decoder is unavailable. It checks stereo 44.1kHz MP3, gapless/no-Xing metadata,
bounded initial decoding, 48kHz PCM streaming, restart, exact normal EOF, finite
nonzero samples and a zeroed terminal tail. Those files remain byte-identical
through later browser-only work.

This qualifies decoding/streaming in those CI packages. It does **not** prove
the live desktop Shared Track sender or audibility, add Windows/Linux sender
support, qualify release signing or establish that the separately requested
native provider-start mode ran. Follow the [music acceptance sequence](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md)
for the actual shared WAV/MP3 mix, physical inputs and second network.

## One real report submission; human review remains pending

Two ordinary cross-entry guests created an owned temporary QA channel and used
the normal message Report button on one harmless synthetic line. The
[public proof excerpt](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-moderation-submission-current-nov07.json)
records server acknowledgement and the disabled queued-for-review button. Both
guests were refused moderator-page access. Their own room closed normally;
both logouts/copied-cookie denials passed, with zero capture and AI off. The
[independent readback](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/hosted-moderation-submission-final-readback-nov07.json)
verified proof/harness hashes and process exit. Other reports were neither read
nor changed, and no participant was punished.

This proves submission feedback and isolation, not human review or an observed
moderator-queue read. The unique harmless-report lookup text stays in the owner's
local receipt. When Jeff is available, he should inspect and dismiss **only that
test report** in the real moderator panel, leaving other reports unchanged.
Do not duplicate it or claim automated moderation completed the human check.

## Remaining release work

Keep physical speech/instruments, the actual Shared Track mix, second network,
real Webex video/manual audio handoff and assistive-technology acceptance
pending. Leave the original real-expiry observer unchanged until its terminal
result; this checkpoint makes no eight-hour or uninterrupted-uptime claim.
Prepared countdown code has not been deployed by this checkpoint. Public-launch,
all-ages/parental-consent, legal/operator and native-release trust dependencies
remain separate. No StoryPool, Karen or shared operations changed.

The [packet receipt](../pr-assets/beta-collaboration/20261107/acceptance-checkpoint/receipt.json)
hashes all thirteen payloads, distinguishes exact copies from the two declared
report excerpts and preserves the original private receipts. Private invitation
values, credentials, recordings and raw private DOM/message dumps are absent.
