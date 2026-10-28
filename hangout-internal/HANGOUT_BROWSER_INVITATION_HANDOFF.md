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

Invitations remain room-scoped bearer capabilities. Existing room-switch,
disconnect, host-power-loss and delayed-action fences remain in place. The
browser link is not put in local/session storage or a room chat line. The
existing event records only that the host shared a browser invitation and
directs members to the correct browser button.

## Verification scope

`tests/e2e/lobby-webjam.spec.js` adds two real-relay browser journeys at 375/390px
and a disabled/unapproved-origin journey. They check the visible Share form,
desktop-message preservation alongside the browser link, host-only updates,
explicit opening with `noopener,noreferrer`, stale-action refusal, clearing,
no storage/capture/external fetch and mobile screenshots. Their reserved
`https://webjam.example` origin exists only in a loopback test namespace.
The popup is intercepted; these tests do not contact a Web Join endpoint.

No production origin, TURN/vault credential, provider or deployment is enabled
by this change. Passing these journeys proves application handoff, not actual
browser enrollment, live mixing, cross-network transport or physical audio.
The [required music acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) and all 62
original acceptance outcomes remain required.
