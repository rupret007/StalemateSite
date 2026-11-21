// A receipt can authenticate text a witness still has without retaining a chat archive.
// Metadata comes exclusively from the server; the browser can supply only the exact text.
import { createHash } from 'node:crypto';

export const RECEIPT_MAX = 1000;
export const RECEIPT_STATE_BYTES = 1024 * 1024;

export function receiptDigest(line, authorDev, text = line.text, publicOrigin = line.publicOrigin) {
    return createHash('sha256').update(JSON.stringify([
        publicOrigin ? 'hangout-delivered-public-line-v2' : 'hangout-delivered-line-v1', line.t, line.id, line.ch, line.from, line.to || '',
        line.prefix || '', !!line.band, !!line.moderator, !!line.me, line.ts, authorDev, text,
        ...(publicOrigin ? [publicOrigin] : [])
    ])).digest('hex');
}

export function messageReceipt(line, { authorDev, recipients, publicOrigin }) {
    return {
        t: line.t, id: line.id, ch: line.ch, from: line.from, to: line.to || '',
        prefix: line.prefix || '', band: !!line.band, moderator: !!line.moderator, me: !!line.me,
        ts: line.ts, authorDev, digest: receiptDigest(line, authorDev, line.text, publicOrigin),
        recipients, ...(publicOrigin ? { publicOrigin: { ...publicOrigin } } : {})
    };
}

// Session storage may pack older rows as JSON. The same receipt bounds and
// validation apply to the combined rows after unpacking.
export function storedReceipts(session) {
    const { receipts, receiptArchive } = session;
    if (!Array.isArray(receipts) || receipts.length > RECEIPT_MAX) return null;
    if (!Object.hasOwn(session, 'receiptArchive')) return receipts;
    if (typeof receiptArchive !== 'string' || receiptArchive.length > RECEIPT_STATE_BYTES) return null;
    try {
        const older = JSON.parse(receiptArchive);
        if (Array.isArray(older) && older.length + receipts.length <= RECEIPT_MAX) return older.concat(receipts);
    } catch { /* Keep invalid receipt data out of the live session. */ }
    return null;
}
