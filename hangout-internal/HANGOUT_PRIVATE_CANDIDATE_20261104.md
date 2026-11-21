# Private Web Join candidate, November 4

The website candidate imports the exact browser runtime from native source
`176103ade7658a76cdb36231c25359c7c6541ee3` (PR421), including prejoin.js and
errors.js. All thirteen shipped runtime files have matching upstream/shipped
hashes in join/PROVENANCE.json. Existing CSP, privacy metadata and license are
retained. No provider, public navigation or deployment change is included.

Local qualification: eight provenance/public packaging checks passed. Sixteen
browser cases passed without retries across Chromium and WebKit, including the
existing mocked two-visitor band journey, fragment privacy, actual Retry capture
cleanup, and microphone-denied/missing-device checks at 375 and 390px. The
original first run (12 pass/4 fail) is retained privately: its new denial-copy
assertion expected “is blocked” while the existing capture helper says “was
blocked”. Only that wording expectation was corrected. These fixture cases do
not establish physical audibility or provider readiness.

See [sanitized captures and receipt](../pr-assets/beta-collaboration/20261104/web-join-import/receipt.json).
The captures show wrapping and visible Retry; they are scrolled viewport images,
not full-page accessibility evidence or physical iPhone observations.

The native master CI failure in job126299970782 was a truncated pip download
before application tests. Its original log was retained (SHA256
538839751bf8119112c861a6b2f73e3c8ab18656fefc725772e79e78f7a66d5e).
One retry of that job was accepted; it remains separate qualification.

Remaining: full candidate CI; selective reconciliation of draft193; native
adaptive-profile safety/lifecycle audit; QR decoding/licensing; real provider,
private deployment/build and ARM/Intel/Windows music trials via the assigned
owner. The upstream checklist still says microphone permission occurs after
Join even though Check microphone also requests it: correct this upstream and
repin together, preserving capture opt-in. Jeff alone handles report289035.
All62 canonical outcomes remain binding and the existing audit remains open.
