# Private band rehearsal in Hang Out and WebJam

Use the [current private readiness guide](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md)
to match the served website and the Mac's Desktop shortcut before inviting anyone.
Keep the rehearsal private and use the build-specific invitation steps below.

## What to send the guest

Use this message with the currently serving private beta.

> Hey Che’, open the private Hang Out invite I send you in Chrome on your PC.
> Pick a nickname and enter the lobby. Put on your wired headphones. I’ll
> invite you to the Jam room. Click **Join room**, then **Join in browser**
> when I share the Music invite. On the audio screen, click
> **Check microphone**, allow Chrome to use it, and play a few drum hits.
> If **Using** names the wrong input, select your drum interface under
> **Microphone** when the picker appears, then play again. When you see
> **Microphone detected.**, check the headphones box and click
> **Join with microphone**. Chrome is all you need on the PC. If the invite
> expires, stay in Hang Out and I’ll send another.

After the selected-guest Music build is delivered and verified, use this version.

> Hey Che’, open the private Hang Out invite I send you in Chrome on your PC.
> Pick a nickname and wait in the lobby. When my Music invite appears, click
> **Accept and join**, then **Open WebJam in browser**. You can **Join to listen**
> with your mic off. When you’re ready to play, plug in wired headphones,
> choose **Check microphone**, and hit the drums a few times. If Chrome shows
> the wrong input, choose your drum interface under **Microphone**. When you
> see **Microphone detected.**, check the headphones box and select
> **Join with microphone**. Keep Hang Out open for chat. If an invite expires,
> ask me there for a new one. Chrome is all you need on the PC.

Send the private Hang Out invitation separately through the usual private
channel. A guest opens it and reads the guest agreement before entering. A
name badge can show Stalemate or Rad Dad. Guests from either entry meet in
the same lobby and can see each other in **People**.

## Host setup

1. Open **WebJam Private Rehearsal (c6eecdc)** from the Mac Desktop. Check
   **More → About WebJam** for build `c6eecdc`. Choose **Music** and **Host**,
   then **Start Session** if shown. Check the physical input,
   wired headphones and intended network first. For the band's rehearsal,
   verify the SSL 2+ guitar and vocal inputs and Che’s drum interface.
2. In Hang Out, open **Rooms** and choose **Jam (WebJam)**. Keep the lobby
   and native Music session open. An online guest can wait in the lobby
   while the host prepares the invitation.
3. Use the invitation path that matches the private build.

| Build | Host | Guest |
| --- | --- | --- |
| Last verified private site, `8d76db40` | Choose **Invite bandmate to room** if shown. If the room shows **Invite guest** under host controls, select the guest there. Once both people are in the Jam room, choose **Invite a browser guest → Copy browser invite** in WebJam. Paste it in the Jam room and click **Share**. | Accept **Join room**, then choose **Join in browser** once the host has shared the Music invite. |
| Selected-guest Music candidate, private fixture | Choose **Invite bandmate to Music**, select the guest, and confirm in WebJam. Wait for Hang Out to show the invitation was sent. | Choose **Accept and join**, then **Open WebJam in browser**. Choose **Join to listen** to keep the microphone off, or follow the microphone check to play. |

Use the `8d76db40` instructions for the staged rehearsal. Both Mac
shortcuts point to `c6eecdc`. The latest paired walkthrough used website source `d199ea3` and WebJam
source `424f2ed`. In desktop Chromium and phone WebKit, guests from both
band entrances accepted a selected-guest invite, recovered from a failed
verification with a fresh invite, listened with the mic off, and left.
The walkthrough used an offscreen Qt host and simulated audio. The local
Apple Silicon `424f2ed` package passed startup and launcher controls.
Browser-to-app dispatch on the intended installed build and live Music
remain open. Check **Build** in **About WebJam** before using a candidate
so an older Desktop shortcut does not open the wrong build.

## Audio check, recovery and ending the session

- Start with **Check microphone**. If **Microphone** appears, selecting an
  interface starts another check. Read **Using** and play a few hits to verify
  the input before checking the headphones box.
- If the interface is missing or silent, check **Windows Settings → System →
  Sound → Input** and select the drum interface. Then confirm Chrome has
  microphone permission. Use **Try again** if shown and wait for
  **Microphone detected.** before joining. If the invite expires or the host
  ends the session, return to Hang Out and ask for a fresh invite.
  [Microsoft microphone setup](https://support.microsoft.com/en-us/windows/hardware/drivers/how-to-set-up-and-test-microphones-in-windows)
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
