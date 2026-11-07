# Website Web Join integration candidate

The website now includes `/join/`, the static browser client used by WebJam's
compiled invitation address. Its source is pinned in
[`join/PROVENANCE.json`](../join/PROVENANCE.json) to WebJam commit
`f5c53f37c2099dc2ea8213815e67e37ea73c83bb` and
[PR451](https://github.com/rupret007/webjam/pull/451). Upstream exact-head CI and
review remain required before advancing this prepared import. It retains the
interrupted-Join recovery, cancellation, relay-cap guidance and access countdown.
The new cleanup helper awaits audio suspension before closing the context, with
a bounded acknowledgement wait. Only `app.js` and `audio.js` change at runtime.
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

Use WebJam's [canonical creator guide](https://github.com/rupret007/webjam/blob/f5c53f37c2099dc2ea8213815e67e37ea73c83bb/USER_GUIDE.md)
and [Web Join protocol guide](https://github.com/rupret007/webjam/blob/f5c53f37c2099dc2ea8213815e67e37ea73c83bb/docs/web-join.md)
for the existing host/guest workflow. Browser joining is a separate higher-delay
option; it does not satisfy the remaining native Windows/Linux/Mac acceptance.
