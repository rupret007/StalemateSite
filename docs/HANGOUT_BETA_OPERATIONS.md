# Private beta health checks

The operator monitor uses a dedicated read-only credential for
`GET /beta/health` on the separate beta Worker. It cannot admit a guest, create a
room, inspect conversations, or perform moderation. Keep its key separate from
invitations and outside source control. Missing or wrong credentials fail closed;
only the bearer header is accepted. Health responses are uncached and contain
fixed status labels, configuration booleans and aggregate application counters.

## What the check establishes

It checks that the gateway and the lobby, connection quota and session registry
can answer bounded reads. It reports admission pauses, saved lobby restrictions,
known storage degradation, missing identity/staff/contact configuration, and
available application allowances. Ordinary Durable Object wake/restore and
expiry housekeeping can run. The probe does not submit a report, create a
session, spend connection allowance, reset abuse limits, or execute an
administrative action.

Storage checks are read-only. A successful response does not establish that a
future report can be written. Email and AI providers are not called, TURN
traffic is not measured, and provider billing/availability are explicitly
unknown. Disabled AI/TURN is expected until their acceptance gates pass.

AI includes content-free `currentInstance` counters for completed, flagged,
failed, skipped and pending reviews. They come from the running adapter and
reset when the lobby instance restarts; they are not durable lifetime totals.
For deployment checks, allow a quiet interval (the hosted rehearsal used
15-second polls) and verify the effective lobby configuration before sending
test text. Gateway and Durable Object updates can temporarily differ;
[Cloudflare documents this deployment behavior](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates).

The separate daily `aiReviews` usage is durable and counts reserved attempts,
including failures. Observed review failures make enabled AI degraded and
produce an `ai-unavailable` monitor issue. A health read sends no text to the
provider, and a ready status does not establish future provider availability.
The monitor's own Worker/Object reads still count as provider operations.

The Mac LaunchAgent probes immediately and every five minutes. It notifies on
new failure/restriction states and recovery, and at 80% and 100% of known
application allowances. A stable warning is deduplicated. These thresholds
are not dollar budgets or provider spending caps.

## Local configuration and installation

The operator's default configuration is the owner-only file
`~/Library/Application Support/Stalemate/beta-monitor.json`. Its structure is
`{"version":1,"opsKey":"<private monitoring key>"}`; never use the beta invite
as that key. Provision the matching `HANGOUT_BETA_OPS_KEY` Worker secret through
the approved secret process. Never put its value in a command argument or plist.

From the repository root:

```sh
node scripts/install-beta-monitor.cjs plan
node scripts/beta-health-monitor.cjs dry-run
node scripts/beta-health-monitor.cjs test-alert
node scripts/install-beta-monitor.cjs install
node scripts/install-beta-monitor.cjs status
```

`plan` changes nothing. `dry-run` performs one protected read, prints sanitized
status and does not save state or notify. `test-alert` asks macOS to show one
labelled local test notification and makes no network request. OS submission
does not prove a person saw the banner; notification settings and Focus can
hide it.

The installer copies the monitor into the private Stalemate Application Support
directory, uses a stable Node path and creates only the current user's
`com.stalemate.beta-monitor` LaunchAgent. This avoids loading code from the
Documents folder under macOS background-process restrictions. Re-run `install`
after changing the monitor source. No system daemon or administrator privileges
are needed. Private state and structured `monitor.log` stay beside the copied
runtime. The structured log rotates at 1 MiB and retains one `.previous` file
(roughly 2 MiB plus the final bounded entries). The separate
`launchd.stdout.log` and `launchd.stderr.log` are private but do not rotate;
normal checks use `--quiet`, and reinstalling clears those two files. Inspect
their size and preserve any needed incident evidence before reinstalling.

The Mac must be awake, online and logged in. Sleeping/offline/logged-out periods
have no dependable alerts, and the local network can fail independently of the
site. This is not continuous external uptime coverage. The core Node script
can run manually on Windows/Linux with a private configuration; this installer
does not create their scheduled tasks or desktop notifications.

To stop scheduled checks:

```sh
node scripts/install-beta-monitor.cjs uninstall
```

This removes only the job/plist and preserves private configuration, runtime,
state and logs for review or reinstall. Revoke the dedicated Worker secret
separately if retiring the monitor; guest invitation and identity keys do not
need to change with it.

## Prepared independent GitHub check

The draft `.github/workflows/beta-health.yml` prepares a GitHub-hosted check
that does not depend on this Mac. It is **not active**. In this workflow, only
`main` with repository variable `STALEMATE_BETA_MONITOR_ENABLED` exactly `true`
can run the job; dispatching another branch skips it. Repository writers can
edit workflows and variables, so this condition is not a separate secret-access
boundary. Repository secret permissions still apply.

The schedule requests four checks per hour, at minutes 7, 22, 37 and 52, with a
two-minute job deadline. No dependency installation, guest login, AI/TURN call,
deployment, artifact upload or local monitor state is involved. The
adapter `scripts/beta-health-ci.cjs` uses the same fixed-origin, bounded,
read-only probe as the Mac monitor. A degraded response or an application
allowance warning at 80% or above fails the job, as do authentication, storage,
network and response-contract failures. Optional disabled AI/TURN remains
normal. Output contains one fixed status label and the provider/billing
limitation; it excludes response bodies, counters, selected evidence and
credentials. This repository's Actions run status and those fixed labels are
public. A setup failure or job timeout is a monitor failure, not proof of a
beta outage. The check never changes a saved safety restriction.

After required review and the original expiry observation's recorded terminal
result, activation still requires all of the following:

1. Publish the reviewed workflow on `main` through the repository's release
   process; this preparation does not authorize a merge or public launch.
2. Store the existing dedicated read-only health key as Actions repository
   secret `HANGOUT_BETA_OPS_KEY` through a private secret entry. Do not use an
   invitation, Access token, Cloudflare deployment token or session HMAC, and
   never put the key in an argument, workflow file, output or artifact. No
   Worker key rotation is needed to add this reader.
3. Configure the intended operator's GitHub Actions notification preferences,
   then set repository variable `STALEMATE_BETA_MONITOR_ENABLED=true`. Perform
   an attended manual dispatch on `main` and record actual probe results and
   failure/recovery notification delivery before relying on it.
4. To stop these checks, set the variable to `false` or disable this workflow.
   This leaves the beta, its invitation and local Mac monitor unchanged.

[GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
says scheduled runs use the default branch, can be delayed or dropped during
high load, and are disabled in public repositories after 60 days without
activity. Scheduled notifications depend on the schedule actor and their
notification settings. A completed job does not prove an operator received an
alert. This prepared check has no durable alert deduplication, retrying delivery
or independent missed-heartbeat detector; it is best-effort coverage, not a
continuous uptime service. Activation, actual scheduled execution and attended
notification acceptance remain unverified. Provider availability, billing and
the separate external alerting/coverage gate remain outstanding.

## Responding to an alert

First check this Mac's network, the last successful local probe and the active
deployment version. A rollback to code predating `/beta/health` can return
application HTTP 401 even when the monitor key is correct: that version routes
the unknown path through the guest gate. Confirm endpoint compatibility before
changing monitoring credentials. Restore a compatible operations release or
perform the handoff's invitation, guest-chat and staff checks independently
while health monitoring is unavailable. Do not rotate guest keys to repair an
ops alert. For a setup warning, use the
[identity guide](HANGOUT_BETA_IDENTITY.md) and confirmed staffing assignments.
For a service/storage or admission alert, follow the
[handoff recovery procedure](HANGOUT_BETA_HANDOFF.md) and preserve evidence.
Do not unlock a saved safety state just to turn the monitor green.

The separate read-only provider audit successfully queried account-wide TURN
analytics using local OAuth; no runtime analytics credential is configured and
this monitor does not query those metrics. Billing, SFU usage, remaining shared
allocation and provider availability remain unknown. The prepared GitHub check
is inactive and does not yet establish independent alert coverage or an agreed,
tested notification destination. A healthy local probe cannot fill those gaps.
Record actual deployment and monitor evidence in the
[readiness assessment](HANGOUT_BETA_READINESS.md). Session coverage and human
device checks are in the [first-session plan](HANGOUT_BETA_FIRST_SESSION.md).
