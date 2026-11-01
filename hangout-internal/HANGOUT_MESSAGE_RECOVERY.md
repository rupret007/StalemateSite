# Composer recovery

The chat composer retains at most eight submitted copies, with a conservative
12 KiB total UTF-8 budget, in this tab's memory. These extra recovery copies
never enter browser storage, analytics or server persistence. Their correlation
tokens never enter original published lines, report receipts, moderation queues
or durable session/effect state. Original messages still follow the existing
delivery, moderation-held and selected-report handling. Ordinary unsent draft
handling remains separate. There is no resend queue.

The exact numeric `hello.features.messageResults: 1` capability enables a
32-hex `clientMessageId` only on ordinary composer text: a channel `say` or a
PM `cmd msg` whose explicit `ch` is the matching PM context. Slash commands,
quick actions and activity traffic do not opt in. The server answers only the
calling socket with `{t:'message-result', id, status}`. Outcomes are staged
alongside the real operation's outputs and released after its existing durable
commit. A failed/rolled-back operation cannot release a positive outcome.
Generic notices are never acknowledgements.

`published` means the normal public/PM operation accepted the line; it does not
claim another person read it, override ignores or imply server history.
`rejected` means that operation refused it. `held` and `pending` describe the
moderation/PM-request outcome at that moment, rather than publication or final
delivery. Such a line may be approved/delivered later. These two statuses keep
their local copy, and restoring requires a duplicate warning. There is no
persistent token-to-message tracking and no final approval notification.

The server never stores or broadcasts the token. An older server receives the
old frame shape, while this client honestly marks its retained copy as
unconfirmed. The same uncertainty applies after ten seconds without a matching
result, a failed connection or a result arriving too late. Nothing resends.
Copy or Discard are available even for unresolved or changed conversations;
clipboard failure opens a selectable read-only text dialog.

Restore is an explicit local edit. It requires the original connection epoch,
the same channel-membership/PM object, an unchanged draft revision, an empty
composer and active sharing. It cannot overwrite text typed after the attempt
or restore a private copy into a replacement room/PM. Non-refused outcomes
require an explicit warning that a later send could duplicate the original.
When the budget is full, the next attempt stays in the composer and is not
sent; earlier copies are never silently evicted.

An ordinary disconnect with unresolved copies pauses automatic reconnection.
The visitor sees that a line may already have arrived and can Copy, Discard,
or deliberately choose Try again. Reconnect warns that it clears copies. An
ordinary disconnect with no copies keeps the existing reconnect behavior.
An admitted replacement session, explicit email/guest identity transition,
logout, expiry/revocation, Leave chat or page exit clears recovery copies and
their callbacks. Withdrawal alone retains Copy/Discard while disabling Restore.

Verification includes actual engine slow-mode refusal at 375/390 px, exact
caller-only outcomes, real SQLite delayed-commit and post-write rollback, and
the real browser client's bounded memory/context/lifecycle behavior. Local
relay and synthetic identity fixtures do not qualify hosted identity, physical
devices, WAN transport or operator policy/key provisioning.
