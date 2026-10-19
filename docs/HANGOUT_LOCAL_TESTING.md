# Try the community privately on this computer

Run `npm run dev:hangout`, then open **http://127.0.0.1:4387/__preview/**.
Keep the terminal running. Ctrl+C stops the preview. This command binds only to
the computer's loopback address and does not publish, deploy, or change Cloudflare.
The automated `serve:test` server remains separate and starts with fresh memory.

The launcher opens the real community interface with one explicitly selected local
identity per tab. Browser storage is isolated for each launcher identity, so two
tabs behave as two people rather than sharing one device token. No visitors or
messages are manufactured. The bottom banner names the selected preview identity.

- **Guest:** nickname-only chat and temporary hosting.
- **Room owner A / B:** two fixed email-account stand-ins. Reopening A creates a
  different device for the same account, making ownership recovery testable.
- **Community moderator:** abuse review and moderation without site configuration.
- **Site owner administrator:** full owner controls, including safety restrictions.

Email and staff identity are simulated by the local server; no code is emailed and
this does not verify live Cloudflare Access. AI is disabled, with no provider calls.
YouTube loads only when an activity uses it. Cameras and microphone still require
explicit browser permission. WebJam desktop audio and live TURN credentials need
their actual service configuration.

## Suggested test

1. Open a guest and room owner A from the launcher; use different nicknames.
2. Exchange messages. Use owner A to start a named chat channel and “Keep this room.”
3. Open room owner B, join the channel, and use the host controls for persistent
   co-host access and an accepted ownership transfer.
4. Report a message from another identity, then open the moderator panel to review it.
5. Try Draw together with two tabs. Host clear controls and drawing sync use the
   real lobby engine. Test live cameras only when you want browser capture enabled.
6. Stop and restart the preview, reopen an existing tab or the same owner profile,
   and rejoin the room. Registered rooms, ownership, restrictions, and moderation
   evidence return; chat scrollback starts fresh. Temporary empty rooms and activity
   state follow the normal cleanup rules.

## Local state and boundaries

On macOS, state is stored with owner-only file permissions at
`~/Library/Application Support/Stalemate/hangout-preview.json`. Other systems use
`$XDG_STATE_HOME/Stalemate/hangout-preview.json` or
`~/.local/state/Stalemate/hangout-preview.json`. This includes local account/session
identifiers, room records, usage limits, settings, moderation evidence, and action
records; ordinary chat and PM text are not saved as a backlog. Evidence and action
records retain their product expiry limits. Preview session links expire after
seven days; registered rooms use the product's 90-day inactivity rule.

Use `HANGOUT_PREVIEW_PORT` for a different port and `HANGOUT_PREVIEW_STATE` for an
alternate state-file path. These never change the loopback binding. A malformed
state file stops startup and is not overwritten; back it up before recovering.

The launcher checks the exact loopback Host and WebSocket Origin. Local role
creation additionally requires a same-origin POST and a per-start CSRF token.
Unknown sessions and attempts to elevate a guest through development query strings
are refused. The server exposes only required community/assets paths, and preview
modules and UI assets are excluded from Pages packaging. None of these identities
or auth adapters is imported by the production Worker.

Validation covers cross-origin/Host rejection, role boundaries, a real cold server
restart with cross-device owner recovery, no chat backlog, distinct browser-tab
identities, real reporting and moderator review, mobile layout, and no external
requests during ordinary local chat.
