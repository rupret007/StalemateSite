# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: arcade-play.spec.js >> Daily Dump preserves one logical board across viewports, rotation, refresh, and the project prefix
- Location: tests/e2e/arcade-play.spec.js:30:1

# Error details

```
Tearing down "context" exceeded the test timeout of 30000ms.
```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - generic [aria-hidden]:
    - generic [aria-hidden]: 🐀
    - generic [aria-hidden]: 🦆
  - banner [ref=f3e2]:
    - heading "The Daily Dump" [level=1] [ref=f3e3]
    - generic [ref=f3e4]:
      - text: Score
      - generic [ref=f3e5]: "0"
    - generic [ref=f3e6]:
      - text: First result
      - generic [ref=f3e7]: —
    - generic [ref=f3e8]:
      - text: Left
      - generic [ref=f3e9]: "78"
    - paragraph [ref=f3e10]: Turdomania · One puzzle. Same board for everyone.
    - generic [ref=f3e11]:
      - paragraph [ref=f3e12]: The Daily Dump · 2026-10-21 · FIRST RUN · resumed
      - group [ref=f3e13]:
        - generic "▸ Rules, saving & reset" [ref=f3e14] [cursor=pointer]
      - generic [ref=f3e15]:
        - link "Free play" [ref=f3e16] [cursor=pointer]:
          - /url: http://127.0.0.1:4320/StalemateSite/play/turdomania.html
        - link "Today’s puzzle" [ref=f3e17] [cursor=pointer]:
          - /url: http://127.0.0.1:4320/StalemateSite/play/turdomania.html?daily=2026-10-22&v=1
  - main "Turdomania" [ref=f3e18]:
    - grid "Daily Dump 2026-10-21 board. Arrows move, Enter pops. No undo in the first daily run." [ref=f3e20]:
      - row [ref=f3e21]:
        - gridcell "classic swirl, column 3, row 10" [ref=f3e22] [cursor=pointer]
        - gridcell "classic swirl, column 4, row 10" [ref=f3e23] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 10" [ref=f3e24] [cursor=pointer]
        - gridcell "green splat, column 6, row 10" [ref=f3e25] [cursor=pointer]
        - gridcell "paper roll, column 7, row 10" [ref=f3e26] [cursor=pointer]
        - gridcell "classic swirl, column 8, row 10" [ref=f3e27] [cursor=pointer]
      - row [ref=f3e28]:
        - gridcell "paper roll, column 1, row 9" [ref=f3e29] [cursor=pointer]
        - gridcell "paper roll, column 2, row 9" [ref=f3e30] [cursor=pointer]
        - gridcell "paper roll, column 3, row 9" [ref=f3e31] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 9" [ref=f3e32] [cursor=pointer]
        - gridcell "paper roll, column 5, row 9" [ref=f3e33] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 9" [ref=f3e34] [cursor=pointer]
        - gridcell "green splat, column 7, row 9" [ref=f3e35] [cursor=pointer]
        - gridcell "classic swirl, column 8, row 9" [ref=f3e36] [cursor=pointer]
      - row [ref=f3e37]:
        - gridcell "green splat, column 1, row 8" [ref=f3e38] [cursor=pointer]
        - gridcell "green splat, column 2, row 8" [ref=f3e39] [cursor=pointer]
        - gridcell "corn nugget, column 3, row 8" [ref=f3e40] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 8" [ref=f3e41] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 8" [ref=f3e42] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 8" [ref=f3e43] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 8" [ref=f3e44] [cursor=pointer]
        - gridcell "green splat, column 8, row 8" [ref=f3e45] [cursor=pointer]
      - row [ref=f3e46]:
        - gridcell "paper roll, column 1, row 7" [ref=f3e47] [cursor=pointer]
        - gridcell "paper roll, column 2, row 7" [ref=f3e48] [cursor=pointer]
        - gridcell "green splat, column 3, row 7" [ref=f3e49] [cursor=pointer]
        - gridcell "green splat, column 4, row 7" [ref=f3e50] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 7" [ref=f3e51] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 7" [ref=f3e52] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 7" [ref=f3e53] [cursor=pointer]
        - gridcell "paper roll, column 8, row 7" [ref=f3e54] [cursor=pointer]
      - row [ref=f3e55]:
        - gridcell "green splat, column 1, row 6" [ref=f3e56] [cursor=pointer]
        - gridcell "paper roll, column 2, row 6" [ref=f3e57] [cursor=pointer]
        - gridcell "classic swirl, column 3, row 6" [ref=f3e58] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 6" [ref=f3e59] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 6" [ref=f3e60] [cursor=pointer]
        - gridcell "green splat, column 6, row 6" [ref=f3e61] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 6" [ref=f3e62] [cursor=pointer]
        - gridcell "corn nugget, column 8, row 6" [ref=f3e63] [cursor=pointer]
      - row [ref=f3e64]:
        - gridcell "green splat, column 1, row 5" [ref=f3e65] [cursor=pointer]
        - gridcell "corn nugget, column 2, row 5" [ref=f3e66] [cursor=pointer]
        - gridcell "corn nugget, column 3, row 5" [ref=f3e67] [cursor=pointer]
        - gridcell "paper roll, column 4, row 5" [ref=f3e68] [cursor=pointer]
        - gridcell "paper roll, column 5, row 5" [ref=f3e69] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 5" [ref=f3e70] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 5" [ref=f3e71] [cursor=pointer]
        - gridcell "green splat, column 8, row 5" [ref=f3e72] [cursor=pointer]
      - row [ref=f3e73]:
        - gridcell "classic swirl, column 1, row 4" [ref=f3e74] [cursor=pointer]
        - gridcell "green splat, column 2, row 4" [ref=f3e75] [cursor=pointer]
        - gridcell "paper roll, column 3, row 4" [ref=f3e76] [cursor=pointer]
        - gridcell "green splat, column 4, row 4" [ref=f3e77] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 4" [ref=f3e78] [cursor=pointer]
        - gridcell "paper roll, column 6, row 4" [ref=f3e79] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 4" [ref=f3e80] [cursor=pointer]
        - gridcell "paper roll, column 8, row 4" [ref=f3e81] [cursor=pointer]
      - row [ref=f3e82]:
        - gridcell "classic swirl, column 1, row 3" [ref=f3e83] [cursor=pointer]
        - gridcell "paper roll, column 2, row 3" [ref=f3e84] [cursor=pointer]
        - gridcell "classic swirl, column 3, row 3" [ref=f3e85] [cursor=pointer]
        - gridcell "green splat, column 4, row 3" [ref=f3e86] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 3" [ref=f3e87] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 3" [ref=f3e88] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 3" [ref=f3e89] [cursor=pointer]
        - gridcell "green splat, column 8, row 3" [ref=f3e90] [cursor=pointer]
      - row [ref=f3e91]:
        - gridcell "green splat, column 1, row 2" [ref=f3e92] [cursor=pointer]
        - gridcell "paper roll, column 2, row 2" [ref=f3e93] [cursor=pointer]
        - gridcell "classic swirl, column 3, row 2" [ref=f3e94] [cursor=pointer]
        - gridcell "corn nugget, column 4, row 2" [ref=f3e95] [cursor=pointer]
        - gridcell "corn nugget, column 5, row 2" [ref=f3e96] [cursor=pointer]
        - gridcell "paper roll, column 6, row 2" [ref=f3e97] [cursor=pointer]
        - gridcell "classic swirl, column 7, row 2" [ref=f3e98] [cursor=pointer]
        - gridcell "green splat, column 8, row 2" [ref=f3e99] [cursor=pointer]
      - row [ref=f3e100]:
        - gridcell "corn nugget, column 1, row 1" [ref=f3e101] [cursor=pointer]
        - gridcell "green splat, column 2, row 1" [ref=f3e102] [cursor=pointer]
        - gridcell "paper roll, column 3, row 1" [ref=f3e103] [cursor=pointer]
        - gridcell "green splat, column 4, row 1" [ref=f3e104] [cursor=pointer]
        - gridcell "classic swirl, column 5, row 1" [ref=f3e105] [cursor=pointer]
        - gridcell "corn nugget, column 6, row 1" [ref=f3e106] [cursor=pointer]
        - gridcell "corn nugget, column 7, row 1" [ref=f3e107] [cursor=pointer]
        - gridcell "paper roll, column 8, row 1" [ref=f3e108] [cursor=pointer]
    - toolbar "Game controls" [ref=f3e109]:
      - button "Colorblind-safe colors off, tap for high-contrast palettes and suit patterns" [ref=f3e111] [cursor=pointer]: Clr
      - button "No daily undo" [disabled] [ref=f3e112]
      - button "Practice after finish" [disabled] [ref=f3e113]
      - group [ref=f3e114]:
        - generic "Aim" [ref=f3e115] [cursor=pointer]
      - generic [ref=f3e116]: Difficulty
  - paragraph [ref=f3e117]: Pop matching groups of 2+. Arrows aim, Enter/Space pops. First run has no undo; practice does. Your challenge stays fixed at midnight.
  - link "Back to game hub" [ref=f3e119] [cursor=pointer]:
    - /url: ./
    - generic [aria-hidden] [ref=f3e120]: ←
    - generic [ref=f3e121]: Hub
  - button "Stalemate music on, tap to turn music off" [pressed] [ref=f3e122] [cursor=pointer]: 🎵
```