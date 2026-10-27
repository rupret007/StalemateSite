// Production composition only. This does not install a policy, enroll a person,
// verify guardianship or enable provider dispatch.
import { createParticipationEnforcement } from './participation-enforcement.mjs';
import { readPartitionedParticipationPrincipals, readPartitionedParticipationWithdrawals, readPartitionedParticipationPreparation } from './participation-partitions.mjs';

export const LOBBY_PARTICIPATION_MODE = 'c3-v1';
export function lobbyParticipationMode(env = {}) {
    if (env.HANGOUT_PARTICIPATION_AUTHORITY === undefined) return false;
    if (env.HANGOUT_PARTICIPATION_AUTHORITY !== LOBBY_PARTICIPATION_MODE
        || env.HANGOUT_BETA_MODE !== 'protected' || env.HANGOUT_SESSION_AUTHORITY !== 'lobby-v1') throw Error('participation-not-configured');
    return true;
}
export function participationConfigurationValid(env) {
    try { lobbyParticipationMode(env); return true; } catch { return false; }
}

export function createLobbyParticipation({ env, authority, dispatchStart = null, now = () => Date.now() } = {}) {
    if (!lobbyParticipationMode(env)) return null;
    if (!authority || typeof authority.records?.transaction !== 'function'
        || ['resolveParticipationConnection', 'validateParticipationConnection', 'writeParticipationEffects'].some(name => typeof authority[name] !== 'function')
        || authority.resolveParticipationConnections !== undefined && typeof authority.resolveParticipationConnections !== 'function'
        || dispatchStart !== null && typeof dispatchStart !== 'function') throw Error('participation-authority-unavailable');
    return createParticipationEnforcement({
        storage: authority.records,
        resolveConnection: connection => authority.resolveParticipationConnection(connection),
        ...(authority.resolveParticipationConnections === undefined ? {} : { resolveConnections: connections => authority.resolveParticipationConnections(connections) }),
        validateConnection: input => authority.validateParticipationConnection(input),
        readPrincipals: readPartitionedParticipationPrincipals,
        readWithdrawn: readPartitionedParticipationWithdrawals,
        readPreparation: readPartitionedParticipationPreparation,
        writeEffects: input => authority.writeParticipationEffects(input),
        ...(dispatchStart === null ? {} : { dispatchStart }),
        // Supplying an owner fence does not qualify provider, quota, result or
        // child-data integration. Production provider admission stays off.
        providerQualified: () => false,
        now
    });
}
