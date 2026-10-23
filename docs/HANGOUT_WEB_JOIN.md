# Website Web Join integration candidate

The website now includes `/join/`, the static browser client used by WebJam's
compiled invitation address. Its source is pinned in
[`join/PROVENANCE.json`](../join/PROVENANCE.json) to WebJam commit
`07a509b475c44f704af55fbe1a1f010a49e653bf` and
[PR398](https://github.com/rupret007/webjam/pull/398). That source contains the
interrupted-Join recovery and delayed-playback cancellation fixes. The MIT license is shipped with the client.
Every runtime file is copied unchanged except for the page's noindex metadata;
the manifest records both source and shipped hashes. No dependency installer,
test harness, provider key or generated invitation is part of the page.

The Pages and private-beta artifact builders include the client. The older
synthetic-pilot builder continues to exclude Web Join. In the protected beta, every client
asset still requires the existing guest invitation session. Web Join receives
its own strict CSP and microphone-only permissions policy, without the chat
bootstrap or analytics. Its endpoint permission is not added to ordinary chat
pages. Public hosting must apply the client's `_headers` equivalents; GitHub
Pages does not itself interpret Cloudflare's `_headers` file.

This prepares application assets; it does not enable or deploy browser music.
The lobby's Web Join origin allowlist stays empty. Native desktop invitations
and their complete-message copy/paste route remain unchanged.

## Deployment-owner handoff

StoryPool 10-21-26 owns review coordination and deployment. Before activating:

- Review the pinned WebJam source, this application PR and their exact heads.
- Confirm the intended page origin and native host's compiled invite address.
  A private-beta domain and `https://stalemate.band/join/` are different origins;
  do not assume an invitation opens the private beta or that its guest cookie
  transfers between those domains.
- Qualify the existing WebJam relay's exact-origin CORS, web-client credential
  scope, separate quota and host codec/bridge. An older relay fails closed.
  The paused TURN/vault work stays paused; no values are required in this repo.
- Apply the required HTTP headers on the selected host, verify real invitation
  admission, then explicitly configure the lobby's allowed browser-join origin.
- Record actual Mac-host/browser-guest playback, consent, host kick, expiry,
  network failure and recovery. Local synthetic audio and provider fixtures do
  not establish WAN timing, physical iPhone behavior or TURN reachability.

Use WebJam's [canonical creator guide](https://github.com/rupret007/webjam/blob/07a509b475c44f704af55fbe1a1f010a49e653bf/USER_GUIDE.md)
and [Web Join protocol guide](https://github.com/rupret007/webjam/blob/07a509b475c44f704af55fbe1a1f010a49e653bf/docs/web-join.md)
for the existing host/guest workflow. Browser joining is a separate higher-delay
option; it does not satisfy the remaining native Windows/Linux/Mac acceptance.
