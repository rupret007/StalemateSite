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
console.log(`Built private ${target} assets. Deploy with wrangler.${target}.toml only.`);
