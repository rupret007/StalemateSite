# Shared Track: the next user check

**Nothing needs to be done while Jeff is asleep.** The automated chat-expiry
observation is running separately. Generated audio already passed through the
private WebJam service; playing a song through the desktop Shared Track control
still needs its own setup and listening check.

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

At the November 7 read-only check, the MacBook did not have a BlackHole 16ch/64ch
device. The official 16ch installer was already downloaded and its exact hash
matched the earlier verified package. It has **not** been installed. The Mini's
native-test resource guard also remained closed, so it was not used as a
workaround.

## When you are awake

1. On the **MacBook**, open Finder → Go → Go to Folder and enter
   `~/Library/Caches/WebJam/shared-track-setup-20261107/`.
2. Open `BlackHole16ch-0.7.1.pkg` and complete its normal installer prompts
   locally. If it asks for a reboot, wait until the current unattended
   observation has finished; its expected expiry is November 8,
   01:16:36.764 UTC.
3. Leave WebJam idle with the headphones connected and report that setup is
   ready. The next controlled session can collect device, process, transport
   and teardown logs together. Installing the driver does not prove playback
   or automatically start it.

The listening session needs a short rights-cleared WAV, the Mac host, and a
Windows browser guest. We need to hear the backing track through the session,
confirm each endpoint can adjust/mute it independently, then verify pause,
restart and End/Leave cleanup. Source decoding or moving meters alone cannot
answer those questions. No recording is needed for the initial listening check.

Keep Webex closed for that baseline. Its separate video/manual audio-handoff
check comes afterward, with explicit microphone/camera choices. The current
Webex integration opens the meeting externally; it does not automatically
switch audio between the two apps.

See the [current private repair](HANGOUT_PRIVATE_REPAIR_20261107.md) and
[generated browser/countdown evidence](HANGOUT_HOSTED_COUNTDOWN_PROOF_20261107.md)
for the exact builds and what automation has already demonstrated. This guide
does not change the sender's route-certification or isolation checks.
