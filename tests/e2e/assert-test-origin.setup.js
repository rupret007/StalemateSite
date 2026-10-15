const { testBaseURL, assertStalemateTestOrigin } = require('../../scripts/lib/e2e-test-server.cjs');

module.exports = async function assertTestOrigin() {
    await assertStalemateTestOrigin(testBaseURL(process.env));
};
