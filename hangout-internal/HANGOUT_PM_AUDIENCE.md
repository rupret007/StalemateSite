# Private-message audience and compatibility

Application assessment, October 25, 2026. This change repairs private-composer
audience selection and silent word truncation; it does not qualify a deployment,
change admission or enable public/all-ages participation.

## Behavior

An ordinary PM body travels as one bounded argument, preserving words after the
seventh. Existing 300-character normalization, frame/argument limits, acceptance,
signed-device blocking, ignores, muting, daily allowance and read-only controls
remain. PM bodies do not enter automatic content classification or the recent
channel moderation buffer. The server still routes plaintext; PMs are not
end-to-end encrypted.

`//literal` sends one literal slash to the selected private counterpart. Typed
`/me`, the quick action and the slap button send private action messages to that
same conversation. Quick text chips also retain its audience. The existing `me`
receipt flag authenticates a selected action report, including after a
same-socket wake. A first action waiting for acceptance remains volatile; wake
retains only pending-consent metadata and explains that lost text needs resending.

The client preserves `pm:nickname` as command context. The server never chooses
the lobby for an implicit command in a private context or a named channel that
no longer exists. It requests a channel instead. Commands with explicit targets or global
meaning remain available, including `/help`, `/msg nickname text`, `/join #room`,
blocking and authenticated global moderation. Existing explicit channel forms
such as `/mode #room ...` retain their usual permission checks.

## Mixed versions and release boundary

The server advertises numeric `features.privateMessageContext: 1` in its initial
hello. The new client requires that exact numeric version for private actions and
renegotiates after reconnect. Missing, string or boolean values do not enable it.
With an older server, ordinary PMs and literal slashes use an explicitly addressed
message. Unsupported private actions are refused before transmission, keeping the
draft and showing an explanation.

| Client | Server | Qualification |
| --- | --- | --- |
| New | New | Fixed audience, full bounded body and private actions; qualify this matched pair. |
| New | Older/missing capability | Ordinary PMs remain usable; private actions are refused with drafts retained. Older server content/retention behavior still applies. |
| Older | New | **Not repaired:** older clients explicitly send PM actions/literal slashes to the lobby and split PM text into capped word arguments. The server cannot infer the intended private audience from a legitimate-looking public frame. |
| Older | Older | Existing defects remain; do not describe this combination as fixed. |

The release owner must deploy and qualify matched client/server assets and use
the existing normal reload/cache/session transition process for older clients.
An application source test does not prove visitors have reloaded. A source change
or rollback while sockets remain live is also not a new handshake: do not assume
the client renegotiated a capability during a same-socket wake. Qualify recovery
with fresh admissions and matching assets before claiming the fix. This document
does not close sockets, invalidate sessions, alter release holds or run deployment
operations; those remain with StoryPool 10-21-26.

No durable schema migration is introduced. Delivery receipts already support the
action flag, and pending consent continues to omit first-message bodies. Retain
existing account/HMAC configuration, moderation evidence and rollback controls.

## Evidence

`tests/unit/hangout-pm-audience.test.js` covers private literals/actions, exact
participant-selected action reports across wake, stale consent, ignore/block/mute
and implicit-channel rejection even for staff. Six of its seven cases failed on
the preceding source, then all passed after the fix. Existing privacy, pending-PM
and receipt suites passed with them (51 focused tests).

`tests/e2e/lobby-pm-recovery.spec.js` executes the actual browser client with the
production engine through an explicitly scoped local WebSocket/identity fixture.
Seven focused Chromium tests pass, including full text, private typed/quick
actions and text chips, outsider absence, explicit commands, invalid capability
types, draft preservation, fresh consent and reconnect negotiation. The 390px
capture shows the privacy disclosure and private actions with contained composer
and Send; geometry assertions check page overflow, viewport containment and a
16px input. This is not hosted Access, physical iOS keyboard, real network/media,
native audio, legal or full assistive-technology qualification.
