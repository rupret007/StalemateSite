# Bounded browser reconnect probe

Requirement S7 includes reconnect storms. The browser probe in
`tests/e2e/lobby-reconnect-burst.spec.js` adds one bounded functional tier: five
independent Chromium profiles lose their actual TCP connections together while
the existing loopback relay remains available. A real application-ACK drain
first establishes an idle baseline: a visible line alone does not prove that
its message result arrived. Uncertain delivery correctly requires explicit
recovery and is a separate path. It is authored pending execution;
do not treat this contract as a passing run.

The test uses the production client retry logic, unchanged admission/control
limits and actual loopback WebSockets/engine. It does not inject browser close
events, mock the WebSocket API, change clocks, force retry randomness, or reset
capacity counters. Its private HTTP server owns the five transports it destroys;
there is no new application fault endpoint or service control.

Success requires five new welcome/session IDs, the correct five-person roster,
no old chat replay, retention of an unsent tab draft without publication, one
copy of a new line per client, exactly ten total admissions and five retained
server sessions/transports. Actual application ACKs must drain the delivery
queue before the final duplicate check; the work queue must have no rejected or
pending work, with no delivery pressure closes. This witnesses recovery instead of accidentally
accepting the old Connected UI before close events arrive. Owned browser
contexts, sockets and the relay are closed on failure as well as success.

The normal browser suite discovers this test without any workflow change.
Record the exact tested source and actual result before qualifying it. Existing
native CI, the separate provider-start mode, and physical/hosted tests retain
their own evidence scopes.

Five clients are not the complete S7 load requirement. Real C3 authority and
provider admission, many-room/hot-room tiers, unavailable-service/backoff paths,
slow clients, WAN behavior, operational capacity/latency/cost targets and hosted
reconnect storms remain separate requirements. Preserve the original 62 outcomes
and do not raise production limits or infer a public SLO from this probe.
