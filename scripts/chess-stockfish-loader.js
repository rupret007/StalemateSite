// SPDX-License-Identifier: GPL-3.0-or-later
// Stalemate's static host omits the WASM MIME type. Keep the pinned engine and
// its download stream intact; normalize only this successful same-origin file.
const wasmUrl = new URL('stockfish-19-lite-single.wasm', self.location.href).href;
const engineFetch = self.fetch.bind(self);
self.fetch = async function (input, options) {
  const response = await engineFetch(input, options);
  const url = new URL(typeof input === 'string' ? input : input.url || String(input), self.location.href);
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (url.href !== wasmUrl || !response.ok || mime === 'application/wasm') return response;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/wasm');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

// The URL fragment supplied by chess-engine.js is Stockfish's supported custom
// WASM path; it keeps its original binary URL when loaded through this worker.
importScripts('stockfish-19-lite-single.js');
