# Browser guidance for a daily relay request cap

This candidate imports WebJam's reviewed
[PR #449](https://github.com/rupret007/webjam/pull/449), merge
`e735a048de82e26c424e31964a30f1dfbd548df9`, into the website's bundled Web Join
client. Only `errors.js` and `mailbox.js` change at runtime. All thirteen
imported files match that exact upstream revision and retain its MIT license
and hash-bound provenance.

A confirmed `429 {"error":"cap"}` may carry an integer `Retry-After` between
1 and 86,400 seconds. The browser then shows an approximate reset date, time
and time zone. Without that valid hint, it retains the generic fresh-invite
guidance. A cap still stops capture tracks and retires the invitation; it
does not reveal a Retry action or reconnect automatically. Temporary outages
remain separately retryable. This change raises no quota and does not promise
that independent limits will have cleared after the daily reset.

The [local evidence receipt](../pr-assets/beta-collaboration/20261107/web-join-reset-hint/receipt.json)
records three asset/provenance checks and eight browser scenarios: Chromium
and WebKit at 375/390px, with and without a reset hint. Existing assertions for
track cleanup, no capture before consent, fragment/storage privacy and page
containment remain. All eight passed without retries. A new hinted scenario
failed against the unchanged parent browser code at its missing-guidance
assertion; the reviewed upstream files were restored afterward.

The [375px Chromium capture](../pr-assets/beta-collaboration/20261107/web-join-reset-hint/chromium-375.png)
and [390px WebKit capture](../pr-assets/beta-collaboration/20261107/web-join-reset-hint/webkit-390.png)
were visually inspected. The fixture deliberately supplies mono 16kHz settings
to retain the voice-quality warning case. It generates a synthetic stream and
intercepts provider responses; it opens no physical microphone, native host,
live relay or recording. These website scenarios do not resolve the separate
strict macOS WebKit AudioContext-state diagnostic in
[issue #448](https://github.com/rupret007/webjam/issues/448).

The actual private website remains source `b61bb41`, Worker version
`75655a50-9e13-4966-bb68-22b45a230c1d`. Neither it nor the live issuer has been
changed by this candidate. The issuer must deliver the reviewed response hint
before visitors can receive it; older responses remain compatible. Run current
application CI and normal reviewed private delivery before claiming hosted
behavior. Native package `76b1fd7`, provider limits, activation holds and public
sites remain unchanged. Physical music, Shared Track and Webex acceptance stay
pending.
