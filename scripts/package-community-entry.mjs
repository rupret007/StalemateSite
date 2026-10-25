// Produces public link snippets only. Never copies the repository or deploys it.
import fs from 'node:fs';
import path from 'node:path';
import { communityIntegration, communityLinkHtml, communityPublicManifest } from '../hangout-worker/src/community-integration.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--out')
    throw new Error('Usage: node scripts/package-community-entry.mjs --config reviewed.json --out NEW_DIRECTORY');
const configPath = path.resolve(args[1]);
if (fs.statSync(configPath).size > 32768) throw new Error('Public integration configuration is too large.');
const integration = communityIntegration(JSON.parse(fs.readFileSync(configPath, 'utf8')));
if (!integration.sites.some((site) => site.enabled)) throw new Error('No reviewed site integration is enabled; no package was written.');
const output = path.resolve(args[3]);
// Exclusive creation prevents accidentally replacing another release/artifact.
fs.mkdirSync(output);
const created = [];
const write = (name, contents) => {
    const file = path.join(output, name);
    const fd = fs.openSync(file, 'wx');
    try {
        const { dev, ino } = fs.fstatSync(fd);
        created.push({ file, dev, ino });
        fs.writeFileSync(fd, contents);
    } finally { fs.closeSync(fd); }
};
try {
    for (const site of integration.sites.filter((entry) => entry.enabled)) {
        write(`${site.id}.html`, communityLinkHtml(integration, site.id));
    }
    write('manifest.json', `${JSON.stringify(communityPublicManifest(integration), null, 2)}\n`);
    write('README.txt', 'Public entry links for one shared Hang Out community.\nOnly reviewed public values belong in addresses and labels; never include credentials or invitation codes.\nThe builder does not read cookies/credentials, grant staff permissions, verify domains, deploy sites or modify server origin policies.\nOperator domain verification and the exact release URL must be confirmed separately.\nAdditional approved badge sites must also be configured in HANGOUT_ENTRY_SITES.\n');
} catch (error) {
    // Remove only files this invocation actually created. Never recursively
    // erase a path if another process added or replaced something there.
    for (const entry of created.reverse()) {
        try {
            const stat = fs.lstatSync(entry.file);
            if (stat.isFile() && stat.dev === entry.dev && stat.ino === entry.ino) fs.unlinkSync(entry.file);
        } catch { /* Preserve the original build failure. */ }
    }
    try { fs.rmdirSync(output); } catch { /* Foreign files are left intact. */ }
    throw error;
}
console.log(`Prepared ${integration.sites.filter((entry) => entry.enabled).length} public site links.`);
