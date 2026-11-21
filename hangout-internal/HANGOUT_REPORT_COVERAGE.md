# Report coverage acknowledgement

This is the visitor-facing contract for roadmap item 5 in
[Hang Out product direction](HANGOUT_PRODUCT_DIRECTION.md) and requirement P4.
The acknowledgement does not appoint a reviewer, change queue limits, or promise
that a person is available. The protected beta's configured contact and sole
initial reviewer are recorded in the [current acceptance checkpoint](HANGOUT_ACCEPTANCE_CHECKPOINT_20261107.md#one-real-report-submission-human-review-remains-pending).

## What a saved report says

A report is accepted only after its moderation-queue write. The reporter then
receives the existing `report-status` frame with `submitted: true`, plus one
StaleBot notice:

> Queued for review when a moderator is available. This is not a promise that someone is reading it now. Appeals are in House rules.

That notice describes stored evidence waiting for a person. It does not say a
moderator received the report, is present, or will reply now. Appeals stay in
House rules. The contact comes from the operator's live configuration. The
initial component used a placeholder, which was not a working inbox. The
current protected beta uses Jeff's confirmed contact, `jeffstory007@gmail.com`;
this does not demonstrate that the inbox is being watched now or promise a
response deadline.

The flag's tooltip and accessible name become:

> Queued for review when a moderator is available

They do not say the report was submitted to moderators.

A later report of the same message from the same device or daily IP hash stores
the evidence again and does not add another vote. Its notice is:

> Already in the report queue. That is not proof a moderator has read it.

## What stays unchanged

- The full queue still refuses new evidence and points at the House rules
  contact. That refusal is not a success acknowledgement.
- A storage failure still withholds `report-status` and both notices above.
- Queue capacity, the 24-hour evidence lifetime, and report authorization are
  unchanged.
- No new durable field is stored. AI review stays off.
- Jeff is the sole initial owner/reviewer. Band membership, a website entrance
  badge and room-host powers do not appoint another reviewer. Actual review
  coverage, backup arrangements and human disposition of the latest synthetic
  report remain separate acceptance work. This acknowledgement does not close P4.
