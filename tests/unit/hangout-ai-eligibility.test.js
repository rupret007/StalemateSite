// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { aiEligibility } from '../../hangout-worker/src/ai-eligibility.mjs';
import { createAiModerator } from '../../hangout-worker/src/ai-moderation.mjs';

const qualified = () => ({ HANGOUT_AI_MODERATION: 'review', HANGOUT_AI_PROVIDER_READINESS: 'qualified',
    HANGOUT_AI_CHILD_DATA_READINESS: 'qualified', OPENAI_API_KEY: 'synthetic-test-key' });

describe('trusted server AI readiness', () => {
    it('stays off by default even when credentials and qualification are present', () => {
        expect(aiEligibility()).toEqual({ requested: false, allowed: false, state: 'off', reasons: [] });
        expect(aiEligibility(null).state).toBe('off');
        for (const mode of [undefined, 'off', true, 'REVIEW', ' review ']) {
            expect(aiEligibility({ ...qualified(), HANGOUT_AI_MODERATION: mode })).toEqual({
                requested: false, allowed: false, state: 'off', reasons: [] });
        }
    });

    it('requires separate provider and child-data qualification, with credentials', () => {
        expect(aiEligibility({ HANGOUT_AI_MODERATION: 'review' })).toEqual({ requested: true, allowed: false,
            state: 'not-qualified', reasons: ['provider-not-qualified', 'child-data-not-qualified', 'provider-not-configured'] });
        for (const field of ['HANGOUT_AI_PROVIDER_READINESS', 'HANGOUT_AI_CHILD_DATA_READINESS']) {
            for (const value of [undefined, null, false, true, 'approved', 'Qualified', 'qualified ']) {
                expect(aiEligibility({ ...qualified(), [field]: value })).toMatchObject({ allowed: false, state: 'not-qualified' });
            }
        }
        for (const key of ['', '  ', undefined, false]) {
            expect(aiEligibility({ ...qualified(), OPENAI_API_KEY: key }).reasons).toEqual(['provider-not-configured']);
        }
        expect(aiEligibility(qualified())).toEqual({ requested: true, allowed: true, state: 'provider-ready', reasons: [] });
    });

    it('ignores client assertions, age checkboxes, roles and unrelated configuration', () => {
        const claims = { age13: true, adult18: true, age: 18, consent: true, parentalConsent: true,
            providerReady: true, childDataReady: true, role: 'owner', eligibility: { allowed: true } };
        const server = { HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'synthetic-test-key' };
        expect(aiEligibility({ ...server, ...claims }, qualified())).toEqual(aiEligibility(server));
        expect(aiEligibility({ ...qualified(), ...claims })).toEqual(aiEligibility(qualified()));
    });

    it('does not cache an approval after trusted configuration changes', () => {
        const env = qualified();
        expect(aiEligibility(env).allowed).toBe(true);
        env.HANGOUT_AI_CHILD_DATA_READINESS = 'not-qualified';
        expect(aiEligibility(env)).toMatchObject({ allowed: false, reasons: ['child-data-not-qualified'] });
        env.HANGOUT_AI_MODERATION = 'off';
        expect(aiEligibility(env).state).toBe('off');
    });

    it('returns immutable, content-free status without exposing secrets or submitted claims', () => {
        const env = { ...qualified(), email: 'person@example.invalid', text: 'private content', age: 12 };
        const result = aiEligibility(env);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.reasons)).toBe(true);
        expect(() => result.reasons.push('forged')).toThrow();
        expect(Object.keys(result).sort()).toEqual(['allowed', 'reasons', 'requested', 'state']);
        const serialized = JSON.stringify(result);
        for (const privateValue of [env.OPENAI_API_KEY, env.email, env.text]) expect(serialized).not.toContain(privateValue);
    });

    it('prevents adapter/provider work for every missing readiness requirement', async () => {
        const fetchImpl = vi.fn(() => { throw new Error('A blocked configuration must never fetch'); });
        const variants = [undefined, { HANGOUT_AI_MODERATION: 'review', OPENAI_API_KEY: 'synthetic-test-key' },
            { ...qualified(), HANGOUT_AI_PROVIDER_READINESS: 'not-qualified' },
            { ...qualified(), HANGOUT_AI_CHILD_DATA_READINESS: 'not-qualified' },
            { ...qualified(), OPENAI_API_KEY: '' }];
        for (const env of variants) {
            const moderator = createAiModerator({ enabled: aiEligibility(env).allowed,
                apiKey: env?.OPENAI_API_KEY, fetchImpl });
            expect(await moderator.review({ text: 'Synthetic public message', age13: true, consent: true }))
                .toEqual({ status: 'unavailable', reason: 'disabled' });
            expect(moderator.status()).toMatchObject({ used: 0, pending: 0, checked: 0 });
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
