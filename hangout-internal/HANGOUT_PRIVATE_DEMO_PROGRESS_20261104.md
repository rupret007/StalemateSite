# Private demo checkpoint — November 4, 2026

The full goal is incomplete. Preserve every row of the unchanged
[62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) and the remaining work in
[the full acceptance audit](HANGOUT_ACCEPTANCE_AUDIT_20261031.md). This checkpoint
adds newer evidence; it does not convert source, fixtures or CI into physical
music or public-launch readiness. No public band navigation, provider or release
hold was changed. StoryPool 10-21-26 retains infrastructure/deployment ownership.

The newer [browser ownership integration](HANGOUT_BROWSER_OWNERSHIP_IMPORT_20261104.md) supersedes the earlier browser pin below; its own website CI remains required. Native423 is now qualified and merged asd814a47894dcdb5f954ca557496611a28c107d95. Native424 incorporates that merge and awaits new combined-head CI. The table retains its recorded earlier revision scopes.

## Application revisions

| Work | Exact source | Current qualification |
| --- | --- | --- |
| Website selected candidate, draft [198](https://github.com/rupret007/StalemateSite/pull/198), stacked on197/196 | `551e669f45ef06ceee9e875cc4ac220ef2b75b9d` | Both current-head CI test jobs passed:2,057 units/137 files and735 main browser cases each, without retries. All11 workerd groups passed; Pages deployments skipped. No merge to auto-publishing main. |
| Native [422](https://github.com/rupret007/webjam/pull/422), merged | `8b5a37fddb99ac3b72ad88952eb1321e23b5ea65` | All six required checks passed. All559 Python modules ran once:12,887 passed/60 skipped. This does not qualify a new package or actual music. |
| Browser ownership draft [423](https://github.com/rupret007/webjam/pull/423) | `01ffdc8b1162dc5ee511de567a86705f305559b6` | 25 local Node tests;28 focused browser cases without retries. Actual Linux Web Join CI passed34 cases; full native test job still running. |
| Native lifecycle draft [424](https://github.com/rupret007/webjam/pull/424) | `8c3dd2c7819b991d75e21ae4356e0e263e7e4641` | 31 focused tests plus2 subtests,159 existing launch/recovery/RPC cases in eight fresh interpreters, Ruff passed. New current-head CI remains required. |

[Website198 CI qualification](../pr-assets/beta-collaboration/20261104/private-guest-journeys/website-ci.json)
binds merge checkout `ba1ba5ae2ed6b39f950c7bfb7deebba7bf320f5e` and reviewed
head551e669 to whole tree `78c2b68ac335a8ef1b68a537e106cd7724bc06c0`.
Each test job also ran separate34/34 root/project-path browser checks; those
overlap and must not be summed. No failure/flaky/retry markers were found.
All11 actual local workerd/SQLite groups passed, including the explicit eighth
provider-start mode. Its callback-only boundary made zero provider network
requests; it does not qualify provider activation or hosted capacity.

PR423's actual CI checkout `17698bd0cc2b48d9657f9d2fad4fa5ebdb650e3c`
and reviewed head share whole tree `d1f1fe6559d9931d57a460dfc913de753122c1ca`.
Its Web Join log SHA256 is
`2d15cae929a45c13a87cc1da7e024a110ded897a455042d12be79d1cdae5a82d`.
This Linux integration proof remains separate from actual devices/provider use.

The website still imports native176103a, not PR423. Repin its finite runtime
files and provenance together after upstream qualification, then qualify that
new website tree. Do not silently combine source/package/deployment identities.
The earlier Cursor193/417 branches remain intact; newer imports supersede their
overlapping browser assets. The pure193 expiry diagnostics were carried into198.

## Actual hosted guest journeys

[Sanitized receipt](../pr-assets/beta-collaboration/20261104/private-guest-journeys/receipt.json).
Both runs used normal invitation admission from an owner-only local note and
isolated synthetic guest/fan browser contexts. No invitation, cookies, staff
session or raw message content is included in this receipt.

- At03:48UTC, three independent Chromium guests exchanged lobby and ordinary
  guest-channel messages. The fresh guest saw no pre-join text but received
  post-join text. An uninvited context received401. No capture was requested.
  Logout cleanup requests were attempted, but statuses were not asserted.
- At04:16UTC, separate Chromium375px and WebKit390px guests created/joined one
  unique art room. Accepted incoming stroke events and changed counterpart
  canvas pixels established drawing both ways. Neither page overflowed; input
  and Send remained visible. Both left the room, then each logout returned200
  and its next state request returned401. No capture was requested.

These observations qualify the existing private service at their timestamps.
Its Worker/source identity was not freshly re-read. The older source4ed1525 /
Worker a9724702 observation is historical; neither run establishes delivery of
551e669,01ffdc8 or8c3dd2c. No new report or staff action was performed.

## Reproduced and corrected defects

PR423 fences delayed enrollment/status/error/latency and initial resume
completions to their originating attempt. An old stream cannot stop a new
capture; stats arriving after close cannot tune the retired receiver. Six
browser ownership cases and one Node regression failed before correction.
Original red/intermediate logs are retained. The WebKit test fixture now starts
the native context normally while delaying JS completion, preserving its full
close assertion. Check microphone/Join permission copy is corrected upstream.

PR424 fixes a production property/method mismatch hidden by its original test
fixture. Stop/new launch/rebind retire observations, policy streaks and old
callbacks; entered writes drain, exact source identities are checked, profile
switches cannot redirect writes, and runtime overrides remain authoritative.
File/format errors disable optional tuning for that launch. Follow-up regressions
also reproduced target reuse after audio disconnect; that target now requires
explicit rebind and malformed numeric pings are rejected.

[Jamulus3.12.2's API](https://github.com/jamulussoftware/jamulus/blob/r3_12_2/docs/JSON-RPC.md)
includes the address for server-info pings and provides no live buffer setter.
Accept only the launched direct numeric target. Directory/hostname/loopback
sidecar pings do not prove WAN audio delay. Readings expire after8 seconds and
become unknown on disconnection/identity change. Saved frame recommendations
are not live settings. Server-jitter ingestion still has no production caller;
per-remote-player and actual audible delay remain unqualified.

## Next required work

1. Qualify current-head native423/424 CI; retain qualified website198 evidence and original failures
   and skipped/physical scopes. Do not restart live jobs because polling times out.
2. Repin the qualified browser runtime into one website candidate; verify finite
   packaging/provenance, mic denial, capture cleanup, Retry and phone recovery.
3. Hand the qualified private candidate/build/config/rollback request to the
   infrastructure owner. Establish actual shared billing-period headroom,
   intended separate web TURN credentials and exact origins through normal trust.
   Leave AI and separate Hang Out media TURN off. Existing permission covers one
   native host/browser guest at a time, no more than10 minutes per reviewed trial.
4. Obtain ordinary device access/headphone/capture readiness. The Intel MacBook
   was offline at04:19UTC; Windows NucBox_K6 was online but device choice remains
   unanswered. Do not interfere with its StoryPool services. Execute reciprocal
   ARM/Intel/Windows audio and a separate-network pair; preserve Linux scope.
5. Retain actual-site entry/badges, registered-room recovery, human moderator
   review, accessibility and staging/capacity/legal gaps from the full62-row audit.
   Jeff alone disposes report289035. Earlier reports do not complete that check.

Frozen private packages remain sourcebf24e7d/run41193954131; no newer physical
music/build qualification is claimed. Windows remains unsigned and its native
remote path cannot bypass policy. No purchases or signing signup. Original
failed eight-hour observation remains FAILED; corrected predicates are not a
new eight-hour pass. Demo readiness requires observed chat and actual music.
