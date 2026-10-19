# Moderating the invitation-only beta

Use a real staff sign-in assigned by the site owner. A room owner or co-host has
authority in their own room; creating a room or verifying an email never grants
site-wide staff powers. Synthetic pilot identities are for testing only.

Before inviting visitors, the operator must configure a monitored moderation
contact, confirm who will review the queue, and agree when they will check it.
The existing site-contact PR proposes the band inbox; its presence in a PR does
not establish that anyone monitors it. The beta house rules must display the
configured address. Do not advertise immediate response or 24-hour coverage.

## Review a report

1. Open the staff panel through the beta sign-in and choose **Queue**. Check both
   the AI status and the moderation-storage status before relying on the queue.
2. Read the exact reported message and available nearby context. A report count
   is a signal, not proof of wrongdoing. Mild swearing is allowed; hate, threats,
   targeted sexual harassment and disclosure of personal information are not.
3. Use **Delete** to remove that exact message, or **Dismiss** when no action is
   warranted. Dismissing does not republish old text to newcomers. AI evidence
   has separate **Delete message** and **Dismiss signal** controls; AI cannot
   mute, ban, promote staff or change room settings.
4. If intervention is needed against someone currently online, use **People**
   and verify their current nickname/context. **Mute 10m**, **Mute 24h**, **Kick**,
   **Ban** (with a reason), and **Purge lines** are available within your role.
   An old report nickname may have been reused: never assume it identifies the
   person who currently holds that nickname. Deleting the evidence by message
   ID is safe; account-level action requires a verified current target.
5. Check **Mod log** for the resulting action. Keep appeal handling in the
   configured moderation inbox; do not copy sensitive evidence into public
   GitHub issues or external chat rooms.

Reports are authorized against actual delivery to that still-open connection.
They remain possible after a server wake because the client can resubmit the
exact received text against a bounded server digest. A refresh or real reconnect
starts a new IRC session and grants no access to previous messages. Digests do
not create a chat backlog. Reports outside the 24-hour/receipt-cap window may be
unavailable; the displayed moderation contact is the fallback. Storage failures
must show an error rather than a successful report acknowledgement.

## Room-host controls

Hosts can invite, kick or ban people in their own room, apply slow mode, disable
cameras and close the room. `/mode +m` restricts speech to hosts and voiced
visitors; `/mode +i` requires an invitation; `/mode +k key` requires a room key;
`/mode +S 10` adds a ten-second slow mode; `/mode -C` disables room cameras.
Registered owners can manage verified co-hosts and transfer ownership. Co-hosts
cannot remove the registered owner. Site moderators can intervene in abusive
rooms without acquiring their ownership.

## Urgent incidents and degraded service

- **Cameras:** a moderator can use **All cameras off** (`/camoff all`). This ends
  current camera participation; it does not itself prevent every later attempt.
  Ask a site administrator to raise the shield when continued restriction is
  needed.
- **Raid or widespread abuse:** a site administrator can use **PANIC: shield
  everything** (`/shield`). It turns off activity cameras, pauses new rooms and
  new PM requests, and applies a 30-second lobby slow mode. Existing text rooms
  can still talk. Use **Read-only** (`/lobby readonly`) to pause visitor chat/PMs,
  or **Back soon (lock)** (`/lobby lock`) to close visitor connections. These
  emergency configuration controls are restricted to band/site administrators.
- **Recovery:** review the cause, confirm the queue is writable, and then use
  **Open** (`/lobby unlock`) and **Lower shield** (`/shieldoff`) as appropriate.
  A storage fault deliberately leaves service read-only until administrator
  recovery. The operator must validate the restored durable state and reload
  the Durable Object before reopening normal room operations: **Open** alone
  does not clear the engine's storage-fault flag. Do not bypass a corruption
  lock to make an error disappear.
- **Scope:** these lobby controls do not end independent desktop WebJam sessions
  or already established encrypted private peer-to-peer media. A lobby lock
  closes visitor lobby connections; it is not a universal media kill switch.
- **Classifier outage or cap:** an empty AI queue does not prove messages were
  checked. Deterministic filters, visitor reports, human review and manual
  controls remain available. The owner should check provider configuration,
  reserved quota and the visible status; do not punish visitors for an AI outage.
- **Moderation storage degraded:** treat current evidence/actions as unconfirmed.
  Stop new invitations, use the configured contact for incident intake, and ask
  the operator to restore durable storage before resuming normal operation.

## Data handled during moderation

Ordinary chat and PM bodies are not saved as a visitor archive. A bounded recent
buffer exists in server memory. Content digests, message metadata and actual
recipient connection IDs survive an idle wake only for still-live connections:
at most 1,000 receipts, 1 MiB and 24 hours, whichever bound is reached first.
These hashes are operational evidence, not a claim of anonymous data.

Reported, filter-held and AI-flagged evidence each has its own active queue of at
most 100 entries for 24 hours. A visitor report may include exact text, nickname,
channel and nearby context; PM text reaches the human queue only when a recipient
reports it. AI review receives eligible new public text only, not PMs, restricted
rooms, camera media or invitation links. Moderation action logs retain at most
2,000 records for 30 days. Cleanup runs periodically; backup/PITR retention is a
separate operational setting. Avoid collecting extra evidence outside those
queues unless an incident requires it and the operator agrees on handling.

Pending PM requests keep only sender/recipient connection metadata for ten
minutes, bounded to 1,000 requests globally and five per sender. After a server
wake, an existing Accept prompt can still open the conversation, but any
undelivered first text must be resent; both people receive that explanation.
Block, ignore and recipient PM-off preferences are rechecked. A real disconnect
ends pending requests and accepted consent for that endpoint. None of this
reconstructs a PM transcript.
