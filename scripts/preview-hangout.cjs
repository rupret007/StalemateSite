'use strict';

// Runs only the loopback stand-in relay. This does not configure or deploy a Worker.
process.env.STALEMATE_TEST_PORT ||= '4387';
const { testBaseURL, hangoutRelayWsBase } = require('./lib/e2e-test-server.cjs');
const base = testBaseURL(process.env);
const query = new URLSearchParams({ preview: 'local-preview-key-0001', relay: hangoutRelayWsBase(base) });
console.log(`Hang Out local preview: ${base}/r/45662413410ed051/lobby/?${query}`);
console.log('Choose a guest nickname. Use another browser profile for a second visitor. Ctrl+C stops the preview.');
require('./serve-test.cjs');
