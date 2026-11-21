'use strict';

const room = require('../../support/product-room.cjs');

// Public e2e routes use a synthetic slug. serve-test rewrites them onto the
// discovered product directory, so specs never name that directory.
const LOBBY = room.roomPath('lobby/');
const ROOM = room.roomPath();

function lobbyPathPattern() {
    return new RegExp(`/r/${room.TEST_SLUG}/lobby/`);
}

module.exports = {
    ...room,
    LOBBY,
    ROOM,
    lobbyPathPattern
};
