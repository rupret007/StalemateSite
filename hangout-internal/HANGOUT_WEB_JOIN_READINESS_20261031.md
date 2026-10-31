# Browser music destination and remaining prerequisites

Recorded October 31, 2026. This is application engineering and a receiving-session
handoff, not permission to activate providers or launch publicly. Application
work proceeds directly here, without StoryPool/Karen admission. Preserve shared
StoryPool checkouts, services, configuration, locks and operational files.

## Exact source and proof boundaries

| Component | Actual observation | Limit |
| --- | --- | --- |
| Qualified native package cohort | `bb40fac7fcaa032c2f19cf9af8c49ac4276d3cf1`, run41181580413; all four desktop builds passed | Actual ARM archive/transport/Join accessibility proof is separate from physical music; see the [package receipt](HANGOUT_NATIVE_PACKAGE_BB40_20261031.md) |
| New application routing candidate | [WebJam PR410](https://github.com/rupret007/webjam/pull/410), current pushed head `7faf4edd6943eb87cb98b0381e25cb37f8c063e5`, tree `1c04fb436337987cca75054be54d3695db0db194` | Current-head full CI, merge and a matching private-beta package remain to qualify; bb40 packages do not contain this feature |
| Private community | Source `96f356a6f2a9af4bbd2834bb94f1e5df81d200dd`, runtime `6293386f-31b8-4415-bf0b-f81296190a4d` | Hosted chat/drawing proof does not qualify hosted Web Join or audio |
| TURN issuer | Normal read-only deployment/version queries at 08:50–08:51 UTC observed version `e7cda1bb-be95-4824-a363-924ff6f2948b`, created October16 | No credentials were read or minted; deployment/configuration remained unchanged |

PR410 replaces the native host's fixed public browser page with two build-time
identifiers: `public` and `private-beta`. The latter selects the protected
shared-community `/join/` page. The host still produces the complete encrypted
invitation; do not edit its URL or fragment. Guests first enter the private
community in the same browser. A source checkout keeps the public default.

Frozen packages require a bounded canonical manifest bound to their exact
source build. Runtime URL/environment overrides are ignored, and invalid or
missing metadata fails before bridge/process/capability allocation. Every
platform builder verifies its actual bundled document. Private-beta tag builds
and release publication are refused. The change does not alter native host
selection, platform signatures, audio consent, authority, Stop or the provider.
Use the source PR's creator guide and release runbook for canonical instructions.

Preserve the earlier failure: head426e6d4's main job in
[run41190083283](https://github.com/rupret007/webjam/actions/runs/41190083283)
stopped at the existing workflow-size guard: 20,801 UTF-16 units exceeded its
20,500 safety limit. Head6241b47 separates bundle creation/verification from
packaging; it does not raise that limit or remove an assertion. Its
[PR run41191002007](https://github.com/rupret007/webjam/actions/runs/41191002007)
then failed the old exact release-condition assertion. Head7faf4ed updates both
existing installer/Mac release contracts to require every earlier condition
plus the new private-target exclusion. Require its own complete current-head
CI; neither failed event qualifies the final source.

At10:13–10:14 UTC fresh guards admitted seven focused modules in separate
interpreters. Their tested inputs match the committed candidate: **190 passed**
(31 destination,42 host,3 target workflow,54 workflow limits,33 installer,
20 Mac release policy and7 build-info cases); changed-source Ruff passed.
The separate packaged-data attempt passed18 cases and failed one because the
minimal local environment lacks PySide6. Preserve that failure; no dependency
or test was bypassed. Full application CI supplies the required Qt environment.
These focused results do not qualify an actual new package or physical music.

## Why neither same Wi-Fi nor unsigned Windows closes the gap

The sourcebb40 audit found that the ordinary packaged host with its sidecar
selects `direct-stun`. Its normal launcher does not expose a separate packaged
version2 LAN selector. The documented LAN protocol accepts only RFC1918 hosts;
Tailscale administration at100.x does not make that address eligible. A LAN
procedure in a document is not proof that the current frozen app offers it.
Do not remove the sidecar, source-run the test, fake a platform/frozen flag or
rewrite an invitation to manufacture an available route.

Frozen Windows remote transport still requires a valid platform signature.
The current Windows testing package is unsigned. PR410 does not change that
policy. A browser path may eventually support the physical Windows demo after
its own prerequisites pass; no certificate purchase or new signing account is
authorized. Browser delay and live ensemble usability require measurement.

The existing browser policy requires browser-scoped TURN issuance even for
direct ICE and excludes private, loopback and Tailscale candidates. Merely
putting both devices on Wi-Fi does not bypass that issuer requirement.

## Ordered work before real browser music

1. Qualify PR410's current source, CI and normal merge. Then admit one matching
   four-target private-beta package run. Verify actual bundled target/source,
   archive hashes, existing platform trust and normal app behavior; retain
   failures. Do not relabel an old public-target package as the new candidate.
2. Keep the current private website source, assets, settings and keys frozen
   until the original eight-hour observer is terminal. Its natural expiry is
   12:08:30.618 UTC / 07:08 CDT. At10:04 UTC it was still running, with zero page
   errors; that is not a pass. Require the ending deployment identity and
   actual expiry/replay/socket/cleanup results. Preserve reconnect budgets.
3. Review the actual protected page and exact browser Origin with the matching
   issuer source. The read-only issuer inventory had desktop key bindings but
   no `WEB_TURN_KEY_ID`, `WEB_TURN_KEY_API_TOKEN` or `CORS_ALLOWED_ORIGINS` binding.
   The private beta still has `HANGOUT_TURN_ENABLED=0` and empty
   `WEBJAM_WEB_ORIGINS`. The source supports protected `/join/` assets; this is
   not a live provider test. Do not enable those settings as a shortcut.
4. Prepare a concrete provider/configuration review for the owner. The existing
   goal explicitly holds TURN/vault activation. Only an explicit owner decision
   releases that hold. Jeff unlocks his own vault through the approved flow;
   never guess passwords, scrape caches, print values or copy secrets into PRs.
   Keep separate web credentials, exact CORS, durable quotas, combined desktop/web
   limits and existing namespaces. Source admission limits alone do not establish
   account entitlement, account-wide usage or a hard spending guarantee.
5. Once authorized and configured, prove exact-origin denial, protected-page
   admission, sealed signaling, actual expiry/revocation, forced relay and Stop
   with sanitized logs. Then use actual ARM Mini, Intel MacBook and Windows
   clients with explicit capture consent and headphones. Demonstrate reciprocal
   audible music, interruption and clean Stop/leave, recording exact builds,
   networks and limitations. CI, meters, packet flow, synthetic audio alone or
   same-machine echo do not qualify the physical music outcome. Retain Linux.

The primary acceptance procedure remains
[Music demo acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md). All
[62 original requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain intact.
AI, age/camera/consent safeguards, native trust, purchases and public-release
holds are unchanged. No provider activation or physical music is claimed here.
