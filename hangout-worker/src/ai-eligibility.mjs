// Server configuration only. This gate never examines a visitor's age, content,
// consent checkbox or claimed role, and never contacts a provider.
// "qualified" records the operator's external readiness decision; it is not a
// legal certification, parental consent record or proof of provider availability.
const qualified = value => value === 'qualified';

export function aiEligibility(env = {}) {
    const requested = env?.HANGOUT_AI_MODERATION === 'review';
    if (!requested) return Object.freeze({ requested: false, allowed: false,
        state: 'off', reasons: Object.freeze([]) });

    const reasons = [];
    if (env?.HANGOUT_SESSION_AUTHORITY === 'lobby-v1') reasons.push('session-start-fence-not-qualified');
    if (!qualified(env?.HANGOUT_AI_PROVIDER_READINESS)) reasons.push('provider-not-qualified');
    if (!qualified(env?.HANGOUT_AI_CHILD_DATA_READINESS)) reasons.push('child-data-not-qualified');
    if (typeof env?.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) reasons.push('provider-not-configured');
    return Object.freeze({ requested: true, allowed: reasons.length === 0,
        state: reasons.length ? 'not-qualified' : 'provider-ready', reasons: Object.freeze(reasons) });
}
