'use strict';

const fs = require('node:fs');
const SOURCE = '/etc/apt/sources.list.d/ubuntu.sources';
const AZURE = 'http://azure.archive.ubuntu.com/ubuntu/';
const OFFICIAL = 'https://archive.ubuntu.com/ubuntu/';

function officialSource(text) {
    if (!text.includes('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg') ||
        !text.includes('Suites: noble noble-updates noble-backports')) {
        throw new Error('Unexpected Ubuntu source contract');
    }
    const lines = text.split('\n').filter(line => line.startsWith('URIs: '));
    if (lines.length !== 2 || ![`URIs: ${AZURE}`, `URIs: ${OFFICIAL}`].includes(lines[0]) ||
        lines[1] !== 'URIs: http://security.ubuntu.com/ubuntu/') {
        throw new Error('Unexpected Ubuntu archive origins');
    }
    return text.replace(`URIs: ${AZURE}`, `URIs: ${OFFICIAL}`);
}

module.exports = { officialSource };
if (require.main === module) {
    try {
        if (process.platform !== 'linux' || process.getuid() !== 0 ||
            process.env.GITHUB_ACTIONS !== 'true' || !fs.existsSync('/.dockerenv')) {
            throw new Error('Mirror selection is only for the isolated GitHub CI container');
        }
        const stat = fs.lstatSync(SOURCE);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ubuntu source must be a regular file');
        const before = fs.readFileSync(SOURCE, 'utf8');
        const after = officialSource(before);
        if (before !== after) fs.writeFileSync(SOURCE, after);
        console.log('Official Ubuntu HTTPS archive selected; suites and signature key unchanged');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
