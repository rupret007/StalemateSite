# Shared Track: the next user check

Use this during the attended private rehearsal. Generated audio has passed
through the private WebJam service. The desktop Shared Track mix with live
instruments still needs a listening check on both ends.

## What you need

For this build, use the **MacBook as the Shared Track host**. A browser guest on
Windows can receive the session without installing WebJam or BlackHole. The
current desktop Shared Track sender does not have a Windows/Linux backend;
repeatedly clicking Recheck Route cannot add one.

On the MacBook you need wired headphones, a physical audio input/output, and
official **BlackHole 16ch or 64ch at 48 kHz** for the separate backing-track
route. The built-in mic and plugged-in headphones are available for the basic
check; use the SSL 2+ and your connected instruments for the actual guitar/vocal
test. BlackHole 2ch is not a substitute for this build's route.

On November 8, after Jeff installed the official driver and rebooted, a fresh
read-only check verified **BlackHole 16ch: 16 inputs, 16 outputs, 48 kHz**. It was
not the default device. The physical defaults were the MacBook microphone and
wired External Headphones, both at 48 kHz. The exact staged native build and its
strict signature matched. **Do not install BlackHole again.** These facts do not
prove an active Jamulus process route or Shared Track playback.

## Before playing

1. Keep the MacBook awake with wired headphones connected and WebJam idle.
   The initial test can use its built-in mic; reconnect the SSL 2+ only for the
   later guitar/vocal check with actual instruments attached.
2. Use one bounded host/guest session after fresh resource, account-headroom,
   admission and cap checks. Keep the primary musician input/output physical;
   the backing-track client uses the separate BlackHole route. Collect actual
   process-route evidence without overriding certification.
3. Open **Shared Track** in the Mac's verified `c6eecdc` build and choose
   **Add Track…**. Start with the staged **Original Test Chords.wav**, then
   repeat with **Original Test Chords.mp3**. Keep the error if the route
   check fails and leave playback stopped.

## Check each file with the Windows guest

1. Choose **Play** and sing or play over the track. Ask the guest to confirm
   that they hear both. Adjust **Source trim** in Shared Track and verify
   that the backing level changes while the live input stays steady. The
   Windows browser receives one combined mix. Its listening volume affects
   the whole mix.
2. Choose **Pause**. The guest should hear the live input while the backing
   stops. Move the position slider while paused and choose **Play** to check
   the new position. Choose **Restart** to check playback from the beginning.
3. Use **Stop** and confirm the backing ends while live audio remains. Finish
   with **Leave session** on Windows and **End Session** on the Mac. Keep a
   short note of what each person heard for WAV and MP3, any dropout, and
   whether playback and capture ended. Use no recording.

The `c6eecdc` build uses **Pause** and **Stop** to silence the backing.
The dedicated Shared Track **Mute** button is in the later [candidate PR 495](https://github.com/rupret007/webjam/pull/495).
When the corresponding build is available, also check that **Mute** silences
the backing for both ends while its position advances and live input remains
audible. Unmute and verify the track returns at the current position.

Keep Webex closed for that baseline. Its separate video/manual audio-handoff
check comes afterward, with explicit microphone/camera choices. The current
Webex integration opens the meeting externally; it does not automatically
switch audio between the two apps.

See the [current readiness handoff](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md) and
[generated browser/countdown evidence](HANGOUT_HOSTED_COUNTDOWN_PROOF_20261107.md)
for the exact builds and what automation has already demonstrated. This guide
does not change the sender's route-certification or isolation checks.
