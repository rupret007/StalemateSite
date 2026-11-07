# Private lobby expiry repair — November 7, 2026 UTC

**The private beta has the reviewed repair. The overall release candidate is
still pending.** All [62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain
unchanged. Public Stalemate and Rad Dad navigation, StoryPool, Karen, provider
limits, release holds, AI and separate Hang Out media TURN were not changed.

## Exact delivered version

| Item | Verified identity |
| --- | --- |
| Reviewed website head, PR #232 | `d8c08fb88b94429f03d13d9beaf01d8ffd301e1a` |
| Merge | `bfe0365eaef183cc282aaed38aecfecc7f0b84d0` |
| Identical reviewed/merged whole tree | `09012724c8600815f9df111faa4014f7aeb220d1` |
| Private website version | `c2271048-aaa3-4649-8e9e-48dd46212da5` |
| Private deployment, 100% | `1a83f7e5-7ed1-4aa7-8af5-bd68fb6a8fcf` |
| Previous website / rollback version | `33862058-10a5-4a6f-9659-38841d70292f` |
| Unchanged issuer version | `4db649fa-a465-44b4-8487-414987b3a660` |
| Unchanged native package source | `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c` |

The invitation-only address remains
<https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>. No invitation or
credential is included here. Both band entrances lead to one community.

## What was fixed and verified

The original real eight-hour test on the previous website ended with a quiet
guest still visibly connected about 47 seconds after access expiry. Cleanup
HTTP returned 401, but the later expired-token replay assertions were not
reached. The original failure is preserved; an authentication bypass was not
established. Its five recovered 1006 closes also prevent an uninterrupted
uptime claim.

The legacy lobby's minute-only alarm could be later than a guest's expiry. The
repair schedules its existing alarm against the earliest live access deadline,
preserves earlier maintenance, restores that deadline after reconstruction, and
refuses new socket admission if recording the deadline fails. Production TTL,
authentication and the separate collocated-authority scheduler are unchanged.
Three old-source deadline assertions reproduce the gap; all five new lifecycle
cases pass. The retained initial matrix had 97 passes and one missing test
snapshot TOML; that unchanged configuration case passed after supplying its
tracked input. Transfer/fixture failures remain available.

An independent local workerd comparison used real automatic alarms and
fixture-only ten-second synthetic access, with the production eight-hour TTL
unchanged. The old alarm was 49,954ms late and its quiet socket stayed open. The
fix stored the exact deadline and closed with 4401 after 49ms. Both versions
refused identical expired signed cookies, and the healthy guest still answered.
No clock advance, manual alarm call, provider access or physical capture was
used; owned runtimes were disposed. This does not replace hosted real-duration
qualification or establish a provider latency guarantee.

Both full exact-head CI runs passed:
[PR](https://github.com/rupret007/StalemateSite/actions/runs/42391463329) and
[push](https://github.com/rupret007/StalemateSite/actions/runs/42391424444).
Each reports 137 unit files / 2,074 tests, 813 browser checks, and both 34-check
root/project smoke runs, with no reported retry or flaky summary. Both local
Durable Object CI jobs also passed. Their provider-start mode uses zero-network
callbacks; it is not external provider activation, native audio, or proof of the
separately requested frozen native-provider CI mode.

Private delivery used normal application Wrangler tooling after review. All 111
prepared source/asset inputs matched. API readback matched all 66 source
contents: 64 unchanged plus the reviewed lobby and beta-entry changes. All 17
existing plain settings, namespace IDs and secret binding names were preserved,
including the approved browser origin. The older prepared controllers remain
unexecuted; the failed old proof was not relabeled or used as a PASS.

## Actual post-update journeys

One ordinary Rad Dad guest joined before delivery and remained connected in this
observation. Its unsent draft stayed private, a new message echoed after the
update in 326ms, and thirteen served runtime payloads matched. Normal logout
returned 200; copied-cookie state and protected code returned 401. Browser
resources closed, and independent readback found the owned Node gone. No restart
or hibernation was forced, so this does not prove every update strategy preserves
sockets.

A separate Linux Chromium run passed all twelve actual hosted stages: both band
entrances, arrival labels, nickname/chat, fresh scrollback, draft-preserving
reconnect, Art-room join/drawing, host/ordinary permission separation, inert Jam
invite sharing, normal own-room closure and copied-cookie logout rejection.
Setup observations were 889ms / 779ms; manual reconnect was 223ms. These are
single automation observations, not audio latency or service-level guarantees.

The logged-out saved-lobby URL now returns a useful invitation recovery page
with status 401. It grants no cookie and keeps APIs, protected code and sockets
denied. Anonymous recovery and authenticated chat screenshots were inspected at
375px and 390px: no page overflow; wrapped text; input and Send visible; input
16px; clear keyboard focus and a 48px recovery action. Starter buttons scroll
inside their card. These are headless Linux captures, not physical iPhone,
Safari or screen-reader qualification.

The imported Web Join countdown/recovery source is delivered and its served
hashes match. These chat/Art checks did not start a live music connection or
demonstrate the connected countdown, actual desktop Shared Track, physical
listening, instruments or Webex video/audio handoff after this update. The
retained controller's `COUNTDOWN_HOSTED` state label must not be read as evidence
of those unexecuted journeys.

## Unattended follow-up and remaining work

A distinct ordinary guest started a full real-duration WebKit observation on
this repaired version at about 17:16 UTC. Its original signed expiry is
**November 8, 2026, 01:16:36.764 UTC**. It is running, not passed. The observer
keeps the actual TTL and clocks, checks resources, blocks physical capture,
retains the identical signed token only in memory for expiry replay, and closes
its own resources. Its process-scoped awake assertion is bounded to 29,400
seconds and ends with the owned observer; no system power preference changed.
The superseded 90-minute assertion was stopped after verifying both exact owned
commands. A separate read-only finalizer will collect the same terminal result,
remote harness/process cleanup, unchanged deployed identities/settings and
existing CI. A failed or stale result requires inspection, not automatic restart.

The original full eight-hour failure, local comparison, CI, delivered behavior
and future repaired expiry outcome remain separate evidence. The website must
stay on this expected immutable version during the observation. Keep actual
Windows speech/music, SSL guitar/vocal and Che's drum setup, desktop Shared Track
WAV/MP3 in the shared mix, a second network, real Webex video/manual audio
handoff, assistive technology and current human report review pending until
demonstrated. MP3 decoder CI alone is not shared-mix proof. The confirmed report
contact and initial reviewer do not establish continuous moderator coverage.
Public all-ages launch also remains dependent on qualified operator/legal and
safety readiness.

Use the [evidence manifest](../pr-assets/beta-collaboration/20261107/private-readiness-followup/receipt.json)
and [packet explanation](../pr-assets/beta-collaboration/20261107/private-readiness-followup/README.md).
Current application progress and test receipts live in the isolated application
worktrees. No installed StoryPool checkout, service, CI workflow, shared
conductor state or shared operational file was changed.
