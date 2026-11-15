import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
const mobileStart = css.indexOf('@media (max-width: 900px) and (pointer: coarse)');
const mobile = css.slice(mobileStart, css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart));

describe('Turdanoid phone layout contract', () => {
    it('uses a viewport bounded play surface with visible return and launch controls', () => {
        expect(mobile).toMatch(/\.arcade-brick-race\[open\]:has\(\[data-brick-match\]:not\(\[hidden\]\)\)[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?height: 100dvh;/);
        expect(css).toMatch(/\.brick-race-actions:has\(\[data-brick-back\]:not\(\[hidden\]\)\)\s*\{[^}]*display: flex/);
        expect(mobile).toMatch(/\.brick-race-actions \.btn\s*\{[^}]*min-height: 44px/);
        expect(mobile).toMatch(/\.brick-race-rail \[data-brick-serve\]\s*\{[^}]*grid-column: 1 \/ -1/);
        expect(mobile).toMatch(/\.brick-race-help\s*\{[^}]*position: static/);
    });

    it('bounds the landscape board by viewport height and keeps a score rail beside it', () => {
        const landscape = mobile.slice(mobile.indexOf('@media (max-height: 450px)'));
        expect(landscape).toMatch(/\.brick-race-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 10rem/);
        expect(landscape).toMatch(/\.brick-race-board\s*\{[^}]*width: min\(calc\(\(100dvh - 180px\) \* 1\.2\), calc\(100dvw - 190px\)\)/);
        const width = Math.min((390 - 180) * 1.2, 844 - 190);
        expect(width / 1.2).toBeLessThanOrEqual(210);
    });
});
