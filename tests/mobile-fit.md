# One-screen phone play

The seven current games and legacy Neon Arkanoid share `assets/mobile-fit.css` and
`assets/mobile-fit.js`. Each page opts in with `data-mobile-game`. The overrides
apply at widths up to 980px; desktop cabinet styling remains game-owned.

The document uses `100svh`/`100dvh`, safe-area padding, and no document scrolling
or overscroll. Game regions flex between their HUD and controls. Arcade canvases
fit both dimensions, retaining their aspect ratio. ResizeObserver and visual
viewport/orientation listeners refit the existing session. Auxiliary rules and
settings use menus/drawers. Music and colour controls retain their own 44px slots.

Crapjack reserves space for money, the dealer and player hands, quick chips and
all actions, in both betting and live states. Landscape puts actions beside the
felt. Rummy and Spades use full card rows with separate 44px targets; Eights
pages large hands. SameGame retains its established board dimensions and scales its grid through
rotation. Its Aim menu supplies 44px arrow/Pop controls for precise selection
when the game cells are smaller than a button; rotation never restarts the board.

Run `npm ci`, `npx playwright install chromium`, then `npm run test:mobile`.
Both preserved Playwright matrices start ephemeral local servers and check all
eight games at 360x640, 375x667, 390x844, 430x932, 667x375 and 844x390. It checks
document bounds, scroll locking, key controls, touch targets, card hit testing,
canvas aspect ratios, betting/dealing/resolution, draw/discard, bidding and live
rotation. `MOBILE_BROWSER=webkit` uses WebKit when installed.

Set `MOBILE_SHOTS=/absolute/output/path` to save 390x844 after screenshots.
Before images belong to the baseline checkout; capture them before applying the
change. The task's paired screenshots and per-game report are stored outside
the repository under `~/.local/share/storypool/doctor/mobile-fit/`.
