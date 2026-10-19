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
allocation and provider availability remain unknown. Independent external
alerts still need a provider and an agreed notification destination. A healthy
local probe cannot fill those gaps.
Record actual deployment and monitor evidence in the
[readiness assessment](HANGOUT_BETA_READINESS.md). Session coverage and human
device checks are in the [first-session plan](HANGOUT_BETA_FIRST_SESSION.md).
