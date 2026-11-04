# Host tools: ownership metadata arriving after the dialog opens

Website200's source0f236aa completed both CI jobs with SUCCESS status, but
job126392334561 retained one flaky browser case:758 passed and the returning
owner/co-host revocation case passed only on its automatic retry. Its initial
failure screenshot shows the Host tools dialog without the named offline
co-host removal action. The other job126392352414 passed759 cases cleanly.
Neither result is evidence of deployed source or actual music.

The client cached `ownership` metadata but built named co-host buttons only
when opening the dialog. The server sends the room snapshot before ownership
details, so opening Host tools in that interval omitted the action indefinitely.

A deterministic Chromium regression now proxies the real local WebSocket and
holds the ownership frame plus subsequent frames in wire order. It opens Host
tools after the room snapshot, releases metadata, and requires the named action
to appear while the focused Invite guest button remains focused. On the old
client this failed at the missing action, independently of the original CI
cleanup timeout. Original screenshots, retry archive and red logs are retained.

The fix reconciles only named co-host buttons by account identity in the open
Host tools dialog. Existing commands and surviving named buttons keep their DOM
identity/focus. Removing a focused action returns focus inside the dialog.
Current connection, owner authority, active room and room-instance nonce must
match both when rendering and when sending. Ownership loss, room replacement
or disconnect retires named actions; retained detached references cannot send.
Ordinary slash-command palettes never acquire these actions. Server permissions
and the wire protocol are unchanged.

Four new client checks failed before correction. The complete137-file local
unit suite now passes2,061 cases. All eight local Chromium/WebKit community
moderation journeys pass without retries, including actual co-host revocation,
reports and cross-entry restrictions through the loopback identity fixture.
That fixture is not real Cloudflare Access/email delivery or hosted moderation.
The WebKit project now explicitly includes this existing moderation file.

Phone captures and sanitized log/hash receipts are under
[`owner-tools-metadata`](../pr-assets/beta-collaboration/20261104/owner-tools-metadata/receipt.json).
Own website current-head CI remains required. No private deployment, provider
activation, native package, public-navigation or release change was performed.

The old165-file runtime-equivalence receipt compares551e669 with0f236aa only.
In201 only browser `lobby.js` differs in that broad inventory; the other164
records and all native/backend execution inputs remain identical. The broad
inventory included all `r/**`; it is not the native bundle catalogue.
`NATIVE_LOBBY_INPUTS` and the native fixtures do not import browser `lobby.js`.
The runtime workflow's configured filter excludes this UI-only path. This
finding requires no extra workflow approval, YAML change or forced run.
Qualify the changed browser UI in201's own frontend CI and retain551's actual
11-mode backend/runtime evidence at its original source/input scope. Source
equivalence is not a new201 runtime/provider/deployment execution claim.

The earlier handoff incorrectly called this an additional workflow dependency.
The correction was delivered to the existing infrastructure owner; that owner
still owns actual builds, provider configuration and private delivery.

Continue from the [current demo checklist](HANGOUT_PRIVATE_DEMO_PROGRESS_20261104.md).
All62 requirements, original failed observer evidence and actual physical-music
requirements remain intact.
