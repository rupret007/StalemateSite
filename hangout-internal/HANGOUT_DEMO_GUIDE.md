# Hang Out: a short shared-community demonstration

For the exact private build, demonstrated checks and remaining work, start with
the [current readiness handoff](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md).
The private lobby has passed current Mac and Windows browser checks. The full
release candidate, including physical music and operator acceptance, remains
pending. Do not send this as a promise that every feature is already qualified.

The finished Che demo includes **live WebJam music with verified two-way
audio**, as well as the shared browser community. Follow the
[music acceptance plan](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) for the ARM Mac mini,
Intel/x86 MacBook Pro and Windows PC; keep the original Linux requirements too.
Audio remains opt-in for each participant.

## What the participant needs

For the first private test, **Jeff hosts with the approved WebJam app on his
MacBook; Che joins in Chrome on his Windows PC.** Che does not need the native
client or BlackHole for that browser role. Keep the private community invitation
and the fresh music link separate: the first admits you to Hang Out; the second
connects your browser to this one Music session.

1. Have headphones and a working microphone ready. Wired audio and Ethernet are
   preferred for music. A Bluetooth headset can be used for an initial speech
   check, but it does not establish instrument quality or low musical latency.
2. Open the private community link supplied by Jeff. Enter the community code
   supplied separately, choose your nickname and say hello. A band account is
   not required for the guest role. Do not use an old music link as the community
   code or post either invitation publicly.
3. Accept Jeff's Jam-room invitation. When he shares the fresh Music destination,
   choose **Join in browser**. Jeff keeps the native Music session running.
4. Choose **Check microphone**, allow the intended input when the browser asks,
   and speak until the level responds. If the wrong input appears, choose the
   correct microphone. Confirm headphones, then **Join with microphone**. A flat
   meter is a setup issue to resolve before joining, not a reason to click Join
   repeatedly.
5. First hear speech both ways; then try the short musical passage. Browser
   joining has higher delay than the native musician connection. Treat the
   displayed estimate as partial diagnostics, not a promise of tight timing.
   Choose **Leave session** when finished; Jeff then uses **End Session**.

If the host ended the session, the invitation expired or a join may have used it,
ask Jeff for a new music invitation. Do not keep retrying an expired link.
**Session ended** for community access instead means return to the community
invitation. A relay-limit notice needs operator review; changing routers, opening
ports or resetting a quota is not a participant fix.

The song/backing-track check needs extra setup on the **Mac host**, not the
Windows browser guest. Use the [Shared Track guide](HANGOUT_SHARED_TRACK_NEXT_CHECK_20261107.md).
Webex video is optional and separate; keep it closed for the first audio check.

## Choose the environment

For a local dry run, use the repository's existing dependencies and run:

```sh
npm run dev:hangout
```

Open the launcher address printed by the command. It binds to loopback and is
available on that computer only. The launcher offers explicit Guest, Room owner,
Community moderator and Site owner fixtures. Those identities are local
stand-ins; they do not demonstrate Cloudflare sign-in or production staff
permissions. AI stays off. Stop the preview with Ctrl+C. Preview session links
expire after seven days. The separately scoped local state file is printed by
the launcher; room, report and moderation-log retention follows their own engine
rules, with no blanket seven-day state-file purge. Ordinary chat is not restored
after reconnect/restart. Do not enter real incident evidence.

For a hosted demonstration, use the existing owner's qualified private-beta
invitation. A localhost link cannot connect Che from another house. Do not put
an invitation, email code, session cookie or private credential into a band-site
Join link. Use the reviewed entry-toolkit links once the canonical address and
site configuration have been approved. Both band links must reach that same
service and namespace, rather than separately deployed communities.

## Five-minute visitor journey

Use two independent browser profiles, or two people in the qualified beta.
For the source-entry check, one follows Stalemate's reviewed Join link and the
other Rad Dad's. The optional entry label describes how this session arrived;
it is not verified band membership or a staff role.

1. Choose guest nicknames and read the current participation notices. No band
   account is required for the permitted guest flow. Existing private-beta and
   age/media safeguards still apply; this demonstration does not enroll children
   or establish public all-ages readiness.
2. Exchange a short hello in the shared lobby. Check the two entry labels beside
   names and in People. Hide one label, wait for its confirmed hidden state and
   send another line. Direct entry should have no invented site affiliation.
3. Have an ordinary guest select **Start a room**, choose drawing and invite the
   other person through the room directory. Draw on one canvas and observe the
   same strokes on the other. Check host controls and leave/rejoin normally.
4. Open a fresh third browser profile after the conversation. It sees currently
   available rooms and new messages, with no previous chat transcript. A
   reconnect also starts chat fresh; shared drawing state is a separate feature.
5. Check the phone layout at 375/390px with a long line and an error notice:
   text/controls wrap, the page stays within its width, and input plus Send remain
   usable. A physical iPhone keyboard/background test is separate from emulation.

## Paint Along

In **Rooms**, choose **Paint along**. The room host can select a featured Bob
Ross lesson, starting with **The Grandeur of Summer**, or paste another YouTube
lesson and choose **Load**. Other participants follow the shared lesson; if a
browser requires a gesture, use **Tap to play**. The shared canvas is available,
and people can also sketch or paint on paper or in their own art app.

**Getting started · kit and materials** contains the optional official materials
links. You do not need to buy a kit to watch or sketch. YouTube provides the
lesson video and audio. Keep headphones on when another audio app is involved. The prior Windows provider
check verified lesson loading and synchronized controls with browser output
muted; it did not establish physical lesson audibility or full native Art parity.

## Moderator and ownership check

Use benign synthetic text only. In the local launcher, open a separate moderator
fixture; in the hosted beta, use only the existing authorized staff sign-in.
From the other entry, flag the synthetic line and observe it in Reports. Dismiss
removes the review item; Delete also removes the delivered line. Verify a guest
cannot perform either staff action. Personal Ignore/Block and community staff
restrictions have different scopes; neither an entry change nor a nickname
should manufacture new authority or bypass a device restriction.

## Staged camera Block acceptance

These are acceptance instructions for the pending media-blocking candidate,
not a claim about a live beta or the earlier `282163e9cbc` package. Identify the
new reviewed source, matching Worker/browser assets and its actual test evidence
before running the check in the receiving owner's permitted environment. An
engine/client regression result alone does not prove this browser journey.

For the camera Block check, use three consenting adult browser profiles in one
Hang Out drawing or watch room. Turn cameras on through the visible controls and
confirm video in both directions. Choose **People → the other nickname → Block**.
The updated clients close that pair's camera connections and received tracks;
both visitors keep their local capture and connections with the third person.
The server refuses further signaling between the pair. A new nickname, entry
label or parallel tab with the blocked visitor's same signed device token does
not bypass the blocker’s current connection preference. A new blocker session
does not inherit an earlier connection's preferences. `/unblock CurrentNick`
removes only your block: the other person's block still applies. Existing active
camera opt-in may negotiate again after both blocks are gone; a stopped camera
is not restarted and prior PM consent is not restored.

This requires the matching updated Worker and browser assets. The receiving
release owner must drain older clients; server signaling refusal alone cannot
close an already connected pair running older clients. Blocking cannot recall
media already received or control copies held by another person. Encrypted
invitation rooms use separate relay identities: their **Hide for me** currently
hides a tile, not this device-scoped lobby Block. Do not present those controls
as equivalent or claim native WebJam/TURN/WAN coverage from this browser check.

## Ownership and existing review evidence

Preserve Jeff's previously completed real synthetic-report dismissal as evidence
for that tested release. Do not create repeated live reports merely to repeat an
unchanged check. Requalify a changed staff path with the release owner.

For room ownership, distinguish the guest's current temporary host session from
registered ownership recovered through verified community sign-in. A new device
or another band's entry link does not itself prove ownership. Staff and owner
authentication remain separate. The automated loopback identity fixture proves
application role behavior, not real email verification or hosted revocation.

## WebJam music and results

The native Mac host starts Music, then uses the visible **Copy browser invite**
control and waits for **Link copied**. This prepares/copies the link in one step;
no legacy Web Join menu sequence is required. Keep Music running. In Hang Out,
create a Jam room, invite the other visitor through **Host tools → Invite guest**,
and paste the fresh browser invitation into the host's invitation box, then
**Share**. The guest accepts the room invite and explicitly selects **Join in
browser**. Room membership is not host authority. Sharing never requests capture
or opens a guest page automatically. See
[browser invitation sharing](HANGOUT_BROWSER_INVITATION_HANDOFF.md).

A separately supported native guest uses the full desktop invitation with the
native Join action; do not substitute that message for the browser music link.
The Windows native role remains trust-blocked in the current private candidate;
the first Windows test uses Chrome. Do not bypass native signing policy.

If a guest or verified owner's session expires or is revoked, **Session ended**
replaces automatic retries. The beta offers **Return to invitation** through its
existing admission page; room owners then verify their email again. A refused
reconnect shows the same reachable recovery with an honest unavailable/possibly
expired message. The local preview keeps **Try again**, returning a former owner
as an unverified guest until a new sign-in. Cameras, stale invitation/PM actions
and displayed owner powers are cleared. The current unsent message remains
available to copy in its original channel or PM; it is never moved into public
chat or sent automatically. Drafts belong to the current page instance and are
not saved in browser storage; a new page instance starts without them.

Show the invitation/opening flow separately from playing music. Qualify the
actual native package, installation/trust, join/leave and bidirectional audio on
each advertised platform. Mac Intel/Apple Silicon, Windows and Linux have
separate evidence requirements. A moving meter, local relay, Tailscale path or
browser test does not establish a cross-house audio session or TURN readiness.
Keep paused TURN/vault work paused and preserve unsigned-build trust boundaries.

Record the exact source/deployed revisions, environment, date, observed steps,
redacted errors and remaining failures. Obtain hosted or physical-device checks
through their existing owner. End the demo with a clear distinction between
what was observed and what remains to qualify; do not imply public launch,
continuous moderation coverage or legal clearance.
