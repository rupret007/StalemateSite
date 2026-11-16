# Private WebJam band demo

Use this walkthrough with the review candidate that includes **Invite to Music**. Stalemate and Rad Dad open the same private Hang Out lobby. The host supplies the private community invitation separately. Check the Mac launch window title against the 12-character build ID supplied for the rehearsal. The title reads **WebJam — Build** followed by the ID. If it differs or is missing, close that test window before sending an invitation and tell the host which ID you saw.

Keep the existing app and its settings available for recovery. If the candidate cannot start, close it and reopen the previous app from its known path. The old shortcut may still point there. Use the test build only after its package and URL handler are identified. Browser guests continue to use their browser.

For a site restore, give the operator the affected site version and its verified rollback receipt. For a failed invitation, start with the recovery steps below.

## Mac host

1. Open the private Hang Out invitation and pick a nickname. In native WebJam, choose **Music** → **Host**. Select **Start Session** if shown.
2. In Hang Out, choose **Rooms** → **Jam (WebJam)**, then **Invite to Music** in the Jam room.
3. Choose the guest already online in Hang Out, then select **Continue in WebJam**. If the browser asks to open WebJam, choose **Open**. Confirm the invitation in the app.
4. Check the status in Hang Out. It shows when the invitation was sent, whether the guest accepted or declined, and whether it expired. If Hang Out cannot confirm delivery, check with your guest before sending again.

## Browser guest

1. Open the private community invitation from the host, pick a nickname, and tell the host the nickname you chose. On Windows, join from your browser. The handoff requires the host's Mac app.
2. When the Music invitation appears, choose **Accept and join**. Then select **Open WebJam in browser**. You can return to the Hang Out tab for room chat.
3. Choose **Join to listen** to keep your microphone off. To play or speak, run **Check microphone**, confirm you're wearing headphones, and choose **Join with microphone**. If the browser blocks playback, choose **Resume audio**.
4. Select **Leave session** to stop browser audio. Return to Hang Out if you want to keep chatting.

## If joining gets interrupted

- **Retry** repeats the listening attempt with your microphone off. If the page says it cannot reach the host, first check that the host still has the Music session open.
- **Back to audio options** lets you choose listening or microphone again. Microphone setup starts when you choose **Check microphone**.
- If the invitation expired or the host ended the session, ask for a fresh invitation in Hang Out.

If the native app handoff fails before sending, the host can confirm the Music session is running and try again. **Share a link instead** is available as a fallback. Send any private link directly to the intended guest.

These steps describe a review candidate. The phone and desktop automated walkthrough uses the real Hang Out UI with a simulated native handoff and media transport. The [live-music acceptance checks](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) cover actual Mac-to-Windows audio, a second network, Shared Track, and Webex. Keep rehearsals parked until Jeff gives the go.

## Historical manual-invite journey

Earlier builds used the manual Web Join link flow below. The retained checks cover that fallback and prior friction.

### Steps

| Step | Visitor action | Page / code | Notes |
| --- | --- | --- | --- |
| 1 | Open reviewed **Stalemate** entry link (“Hang Out”) | Band site fixture or packaged `stalemate.html` via `communityJoinLink()` → `r/<hidden-slug>/lobby/?via=stalemate…` | `tests/e2e/community-entry.spec.js` pattern; `via` badge is optional to show/hide. |
| 2 | Pick nickname, agree, enter lobby | Gate: `r/<hidden-slug>/lobby/index.html` (`data-nick`, `data-enter`); connect in `lobby.js` | **Friction:** long gate button copy (“I’m 13+…”) reads like legal fine print before the obvious action. **Friction:** must wait for relay/preview params or enter stays disabled with no plain “missing link” copy on some builds. |
| 3 | Say hello in `#stalemate` | Chat pane `data-text` / `data-send`; scrollback `data-buffer` | Slow mode (3s) between lines from same author in shared tests. Conversation starters help; optional. |
| 4 | Host opens **Rooms** → **Jam (WebJam)** | `data-show="rooms"`, `data-start="jam"`; channel `#jam-…` | **Friction:** two navigation hops before hosting; no single “Start a jam” on chat home. Jam rooms are **invite-only** (`+i`); directory shows them but join without invite fails (`invite-only` toast). |
| 5 | Bandmate **sees** the jam room in directory | Rooms pane `data-roomlist`, labels from `discovery-core.js` | **Friction (partially addressed):** old copy said “Try joining” on invite-only rows, implying a self-serve join. |
| 6 | Host invites bandmate by nickname | Host tools `data-roomtools` → “Invite guest” dialog (`data-invite-dialog`); server `invite` in `lobby-core.mjs` | **Friction:** host must know exact nickname; dialog is behind Host tools, not surfaced on jam start. |
| 7 | Bandmate accepts **Join** on invitation toast | `data-toast` button; lands in jam room (`data-chat-context`, `data-jam`) | Lowest-click path for invite-only jam (toast vs directory). |
| 8 | Host pastes **browser Web Join** link | Host-only `data-jam-form` / `data-jam-link`; validation in worker + `webJoinOrigins` on test relay (`webjam-browser-*` namespaces) | **Friction (partially addressed):** guests saw “Waiting for the host to paste their WebJam invite” even when only a browser link is needed. Rejected paste needs reread of toast (`Browser joining is not configured`). |
| 9 | Bandmate **Join in browser** | `data-jam-web` opens approved `https://…/join/#…` | **Friction:** disabled state title was generic; button label “Browser join unavailable” sounds broken rather than “waiting on host”. |
| 10 | Web Join: headphones, mic check, connect | `/join/` (`join/app.js`, `join/session.js`); fake media in e2e | **Friction:** without host-side mailbox/relay, real join fails at credentials (`Web Join is unavailable` in `webjam-join-play.spec.js`); demo/tests must mock transport. CSP limits connect-src to turn worker origin. |
| 11 | Connected audio ready | `#status` “Connected — Web Join…”; `join/session.js` `onStatus` | Not the same as native WebJam/TURN qualification across houses. |

### Admin / alternate entry (out of band demo spec)

- **Guest nickname only** — same gate as step 2.
- **Admin / room owner email code** — `data-owner-signin`, preview launcher “Room owner A/B”, `/lobby-owner/login` on preview server (`HANGOUT_LOCAL_TESTING.md`). Not required for the two-guest band demo.

### Friction summary (open vs addressed in this branch)

| Issue | Severity | Status |
| --- | --- | --- |
| Invite-only jam directory implies self-serve join | High | **Addressed:** clearer directory action label |
| Jam guest wait copy mentions desktop paste only | Medium | **Addressed:** wait line mentions browser or desktop invite |
| Disabled browser join button sounds like a product bug | Medium | **Addressed:** clearer disabled title |
| Two taps to reach room tiles from chat | Medium | Open (by design: IRC layout) |
| Host must find “Invite guest” under Host tools | Medium | Open |
| Web Join real relay not available in local static server | High | Mock in e2e; document in step 10 |
| Gate legal button text before “in” | Low | Open |
| `/join` failure copy good; success path needs host mailbox in live env | Medium | Open for production qualification |

### Automated coverage

- Current targeted invitation across both entrances: `tests/e2e/music-invite-journey.spec.js`
- Historical two-context path: `tests/e2e/band-demo-journey.spec.js`
- Related: `community-entry.spec.js`, `lobby-guest-journeys.spec.js`, `lobby-webjam.spec.js`, `webjam-join-play.spec.js`
