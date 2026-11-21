# Website Web Join integration candidate

The website now includes `/join/`, the static browser client used by WebJam's
compiled invitation address. Its source is pinned in
[`join/PROVENANCE.json`](../join/PROVENANCE.json) to WebJam commit
`5dde45d2e841fd19ff9c1fd055f88520fbf778e4` and
[PR452](https://github.com/rupret007/webjam/pull/452), which depends on
[PR451](https://github.com/rupret007/webjam/pull/451). Both reviewed upstream heads have passed normal CI and merged: PR451 as
`bcc1554` and PR452 as `25806b6`. PR452's merged whole tree equals its pinned
reviewed head. This website candidate still requires its own exact-head CI. It retains the
interrupted-Join recovery, cancellation, relay-cap guidance and access countdown.
The cleanup helper awaits audio suspension before closing the context, with
a bounded acknowledgement wait. Failed microphone checks also release their
capture/meter and context before an explicit retry starts a fresh check. Only
`app.js` and `audio.js` change at runtime.
The MIT license is shipped with the client.
All thirteen imported files, including the noindex page, are copied unchanged;
the manifest records both source and shipped hashes. No dependency installer,
test harness, provider key or generated invitation is part of the page.

The Pages and private-beta artifact builders include the client. The older
synthetic-pilot builder continues to exclude Web Join. In the protected beta, every client
asset still requires the existing guest invitation session. Web Join receives
its own strict CSP and microphone-only permissions policy, without the chat
bootstrap or analytics. Its endpoint permission is not added to ordinary chat
pages. Public hosting must apply the client's `_headers` equivalents; GitHub
Pages does not itself interpret Cloudflare's `_headers` file.

This prepares application assets; it does not deploy them. The actual private
environment remains source `d8c08fb88b94429f03d13d9beaf01d8ffd301e1a`, Worker
version `c2271048-aaa3-4649-8e9e-48dd46212da5`, while its original real eight-hour
expiry observation runs. Keep that observation and the live origin/settings
unchanged. Private testing has its existing scoped authorization; public sites
and public browser-music activation remain held. Staged native source `76b1fd7`
is unchanged. Earlier hosted results do not qualify this new import.

## Deployment-owner handoff

Jeff's October30 clarification keeps application code, project CI, tests, docs
and application PRs in this workstream without StoryPool/Karen admission.
Shared StoryPool core, services, configuration and operational state remain
outside this work. Provider, native-trust and public-release holds remain.
Before activating:

- Review the pinned WebJam source, this application PR and their exact heads.
- Confirm the intended page origin and native host's compiled invite address.
  A private-beta domain and `https://stalemate.band/join/` are different origins;
  do not assume an invitation opens the private beta or that its guest cookie
  transfers between those domains.
- Qualify the existing WebJam relay's exact-origin CORS, web-client credential
  scope, separate quota and host codec/bridge. An older relay fails closed.
  Preserve the existing private-trial spending and activation bounds; no vault
  values belong in this repo and this import authorizes no new activation.
- Apply the required HTTP headers on the selected host, verify real invitation
  admission, then explicitly configure the lobby's allowed browser-join origin.
- Record actual Mac-host/browser-guest playback, consent, host kick, expiry,
  network failure and recovery. Local synthetic audio and provider fixtures do
  not establish WAN timing, physical iPhone behavior or TURN reachability.

Use WebJam's [canonical creator guide](https://github.com/rupret007/webjam/blob/5dde45d2e841fd19ff9c1fd055f88520fbf778e4/USER_GUIDE.md)
and [Web Join protocol guide](https://github.com/rupret007/webjam/blob/5dde45d2e841fd19ff9c1fd055f88520fbf778e4/docs/web-join.md)
for the existing host/guest workflow. Browser joining is a separate higher-delay
option; it does not satisfy the remaining native Windows/Linux/Mac acceptance.

## Generated-media cleanup qualification

The [source-bound evidence packet](../pr-assets/beta-collaboration/20261107/web-join-mic-cleanup/receipt.json)
records 40 units and 24 focused browser cases on each of Intel macOS WebKit,
Apple Silicon macOS WebKit and Windows installed Chrome. It includes the original denied-input failure, exact
source and report hashes, and independent owned-process cleanup. The current
upstream browser CI passed 57 cases and its actual checkout whole tree matched
the proposed head. All three upstream application CI workflows passed; ordinary
CI does not qualify physical music or a new native-provider CI mode.

These checks use generated media, omit the unused Go bridge in device probes,
and open no physical microphone or live provider session. They do not qualify
physical speech/music, Shared Track, Webex, physical Safari/system resources,
or a new private deployment. The staged native packages are unchanged.
Both normal website CI runs at `6690913` passed and their complete logs were
reviewed: each passed 2,074 units, 813 browser cases and 34+34 local deployment
checks, with public Pages deployment skipped. Those runs cover the earlier
PR451 import. This combined PR452 import requires new exact-head website CI
before merge.
