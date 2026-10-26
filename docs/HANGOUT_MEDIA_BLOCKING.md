# Public-room Block, cameras and activity pacing

This describes the application candidate's contract and the checks required for
matched clients and server. The earlier `282163` candidate does not contain this
fix. Source, local tests and hosted acceptance are separate evidence; use the
delivered commit's receipts before a demonstration or rollout.

## What personal Block means

Choose a person in People and use **Block**. The existing device reference is
the server's preference key for that live/restored connection. Nickname and
entry-badge changes do not change that reference. A parallel connection of the
blocked device is also denied media with the blocker where they share a public
activity room. Another device or a new identity is not silently identified or
tracked as the same person.

Personal Block is separate from a host/staff ban. It closes PM consent and
suppresses the existing text path, plus the affected camera peer connection.
The other visitor's own block remains effective if only one person unblocks.
Unblock does not restore PM consent or start a camera prompt. Shared canvases,
watch-room state and copies already delivered elsewhere are not erased.

## Current policy reaches the affected connections

Normal join/channel views contain recipient-specific `mediaBlocked` connection
IDs. Block/unblock sends compact `media-policy` changes only to the blocker and
matching current device connections in shared activity rooms. The client applies
changes only to an existing joined channel and its current member IDs; it does
not replace the roster or create a new channel. Raw device references stay in
private session preferences.

RTC routing preserves the complete admitted connection ID. The gateway issues
`c` plus 32 hexadecimal characters; the existing reference contract permits
1–128 ASCII letters, digits, underscores or hyphens. Invalid or oversized
recipients are rejected, never truncated into another participant's prefix.
The local relay uses the gateway's ID shape so browser tests exercise this
boundary. Membership, bilateral Block and current authority still decide access.

Both signaling directions consult the current bilateral block sets before media
bookkeeping. Updated clients retire only the affected peer connection and
received tracks, remove its tile and invalidate queued negotiation. Unrelated
participants and shared local capture continue. Pending capture attaches its
tracks once to still-allowed existing receive-only peers when it completes.
Early ICE may create an empty peer connection while capture is pending. The
incoming offer creates its receiving transceiver through the native browser;
the client does not invent a competing receive-only offer during that wait.

Policy outputs use the existing effect-commit boundary. A failed commit must
not publish a successful Block, PM closure or changed media policy. Duplicate
Block/unblock does not repeat unchanged pair-policy output. Repeating a full
roster for every shared room is deliberately avoided: a retained local fixture
with 58 legitimately admitted connections in 30 rooms exceeded the existing
16 MiB staged-output ceiling before the compact update. This is a regression
fixture with synthetic trusted staff, not maximum hosted capacity or real staff
identity qualification.

## One bounded outgoing activity allowance

Drawing, watch controls and camera signaling share the browser module's smaller
allowance: burst 8 and refill 8 frames per second. The server retains its existing
burst 24 / refill 10 per second. The tab-local queue accepts at most 128 frames,
256 KiB of encoded payload and 16 KiB per frame. These are logical accounting
bounds, not a measurement of browser heap, WebSocket buffers or hosting cost.

SDP controls can precede queued candidates; paint/clear/watch ordering remains
FIFO. Consecutive unsent chunks of the same stroke may merge without losing or
reordering points, up to 400 points and the existing frame/byte bounds. A merge
does not cross a clear, watch update, another stroke or room generation.

Queue overflow is explicit. An unaccepted drawing or watch action is not
presented as successfully shared; the visitor receives a busy/error status.
Queued work rechecks membership, current host authority where needed, peer
policy and native negotiation generation before sending. Peer retirement,
Block and room teardown discard invalid work. There is no automatic retry or
server-delivery acknowledgement implied by local queue acceptance.
Queued ICE uses its selected media section's effective username fragment and
password, including session-level inheritance. MID and media-index selectors
must agree. Changing another section does not invalidate that candidate;
changing the selected credentials does. No BUNDLE transport is guessed.

## Privacy and rollout boundaries

The activity queue stays in tab memory. SDP/ICE can contain network information;
it is not a chat transcript and must not enter routine diagnostics or durable
records. Personal preferences persist only within the documented live/restored
session model. [The data inventory](HANGOUT_DATA_INVENTORY.md) distinguishes
these records from received scrollback, unsent composer drafts and evidence.

The release owner must qualify matching client assets and backend, including
old-client drain. Server signaling denial alone cannot close an already
established P2P connection between two outdated clients. Nor can it erase a
participant's separately captured copy. The encrypted `/hangout/<room>` local
Hide control and native WebJam/external meeting sessions have separate identity
and transport boundaries; they do not inherit a global Lobby block.

Verify the [demo journey](HANGOUT_DEMO_GUIDE.md) at 375/390px with actual decoded
camera frames before Block, pair teardown, continuing third-peer frames,
parallel-device/nickname/entry changes and mutual unblock.
Run the separate pending-capture/early-ICE startup regression at both widths too.
Synthetic RTC in the local SQLite authority proof verifies signaling and storage,
not camera capture,
physical media, TURN or WAN connectivity. Existing consent/age safeguards remain
until their replacement is qualified; AI/provider activation is separate work.
