# Vendored for opt-in camera backgrounds (loaded only when someone picks one)

- `track-processors.mjs`: @livekit/track-processors 0.8.2 (Apache-2.0, see LICENSE-livekit-track-processors), bundled with esbuild 0.24 together with @mediapipe/tasks-vision 0.10.14 (Apache-2.0, Google, see LICENSE-mediapipe). The single `livekit-client` import (`getLogger`) is replaced by a silent shim; no LiveKit server or SDK is used.
- `wasm/vision_wasm_internal.{js,wasm}`: @mediapipe/tasks-vision 0.10.14 SIMD build (Apache-2.0). No non-SIMD build is shipped; browsers without WebAssembly SIMD simply don't get backgrounds.
- `selfie_segmenter.tflite`: MediaPipe selfie segmenter float16 model (Apache-2.0), from storage.googleapis.com/mediapipe-models.
- `bg/*.png`: Stalemate presets drawn for this repo.

Everything is self-hosted: picking a background makes no third-party request, and camera frames never leave the device for it.
Rebuild: `npm i @livekit/track-processors@0.8.2 @mediapipe/tasks-vision@0.10.14 esbuild@0.24`, then
`esbuild entry.js --bundle --format=esm --minify --alias:livekit-client=./shim.js --legal-comments=eof` (sources in `build/`).

## Source and attribution records

`PROVENANCE.json` records the exact npm archive integrity values, copied SIMD
asset hashes and immutable model generation. The combined bundle was not
independently rebuilt during this comparison; a package identity is not a
claim of bit-for-bit combined build reproducibility.

The MediaPipe source map supplied with 0.10.14 retains:

> Copyright The Closure Library Authors.
> SPDX-License-Identifier: Apache-2.0

Those notices and the local bundling/logger-shim modification are retained in
the `track-processors.mjs` banner. The full shipped MediaPipe license is byte
identical to upstream tag v0.10.14 and includes the Lucent notice; the npm
archive itself contains no separate LICENSE or NOTICE file.

The shipped model exactly matches square SelfieSegmenter float16 version 1,
Google Storage generation `1683436452886295`, SHA-256
`191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`.
Its [official model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)
labels the model Apache License, Version 2.0. The immutable download address
and model-card hash are recorded in `PROVENANCE.json`.
