# Moderating the invitation-only beta

Use a real staff sign-in assigned by the site owner. A room owner or co-host has
authority in their own room; creating a room or verifying an email never grants
site-wide staff powers. Synthetic pilot identities are for testing only.

Jeff confirmed `jeffstory007@gmail.com` as the moderation contact and himself as
the sole initial reviewer; the hosted house-rules contact link is verified.
Before inviting visitors, agree review hours and an incident handoff, then
recheck the displayed contact after deployment. Do not advertise immediate
response or 24-hour coverage.

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

These message reports cover the lobby and its channels. They are authorized
against actual delivery to that still-open connection.
They remain possible after a server wake because the client can resubmit the
exact received text against a bounded server digest. A refresh or real reconnect
starts a new IRC session and grants no access to previous messages. Digests do
not create a chat backlog. Reports outside the 24-hour/receipt-cap window may be
unavailable; the displayed moderation contact is the fallback. Storage failures
must show an error rather than a successful report acknowledgement.

## Encrypted private rooms

The **current hosted beta** has only the older camera-tile **Report to the host**
notice. It sends an encrypted notice to that room's creator and hides the
participant locally; it is not durable staff evidence or confirmed host delivery.
Use `jeffstory007@gmail.com` as the interim contact for private-room abuse,
including an abusive or absent host. Do not send invitation links, room keys,
access codes or passwords.

A [prepared staff-report candidate](../pr-assets/beta-collaboration/private-staff-reports.json)
adds consented intake; it is **not deployed**. Human/Karen review and hosted
guest-to-real-staff acceptance remain pending after the original eight-hour
expiry observation has a recorded terminal result. Email contact alone does
not complete that requirement. After an accepted release:

1. A visitor can choose **Report to staff** beside a received private message,
   or **Report a problem to staff** without using cameras or relying on the host.
   They review the selected quote, claimed nickname and reason, then explicitly
   agree to share those details. Ordinary encrypted chat stays unmonitored; no
   history, automatic context, invitation or room key is attached. Private reports
   are excluded from AI review.
2. Use the restricted staff sign-in, then **Queue → Private-room reports**.
   Review actions recheck session expiry/revocation and staff permission. Check
   **Private report storage is ready** before relying on the queue. The reported
   nickname and quote are unverified claims. A membership note proves only that
   the selected relay connection was present in that room at submission; an
   absent/unverified target establishes no current identity.
   If the staff connection ends, the panel clears its saved display. Sign in
   again if needed, then reconnect to load the current queue.
3. Use **Resolve report** after review or **Dismiss report** when unwarranted.
   These rows have no **Delete**, mute, kick or ban actions. Neither disposition
   deletes private chat or automatically punishes anyone. A successful required
   write removes the saved report text from the active queue; confirm the server
   update rather than treating a button click as success. Do not target someone
   in **People** using a retained private-report nickname.
4. If storage is unavailable, treat the disposition as unconfirmed and ask the
   operator to restore it; an empty-looking queue does not establish deletion.
   For reporters, **Not confirmed** means the submission may have been saved.
   Keep the same details and use **Retry the same report** manually. Reconnect
   never submits automatically; editing details creates a new request and may
   create a separate report. Within the original 24-hour receipt window, retrying
   a resolved/dismissed submission returns its final status without recreating
   the removed text.

## Room-host controls

Lobby-channel hosts can invite, kick or ban people in their own room, apply slow
mode, disable cameras and close the room. `/mode +m` restricts speech to hosts and voiced
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

The prepared private-report candidate adds a separate queue of at most 100
reports for 24 hours. It stores consented text/claimed names, submission time,
relay connection metadata and opaque keyed room/target-session references,
not invitations or decryption keys. Resolve/Dismiss removes that active record
after a successful write. Up to 200 text-free retry receipts retain report ID,
time, request code, digest, reporter reference and final/pending status for the
original 24-hour window. Backup/PITR retention remains separate.

Pending PM requests keep only sender/recipient connection metadata for ten
minutes, bounded to 1,000 requests globally and five per sender. After a server
wake, an existing Accept prompt can still open the conversation, but any
undelivered first text must be resent; both people receive that explanation.
Block, ignore and recipient PM-off preferences are rechecked. A real disconnect
ends pending requests and accepted consent for that endpoint. None of this
reconstructs a PM transcript.
