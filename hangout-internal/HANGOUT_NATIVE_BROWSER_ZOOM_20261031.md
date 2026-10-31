# Native browser zoom: retained-message composer clipping

Recorded October31,2026. This is an application defect and a focused candidate
fix. The original native400 failure remains a failure until the changed source
passes both the relevant browser checks and a new actual native zoom journey.

## Actual baseline observation

A separate native macOS Chrome Guest window used the existing disposable
loopback relay. Its application assets matched website source
`96f356a6f2a9af4bbd2834bb94f1e5df81d200dd`; the tested local Git head was
`dbae92212247faa80f305062bc9175600f2b82ea`. The installed Chrome bundle version
was156.0.8078.76. No extension, DOM/native hook, fake clock, microphone/camera capture, provider or
production session was used.

Chrome's native View menu/zoom controls and AX state confirmed200% and400%.
At200%, the composer and Send remained visible. At400%, a retained rejected
message copy and the new-message row consumed the short chat pane; the composer
was clipped beneath section navigation. Tab/Space still sent a real local
message, but keyboard submission did not prove visibility. Scrolling over the
navigation did not expose it. The initial repeated-character probe was refused
by unchanged spam policy and retained as an unsent copy; a normal message passed.

The [original screenshot](../pr-assets/beta-collaboration/20261031/native-browser-zoom/chrome-400-before.png),
[actual AX snapshot](../pr-assets/beta-collaboration/20261031/native-browser-zoom/chrome-400-before-ax.txt)
and [sanitized source/artifact receipt](../pr-assets/beta-collaboration/20261031/native-browser-zoom/before-receipt.json)
retain that negative result. The original200% and post-scroll400% images,
source hashes and detailed setup observations stay in ignored local evidence.

## Candidate and required verification

At short heights, the existing chat pane is allowed to scroll vertically when
recovery/jump rows exceed its height. Existing controls, text, retained drafts,
input16px sizing and horizontal containment remain. No information, spam rule,
session policy or control is removed to manufacture a smaller layout.

Two new cases in [the accessibility suite](../tests/e2e/lobby-accessibility.spec.js)
exercise saved-message recovery at300x299 and320x256. They use real loopback
sockets and keyboard Tab/Space, retain the unsent copy, check successful normal
message delivery, and hit-test the input/Send corners against clipping. These
are reflow regression dimensions, separate from actual browser zoom.

The first local baseline and candidate attempts were both refused before Node
started by the unchanged swap guard. They are not red/green test results.
Current-source CI and a new native400 observation remain required; source code
alone does not prove the fix. Keep the before receipt, use new names for after
evidence, and verify375/390 regressions plus existing recovery/keyboard cases.

W3C's [Reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
allows responsive relocation and vertical scrolling while retaining content and
function. Its separate [Resize Text guidance](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
addresses enlargement through200%. These observations do not establish complete
WCAG conformance, screen-reader speech, text-only zoom or physical iPhone use.

The Guest window was restored to100% and closed back to the original profile
picker. The loopback server ended at its original600-second bound; no process or
port remained. No user profile or hosted-session observer was changed. All
[62 original outcomes](HANGOUT_ACCEPTANCE_REQUIREMENTS.md), provider/AI/vault,
age/camera/consent, native-trust and public-release holds remain intact.
