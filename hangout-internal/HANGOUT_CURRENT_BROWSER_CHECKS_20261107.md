# Current private browser checks — November 7

**The repaired private version passed these Mac and Windows browser journeys.
The release candidate remains pending.** These checks preserve all
[62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md); they do not
replace physical audio, Shared Track or the separate real eight-hour observation.

Both endpoints used the real invitation-protected community, website source
`d8c08fb88b94429f03d13d9beaf01d8ffd301e1a` and private version
`c2271048-aaa3-4649-8e9e-48dd46212da5`. Thirteen served runtime hashes matched
on each endpoint. No deployment, provider credential issuance, physical capture,
recording, operating-system policy change or StoryPool operation was performed.

| Actual endpoint | Completed journeys | Observed setup / reconnect |
| --- | --- | --- |
| Intel MacBook, macOS 15.7.9, Playwright WebKit 27.2 | Twelve stages: anonymous denial, both band entrances, shared lobby and arrival badges, fresh scrollback, mobile layout, draft-preserving reconnect, Art-room stroke, host/guest permissions, inert Jam destination sharing, own-room closure and logout revocation | Stalemate 1,487ms; Rad Dad 902ms; reconnect 329ms |
| Windows 11 NucBox, installed Google Chrome 156.0.8078.80 | Seven stages: anonymous denial, ordinary guests through both entrances, reciprocal chat and badges, fresh scrollback, runtime hashes, mobile layout, private-draft reconnect and simulated mic-denial recovery; both logout/revocation checks also passed | Stalemate 1,755ms; Rad Dad 1,312ms; reconnect 268ms |

Setup measurements have different harness boundaries: the Mac measures from
submitting the invitation; Windows includes initial entry navigation. They are
single observations, not a cross-platform speed comparison, audio latency or a
service guarantee. WebKit automation is not an actual Safari or iPhone test.

## Layout and recovery

All four 375px/390px screenshots were visually inspected. Page width stayed at
the requested viewport, welcome/chat lines wrapped, input and Send remained
visible, and the browser measured 16px input text. Starter buttons and action
chips scroll inside their own rows; some options are intentionally offscreen
until that row is scrolled. The connected indicator, arrival-site backlink and
bottom navigation remain readable. Physical touch, keyboard occlusion and
screen-reader behavior still need their own checks.

Windows guests had `guest` / `fan` identities irrespective of their arrival
label. The later guest did not receive the earlier message. Reconnect reset
scrollback while keeping an unsent draft private. Each normal logout returned
200; copied-cookie state and protected JavaScript then returned 401.

The Windows mic-denial case intercepted `getUserMedia` inside the isolated test
context and threw `NotAllowedError`. The page displayed the blocked-access
explanation and Try again. Exactly one simulated request and zero display
requests occurred. No physical microphone API was invoked; this is recovery
coverage, not Windows device or listening qualification. The Jam destination
in the Mac run was deliberately inert and did not start a music session.

## Process ownership and retained setup failures

Independent Mac readback matched the remote proof and harness and found no
remaining Node process for that check. The harness awaited its own browser
close before writing the matching terminal proof; it did not retain a separate
historical browser PID. The unrelated eight-hour observer remained untouched.

Windows used a separately owned normal interactive Chrome profile, muted output
and a loopback-only control endpoint. Its executable had a valid Google
signature. No headless, fake-device, autoplay, certificate, sandbox or web-security
override was used. The isolated JavaScript SDK was installed from pinned public
packages with install scripts disabled; no global package or browser install
was performed. The temporary limited launch task was removed after launch.

The first controller stopped while parsing an empty response before the remote
test harness, receipt or Node process existed. Its 9,704-character encoded
command suggests a transport-length problem, but the original remote error was
not retained and the precise cause is unestablished. It remains a failed setup
attempt. Splitting the CLI transport into two bounded commands then exposed a
separate preparation guard error: Chrome renderer processes inherited the
debugging-port argument and were incorrectly counted as primary browsers.
Readback found one signed primary and three signed renderers, with no unsafe
flags and no test started. The corrected selector requires one primary process
without `--type=`, the expected owned profile and ownership of the actual
loopback listener. Test assertions and resource/trust checks were unchanged.

After the completed Windows run, independent readback matched its exact proof
and harness and found the recorded Node, owned Chrome processes and control
listener gone. The temporary launch task was absent, and PowerShell's effective
execution policy remained Restricted. No script-file execution or policy
bypass was used. Existing user browser profiles were not closed.

## Evidence and next acceptance work

The [preparation manifest](../pr-assets/beta-collaboration/20261107/hosted-access-countdown/receipt.preparation.json)
records payload hashes and the explicitly declared excerpts. The packet retains
both browser harnesses, terminal proofs, independent readbacks, controller stops,
process diagnostic and four screenshots. Original receipts remain owner-only;
private invitations and credentials are absent.

The [connected countdown and generated-media trial](HANGOUT_HOSTED_COUNTDOWN_PROOF_20261107.md)
is separate transport evidence. The [Shared Track setup/check](HANGOUT_SHARED_TRACK_NEXT_CHECK_20261107.md)
explains the missing MacBook route prerequisite. Clear physical Mac-to-Windows
speech/music, instruments, actual desktop WAV/MP3 shared mix, a second network,
real Webex video/manual audio handoff, assistive technology and human moderation
review remain pending. The repaired eight-hour observation is still running
toward its original November 8, 01:16:36.764 UTC expiry; it has not passed yet.
