# Host tools and delayed ownership metadata

The original website PR183 push CI timed out while a returning room owner had
Host tools open without the named offline co-host removal button. The
[original 390px screenshot and source-bound receipt](../pr-assets/beta-collaboration/20261031/host-tools-ownership/receipt.json)
retain that failure. Its trace records only the successful retry, so it does
not establish the original sequence of frame arrival. The timeout and teardown
error remain distinct from the deterministic client defects reproduced below.

The engine sends the room view and owner-only co-host list separately. The
client previously stored later ownership frames without updating an open
menu. Opening Host tools between those frames left its removal list stale
until the owner closed and reopened it. Repeated ownership updates also left
the displayed labels and controls unchanged.

The focused local regression run admitted by the unchanged resource guard
executed 36 cases: 28 passed and eight failed on the original application
client. Seven failures demonstrate delayed rows, changed labels and stale host
controls after room switch, room replacement, fresh same-name join, lost
ownership and disconnect. The eighth was an initial Stop-fixture mistake: its
private sharing controls were not enabled. That fixture now includes the real
private-shell marker and explicit feature flag; the initial result is retained
without counting it as a demonstrated Stop failure. The test-only commit in the
receipt preserves the original cases before the application correction.

The correction keeps the menu bound to the original room object, room nonce
and ownership state. Incoming owner-only metadata updates keyed account rows
inside the open menu. Unchanged controls keep their DOM identity and keyboard
focus. A removed focused row returns focus to Close; a waiting/update status
is available to assistive technology. Generic command menus gain no host
controls. Closing or invalidating the host menu retires its callbacks.

Removal still asks for confirmation and sends the exact verified account ID,
`cohostAccount: true` and the original `roomInstance` through the existing
server authorization path. It does not substitute a nickname, change account
linking or trust the entry-site badge. Room, ownership, disconnect and local
Stop boundaries remain required.

When an enabled private sharing withdrawal retires an open host menu, focus
returns to the visible sharing-controls summary. Its status region may be
inside a closed disclosure and must not be assumed focusable. A separate
real-browser client fixture checks visible focus, Enter to expose the current
status and Tab to reach its check button, while new sharing stays disabled.
That synthetic protocol frame does not qualify actual server withdrawal.

The final reviewed source `f7209ca` merged as `c9b5db0`; their complete trees
match. Both final CI runs passed 1,894 units in 115 files and 447 distinct browser
cases in 447 attempts, without retries or skips. Each log explicitly records
all four actual-Tab 375/390px Chromium/WebKit journeys and the visible withdrawal
recovery case. This qualifies those later tests separately from source188's
programmatic-focus local captures below. Pages deployment was skipped; private
delivery and physical music remain outstanding.

New real-relay browser journeys delay only the separate ownership metadata,
then update the already-open menu at 375px and 390px. They exercise a returning
fixture account, preserved focus, exact offline co-host removal and refusal of
host controls to the returning revoked co-host. The community moderation file
is included in the existing WebKit project as well as Chromium. Its loopback
identity adapter is not Cloudflare Access or real email-delivery evidence.
Fixture cleanup tracks only live contexts and attempts every owned website
shutdown even if another cleanup operation fails.

Source `188c787` passed 49 focused local cases in two files after a fresh guard
admitted execution. Four real-relay browser journeys then passed once, with
one worker, no retries, skips or report errors. The inspected local captures
show the waiting and updated menu at
[375px](../pr-assets/beta-collaboration/20261031/host-tools-ownership/webkit-community-375-updated.png)
and [390px](../pr-assets/beta-collaboration/20261031/host-tools-ownership/webkit-community-390-updated.png).
These are desktop-engine viewport checks, not physical iPhone evidence. The
first run set focus programmatically; it does not establish Tab navigation.

Both source188 CI jobs passed 1,894 units in 115 files and 446 distinct browser
cases in 446 attempts, with zero retries, failures or skips. They ran on
GitHub-hosted Ubuntu, separately from the local checks. Pages deployment was
skipped. The later browser test uses actual Tab keys to reach the control
before delayed metadata arrives. Its first local attempt was resource-refused;
read [PR184](https://github.com/rupret007/StalemateSite/pull/184) for the exact
latest-head CI result rather than counting the earlier focus setup as that
test. The receipt retains each scope and the original failures.

Initial fixed local attempts were refused before Node because swap usage
exceeded the unchanged 80% guard. Those refusals remain; they are not executed
tests. No workflow, deployed Worker, credential, provider, resource threshold
or release hold is changed by this application patch. Delivery still requires
the deployment owner to apply matched HTML/JavaScript through the existing
private release path, preserving all settings, bindings and rollback state.

All [62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain.
Real music on the ARM Mini, Intel MacBook and Windows, Linux qualification,
physical consent/headphone checks, real-site integration and other unresolved
outcomes are not supplied by this correction.

References: [Playwright context lifecycle](https://playwright.dev/docs/api/class-browsercontext#browser-context-close),
[fixture/test timeout scopes](https://playwright.dev/docs/test-timeouts),
[Node HTTP server shutdown](https://nodejs.org/api/http.html#serverclosecallback).
