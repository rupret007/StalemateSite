# Native application source and remaining demo proof

Evidence recorded October 31, 2026; resource and branch-run observations are
stamped 07:19–07:32 UTC. Application work proceeds here directly,
without StoryPool/Karen routing. Shared StoryPool services, installed checkouts,
configuration, locks and operational files remain outside this workstream.

## Qualified application source

[WebJam PR #409](https://github.com/rupret007/webjam/pull/409) merged as
`bb40fac7fcaa032c2f19cf9af8c49ac4276d3cf1`. It includes the existing verifier,
Windows ACL/directory protection, native diagnostic and accurate Music guidance
from PRs #401, #403, #404 and #405, plus the current launcher guard and accessibility fix.
Original branches and failure evidence remain. GitHub marked #401 merged through
its incorporated ancestry; #403, #404 and #405 were closed as superseded, without changing
their old external statuses.

The reviewed `4734e04` head, actual CI checkout `2b085ce` and merged `bb40fac` share tree
`9f6af28b1429a71f011bf82af7dea25327613a70`. The complete tracked-module loop
invoked all 553 modules once: **12,760 passed, 60 skipped, zero failures/errors/
xfails/deselections**. All 16 applicable application checks passed. Signing,
public-release and manual hardware jobs remained skipped. See the
[source and CI receipt](../pr-assets/beta-collaboration/20261031/native409-source-ci-receipt.json).

Actual Windows CI on build 26100 / CPython 3.11.9 AMD64 passed all eight ACL/API/
owned-Python-process cases, all four directory-sharing controls and three
PowerShell smoke-exit scenarios. The eight cases have exact collection,
setup/call/teardown and JUnit proof with no failures/skips or API mocks. Native
working-tree hashes match the exact Windows CRLF rendering of the reviewed Git
blobs and stayed unchanged. Existing ACLs were not repaired. These are CI
controls, separate from Jeff's Windows PC, installation, signing and music.

## Matching packages and resource admission

The most recent completed four-target package cohort remains source `83d2950`,
described in the [package receipt](HANGOUT_NATIVE_CANDIDATE_20261031.md). Its ARM
archive, architecture, signature and production transport lifecycle passed.
Its normal launcher refused malformed Join safely but omitted the useful
explanation from the macOS accessibility tree. The
[original observation and qualified PR408 fix](HANGOUT_NATIVE_ACCESSIBILITY_20261031.md)
remain distinct; no fixed frozen-app AX result is claimed yet.

The matching `bb40fac` test branch is
`codex/private-music-test-bb40fac-20261031`. The 07:19 UTC dispatch attempt was
refused **before the CLI started**, at 81.95% swap. At 07:31 the read-only snapshot
still failed admission: load 8.49, swap 81.36%, disk 14.92 GiB. The 07:32 actual branch
run listing contained no workflow-dispatch run. Preserve these observations.
Check current runs before one admitted dispatch; do not start another if a
matching run already exists. The proposed cohort keeps signing, purchases,
provider activation and public publication disabled.

Keep the existing admission limits: load1 < 10, swap < 80%, free disk ≥ 15 GiB. Do not
lower them or stop unrelated processes. Only an unused extracted source83 test
app was retired after verifying its original archive, no active process and no
changed files. The original archive and every result remain. A read-only disk
image can avoid expanding another app copy when admission permits it; retain
normal checksum/signature checks and never remove quarantine or re-sign it.

## Required evidence still outstanding

- Qualify the matching ARM/Intel/Windows/Linux packages, production transport
  and actual fixed macOS accessibility behavior. Package builds and Qt CI are
  separate proof.
- Bring the Intel MacBook online/awake through approved access, and establish
  the existing Windows desktop connection. At 06:51 the MacBook was offline;
  Windows/WSL were online. Earlier temporary test keys were removed. Do not
  recover private credentials or invent an access path.
- Demonstrate actual two-way ARM/Intel/Windows music, retain Linux, exercise
  interruption/Stop/leave and preserve capture consent. Native Music hosting is
  Mac-only. Frozen Windows remote transport still requires a valid signature;
  unsigned availability or same-LAN success does not qualify that remote path.
  Follow the [music acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md).
- Jeff alone must review the one current synthetic report,
  “Beta acceptance report test only October thirty 289035.” Its message ID is
  `mmvvvpwcp1`; reporting received a real server acknowledgement. Leave other
  reports unchanged. No automated dismissal substitutes for human review.
- Observe the existing natural eight-hour expiry. The one admitted guest's
  deadline is 12:08:30.618 UTC / 07:08 CDT. Keep private website source `96f356a` / runtime
  `6293386f-31b8-4415-bf0b-f81296190a4d`, assets, settings and keys unchanged
  until its terminal receipt. A heartbeat is not a pass; ending deployment
  identity and actual expiry/revocation/cleanup results are required. Preserve
  the older failed run and the unchanged reconnect budgets.

The website's actual hosted chat, room, Jam invitation, drawing, reload,
revocation and mobile observations remain in the
[private release receipt](HANGOUT_PRIVATE_DEMO_20261030.md). All
[62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain intact.
Physical music and unperformed accessibility/capacity/legal/public-launch
requirements remain explicit. AI, TURN/vault, existing age/camera/consent and
platform-trust/public-release holds are unchanged.
