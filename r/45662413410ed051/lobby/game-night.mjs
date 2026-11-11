// Accept only Discord's HTTPS invites and server channel links.
const INVITE = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9_-]{2,64}$/;
const CHANNEL = /^https:\/\/discord\.com\/channels\/[0-9]{17,20}\/[0-9]{17,20}$/;

export function discordCallLink(value) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    return INVITE.test(url) || CHANNEL.test(url) ? url : '';
}

// Reserve a generated room-name format so the durable chat record stays
// readable by the previous Worker without a storage migration.
export const gameNightRoomName = name => typeof name === 'string' && /^#game-[a-f0-9]{6}x[a-f0-9]{6}$/.test(name);
