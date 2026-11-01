'use strict';

const DEFAULT_TEST_PORT = 4320;
const TITLE_NEEDLE = 'Stalemate';
const HANGOUT_RELAY_PREFIX = '/__hangout-relay';

function resolveTestPort(env = process.env) {
    const rawTestPort = env.STALEMATE_TEST_PORT || String(DEFAULT_TEST_PORT);
    const testPort = Number(rawTestPort);

    if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) {
        throw new Error('STALEMATE_TEST_PORT must be an integer between 1024 and 65535.');
    }

    return testPort;
}

function testBaseURL(env = process.env) {
    return `http://127.0.0.1:${resolveTestPort(env)}`;
}

function homepageTitle(html) {
    const match = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function assertStalemateHomepage(html, origin) {
    const title = homepageTitle(html);

    if (!title.includes(TITLE_NEEDLE)) {
        const shown = title ? JSON.stringify(title) : 'is missing';
        throw new Error(
            `Refusing to run e2e against ${origin || 'the test origin'}: homepage title ${shown} is not a Stalemate server. A different process may be occupying the port.`
        );
    }

    return title;
}

async function assertStalemateTestOrigin(origin) {
    let response;

    try {
        response = await fetch(origin, {
            redirect: 'follow',
            signal: AbortSignal.timeout(10000)
        });
    } catch (error) {
        throw new Error(`Refusing to run e2e: could not reach ${origin} (${error.message}).`);
    }

    if (!response.ok) {
        throw new Error(`Refusing to run e2e against ${origin}: HTTP ${response.status}.`);
    }

    return assertStalemateHomepage(await response.text(), origin);
}

function hangoutRelayPath(namespace = '') {
    if (!namespace) return HANGOUT_RELAY_PREFIX;
    if (typeof namespace !== 'string' || !/^[a-z0-9-]{1,80}$/.test(namespace)) {
        throw new Error('Hangout test namespace must contain 1-80 lowercase letters, digits or hyphens.');
    }
    return `${HANGOUT_RELAY_PREFIX}/sessions/${namespace}`;
}

function parseHangoutRelayPath(pathname) {
    if (pathname !== HANGOUT_RELAY_PREFIX && !pathname.startsWith(`${HANGOUT_RELAY_PREFIX}/`)) return null;
    const suffix = pathname.slice(HANGOUT_RELAY_PREFIX.length) || '/';
    if (suffix === '/sessions' || suffix.startsWith('/sessions/')) {
        const match = /^\/sessions\/([a-z0-9-]{1,80})(\/.*)?$/.exec(suffix);
        return match ? { namespace: match[1], pathname: match[2] || '/' } : null;
    }
    return { namespace: '', pathname: suffix };
}

function hangoutRelayWsBase(origin, namespace = '') {
    return new URL(hangoutRelayPath(namespace), origin).href.replace(/^http/, 'ws');
}

module.exports = {
    DEFAULT_TEST_PORT,
    HANGOUT_RELAY_PREFIX,
    TITLE_NEEDLE,
    resolveTestPort,
    testBaseURL,
    hangoutRelayPath,
    parseHangoutRelayPath,
    hangoutRelayWsBase,
    homepageTitle,
    assertStalemateHomepage,
    assertStalemateTestOrigin
};
