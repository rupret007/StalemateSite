# Quiet visits and confirmed gatherings

This is the display contract for roadmap item 1 in
[Hang Out product direction](HANGOUT_PRODUCT_DIRECTION.md). It does not authorize
deployment, seed a schedule, or claim that a gathering has been hosted.

## What a visit can show

The lobby keeps `#stalemate` as the main conversation. Room cards still come
from the current directory. Empty rooms stay empty, and a connected tab is not
treated as attendance or as proof that someone is reading.

A confirmed gathering is rendered only when one supplied record has all of:

- `confirmed: true`
- a host nickname, used as a label
- `startsAt` and `endsAt` instants, 15 minutes through 4 hours, ending after
  the supplied clock, and starting no more than 14 days ahead
- an equipment-free activity: text chat, drawing, one-line writing, reading, or
  watching a shared video

The room presence panel shows that host, the time in the requested time zone,
and what someone can do without bringing equipment. Those lines stay out of the
chat column so the composer remains on screen. The quiet prompt stays with the
other draft buttons. A camera, microphone, or instrument
is never required. A jam is not an equipment-free activity. `requiresBand: true`
or a recurrence value other than an explicit `false` drops the record. The
earliest valid record is the next one. Invalid siblings are skipped, not
repaired into a weekly slot.

Hosting that gathering does not make the host a site moderator. The nickname is
not matched against the people list, so the screen does not say the host is
here, away, or a band member because of the gathering. No RSVP count is shown.

When the people list is known and no valid gathering was supplied, the copy
says that none was supplied. It does not say the server was searched, and it
does not invent a time, a weekly cadence, or a band host. Anyone visiting may
host one. No weekly commitment is stored or promised.

## Quiet, disconnected, and reminders

A quiet connected visit, meaning a known people list with no other visitor,
offers one creative prompt. Choosing it inserts a draft. It does not send.
An approved past creation is shown only when the supplied record has
`approved: true`, a plain title, a short detail, and, if present, a normal room
name. Anything else is omitted. A busy room does not replace the conversation
with that quiet offer.

Offline, reconnecting, connecting, ended, and unknown connection states explain
the service. They do not reuse the quiet headline, a stale people count, a
previously supplied gathering, or a past creation. A missing people list while
connected stays "Waiting for the lobby" rather than "first one here."

"Save a reminder on this device" downloads an iCalendar file for a gathering
that is already on screen. The file has no attendees, organizer, or recurrence.
Its description says it is not an RSVP and does not record attendance. Email
and push are not sent.

## What this slice does not do

`confirmedGathering` and `approvedCreation` on the lobby client stay null. No
server frame, command, or durable field supplies them yet. A host confirmation
that must still be visible after the room is empty needs a later matched
reader, writer, and client rollout. This slice does not add that stored field
and does not reset durable state.

A saved calendar file is not a server RSVP. A remembered browser is not a
unique person. Local Worker tests of this contract are not hosted capacity,
physical-device accessibility, or deployment proof. AI review stays off.
