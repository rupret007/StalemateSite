# Quiet lobby connections

The original private C227 observer recorded three abnormal socket closures before
22:47 UTC on November 7. Each socket reopened automatically after 1,197–1,259 ms.
These are measured reopen gaps, not proof that messages were delivered during a
gap. The transport cause is unproven. This does not establish uninterrupted uptime
or a terminal pass for the separate real eight-hour expiry experiment.

The current lobby uses the hibernating Durable Object API and bounded transport
acknowledgements, but has no application keepalive. Cloudflare documents idle
WebSocket closure and recommends heartbeats. It also warns that network code
updates can terminate connections. These facts support investigating a keepalive;
they do not identify the cause of the three observed closures.

Sources checked November 7, 2026:

- [Cloudflare WebSocket connection guidance](https://developers.cloudflare.com/network/websockets/)
- [Hibernation and WebSocket control frames](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object automatic responses](https://developers.cloudflare.com/durable-objects/api/state/#setwebsocketautoresponse)
- [Request and duration accounting](https://developers.cloudflare.com/durable-objects/platform/pricing/#compute-billing)

## Application change

Only a server advertising numeric `transportPing: 1` enables the browser timer.
An idle timer checks every five minutes. Incoming traffic postpones a ping;
busy rooms add none, and undrained browser output does not accumulate keepalives.
The ping contains no nickname, message, invitation or credential. Disconnect,
logout and replacement retire its timer. Older servers receive no new controls.

The Worker validates the existing socket identity before processing a ping and
uses the same prepaid request budget as acknowledgements. Replies use the normal
bounded delivery window. Pings share acknowledgement rate and lifetime limits;
they do not release outstanding delivery credit or reset duplicate-ACK protection.
There is no new allowance, budget reset or automatic-response bypass. Absolute
authentication expiry, room ownership/activity, consent and moderation are unchanged.

The existing 20-control reservation accounts for incoming ping/ACK work. An idle
eight-hour session sends at most 96 scheduled pings and 96 associated ACKs, plus
ordinary protocol traffic; reservations are rounded to existing blocks. This is
an application bound for the scheduled client, not a free-service or capacity claim.
No new server interval prevents hibernation. Normal reconnect remains necessary.

## Qualification boundaries

The implementation is isolated from the original C227 observer. Do not update
that environment while its expiry experiment remains live. The earlier Web Join
cleanup candidate and its CI are separate evidence; they do not test this change.

The [source-bound evidence packet](../pr-assets/beta-collaboration/20261107/lobby-idle-heartbeat/receipt.json)
records 53 focused units and four SDK WebKit page checks. Browser tests use explicit
WebSocket fixtures and virtual browser timers. A separate native Worker fixture
sent 26 metered pings; real alarms closed both synthetic short-lived visitors
18 ms after expiry, and identical expired cookies received HTTP 401. The healthy
visitor still responded. Production TTL and the original hosted observer were
unchanged; owned fixture processes/listeners were independently checked afterward.

This covers negotiation, idle/busy/undrained output, timer teardown, shared rate
and pending limits, duplicate ACKs, request-budget refusal and expiry. Ordinary
exact-head application CI, actual hosted behavior and quiet-session observations
still require their own evidence before delivery. Local Worker results do not
qualify native music or a new native-provider CI mode.
All 62 acceptance requirements and public-launch holds remain in force.
