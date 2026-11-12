# Accessible conversation structure

An independent axe-core 4.14.0 audit reproduced defects in the existing lobby:
the ordered list had `role="log"`, overriding its list semantics and leaving
message listitems without a valid list parent. The visible random-nickname
label was also missing from its accessible name. The nickname gate lacked a
visible main landmark, and the connected workspace lacked a level-one heading.

This candidate keeps the existing scrolling `.buffer` as the named live log
and places a named ordered message list inside it. The existing scroll,
announcement preference and repaint suppression stay on that outer log.
Appending, trimming to 300 messages and clearing on channel/session changes
operate on the inner list. The gate and connected workspace each expose their
own main landmark when visible, and the workspace has a screen-reader heading.
The random-name button's accessible name now includes its visible wording,
and the named feature group has an appropriate grouping role.

This follows the W3C's [sequential log technique](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23)
and [label-in-name technique](https://www.w3.org/WAI/WCAG22/Techniques/general/G208).
It preserves the visual layout rather than changing how chat is arranged.

The [evidence receipt](../pr-assets/beta-collaboration/20261107/chat-semantics/receipt.json)
binds the actual tested runtime file hashes and reports:

- 36 complete baseline audit states with the original findings, followed by
  36 candidate states with no automated violations, across Chromium/WebKit
  at 375/1440px. The first audit's two mobile navigation failures are retained
  separately; they are not a complete audit pass.
- 59 focused unit checks, including the 300-message bound, stable list through
  clearing and preserved announcement-off preference.
- Six actual keyboard/small-viewport scenarios and five full-workspace cases,
  without retries. The 375px, 390px and 1440px captures were visually inspected.

The scanner is the unmodified, integrity-verified, MPL-2.0
[axe-core QA engine](https://github.com/dequelabs/axe-core). Its code/license
remain in local test tooling; neither is shipped as a visitor script or a new
production dependency. Reports contain compact selectors/check identifiers,
not page HTML, private invitation values or real visitor conversations.

All scans use instrumented loopback fixtures, with external requests blocked
and physical capture forbidden. Incomplete checks remain explicit in the audit
JSON: contrast cases and the symbolic slash button with its named Commands
action need manual review. Screen-reader speech, physical Safari/iOS, complete
WCAG 2.2 AA and the music/Webex journeys remain unqualified. This patch changes
no private/public deployment, provider activation, quota, StoryPool service or
CI workflow.
