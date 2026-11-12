// Version 1 of the shared lobby roster wire format. Keep the flag order
// fixed so a cached browser and a newer Worker can read the same snapshots.
const FLAGS = ['band', 'moderator', 'verified', 'owner', 'away', 'cam', 'busy'];
const MAX_MEMBERS = 200;

export function packLobbyRoster(members) {
    return members.map(member => [
        member.id, member.nick, member.entrySource, member.prefix,
        FLAGS.reduce((bits, flag, index) => bits | (member[flag] ? 1 << index : 0), 0),
    ]);
}

export function unpackLobbyRoster(rows) {
    if (!Array.isArray(rows) || rows.length > MAX_MEMBERS) return null;
    const members = [];
    for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 5) return null;
        const [id, nick, entrySource, prefix, bits] = row;
        if (typeof id !== 'string' || typeof nick !== 'string' || typeof entrySource !== 'string' || typeof prefix !== 'string'
            || !Number.isInteger(bits) || bits < 0 || bits >= (1 << FLAGS.length)) return null;
        const member = { id, nick, entrySource, prefix };
        for (const [index, flag] of FLAGS.entries()) {
            const enabled = (bits & (1 << index)) !== 0;
            if (flag !== 'busy' || enabled) member[flag] = enabled;
        }
        members.push(member);
    }
    return members;
}
