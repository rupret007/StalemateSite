# Verify email, then keep the original room

Guest chat and temporary room hosting still need no account. Choosing **Keep
this room** as a guest prepares the ordinary canonical-origin email sign-in,
preserving the optional entry badge and the visitor's hide choice. The tab keeps
only a bounded, ten-minute, one-use room-return intent. It contains a room name,
opaque room-instance reference and creation time; no account, role, redirect,
credential or chat is stored in it.

After verified welcome, the client conditionally rejoins that exact **existing**
room. It never creates a replacement during this return. A separate **Keep this
room** confirmation appears only after the matching room join. The visitor can
decline. Focus returns to an available Host tools/composer control only when it
was inside the closing prompt; pending acknowledgement keeps focus in the
labelled region without taking it back from another control. Registration still requires the server's verified account, original
founder device and current membership checks. A badge, nickname, stored intent
or observed reference cannot grant these permissions.

Expired/malformed intents, interrupted or unverified sign-in, closed/recreated
rooms, changed host controls and unsupported servers fail safely. A new client
requires numeric `roomKeep: 1` before sending a return. There is no automatic
registration or retry. Once registration has been submitted, an interruption is
reported as **unconfirmed**; the visitor should inspect Host tools before
retrying. Ordinary guest chat remains usable if reading/removing the Keep intent
fails. A failed pre-navigation write explains why the return cannot be saved.
This does not promise blanket support when all browser storage or the existing
beta bootstrap is blocked.

## Protocol and stored state

Member channel views include `keepRef`, an opaque random 128-bit room-instance
reference. Directory entries do not expose it. It is public context for the room's
members, not a capability or authentication token. A new instance receives a new
reference even when its name, founder or timestamp repeats.

The optional `roomInstance` field on a `cmd` frame adds a strict precondition to
Join and Register. A mismatch or missing room denies the operation before Join
can create anything. Ordinary commands without this field retain their existing
behavior, including `/join` title arguments. Existing account and permission
checks still run; supplying a matching reference does not bypass them.

The reference is retained in room snapshots and the current indexed effect
records. Restoring the same room preserves its reference, including transactional
checkpoint recovery. Existing stored rows without it remain readable and receive
a fresh reference on restoration; a supplied malformed value is rejected. This
does not change namespace IDs, account HMACs, room ownership or guardian policy.
Before restoring legacy state on a real service, preflight the serialized room
snapshot and indexed-record sizes including new references against unchanged
caps. An oversized state must fail closed; never raise caps or truncate rooms
automatically to make restoration pass.

## Compatibility and rollback boundary

The base `907de1462776779fd4a02ae6ea066d0a77ebe1e7` indexed reader's
`lobby-effect-records.mjs`, `validRoomRecord`, permits only `transfer` in addition
to its required room fields. Its exact-shape check rejects an added `keepRef`.
The new reader explicitly permits and validates this optional field. Therefore
**an unchanged 907 indexed reader cannot read newly written indexed records**.
Passing current legacy-load tests is not proof of reverse compatibility.

The receiving release owner must qualify a matched rollback. Either retain a
reviewed reader compatibility patch, or drain writers, live sockets and in-flight
work before projecting a verified state snapshot into the old format by removing
only the non-authoritative `keepRef` field. Preserve every ownership/co-host,
account, moderation, room-ID, budget, session/revocation and activity field.
Validate the resulting state against the actual rollback reader before changing
the running authority. Pending Keep returns must be invalidated; they may not be
retargeted to newly generated references. A flag reversal or a backup alone is
not writer-drain or successful restore evidence. StoryPool retains actual
deployment, migration, release holds and rollback ownership; this source slice
performs none of those operations.

## Evidence scope

The initial four regressions execute the unmodified 907 client/engine before the
fix: missing badge/hide handoff, legacy unbounded return replay, create-on-missing
Join, and mismatched-instance registration. New focused client/engine checks cover
explicit confirmation, expiry/cancel, changed room/host, session end, storage
failure, legacy restoration and same-name restart recreation. Existing indexed
SQLite storage suites remain part of validation.

The signed-identity composition uses the actual beta gateway, BetaSessions
registry and lobby engine with a generated RSA test issuer and explicit binding
transport seams. It establishes no hosted OTP delivery, real Access policy,
browser cookie behavior or provider readiness. Local browser journeys use an
explicit loopback verified-account fixture. Real canonical-origin sign-in,
second-device recovery, logout/revocation, matched deployment and rollback remain
receiving-owner acceptance. All-ages/provider/legal and native WebJam work remain
separate requirements.
