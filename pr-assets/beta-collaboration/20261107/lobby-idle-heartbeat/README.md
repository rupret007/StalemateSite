# Idle heartbeat evidence

The runtime inputs are from local commit `ec1b4a09d6c375433aedb33f56c3deb9590350ac`.
The subsequent evidence/browser-test commit must preserve those runtime bytes.
`receipt.json` binds every payload hash and the four changed runtime inputs.
No real invitation, cookie, credential or recording is included.

- `unit.json`: 53 focused units, with the original two greeting expectation failures retained separately.
- `browser.json`: four real SDK WebKit page checks with explicit WebSocket fixtures and virtual browser timers.
- `worker-runtime.json`: actual loopback Workerd alarms with one quiet and one pinging synthetic short-lived visitor, plus a healthy visitor. Production TTL is unchanged.
- `fixture-worker.mjs` / `runner.mjs`: the exact executed isolated Worker fixture and native harness. This is not a production endpoint or a native music test.

## Native harness layout

Run only in an approved, resource-qualified QA directory. The harness does not
install tools or authenticate. Use the tested existing Node, Miniflare, Workerd
and Rolldown versions recorded in `worker-runtime.json`; do not bypass trust or
resource checks to run it.

Place `runner.mjs` in a fresh directory with `candidate/` containing the exact
Git revision's `hangout-worker/src/`, `package.json`, `package-lock.json`, and
`r/45662413410ed051/{entry-sites.mjs,sync-core.js}`. Put `fixture-worker.mjs` at
`candidate/fixture-worker.mjs`. The candidate needs its existing locked production
dependencies and Rolldown; `tools/` must resolve the recorded existing Miniflare
installation through its package.json. Do not copy live environment files or secrets.
Run the runner with that Node binary. It refuses an existing runtime directory,
uses loopback ephemeral ports, denies outbound services, records source hashes,
and disposes its runtime. Inspect the original result and log after any failure;
do not retry unchanged or alter an alarm/clock to manufacture a pass.

## Limits

No hosted change, physical capture, relay trial, original-observer change,
Webex proof, actual music qualification, new native-provider CI mode, or public
launch is claimed. Ordinary exact-head application CI and hosted qualification
remain required. Three existing hosted interruptions recovered in roughly 1.2s;
this change does not yet establish their cause or prove that they are eliminated.
