# Scoped lobby contrast checks

The dark input outlines formerly used decorative `--line` (`#343d36`). The nickname field measured **1.5895:1** against its surrounding surface. A dedicated `--control-line` (`#6b776c`) now identifies editable fields, leaving decorative separators unchanged. The WebJam invitation textarea uses the same foreground, placeholder and boundary colors, plus the visible keyboard-focus outline.

`tests/e2e/lobby-contrast.spec.js` opens the real local lobby and relay at 375, 390 and 1280 CSS pixels, then samples entry, sent chat, room discovery, channel creation and the host's WebJam invitation form. A fourth test checks the shared staff-entry field styling without changing staff authorization. JSON measurements and unedited screenshots are saved in the Playwright output directory.

The calculation uses computed solid colors, alpha compositing over solid ancestor backgrounds and linearized sRGB luminance. It rejects missing, disabled or hidden samples and unsupported gradient/image/opacity-group cases instead of silently skipping them. Text uses 4.5:1, or 3:1 for sufficiently large text; placeholders use 4.5:1. Comparisons use unrounded ratios.

The **3:1 field-boundary target is an explicit product choice**, measured against both the field interior and exterior. WCAG does not require every decorative border or every already-identifiable button boundary to meet that target. See W3C's [Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

These samples are not a whole-application WCAG certification. They do not cover every interaction state, actual glyph rendering, images/emoji, videos, system color overrides, native select popups, physical iPhone focus/keyboard behavior or screen readers. Existing keyboard/reflow and WebJam invitation-copy regressions run separately. Hosted acceptance and actual assistive-technology qualification remain outstanding.

Run with the repository's installed Chromium browser and local listener permission:

```sh
npx playwright test tests/e2e/lobby-contrast.spec.js tests/e2e/lobby-accessibility.spec.js tests/e2e/lobby-webjam.spec.js --project=chromium --workers=1
```
