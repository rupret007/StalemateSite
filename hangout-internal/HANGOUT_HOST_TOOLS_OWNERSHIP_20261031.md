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

New real-relay browser journeys delay only the separate ownership metadata,
then update the already-open menu at 375px and 390px. They exercise a returning
fixture account, preserved focus, exact offline co-host removal and refusal of
host controls to the returning revoked co-host. The community moderation file
is included in the existing WebKit project as well as Chromium. Its loopback
identity adapter is not Cloudflare Access or real email-delivery evidence.
Fixture cleanup tracks only live contexts and attempts every owned website
shutdown even if another cleanup operation fails.

Fixed-source verification is pending at preparation. The first fixed local
attempts were refused before Node because swap usage exceeded the unchanged
80% guard. Do not count a guard receipt as an executed test. Current-head CI,
the new screenshots and any later local result must retain their own revisions,
counts, retries and limits. No workflow, deployed Worker, credential, provider,
resource threshold or release hold is changed by this application patch.

All [62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md) remain.
Real music on the ARM Mini, Intel MacBook and Windows, Linux qualification,
physical consent/headphone checks, real-site integration and other unresolved
outcomes are not supplied by this correction.

References: [Playwright context lifecycle](https://playwright.dev/docs/api/class-browsercontext#browser-context-close),
[fixture/test timeout scopes](https://playwright.dev/docs/test-timeouts),
[Node HTTP server shutdown](https://nodejs.org/api/http.html#serverclosecallback).
