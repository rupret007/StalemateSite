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

1. For the currently serving beta, open **WebJam Private Rehearsal (c6eecdc)**
   on the Mac Desktop and check **More → About WebJam** for build `c6eecdc`.
   Once the rehearsal is scheduled, check the intended network, SSL 2+
   guitar and vocal inputs, wired headphones and Che’s drum interface.
2. In WebJam, choose **Music → Host**, then **Start Session** if shown.
   In Hang Out, open **Rooms → Jam (WebJam)**. Keep both open.
3. Use the invitation steps that match the serving website and Mac build.

| Build | Host | Guest |
| --- | --- | --- |
| Serving private beta, source `dc77aef`, Worker version `8d76db40` | Choose **Invite bandmate to room** if shown, or **Invite guest** in Host tools. Once the guest joins the room, choose **Invite a browser guest → Copy browser invite** in WebJam. Paste it into the Jam room and click **Share**. | Accept **Join room**, then choose **Join in browser** when the host shares the Music invite. |
| Selected-guest candidate, website `02a74e73` and WebJam `424f2ed6` | After private delivery and launch verification, choose **Invite bandmate to Music**, select the guest, and confirm in WebJam. Wait for Hang Out to say the invitation was sent. | Choose **Accept and join**, then **Open WebJam in browser**. Choose **Join to listen** with your mic off, or check your input and join with a microphone. |

### If WebJam doesn’t open from Hang Out

On the selected-guest build, choose **Open** if the browser asks to open WebJam.
If nothing opens, choose **Cancel Music invite** in Hang Out. Open the WebJam
beta app, start **Music → Host**, then try again. If the return tab opens in a
different browser profile, choose **End browser invite** in WebJam and retry
from Hang Out in the return tab’s browser profile.

### What’s been verified

The serving beta uses the first row. The selected-guest path passed in desktop
Chromium and phone-size WebKit with the exact private website archive and WebJam
Qt source. The guest recovered from a refused invitation, accepted a fresh one,
listened and left. Those checks simulated audio. The exact Apple Silicon package
passed targeted warm and cold launches. The Mini’s default private URL handler
still selected `c6eecdc` at the latest check. A matching Intel package, actual
browser-to-app launch and the live rehearsal still need verification.
[Website review](https://github.com/rupret007/StalemateSite/pull/487) ·
[Desktop review](https://github.com/rupret007/WebJam/pull/505)

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
