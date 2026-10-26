# Audio diagnostics and verification after publication

The media suites now capture native audio events, play calls and promise results,
buffered ranges, ready/network/error state, visibility, label changes, request
timings and response headers. Browser timestamps and timer delays help distinguish
event-loop delays from missing data or a blocked playback gate. Each attempt has
its own JSON attachment, including successful attempts for comparison. Pagehide
snapshots retain the departing game's state. First-attempt failure traces are
retained alongside existing screenshots/videos. Observers run only in tests.

CI runs one browser worker to reduce contention between native decoding, tracing
and recording. Existing 30-second test and five-second assertion limits remain.
Retries remain visible in ordinary CI reports; live verification has zero retries.
Timing failures are investigated from their first attempt, not declared fixed
solely because a retry passed.

## Reproduced navigation defect

The new live check found that Turdtris cached the initial shared music preference.
Entering while muted and enabling music with the shared footer left playback
paused. Upstream now reads the current shared preference for its playback gate,
menu toggle/label and runtime getter, preserving sound/master mute and standalone
fallback. Native Chromium and emulated WebKit failed the original navigation check;
the page-script regression also failed before the fix. Baselines are preserved in
the workspace's release-evidence/audio-live-verification directory.

## Automatic live verification

`Verify published site` runs after a successful main-branch push completes the
`Test and Pages` workflow, including its deployment. PRs and failed deployments do
not qualify. Manual dispatch is limited to main. Each host gets an independent
job; one failed host does not prevent checking the other. The checkout is pinned
to the completed deployment's exact commit. New qualified releases replace older
verification jobs for that host; this does not cancel builds or deployments.

Each job packages that checkout and compares expected public bytes with its host:

- All packaged public files are hashed in full, including every music file.
- The large lyric video uses HEAD status/content length instead of a full download.
- `.nojekyll` is a build control file and is excluded from public URL checks.
- The arcade marker must identify an exact upstream commit. File hashes also catch
  site-only changes when that upstream revision has not changed.

The band domain mirrors independently. Readiness may poll for up to 20 minutes,
preserving the first mismatch, HTTP/cache headers and every subsequent observation.
One abort timer owns the complete readiness operation. Once it expires, queued
requests and further polling stop even if wall-clock rounding still reports a
small amount of time remaining; the first mismatch and unresolved paths remain.
Only unresolved files are polled; a final complete comparison prevents accepting
a mixed copy from different observations. Readiness waiting does not retry failed
browser assertions. Once ready, Chromium and emulated WebKit check the homepage,
all seven game pages, a real puzzle move/Undo, muted game navigation/unmute, one
native music stream, Next and deliberate failed-song/Retry recovery. The checker
also plays a Rummy turn with storage access denied and verifies QR music can
reload and advance after a deliberately failed download. Media must
advance in real time; a play label alone is insufficient. Requests to GoatCounter
are blocked so checks do not inflate visitor analytics.

A mismatch past the deadline or any browser failure fails the job. Readiness,
expected hashes, results, per-attempt audio diagnostics and first-failure traces
are retained as Actions artifacts for 14 days. No external messaging service,
credentials, hosting service or multiplayer infrastructure is required.

Run the same checker locally at both supported prefixes:

```sh
npm run test:live:local
```

To verify a published host from the exact expected checkout:

```sh
STALEMATE_LIVE_BASE=https://stalemate.band/ npm run verify:live
STALEMATE_LIVE_BASE=https://rupret007.github.io/StalemateSite/ npm run verify:live
```

Outputs default to ignored `live-results/`. In CI, each host/prefix gets its own
directory. `STALEMATE_EXPECT_SITE_SHA`, when set, must equal the checkout's HEAD.
Public file matches prove deployed content matches that revision; test-only
commits with identical public files are intentionally indistinguishable on hosts.

## Physical iPhone acceptance — not run

This environment has Command Line Tools, without an available physical-iPhone
automation connection. Browser emulation cannot establish native screen-lock,
app-switch or OS media behavior. Record these results separately when a device
is available; never infer them from a synthetic visibility event.

1. In Safari, open the arcade and play Turdomania. Enable music and confirm one
   audible stream and a matching title. Use Songs/Next to change tracks.
2. Turn music off, navigate to Turdtris, start play, then enable music. Confirm
   playback resumes; mute remains effective while moving between games.
3. While music is playing, lock the phone for ten seconds. Confirm it stops while
   hidden. Unlock and record whether playback resumes or asks for a new gesture.
4. Repeat by switching to another app for ten seconds and returning to Safari.
5. Rotate portrait/landscape and confirm the game, music controls and titles remain
   usable. Note any doubled stream, incorrect title or persistent Loading state.

Record device model, iOS version, URL/revision, each result, and any unexpected
gesture requirement. Physical acceptance remains **unverified** until recorded.

References: [Playwright traces](https://playwright.dev/docs/trace-viewer),
[GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
