# Band demo journey map (Stalemate → Hang Out → Web Join)

End-to-end path for a first-time bandmate and a host, using local preview / `serve:test` fixtures. This is a working map for QA and Playwright; it is not a claim about production hosting.

## Steps

| Step | Visitor action | Page / code | Notes |
| --- | --- | --- | --- |
| 1 | Open reviewed **Stalemate** entry link (“Hang Out”) | Band site fixture or packaged `stalemate.html` via `communityJoinLink()` → `r/45662413410ed051/lobby/?via=stalemate…` | `tests/e2e/community-entry.spec.js` pattern; `via` badge is optional to show/hide. |
| 2 | Pick nickname, agree, enter lobby | Gate: `r/45662413410ed051/lobby/index.html` (`data-nick`, `data-enter`); connect in `lobby.js` | **Friction:** long gate button copy (“I’m 13+…”) reads like legal fine print before the obvious action. **Friction:** must wait for relay/preview params or enter stays disabled with no plain “missing link” copy on some builds. |
| 3 | Say hello in `#stalemate` | Chat pane `data-text` / `data-send`; scrollback `data-buffer` | Slow mode (3s) between lines from same author in shared tests. Conversation starters help; optional. |
| 4 | Host opens **Rooms** → **Jam (WebJam)** | `data-show="rooms"`, `data-start="jam"`; channel `#jam-…` | **Friction:** two navigation hops before hosting; no single “Start a jam” on chat home. Jam rooms are **invite-only** (`+i`); directory shows them but join without invite fails (`invite-only` toast). |
| 5 | Bandmate **sees** the jam room in directory | Rooms pane `data-roomlist`, labels from `discovery-core.js` | **Friction (partially addressed):** old copy said “Try joining” on invite-only rows, implying a self-serve join. |
| 6 | Host invites bandmate by nickname | Host tools `data-roomtools` → “Invite guest” dialog (`data-invite-dialog`); server `invite` in `lobby-core.mjs` | **Friction:** host must know exact nickname; dialog is behind Host tools, not surfaced on jam start. |
| 7 | Bandmate accepts **Join** on invitation toast | `data-toast` button; lands in jam room (`data-chat-context`, `data-jam`) | Lowest-click path for invite-only jam (toast vs directory). |
| 8 | Host pastes **browser Web Join** link | Host-only `data-jam-form` / `data-jam-link`; validation in worker + `webJoinOrigins` on test relay (`webjam-browser-*` namespaces) | **Friction (partially addressed):** guests saw “Waiting for the host to paste their WebJam invite” even when only a browser link is needed. Rejected paste needs reread of toast (`Browser joining is not configured`). |
| 9 | Bandmate **Join in browser** | `data-jam-web` opens approved `https://…/join/#…` | **Friction:** disabled state title was generic; button label “Browser join unavailable” sounds broken rather than “waiting on host”. |
| 10 | Web Join: headphones, mic check, connect | `/join/` (`join/app.js`, `join/session.js`); fake media in e2e | **Friction:** without host-side mailbox/relay, real join fails at credentials (`Web Join is unavailable` in `webjam-join-play.spec.js`); demo/tests must mock transport. CSP limits connect-src to turn worker origin. |
| 11 | Connected audio ready | `#status` “Connected — Web Join…”; `join/session.js` `onStatus` | Not the same as native WebJam/TURN qualification across houses. |

## Admin / alternate entry (out of band demo spec)

- **Guest nickname only** — same gate as step 2.
- **Admin / room owner email code** — `data-owner-signin`, preview launcher “Room owner A/B”, `/lobby-owner/login` on preview server (`HANGOUT_LOCAL_TESTING.md`). Not required for the two-guest band demo.

## Friction summary (open vs addressed in this branch)

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

## Automated coverage

- Full two-context path: `tests/e2e/band-demo-journey.spec.js`
- Related: `community-entry.spec.js`, `lobby-guest-journeys.spec.js`, `lobby-webjam.spec.js`, `webjam-join-play.spec.js`
