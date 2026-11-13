import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../../shots');
const code = /[a-f0-9]{32,}/i;

export async function shoot(page, name) {
    await page.evaluate(() => {
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    });
    const visible = await page.locator('body').innerText();
    if (code.test(visible) || /invite=/i.test(visible)) throw new Error('Refusing to save a screenshot that shows a code.');
    if (await page.locator('#code').isVisible().catch(() => false)) throw new Error('Refusing to save the invitation form.');
    await mkdir(shots, { recursive: true });
    const edited = await page.evaluateHandle(() => {
        const changes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const cleaned = node.textContent.replace(/#?game-[a-z0-9]{4,}x[a-z0-9]{4,}/gi, 'Game Night');
            if (cleaned !== node.textContent) {
                changes.push([node, node.textContent]);
                node.textContent = cleaned;
            }
        }
        for (const field of document.querySelectorAll('input, textarea')) {
            if (/[a-f0-9]{16,}/i.test(field.value)) {
                changes.push([field, field.value, 'value']);
                field.value = '';
            }
        }
        return changes;
    });
    try {
        await page.screenshot({ path: join(shots, name), animations: 'disabled' });
    } finally {
        await edited.evaluate(changes => {
            for (const change of changes) {
                if (change[2] === 'value') change[0].value = change[1];
                else change[0].textContent = change[1];
            }
        });
        await edited.dispose();
    }
}
