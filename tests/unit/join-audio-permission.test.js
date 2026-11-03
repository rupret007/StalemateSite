// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { acquireMusicStream } from '../../join/audio.js';

describe('Web Join microphone permission errors', () => {
    it('maps NotAllowedError to an actionable status message', async () => {
        const mediaDevices = {
            getUserMedia: vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }),
        };
        await expect(acquireMusicStream(mediaDevices)).rejects.toThrow(/Microphone access was blocked/);
    });
});

describe('Web Join first-run checklist copy', () => {
    it('lists headphones, microphone and host-trust steps before Join', () => {
        const html = readFileSync(new URL('../../join/index.html', import.meta.url), 'utf8');
        expect(html).toContain('aria-label="Before you join"');
        expect(html).toMatch(/headphones on/i);
        expect(html).toMatch(/Microphone ready/i);
        expect(html).toMatch(/trust the host/i);
    });
});
