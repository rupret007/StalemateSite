# Webex companion: current behavior and acceptance

WebJam carries the music through Jamulus and browser Web Join. An optional
Webex meeting can provide video or conversation separately. Both Macs use
**WebJam Private Rehearsal (c6eecdc)**. Use the
[current private handoff](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md)
for package and website identities. The real meeting remains an attended check.

On November 12 both verified Mac builds had the same existing Personal Room
saved. The MacBook change updated only its meeting field. A fresh readback
confirmed the saved setting, valid package signature and absence of a conflicting
environment override. Private links and room numbers stay out of the evidence.

## What the current application controls

| Participant | Available behavior | Boundary |
| --- | --- | --- |
| Native Mac host | Conversation opens its panel. An explicit Join / Open Meeting action hands the saved validated meeting link to the operating system. | The meeting owns sign-in, camera, microphone, speakers and participant state. Opening a link does not prove the meeting was joined. |
| Native Mac with verified Webex | Show Webex App and Open Webex to Mute bring the verified Cisco application forward for its own controls. | The participant must operate Webex's Mute control. WebJam cannot verify or change that external meeting's mute state. |
| Browser Music guest | Web Join supplies music audio. A separately supplied meeting invitation can be opened in Webex's supported app or browser. | Web Join has no embedded meeting, camera, Webex SDK session or automatic cross-app audio switch. |

The desired simple audio switch remains an implementation gap. Legacy
Talkback, video-only or audience preferences do not establish automatic routing.
The supported external path is documented in the native
[meeting-platform guidance](https://github.com/rupret007/webjam/blob/76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c/WEBEX_AUDIO_MODES.md).

## November 8 device readiness

Read-only inspection using the staged source's production detector found a
publisher-verified Webex **46.7.0.35472** on the Mini. Windows had a Cisco-signed
Webex **45.6.1.32593** executable with a valid signature. The MacBook detector
found no supported Webex installation in its normal application locations.
Neither Mac had a saved `webex_url` in its current WebJam settings. Do not
assume the earlier Personal Room discussion configured these builds.

At 09:48 UTC, normal Mini client navigation through the dedicated WebJam
profile → Meetings → My Personal Room Information revealed the existing
Personal Room. The current vendor signature was valid. One HTTPS Webex Personal
Room link was validated without saving its URL, room number or host fields to
evidence; the client was quit normally. No meeting, camera or microphone started.

The November 12 saved settings supersede the November 8 device inventory.
On the MacBook, choose **Join / Open Meeting** and use the external browser
option if Webex offers it. **Show Webex App** requires a verified installed
client. The MacBook has a listed camera. Windows has a software-enumerated
image device and still needs a real camera-preview check. To undo the MacBook
setup, clear its meeting link in WebJam Settings. Its original field was empty.

## Attended manual handoff check

This is an interim test procedure, not a completed one-button switching UX.
Use two consenting participants, headphones and no recording. Keep each music
trial within the approved one-host/one-guest, ten-minute bound and obtain the
normal fresh resource and account-headroom checks.

1. Start with music audio working. Open the optional meeting using the intended
   participant accounts and enable cameras only with their consent. While
   playing, leave the meeting's audio disconnected or join without audio if
   that meeting offers it. Muting only its microphone can leave meeting
   playback active; it does not demonstrate exclusive audio.
2. To test conversation through the meeting, use Leave Session in browser
   Music and End Session on the native host. Confirm music has stopped before
   enabling the meeting's audio. Check speech in both directions and video.
3. Before returning to Music, disconnect the meeting's audio using its own
   controls. If the available client or meeting cannot do this, leave the
   meeting. Start Music explicitly and share a fresh browser invitation.
   Confirm music works and meeting audio remains off.
4. Verify normal Leave / End Session and meeting exit. Retain only revisions,
   client/device roles, timing, outcomes and sanitized errors. Do not put
   meeting URLs, room numbers, invitations, credentials or recordings in the
   evidence. A browser meter or an accepted operating-system handoff is not
   proof of hearing, video or exclusive audio.

Cisco's [audio-switching guide](https://help.webex.com/article/871cgu) explains
the meeting's own audio choices and notes that available options depend on the
meeting type. Check the actual client rather than assuming an identical button
on every platform. Neither this procedure nor the local control tests complete
the real-meeting acceptance requirement.

## SDK research boundary

The official [Webex Meetings SDK guide](https://developer.webex.com/meeting/docs/sdks/webex-meetings-sdk-web-join-a-meeting)
describes joining an SDK-owned Meeting instance without media and adding media
later. Those controls apply to the integration's own SDK session. They do not
give the current external-link handoff control over a separately owned Webex
app or tab. A future embedded integration needs a separately designed and
authorized session/credential path, explicit media ownership and real-device
acceptance. No SDK, OAuth connection, provider activation or automatic routing
was added by this documentation change.
