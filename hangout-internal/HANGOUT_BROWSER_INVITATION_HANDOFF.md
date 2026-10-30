# Sharing a WebJam browser invitation in a Jam room

The room host can use the visible invitation box for either the complete
desktop **Copy Invite** message or the single HTTPS URL from **Web Join →
Copy web invite**. Desktop messages retain their full original text, including
sealed replies. Only an explicitly pasted HTTPS URL uses the existing `web`
command. The server still requires current host authority and an exact allowed
Web Join origin; production's empty allowlist keeps browser joining off.

In the desktop host, start the supported music session, select **Web Join →
Allow a web guest**, then **Copy web invite**. Paste that link into the room's
invitation box and click **Share**. It can coexist with a desktop invitation.
Members must click **Join in browser** themselves; sharing never opens a page
or requests media. The destination owns headphones/audio consent, enrollment
and audio. Browser joining has higher delay and the host's guest limit still
applies. Clearing links removes both room handoffs; it does not stop the native
host or revoke a capability already copied. Use the host's **Kick web guest**
or end its session for that.

The host's paste clears after matching current-room state confirms publication,
including re-sharing an unchanged link. A rejected paste stays editable while
the visitor remains the same connected room host. Room changes, loss of host
powers, disconnect and Stop still clear it. This is publication-state feedback,
not proof that a particular command or downstream audio enrollment succeeded.
The one pending paste stays in memory only and does not enter browser storage.

## Finding setup help

The compact music panel keeps platform availability and headphone/delay advice
outside its expandable help. Copy/Join and the host editor remain direct actions.
**Setup & invitation help** contains the full beta-app, paste, host, expiry and
Stop instructions. It starts closed and uses native keyboard disclosure. Opening
it scrolls the first steps into the panel without moving focus from the summary;
closing it is the same native action. It neither opens a destination nor requests
capture. The host's empty-state action row stays out of the way until an invitation
exists; ordinary guests still see their waiting state.

The375/390 browser journeys also check keyboard-open help at667px height, an
immediately readable first paragraph, visible input/Send, at-least16px inputs,
the normal title/platform warning, and no page overflow. This is partial browser
accessibility coverage, not a full WCAG or physical screen-reader/iPhone audit.
No framework, dependency, external component or copied code is added. The design
uses the native [HTML disclosure element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details),
with [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) and
[visible-focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
as constraints. Passing these cases does not establish conformance.

## Publication and capability lifetime

If the same connected host edits the next paste while publication is delayed,
confirmation of the submitted value preserves that newer edit through the
room redraw. It does not submit the edit. An unrelated room's confirmation,
room switch, authority loss or local Stop does not receive that preservation.
This remains state confirmation, without a request-correlated acknowledgment
or a queue of pending Share commands.

Invitations remain room-scoped bearer capabilities. Existing room-switch,
disconnect, host-power-loss and delayed-action fences remain in place. The
local Stop action immediately retires room invitation controls, and cached
Join/copy actions require active local sharing even while server withdrawal
is unconfirmed. This does not recall an invitation already copied elsewhere.
The
browser link is not put in local/session storage or a room chat line. The
existing event records only that the host shared a browser invitation and
directs members to the correct browser button.

## Verification scope

`tests/e2e/lobby-webjam.spec.js` adds two real-relay browser journeys at 375/390px
and disabled/unapproved-origin and unconfirmed-Stop journeys. They check the visible Share form,
desktop-message preservation alongside the browser link, host-only updates,
explicit opening with `noopener,noreferrer`, stale-action refusal, clearing,
no storage/capture/external fetch and mobile screenshots. Their reserved
`https://webjam.example` origin exists only in a loopback test namespace.
The popup is intercepted; these tests do not contact a Web Join endpoint.
The Stop case uses synthetic own-status HTTP replies and a failed withdrawal;
it proves the real client's immediate opt-out, not real server consent ordering.

The invitation-lifecycle fixture can hold one connection's complete server
stream in FIFO order, freezing each real-engine frame when emitted. New cases
cover editing before publication arrives, another room's pending confirmation,
and local Stop before a delayed confirmation. The queue has a fixed 1,000-frame
test bound and cannot inject arbitrary frames or reorder the stream. The Stop
case uses synthetic own-status HTTP, and the independent guest's already
received invitation is not recalled. These are browser/engine races, not native
music, revoked transport capability or hosted consent proof.

No production origin, TURN/vault credential, provider or deployment is enabled
by this change. Passing these journeys proves application handoff, not actual
browser enrollment, live mixing, cross-network transport or physical audio.
The [required music acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) and all 62
original acceptance outcomes remain required.

The recovery change keeps existing programmatic error feedback without moving
focus or announcing invitation contents. This follows the purpose of
[WCAG status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
[Jamulus setup guidance](https://jamulus.app/wiki/Getting-Started) recommends
wired networking and wired headphones; retain that preparation advice without
claiming it establishes measured WebJam latency or successful live audio.

The delayed-response fixture preserves ordering in accordance with the
[WebSocket framing rules](https://datatracker.ietf.org/doc/html/rfc6455#section-5.4).
Avoiding unnecessary re-entry is also a design consideration in
[WCAG's redundant-entry guidance](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html);
preserving a newer edit here is an application improvement, not a WCAG audit.
