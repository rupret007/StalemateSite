# Mobile play viewport checks

`npm run test:mobile` serves the repository locally and runs Playwright Chromium
against all seven games and the legacy Neon Arkanoid page. Install Chromium with
`npx playwright install chromium` first.

The matrix covers 360×640, 375×667, 390×844, 430×932, 667×375, and 844×390.
It checks entry and play document dimensions, play area bounds, visible key control
bounds, ancestor clipping, 44px action buttons, controls covered by another layer, opening the table
menu, and rotating an already running game in both directions. Spades also checks
the transition from bidding to play; Eights also checks that every card in a 30-card
hand remains reachable through its card pages. Failures exit nonzero; existing tests remain
unchanged.

Optional environment variables:

- `MOBILE_SHOTS=/path/to/shots`: save each game at 390×844.
- `MOBILE_RESULTS=/path/to/results.json`: save per-game results.
- `MOBILE_BROWSER=webkit`: run the same matrix in WebKit.
- `MOBILE_GAMES=turdjack,turdrummy`: run selected games while developing.

Mobile rules are scoped by `body[data-mobile-game]` and the 980px breakpoint.
Desktop styling stays with each game. Phone layouts reserve safe areas and use
`100dvh` with a small-viewport fallback. Secondary settings live in overlay menus.
Eights pages a growing hand without modifying the engine hand, scores, or rules.
The shared music and accessibility settings retain their existing handlers.
