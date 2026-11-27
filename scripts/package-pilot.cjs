'use strict';
// Build only the protected collaboration assets. The pilot Worker authenticates every asset request.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = process.argv[2] || 'pilot';
if (!['pilot', 'beta'].includes(target)) throw new Error('Choose pilot or beta assets.');
const out = path.join(root, `.${target}-assets`);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const dir of ['r', 'assets', ...(target === 'beta' ? ['join'] : [])]) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
const rooms = path.join(out, 'r');
for (const room of fs.readdirSync(rooms, { withFileTypes: true })) {
    if (!room.isDirectory()) continue;
    const index = path.join(rooms, room.name, 'index.html');
    if (!fs.existsSync(index)) continue;
    const html = fs.readFileSync(index, 'utf8');
    // Protected rooms return to their own authenticated lobby.
    const privateLobby = html.replace(/(<a class="show-link lobby-link" href=")https:[^"]+"/, '$1lobby/"');
    if (privateLobby !== html) fs.writeFileSync(index, privateLobby);
}
console.log(`Built private ${target} assets. Deploy with wrangler.${target}.toml only.`);
