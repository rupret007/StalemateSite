# WebKit keyboard coverage — October 31, 2026

PR188 adds the existing 27 lobby accessibility cases to `webkit-community`.
The phone projects select different files, so their successful runs did not
previously demonstrate these keyboard journeys in WebKit. Production assets,
CI workflows, retries, timeouts and all 62 acceptance requirements are unchanged.

## Original failure and correction

At source `0e1ce31139555012624f72866be03308ed12c586`, both the
[push run](https://github.com/rupret007/StalemateSite/actions/runs/41247695174)
and [PR run](https://github.com/rupret007/StalemateSite/actions/runs/41247806656)
finished with 476 passing cases and two failures: short-screen Jam instructions
and manual invitation copying at 375px and 390px. The other 25 newly selected
WebKit cases passed. The original failures remain failures.

The test required `scrollTop` to decrease after Shift+Tab from the selected
manual-copy textarea to Copy. The saved geometry and screenshots show that
WebKit had already left Copy fully visible: its top/bottom were
307.203125/351.203125 within a panel spanning 276.140625–383.140625, and its center
hit-test reached the button. Focus correctly moved to Copy; scroll position
remained 88. Those observations were identical at both widths and in both
saved retry snapshots. No product defect is inferred from that scroll delta.

The corrected setup explicitly scrolls the Jam panel to its end while retaining
textarea focus, then proves Copy is fully clipped above the panel. Actual
Shift+Tab must focus Copy, decrease panel scroll, and reveal its whole rectangle
with an unobstructed center. The original composer snapshots are still captured
before this setup and before any composer focus can repair layout. Page/text
containment, visible input/Send, 16px input text, clipboard-refusal recovery,
invitation privacy and no-popup checks remain intact. No focus repair,
`scrollIntoView`, skip, timeout increase or application scroll handler is added.

The [baseline receipt](../pr-assets/beta-collaboration/20261031/webkit-keyboard-baseline/receipt.json)
pins the source, both failed runs and official artifact digest. Inspected original
captures: [375px](../pr-assets/beta-collaboration/20261031/webkit-keyboard-baseline/copy-already-visible-375.png)
and [390px](../pr-assets/beta-collaboration/20261031/webkit-keyboard-baseline/copy-already-visible-390.png).
The full archive, original logs and retry evidence remain in private local
evidence; the receipt grants no broader qualification.

## Execution limits

The focused local check was resource-refused before any browser runtime started
at 22:51 UTC (80.47% swap; the unchanged limit is below 80%). There is no local
pass for this correction. Qualify the corrected exact head from its actual CI
reports before merging; the original failed head does not qualify it.

These cases exercise actual keyboard events and a local WebSocket relay with an
explicit clipboard-refusal fixture and an opaque, nonfunctional invitation.
They do not demonstrate native WebJam music, a physical iPhone, hosted Safari,
screen-reader speech, deployment, provider headroom or two-way physical audio.
