# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: play.spec.js >> /play/ hosts Turdanoid same-origin, hidden and noindex
- Location: tests/e2e/play.spec.js:7:1

# Error details

```
Tearing down "context" exceeded the test timeout of 30000ms.
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - status [ref=f1e3]: Game started. Break every brick.
    - generic [ref=f1e4]:
      - complementary [aria-hidden]:
        - generic:
          - paragraph: Classic best
          - paragraph: "0"
          - paragraph: Boss best
          - paragraph: "0"
      - generic [ref=f1e5]:
        - img "Turdanoid playfield. Arrow keys or A and D move the seat. Space to launch. P to pause." [active] [ref=f1e6]
        - generic [aria-hidden]:
          - generic:
            - generic: Score
            - generic: "17"
          - generic:
            - generic: Level
            - generic: "1"
          - generic: Lives
        - generic [ref=f1e7]:
          - button "Mute sound" [ref=f1e8] [cursor=pointer]: 🔊
          - button "Pause game" [ref=f1e9] [cursor=pointer]: ⏸
        - generic:
          - generic: Bathroom Tiles
          - generic: Level 1 · Fresh Tiles
        - button "TAP TO LAUNCH 💩" [ref=f1e10]
        - button "Colorblind-safe colors off, tap for high-contrast palettes and suit patterns" [ref=f1e12] [cursor=pointer]: Clr
      - complementary [aria-hidden]:
        - generic:
          - paragraph: Sewer tips
          - paragraph: 🪠 Magnet pulls every drop
          - paragraph: 🔥 Fire + multiball = chaos
          - paragraph: 💰 Gold doubles breaks
  - link "Back to game hub" [ref=f1e13] [cursor=pointer]:
    - /url: ./
    - generic [aria-hidden] [ref=f1e14]: ←
    - generic [ref=f1e15]: Hub
  - button "Stalemate music on, tap to turn music off" [pressed] [ref=f1e16] [cursor=pointer]: 🎵
```