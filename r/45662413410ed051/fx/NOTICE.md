# Vendored for opt-in camera backgrounds (loaded only when someone picks one)

- `track-processors.mjs`: @livekit/track-processors 0.8.2 (Apache-2.0, see LICENSE-livekit-track-processors), bundled with esbuild 0.24 together with @mediapipe/tasks-vision 0.10.14 (Apache-2.0, Google). The single `livekit-client` import (`getLogger`) is replaced by a silent shim; no LiveKit server or SDK is used.
- `wasm/vision_wasm_internal.{js,wasm}`: @mediapipe/tasks-vision 0.10.14 SIMD build (Apache-2.0). No non-SIMD build is shipped; browsers without WebAssembly SIMD simply don't get backgrounds.
- `selfie_segmenter.tflite`: MediaPipe selfie segmenter float16 model (Apache-2.0), from storage.googleapis.com/mediapipe-models.
- `bg/*.png`: Stalemate presets drawn for this repo.

Everything is self-hosted: picking a background makes no third-party request, and camera frames never leave the device for it.
Rebuild: `npm i @livekit/track-processors@0.8.2 @mediapipe/tasks-vision@0.10.14 esbuild@0.24`, then
`esbuild entry.js --bundle --format=esm --minify --alias:livekit-client=./shim.js --legal-comments=eof` (sources in `build/`).
