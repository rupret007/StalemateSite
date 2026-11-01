# Collaboration beta verification

Checked October 19, 2026 against StalemateSite's beta worktree and WebJam
`master` commit `5effbc58db706254f8ca8b52de4a0520c482294a`. These are scoped
test receipts, not a claim of physical-device or cross-network music acceptance.

## The WebJam invitation boundary

The host uses **Copy Invite in WebJam**, pastes its complete message into the
jam room's invitation box, and selects **Share**. An invited room member uses
**Copy full WebJam invitation**, opens the desktop app, chooses **Join**, and
pastes the complete message. A blocked clipboard reveals a selectable text
area instead. Windows and Linux require this paste route for private invites.
Phones can participate in the jam room's chat; desktop WebJam carries music.

This fixes two integration defects found with the real app source:

- The ordinary remote invitation includes both a `webjam://` URL and a sealed
  `webjam-signal:` line. Sharing the URL alone makes WebJam reject it as
  incomplete.
- Ordinary chat commands bounded arguments to 300 characters. The complete
  invitation now has a narrowly scoped envelope, limited to 8 KiB, matching
  WebJam's 8,192-character paste boundary and retaining a bounded JSON frame.

The message remains opaque and is copied unchanged as received by the text
area. Only joined members of the invite-only jam channel receive it. Hang Out
does not fetch its URLs, open companion meetings, validate its cryptography,
or grant a desktop session. WebJam performs protocol validation, expiry,
one-use enrollment and transport authentication. Hang Out stores invitation
material only in the live room's memory, excluding it from room/session
snapshots, moderation logs and AI submission. Restarting the service can require
the host to share a fresh invitation. No transcript or invitation archive exists.

## Executed native handoff

The native check used an isolated checkout of the exact WebJam commit above,
its actual Qt Join dialog, a newly compiled `webjam-fabric` in a temporary
directory, and the installed Jamulus server executable. It did not replace the
installed WebJam application or publish a new build.

1. Start a real Jamulus server bound to loopback and create a native host session
   through `NativeHostTransportOwner` with the normal `direct-stun` policy.
2. Obtain its real complete invitation and pass it through two independent
   Hang Out browser sessions and the visible Copy invitation action.
3. Paste the returned message into the actual Qt Join dialog and verify typed
   invitation admission.
4. Connect a real `NativeGuestTransportBackend`, using the documented explicit
   sealed-reply paste fallback.
5. Receive a real Jamulus control response through the authenticated native
   transport; stop both sidecars and the server.

All five steps passed on the same Mac. Separate checks passed exact-source v2
and v3 invitation parsing for the Mac, Windows and Linux explicit-paste routes.
The regression fixtures contain no working shared invitation. Actual ephemeral
invitations were kept in process pipes and browser memory, never committed.
The sanitized receipt is [native-handoff.json](../pr-assets/beta-collaboration/native-handoff.json).

This proves native invitation handoff, authentication and UDP forwarding. It
does not prove cross-network NAT traversal, physical audio, audible latency,
automatic mailbox signaling or a released desktop package. The installed
WebJam app reports 0.27.2; GitHub's latest release is the test-only v0.29.0 from
September 30, preceding the October 17 Web Join source merge.

## Chat, drawing, video and expiry checks

Automated WebKit scenarios run in the existing iPhone SE, iPhone 15 and iPhone
15 Pro Max projects; Chromium runs the Android profile. Each verifies real
two-browser chat, no pre-join backlog, touch drawing, reconnect with the
original channel's unsent draft, and fresh chat after reconnect. Watch tests
use a named YouTube player fixture with real authoritative room events. They
verify host play/pause/seek delivery and guest control restrictions. Paused
YouTube seeks now publish instead of snapping the host back to an old position.

A private-room close with the beta expiry code 4401 stops camera and microphone
tracks, peer connections, TURN refresh, video playback and pending transmission.
It clears connected content and presents an expired-sign-in gate. Delayed
capture, decrypt, player and signing callbacks cannot revive the ended session.

Relevant commands:

```sh
npx vitest run tests/unit/hangout-webjam.test.js tests/unit/hangout-lobby.test.js
npx playwright test tests/e2e/lobby-webjam.spec.js --project=chromium
npx playwright test tests/e2e/lobby-collaboration-phones.spec.js
npx playwright test tests/e2e/hangout-turn.spec.js tests/e2e/hangout.spec.js --project=chromium
```

## Remaining external acceptance

- Perform physical iPhone Safari and a second household's desktop acceptance,
  including real microphone/camera permission, audio and connection recovery.
- Validate cross-network native WebJam audio and the desired released desktop
  build. Same-Mac forwarding is not evidence of WAN musical timing.
- Browser Web Join remains disabled. Its source is merged, but
  `https://stalemate.band/join/` still returned 404 on this check and no release
  or static-host configuration was inferred from source availability.
- Verify the final protected Cloudflare deployment's invitation handoff after
  deployment. Local relay tests alone do not establish its configured origins,
  provider credentials or budget accounting.
