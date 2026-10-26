// A receipt can authenticate text a witness still has without retaining a chat archive.
// Metadata comes exclusively from the server; the browser can supply only the exact text.
import { createHash } from 'node:crypto';

export function receiptDigest(line, authorDev, text = line.text, publicOrigin = line.publicOrigin) {
    return createHash('sha256').update(JSON.stringify([
        publicOrigin ? 'hangout-delivered-public-line-v2' : 'hangout-delivered-line-v1', line.t, line.id, line.ch, line.from, line.to || '',
        line.prefix || '', !!line.band, !!line.moderator, !!line.me, line.ts, authorDev, text,
        ...(publicOrigin ? [publicOrigin] : [])
    ])).digest('hex');
}

export function messageReceipt(line, meta) {
    return {
        t: line.t, id: line.id, ch: line.ch, from: line.from, to: line.to || '',
        prefix: line.prefix || '', band: !!line.band, moderator: !!line.moderator, me: !!line.me,
        ts: line.ts, authorDev: meta.authorDev, digest: receiptDigest(line, meta.authorDev, line.text, meta.publicOrigin),
        recipients: [...meta.recipients], ...(meta.publicOrigin ? { publicOrigin: { ...meta.publicOrigin } } : {})
    };
}
