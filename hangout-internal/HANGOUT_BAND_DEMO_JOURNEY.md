# Private band rehearsal in Hang Out and WebJam

Use the [current private readiness guide](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md)
to match the served website and the Mac's Desktop shortcut before inviting anyone.
Keep the rehearsal private and use the build-specific invitation steps below.

## What to send the guest

> Hey Che’, open the private Hang Out invite I send you in Chrome on your PC.
> Pick a nickname and enter the lobby. Keep wired headphones handy. I’ll send
> you the Music invite from inside Hang Out. Once you reach the audio check,
> pick your drum interface as the microphone, click **Check microphone** and
> play a few hits. When the meter responds, check the headphones box and click
> **Join with microphone**. You can do this in Chrome without installing WebJam.

Send the private Hang Out invitation separately through the usual private
channel. A guest opens it and reads the guest agreement before entering. A
name badge can show Stalemate or Rad Dad. Guests from either entry meet in
the same lobby and can see each other in **People**.

## Host setup

1. Open the verified WebJam rehearsal shortcut on the Mac. Choose **Music**
   and **Host**, then **Start Session** if shown. Check the physical input,
   wired headphones and intended network first. For the band's rehearsal,
   verify the SSL 2+ guitar and vocal inputs and Che’s drum interface.
2. In Hang Out, open **Rooms** and choose **Jam (WebJam)**. Keep the lobby
   and native Music session open. An online guest can wait in the lobby
   while the host prepares the invitation.
3. Use the invitation path that matches the private build.

| Build | Host | Guest |
| --- | --- | --- |
| Current delivered rehearsal flow | Choose **Invite bandmate to room** if shown. If the room shows **Invite guest** under host controls, select the guest there. Once both guests are in the Jam room, choose **Invite a browser guest → Copy browser invite** in WebJam. Paste it in the Jam room and click **Share**. | Accept **Join room**, then choose **Join in browser** once the host has shared the Music invite. |
| One-tap Music candidate, private fixture | Choose **Invite bandmate to Music**, select the guest's name, and confirm the invitation in WebJam. Wait for Hang Out to show that it was sent. | Choose **Accept and join**. If the audio check remains available in the room, choose **Open audio check**. The browser joins the Jam room and opens the audio check without exchanging a link. |

The verified one-tap candidate used private website tree `5553434` and
browser source `90331ff`. The isolated tests exercised native confirmation,
Windows Chrome, fresh invites and mixer-loss recovery with generated audio.
Use the one-tap instructions for an attended rehearsal once the corresponding
site and native handoff are delivered and confirmed on the actual devices.

## Audio check, recovery and ending the session

- On Windows, choose the intended microphone if Chrome lists more than one.
  Allow capture when prompted. Confirm that **Check microphone** responds to
  that input and that headphones are connected before joining.
- If the chosen input stays silent, check the interface in Windows Sound,
  choose it in Chrome and retry the mic check. If the Music invitation expires
  or the host ends the session, return to Hang Out and ask for a fresh invite.
- After joining, each person should say a few words and confirm hearing the
  other. Play a short passage and check guitar, vocal and drum levels by
  listening together. Finish with **Leave session** in Chrome and **End Session**
  in WebJam. Start a fresh invite for a rejoin.
- If using Webex video, join it without audio while playing. For conversation,
  end Music before connecting Webex audio. Before restarting Music, everyone
  disconnects Webex audio or leaves the meeting.

The [attended music worksheet](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) covers both
Macs, a second network, and the WAV and MP3 Shared Track checks. The
[Webex handoff guide](HANGOUT_WEBEX_AUDIO_HANDOFF.md) covers video and the
manual audio switch. These physical checks remain open. Use the approved
short private trials, consent before capture, and no recording.

## Repeatable QA

- [Lobby to Music journey](../tests/e2e/band-demo-journey.spec.js)
- [WebJam invitation and recovery tests](../tests/e2e/lobby-webjam.spec.js)
- [All 62 community acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md)
