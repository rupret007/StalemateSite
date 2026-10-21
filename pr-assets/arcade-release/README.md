# Actual arcade candidate evidence

Captured October21,2026 from StalemateSite with upstream5160ba6. All named root PNGs are actual integrated candidate renders, inspected at gameplay size. capture.json records zero page errors. daily-share.png is the actual exported1200×630 result image.

Phone images and browser checks use emulation, not physical-device acceptance. Full-page hub images include the fixed site footer at the original viewport position.

To recapture, run the site test server and `node pr-assets/arcade-release/capture-candidate.cjs`; STALEMATE_CAPTURE_BASE can select another local preview. Do not present iterations/, failed-site-first/ or failed-site-ci-first/ as current candidate screens.

validation/ preserves first failures separately from retries and final gates. sync-evidence.json records164 byte-identical files after repeating the exact committed import. No main merge or deployment is represented.
