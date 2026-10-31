# Private demo: October 31 application evidence

This work is owned directly in the application session. It does not route
application changes through StoryPool/Karen or modify shared services,
checkouts, locks or operational state. Existing GitHub protections and all
[62 requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain in force.

## What changed

The native host now uses a bounded, build-bound first-party destination for
browser invitations. A private-beta package selects the protected community;
public packages retain their established first-party page. Runtime URL and
user-environment overrides cannot choose another destination. Invalid, missing,
symlinked or wrong-build metadata fails before bridge/capability allocation.
This changes the invitation page only, not transport selection or permission.

[Native PR410](https://github.com/rupret007/webjam/pull/410) merged as
`bf24e7d4769aa8ef8ce1300ccacc7d1fe9b2fc35`. Its reviewed head
`7faf4edd6943eb87cb98b0381e25cb37f8c063e5`, actual CI checkout
`619a32f1d947a9f73beef4d79580c5915b903665` and merged source have the same tree,
`1c04fb436337987cca75054be54d3695db0db194`. The main CI ran all 555 tracked
modules once, in order: 12,796 passed, 60 skipped. All 16 applicable checks passed.
The earlier workflow-size and release-assertion failures remain preserved.

Exactly one matching [private package run 41193954131](https://github.com/rupret007/webjam/actions/runs/41193954131)
completed successfully on that merged source. ARM Mac, Intel Mac, Windows and
Linux builders each passed their actual bundled Web Join target verification.
The run has 16 successful jobs and six expected skips. Signing, publication,
one-hour and unapproved-headless inputs stayed off. Four unexpired artifacts
are pinned by ID, exact size and SHA256 in the accompanying sanitized receipt.
Do not dispatch another unchanged build.

The ARM archive downloaded with the published digest and passed ZIP integrity.
It has not yet been extracted, mounted, installed or exercised as the new frozen
GUI. A successful package build is not proof of physical music. The existing
bb40 package/GUI observation remains valid for that older public-target source.

## Native zoom correction

[Website PR178](https://github.com/rupret007/StalemateSite/pull/178) fixes a real
400% composer-clipping defect when a rejected-message copy is retained. The
implementation at `80a1a5d` passed 1,869 units and 438 browser cases, including
two new real-socket short-screen cases. Both focused cases also passed locally
with one worker and retries disabled. A separate native Chrome Guest journey
confirmed actual 400% and 200% zoom: the complete input and Send stayed visible,
Tab/Space delivered a normal message, and the rejected copy remained saved.
Before/after captures and exact source hashes are committed. See the
[native-browser-zoom note](HANGOUT_NATIVE_BROWSER_ZOOM_20261031.md) for failure
history and proof boundaries. Final head `a56c2ff08b9a86ba3627b8fd787baef867630fa5` passed both required
CI workflows. PR178 merged as `4ed1525c84f48173077f506261cb5acd19e3c1dc`;
reviewed and merged trees match. The fix is not yet deployed.

## Real eight-hour expiry: observed behavior and failed observer

One normally admitted guest ran from 04:08:30 UTC with actual natural expiry at
12:08:30.618 UTC. The original observer ended FAILED at 12:10:01.073 UTC with
`natural-expiry-socket-observation-timeout`. Its original script and failed
receipt are unchanged. No clock/TTL change, re-admission or manual reconnect was
used, and no media, chat or report was sent by this run.

The terminal receipt records the current private socket closing 4401 at +26ms
and the late same-session lobby socket closing 4401 at +47,429ms. Both are within
the original 90-second allowance. Private-room state ended and hid the room;
lobby state became `ended` with no replacement attempt. Expired state/asset HTTP
requests and the original expired token were denied 401. Owned browser and
idle-sleep helper cleanup completed.

The observer's completion predicate incorrectly required lobby state `offline`.
The exact deployed source handles 4401 with `endSession()` and finishes in state
`ended`. This mismatch explains the timeout; a separate diagnostic records the
actually observed criteria. It does not relabel the original automated run PASS
or claim a newly corrected observer has run. A future helper copy corrects the
state expectation and has not been executed.

Normal post-expiry Cloudflare reads at 12:23–12:25 UTC confirmed the latest
100%-traffic deployment still uses `6293386f-31b8-4415-bf0b-f81296190a4d`, source
`96f356a6f2a9af4bbd2834bb94f1e5df81d200dd`. The immutable version has the same
17 plain variables and five Durable Object bindings. No secret value was read.
The earlier 10500 read error is retained separately; its later read succeeded.

## Remaining work in dependency order

1. The website fix is merged. Qualify its separate private application
   deployment when resource guards admit it. The private deployment remains
   source96; source/CI/native zoom do not substitute for a new hosted observation.
2. Resume normal package inspection only when resource guards admit it. The
   ARM download was admitted with 16.29 GiB free and 15.87 GiB projected; later
   disk headroom fell below 15 GiB. No extraction was started. A read-only DMG
   inspection can avoid another expanded app copy; preserve signature and
   quarantine behavior, and verify the exact mounted source and target.
3. Preserve AI, TURN/vault, native-trust, purchases/signing and public-release
   holds. The browser issuer lacks its separate browser-scoped credentials and
   exact origins; an advertised link or same-Wi-Fi connection does not solve it.
   The normal frozen app does not expose the documented version 2 LAN route.
   Unsigned Windows is not a signed native remote-transport pass.
4. Finish actual two-way music with ARM Mini, Intel MacBook Pro and Windows
   through an approved path; retain Linux. Record devices, builds, networks,
   consent, usable audio, errors and Stop/leave. Synthetic checks, package
   verification and same-machine echo do not satisfy this requirement.
5. Jeff's authorized disposition of the current benign report remains separate
   from automated acknowledgement. Keep other reports untouched. Continue
   remaining acceptance, legal, accessibility and capacity evidence and the
   receiving-site integration handoff without reducing the original outcomes.

The community remains private. No public launch, paid service, credential
activation or broad security-policy change occurred in this application work.

[Sanitized source/artifact/expiry receipt](../pr-assets/beta-collaboration/20261031/private-demo-progress/receipt.json)
retains the exact package identities and limited observed expiry criteria.
