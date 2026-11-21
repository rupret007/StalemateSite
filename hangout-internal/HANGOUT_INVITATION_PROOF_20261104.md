# Private invitation proof, November 4

This candidate follows PR197 and preserves public navigation and provider state.
It carries forward draft193's pure expiry diagnostics, bounded/redacted tests,
and actual client revocation-close regression. Its Web Join checklist is
superseded by the exact newer native runtime imported in PR196. Original193
branches and the original failed eight-hour observation remain intact. The
ported diagnostic tests do not establish a new eight-hour pass.

The invitation QR now uses integer-scaled modules and a four-module quiet zone,
as documented by [DENSO WAVE](https://www.qrcode.com/en/howto/code.html).
An independent decoder reads the exact fixture invitation from actual canvas
pixels in Chromium and WebKit. The test also checks quiet-zone pixels, clears
the bitmap when hidden and after leaving the room, verifies the clipboard
fallback and confirms the raw bearer is not copied into a canvas attribute.
Four added phone-viewport cases verify the entire QR is inside its own pane and
viewport while input/Send stay visible. Visual inspection exposed earlier panel
clipping; four red geometry cases reproduced it before the scoped scroll fix.
Physical camera scanning remains unperformed.

[Component receipt](../pr-assets/beta-collaboration/20261104/qr-review/components.json):
the original 56,694-byte encoder prefix is byte-identical to npm
qrcode-generator1.4.4. The upstream MIT header is preserved and its full
[permission notice](https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE)
is included with the shipped script. The first-party canvas wrapper is changed.
The independent jsQR1.4.0 decoder uses Apache2.0 and is a pinned test-only
dependency; it is excluded from visitor packages with node_modules. This
component check does not establish the project's broader public legal readiness.

The new QR regression initially failed on the missing quiet-zone geometry in
both browser engines; those red logs/captures are retained privately. After
the fix both cases pass without retries. The three ported expiry/client unit
files pass37 cases locally. The complete local candidate unit suite passed 2,057 cases in137 files.
The broader invitation/browser suite passed52 cases across both engines without
retries. Candidate CI and physical journeys still need qualification. All62 original requirements remain binding; actual private
provider/build/deployment and physical music trials remain separate.
