# Game Night private beta

Use **Rooms → Game Night → Invite players** while the other players are in Hang Out. Guests can choose **Join Game Night** or **Not now** in the invitation bar. To play in the room, open **Four in a Row** and choose **Open a match**. The guest sees **Join match** when a seat opens. X moves first. Choose a numbered column on your turn to drop a piece. Other invited guests can watch and keep chatting. The host can open another match after a win or draw.

If you lose your connection or reload, reconnect to Hang Out and choose **Return to room** if offered. The original room and your permission to join are checked again. A match ends when a player disconnects, and the host can open another. If the room closed or access changed, ask the host for a fresh invitation.

**Open Stalemate Arcade** opens the existing arcade in a separate tab. For an external multiplayer game, use that game's controls to join the same match.

If the host already has a Discord voice channel, they can open **Manage Discord link** and paste an invite created from that channel. A channel link also works for people who already have access. Players choose **Open Discord call** and use Discord's microphone, camera, screen sharing and leave controls. Everyone can keep using Hang Out text chat during the call. Use an expiring invite for a private group. To close access to Discord itself, revoke the invite or adjust channel permissions in Discord. [Discord invitations](https://support.discord.com/hc/en-us/articles/208866998-Invites-101) · [Discord video calls](https://support.discord.com/hc/en-us/articles/360041721052-Video-Calls) · [Discord screen sharing](https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share)

## Integration choice

Discord's existing voice channels provide an immediately usable call handoff without provisioning a Discord app for Hang Out. The Social SDK is a native game integration. Its communications feature has eligibility, application setup and authorization requirements. The Embedded App SDK hosts web activities inside Discord. In-page calling inside Hang Out would need a separately reviewed media design covering consent, moderation, accessibility, device switching, quality on home networks and relay capacity. [Discord Social SDK](https://discord.com/developers/social-sdk) · [Discord Embedded App SDK](https://support-dev.discord.com/hc/en-us/articles/21204423970071-Introducing-the-Embedded-App-SDK)

## Access and delivery

- The server advertises Game Night on the protected beta and the loopback preview. The new lobby UI hides the tile against an older server. The room uses the existing invite, host and moderation paths. Chat starts when a player joins.
- The board is available when the protected server advertises it. The server owns the seats, turn order and results. Boards are visible only to current room members and clear when either player leaves the room or match, one player blocks the other, Shield is raised, or the server restarts. The board has no persistent scores or match history.
- Only current room hosts can manage a link. It is sent only to current room members and kept in live room memory. It clears on removal, the publishing host's departure or loss of host permissions, a server restart, or Shield activation. A player who already opened the call leaves it in Discord. Hang Out has no visibility into call media or participant activity inside Discord.
- Only official HTTPS Discord invite and server channel URL formats are accepted. The browser opens the destination on click with the referrer suppressed. Link validity, account eligibility, and voice-channel permissions are evaluated by Discord. [Discord minimum age guidance](https://support.discord.com/hc/en-us/articles/360040724612-Why-is-Discord-asking-for-my-birthday)
- Deployments with the participation authority enabled keep Discord sharing unavailable pending separate qualification. Game Night remains usable for text and games there. The preview adds no call provider credential, microphone or camera capture, recording, or WebJam relay usage.
- Protected delivery requires the Worker and lobby assets from the same revision. The persisted room stays a compatible chat record with a reserved generated room name, so an older Worker can restore the room as chat. Call links are absent from the durable room record.

## Verification

Loopback tests cover host publication, unauthorized updates, invite-only admission, link removal, host departure, restart, and a browser handoff to a synthetic Discord page. Chromium and WebKit tests play a complete match from two independent browser contexts, use the keyboard to make a move, keep the composer visible at 375 and 390 px, and start and leave a rematch. A private session with an existing Discord voice channel is needed to verify real microphone and camera exchange with two people.
