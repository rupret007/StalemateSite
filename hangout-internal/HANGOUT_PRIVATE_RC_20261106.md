# Private candidate delivery — November 6, 2026

**Historical checkpoint.** The [November 7 receipt](HANGOUT_PRIVATE_RC_20261107.md)
supersedes the current deployment and issuer identities below. Preserve these
earlier observations and failures with their original source/version scope.

The existing invitation-only beta now runs application source
`b61bb416d7af39d2fe3a41529ddd65520e5305ca` as Worker version
`75655a50-9e13-4966-bb68-22b45a230c1d`, deployment
`e01f4ed8-b966-42e8-bb50-631ef1a8f515` at 100%.
Its previous version, retained for rollback, is
`50c62fa6-676c-4c1a-888f-ae4ceb74a3be`.
Times in the receipts are UTC on November 7; this delivery was on November 6
in Texas. Documentation merge `0ee3edd` changes no runtime from this candidate.

Jeff explicitly reassigned application CI and delivery directly to this session.
The earlier StoryPool staging handoff was withdrawn to prevent duplicate work.
Tests and private delivery used the application tools and existing GitHub Actions.
StoryPool services and shared operational state were untouched.

The private address remains
<https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/>.
The existing invitation is still required and is absent from these artifacts.
Public band navigation and public launch remain unchanged.

## Source, configuration and served bytes

Website [CI 42322831939](https://github.com/rupret007/StalemateSite/actions/runs/42322831939)
and [CI 42322802308](https://github.com/rupret007/StalemateSite/actions/runs/42322802308)
passed. The tested PR head `36cf37f` and candidate `b61bb41` have the same whole
tree, `8507d85db2ed354ddfc1710f861c07d5d112063a`.
The current browser import is pinned separately to WebJam head `44116a7`,
merged as `6a19202`; its Worker, browser and native-repository CI passed.
This browser update adds selected-connection Direct/Relayed labels and specific
quota-exhaustion recovery. It does not change ICE policy or prove a live relay
session on this deployment.

The [preflight](../pr-assets/beta-collaboration/20261106/private-rc/preflight.json)
verified all 69 packaged asset hashes and reconciled the candidate with the
actual active private version before applying it. The approved
`WEBJAM_WEB_ORIGINS` value was explicitly preserved. Post-deployment checks
confirmed identical effective plain variables, secret binding names, Durable
Object namespace identities, compatibility date and flags. The beta remains
protected, AI remains off and Hang Out's separate chat/media TURN remains off.
No WebJam issuer, credential or quota setting was changed.

Authenticated hosted reads verified 13 served Web Join/lobby runtime payloads
against the candidate: JavaScript, styles and the unchanged Web Join HTML.
The lobby HTML is intentionally rewritten by the beta Worker to inject its
bootstrap and live relay/contact metadata; its raw asset digest is not claimed
as the digest of that dynamic response. The visible HTML was exercised by the
visitor journeys below.

## Actual private-service journeys

The [Chromium run](../pr-assets/beta-collaboration/20261106/private-rc/hosted-chromium.json)
passed all eleven recorded stages:

- Uninvited state/code access was denied. Two independent invited guests chose
  nicknames through the Stalemate and Rad Dad entrances and reached one lobby.
- The late guest saw no pre-join line. A real Rad Dad message displayed its
  arrival-site badge to the other guest.
- The thirteen hosted runtime payloads matched candidate bytes. At 375px and
  390px, page width stayed contained, input/Send stayed visible and the input
  font was 16px. The four engine/width screenshots were visually inspected.
- A deliberate local socket close/manual reconnect kept the unsent draft,
  cleared earlier transcript and received a new message after the existing
  three-second slow-mode allowance. This is not a physical network outage.
- Two guests created/joined an Art room and received a canvas stroke. The
  server accepted the room host's topic change and refused the ordinary guest.
- A Jam host invited the other guest and shared an inert browser destination
  on the approved origin. No Web Join link was opened or music session started.
- Logout revoked copied cookies, denied protected code and ended active guest
  pages. All cleanup logouts returned 200. Capture requests were zero.

The [WebKit run](../pr-assets/beta-collaboration/20261106/private-rc/hosted-webkit-stopped-at-room-limit.json)
passed the first nine stages, through drawing and room-host permissions. It
then stopped at Jam creation. Chromium had created two rooms and WebKit had
created a third; the unchanged service permits three new rooms per IP per hour.
The complete WebKit run remains **failed**, not relabeled as a full pass.
The subsequent full run below is separate evidence after the ordinary room
allowance became available again.

A separate [WebKit guard/revocation check](../pr-assets/beta-collaboration/20261106/private-rc/hosted-webkit-quota-and-logout.json)
confirmed the exact server explanation, “Too many new rooms from your connection
this hour.” The guest remained in the lobby, could return to chat, and could not
open an unauthorized Jam room. Actual logout then invalidated copied cookies,
denied protected code and ended the page. Capture requests were zero.
Neither room limits nor slow mode were relaxed for testing.

Measured local-machine browser setup after clicking the invitation button was
872/832ms in Chromium. Reconnect was 323ms in Chromium and 315ms in WebKit.
These are individual website observations, not music latency, cross-network
benchmarks, load capacity or service-level promises.

Earlier unsuccessful harness runs are retained in the
[attempt ledger](../pr-assets/beta-collaboration/20261106/private-rc/earlier-attempts.json).
They exposed an incorrect expected asset count, the dynamic-HTML digest
assumption and test messages sent inside the existing slow-mode window.
No production code changed to make these assertions pass.

## Subsequent verification — November 7 UTC

The candidate and private Worker version above stayed unchanged. After waiting
for the existing room-creation window, one guarded
[WebKit run](../pr-assets/beta-collaboration/20261107/private-rc-followup/hosted-webkit-completed.json)
passed all eleven stages at 04:12 UTC, including Jam invitation sharing and
copied-cookie revocation. It did not request a microphone or relay credentials.
Its 375/390px measurements again showed contained page/composer width and 16px
inputs. Setup samples were 2,777/886ms and manual reconnect was 306ms; these are
single website observations on one Mac. The earlier failed run remains retained.

A [bounded room workload](../pr-assets/beta-collaboration/20261107/private-rc-followup/room-workload-browser-entry.json)
then used normal browser invitation entry in nine independent Chromium contexts,
alternating Stalemate and Rad Dad. It reused the empty QA Art room identified by
the preceding run's synthetic topic, with ordinary guest permissions. No new
room, privileged identity or guard override was needed.

Eight guests exchanged four rounds of chat: 32 submitted messages and all 256
expected in-room deliveries, including the senders' echoes. There were 224 peer
delivery samples, with median 84ms, p95 118ms and maximum 118ms. These measure
automation submission through receipt in another browser context on one Mac and
one normal Internet connection. They include automation/rendering overhead and
do not establish music latency, multiple-household behavior, a service-level
target or a larger deployment capacity.

The ninth admitted guest was refused entry by the existing eight-person room
limit and remained in the lobby. All nine logouts returned 200; all nine later
state requests returned 401. Capture requests were zero. The test stayed below
the existing machine resource thresholds throughout.

The [first workload attempt](../pr-assets/beta-collaboration/20261107/private-rc-followup/room-workload-first-attempt.json)
remains failed: its API-admission variant stopped before the fourth guest and
did not record the failing HTTP status. Its three admitted guests all logged
out and then received 401. Do not assign that failure to a specific quota or
provider. A later [single admission check](../pr-assets/beta-collaboration/20261107/private-rc-followup/single-admission-check.json)
succeeded and logged out normally. The
[read-only health check](../pr-assets/beta-collaboration/20261107/private-rc-followup/read-only-health.json)
reported ready/open service, healthy storage and usage below the monitored
application limits. It describes that later observation, not the earlier fault.

The [account usage observation](../pr-assets/beta-collaboration/20261107/private-rc-followup/realtime-usage-headroom.json)
also resolves the earlier account-headroom gap for the approved bounded music
trials. Actual signed-in Cloudflare billing showed the first 1,000GB included,
usage within that tier and $0 current/projected usage cost for the October 15–
November 14 cycle. Its combined usage display rounds to 0GB; it is not literal
zero traffic. Account-wide TURN analytics showed 6.4MB egress / 9.07MB ingress
over 30 days. SFU had no applications and reported “No data,” which is not
relabeled as a measured zero-byte aggregate. Refresh these observations before
a later media trial. No subscription, credential, cap or activation changed.

Request allowances remain distinct from bandwidth: the live issuer also has a
200-request daily source-prefix allowance and a separate 3,000-request web
allowance. These observations do not identify which cap caused the older relay
error. [WebJam PR #449](https://github.com/rupret007/webjam/pull/449) adds daily
reset hints without changing limits. It merged as
`e735a048de82e26c424e31964a30f1dfbd548df9` after direct GitHub Actions checks
passed for head `ec4bfdfa705b7ba32707fe26174265c77dae2e7a` (17 successful,
8 intentionally skipped release/manual jobs). It is not part of this deployed
candidate or the live issuer; those still need their own reviewed delivery.

The original local macOS WebKit audio-cleanup assertion is separately tracked
in [issue #448](https://github.com/rupret007/webjam/issues/448). Diagnostics observed
a completed close promise followed by a stale-looking running state and an
uninitialized audio-destination error. Keep that scope separate from the
successful hosted WebKit chat run, Linux CI, physical Safari audio and microphone
resource qualification. No cleanup assertion was relaxed.

## Evidence boundaries and next steps

The [receipt](../pr-assets/beta-collaboration/20261106/private-rc/receipt.json)
pins the delivered files. This is a verified private website update, not full
release acceptance. Preserve all 62 original requirements and their existing
evidence scopes. Prior real listening evidence remains attached to its own
native build and deployment; it cannot qualify the current combination.

Current physical speech/music, a second network, actual shared-mix WAV/MP3,
real Webex video/audio switching and remaining platform acceptance are pending.
At this check the Intel MacBook still had WebJam open and Jeff was away;
no process was stopped and no microphone session was started. Account-wide
headroom was subsequently qualified above; actual issuer-cap recovery and the
remaining live media journeys still need verification. Native source/package
`76b1fd7` remains separate from this website/browser import and has not been
replaced by this delivery.

Real Access email admission, registered-room recovery and human moderation
retain their earlier live evidence and current outstanding scopes. Locally
signed role fixtures are not live Cloudflare sign-ins. The all-ages, privacy,
moderation coverage, legal, accessibility, integration and capacity requirements
remain as documented in the unchanged acceptance audit.

Use the updated [private deployment instructions](HANGOUT_BETA_HANDOFF.md).
Before any subsequent change or rollback, read the actual active version again,
preserve current admission/authority/bindings and match the client assets.
Cloudflare's [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
does not promise recovery of external-resource or schema changes; this release
changed neither the Worker implementation nor its namespace/schema inputs.
