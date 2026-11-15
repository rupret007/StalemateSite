// @vitest-environment node
// Runs the re-grade screenshot script's cases, which live next to the script.
import { describe, it } from 'vitest';
import { cases } from '../../scripts/family-alpha-regrade-shots.test.mjs';

describe('family-alpha re-grade screenshot script', () => {
    it.each(cases)('%s', (_name, run) => run());
});
