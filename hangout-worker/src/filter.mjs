// StaleBot's word + personal-info filter. Server-side only (the browser can't skip it).
// Jeff's rule: "Don't be a dick." Swearing is part of speech and is NOT filtered. We target abuse: slurs/hate,
// insults aimed at a person (held for a band op), threats, sexual content, doxxing/personal info, and spam.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// Words from the obscenity preset that stay allowed in a punk band's chat.
// Plain profanity from the obscenity preset: always allowed on its own.
export const MILD_OK = Object.freeze(['arse', 'ass', 'bastard', 'bollocks', 'piss', 'shit', 'fuck', 'turd', 'bitch', 'dick', 'prick', 'cock', 'twat', 'wank', 'cuck', 'cunt', 'tit', 'boob']);
// Words a band op can add to the hold list from the panel. Empty by default: profanity isn't held.
export const HOLD_PRESET = Object.freeze([]);
// Aimed at a person = held for a band op to OK (insults), or blocked outright (threats / self-harm baiting).
const AT_YOU = String.raw`(?:you|u|ur|you're|youre|your|ya)`;
const INSULT = String.raw`(?:idiot|stupid|loser|moron|ugly|fat|trash|garbage|worthless|dumb|bitch|dick|prick|cunt|twat|asshole|arsehole|bastard|piece of shit|pos|freak|creep|pathetic|waste of space)`;
const DIRECTED = new RegExp(String.raw`\b${AT_YOU}\b(?:\s+\w+){0,3}?\s+(?:a\s+|an\s+|such\s+a\s+|so\s+|are\s+a\s+|r\s+a\s+)?${INSULT}\b|\b(?:shut up|stfu|nobody likes|everyone hates)\s+${AT_YOU}\b`, 'i');
const THREAT = /\bkys\b|\bkill (?:your ?self|urself|yourself)\b|\b(?:i'?ll|i will|gonna|going to|im gonna|i'm gonna)\s+(?:kill|hurt|find|stab|shoot|beat up|dox)\s+(?:you|u|ya|him|her|them)\b|\bdie in a fire\b|\bhope (?:you|u) die\b|\bi know where (?:you|u) live\b/i;

// Sexual content aimed at someone. Plain words (dick/cock/tit/boob) stay OK as swearing ("cock-up"),
// but these phrasings are blocked even though each word alone is in MILD_OK.
const BODY = String.raw`(?:dick|cock|penis|tits?|titties|boobs?|boobies|pussy|nipples?|clit|balls|ass|butt)`;
const MUSIC = String.raw`(?:riffs?|solos?|tone|songs?|tracks?|tunes?|sets?|guitars?|bass|basslines?|drums?|drumming|fills?|grooves?|beats?|licks?|chorus|hooks?|jams?|shows?|gigs?|bands?|amps?|pedals?|painting|paintings|drawing|sketch|canvas|vocals?|voice|scream|breakdown|mosh|pit|stage|sound|mix|record|album|ep|cover|playing|chops)`;
// A music word followed by a person ("nice ass bass player") is about the person, so the exception doesn't apply.
const PEOPLE = String.raw`(?:girls?|gurls?|guys?|babes?|baby|players?|chicks?|boys?|lad(?:y|ies|s)?|wom[ae]n|m[ae]n|mans|gals?|grls?|hott(?:ie|y)s?|cuties?|kid|kids|person|people|singers?|drummers?|bassists?|guitarists?|vocalists?|shawty|mama|daddy|mommy|she|he|her|him|you|u|ya)`;
const SEXUAL = new RegExp([
    String.raw`\b(?:suck|lick|blow|ride|touch|grab|rub|stroke|eat|sit on|play with)\s+(?:on\s+)?(?:my|your|ur|his|her|their|this|that)\s+${BODY}\b`,
    String.raw`\b(?:send|show|see|post|share|drop|flash)\s+(?:me\s+|us\s+)?(?:(?:your|ur|ya|some|a|my|them|those)\s+)?(?:${BODY}|nudes?|naked)(?:\s*(?:pics?|pix|pictures?|photos?|vids?))?\b`,
    String.raw`\b(?:dick|cock|tit|titty|boob|nude|nudie)\s*(?:pics?|pix)\b`,
    // "nice ass riff" / "big ass amp" is a compliment on the music; "nice ass" on its own (or at a person) is not.
    String.raw`\b(?:nice|sexy|hot|great|big|juicy)\s+(?:(?:tits?|titties|boobs?|boobies|rack|dick|cock|pussy|nipples?)\b|(?:ass|butt)\b(?!\s*-?\s*(?:${MUSIC})\b(?!(?:\s+(?:${MUSIC}))?\s+(?:${PEOPLE})\b)))`,
    String.raw`\b(?:sit|sitting|sat|squat|ride|riding)\s+on\s+(?:my|your|ur|his|her|their|this|me|ya)\s+(?:face|lap|dick|cock|mouth)\b|\bface\s*-?\s*sit(?:ting)?\b|\b(?:ride|riding)\s+(?:my|your|ur)\s+face\b`,
    String.raw`\b(?:wanna|wan na|want to|i want to|let'?s|lets|gonna|i'?d|i would|can i|could i)\s+(?:fuck|bang|screw|shag|hook up with)\s*(?:me|you|u|ya|her|him|them|tonight|\?|$)`
].join('|'), 'i');
// Targeted 'cunt' (Jeff: swearing is fine, aimed at a person = held for a band op like other insults).
const CUNT_AT = /\b(?:is|was|are|r|you|u|ya|ur|youre|you're|ure)\s+(?:(?:a|an|such a|such|total|fucking|fuckin|absolute|right|little|stupid|dumb)\s+){0,3}cunts?\b(?!\s+of\b)|\b(?:shut up|stfu|fuck off|piss off|get lost|go away|bye|oi|hey)\s*,?\s*(?:you\s+)?(?:(?:fucking|fuckin|stupid|dumb|little)\s+)?cunts?\b|\bcunts?\s+like\s+(?:you|u)\b/i;
// Phone numbers spelled out ("two one four, five five five, oh one nine nine"). Plain ascending count-ins are fine.
const DIGIT_WORDS = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const DTOK = String.raw`(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)`;
const SPELLED_PHONE = new RegExp(String.raw`(?<![a-z0-9])${DTOK}(?:[\s.,()\/-]*${DTOK}(?![a-z])){6,}`, 'gi');
function spelledPhone(text) {
    for (const m of text.match(SPELLED_PHONE) || []) {
        const toks = m.toLowerCase().match(/zero|oh|one|two|three|four|five|six|seven|eight|nine|\d/g) || [];
        if (!toks.some((t) => /[a-z]/.test(t))) continue; // all digits: PHONE already handles that
        const ds = toks.map((t) => (t in DIGIT_WORDS ? DIGIT_WORDS[t] : Number(t)));
        if (ds.every((d, i) => i === 0 || d === ds[i - 1] + 1)) continue; // "one two three four five six seven"
        return true;
    }
    return false;
}

const presetMatcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers
});
const wordOf = (m) => englishDataset.getPayloadWithPhraseMetadata(m).phraseMetadata.originalWord;

const BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

// NFKC, drop bidi overrides / zero-widths / control chars, and cap combining-mark floods (Zalgo).
export function normalize(input, max = 300) {
    let s = String(input ?? '').normalize('NFKC').replace(BIDI, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
    s = s.replace(/(\p{M}{2})\p{M}+/gu, '$1');
    return s.slice(0, max);
}

const PHONE = /(?:\+?\d[\s.\-()]*){7,}/;
const EMAIL = /[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[A-Za-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[A-Za-z]{2,}/i;
const ADDRESS = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pkwy|parkway|cir|circle|pl|place|hwy|highway)\b/i;
const CONTACT = /\b(?:snap|sc|insta|ig|instagram|discord|whatsapp|whats app|kik|telegram|tg|tiktok|facebook|fb|venmo|cashapp|cash app|text|call|dm|pm|message)\s*(?:me|@|:|is|at)\b|\badd me\b|\bmy (?:snap|insta|ig|discord|number|phone|addy|address|school)\b|\bhit me up on\b|\bwhere do you live\b|\bhow old are (?:you|u)\b|\bsend (?:pics|nudes|a pic)\b/i;
const HANDLE = /(?:^|\s)@[A-Za-z0-9_.]{3,30}\b/;
const URLISH = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|co|me|ly|tv|app|xyz|link|info|biz|ru|cn)(?:\/\S*)?\b/gi;
const YOUTUBE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/\S*)?$/i;

export function personalInfo(text) {
    if (EMAIL.test(text)) return 'email';
    if (PHONE.test(text) || spelledPhone(text)) return 'phone';
    if (ADDRESS.test(text)) return 'address';
    if (CONTACT.test(text)) return 'contact';
    return null;
}

export function badLink(text) {
    const links = text.match(URLISH) || [];
    return links.some((l) => !YOUTUBE.test(l.replace(/[).,!?]+$/, '')));
}

export function defaultLists() {
    return { block: [], hold: [...HOLD_PRESET], allow: [] };
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hasWord(text, words) {
    const flat = text.toLowerCase();
    return words.find((w) => w && new RegExp(`(^|[^a-z0-9])${esc(w.toLowerCase())}($|[^a-z0-9])`).test(flat)) || null;
}
// Leet-ish squash for custom list words: n1gg3r -> nigger, s.e.x -> sex.
function squash(text) {
    return text.toLowerCase().replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[5$]/g, 's').replace(/7/g, 't').replace(/[^a-z\s]/g, '');
}

// Join letters spaced out one at a time: "f a g g o t" / "n . i . g" -> "faggot" / "nig".
const SEP = String.raw`[\s.\-_*+~,'"\x60/\\|:;]+`;
const SPACED = new RegExp(String.raw`(?<![\p{L}\p{N}])[\p{L}\p{N}@$!](?:${SEP}[\p{L}\p{N}@$!](?![\p{L}\p{N}])){2,}`, 'gu');
function collapseSpaced(text) {
    return text.replace(SPACED, (m) => m.replace(new RegExp(SEP, 'g'), ''));
}
// Text variants the preset matcher sees: as typed, leet/separator-stripped, and single-letter-spaced collapsed.
function variants(text) {
    return [...new Set([text, squash(text), squash(collapseSpaced(text))])];
}

// verdict: ok | hold | block. `reason` is for the mod log, never shown to other fans.
export function checkText(raw, lists = defaultLists(), { handles = true } = {}) {
    const text = normalize(raw);
    if (!text) return { verdict: 'block', reason: 'empty', text };
    const pi = personalInfo(text);
    if (pi) return { verdict: 'block', reason: `personal-info:${pi}`, text };
    if (handles && HANDLE.test(text)) return { verdict: 'block', reason: 'personal-info:handle', text };
    if (badLink(text)) return { verdict: 'block', reason: 'link', text };
    if (THREAT.test(text)) return { verdict: 'block', reason: 'threat', text };
    if (/(.)\1{14,}/u.test(text)) return { verdict: 'block', reason: 'spam', text };
    const allow = lists.allow || [];
    const blockHit = hasWord(text, lists.block || []) || hasWord(squash(text), lists.block || []);
    if (blockHit && !allow.includes(blockHit)) return { verdict: 'block', reason: `word:${blockHit}`, text };
    const forms = variants(text);
    if (forms.some((f) => SEXUAL.test(f))) return { verdict: 'block', reason: 'sexual', text };
    for (const f of forms) {
        for (const m of presetMatcher.getAllMatches(f)) {
            const w = wordOf(m);
            if (allow.includes(w) || MILD_OK.includes(w)) continue;
            if ((lists.hold || []).includes(w)) continue; // handled below
            return { verdict: 'block', reason: `preset:${w}`, text };
        }
    }
    if (DIRECTED.test(text) || forms.some((f) => CUNT_AT.test(f))) return { verdict: 'hold', reason: 'insult-at-person', text };
    const presetHold = presetMatcher.getAllMatches(text).map(wordOf).find((w) => (lists.hold || []).includes(w) && !allow.includes(w));
    const holdHit = presetHold || hasWord(text, lists.hold || []) || hasWord(squash(text), lists.hold || []);
    if (holdHit && !allow.includes(holdHit)) return { verdict: 'hold', reason: `hold:${holdHit}`, text };
    return { verdict: 'ok', reason: null, text };
}

export const RESERVED_NICKS = Object.freeze(['jeff', 'stalemate', 'stalebot', 'chanserv', 'nickserv', 'admin', 'administrator', 'mod', 'moderator', 'op', 'band', 'staff', 'karen', 'root', 'system', 'server', 'bob', 'bobross', 'official']);

export function checkNick(raw, lists = defaultLists(), { band = false } = {}) {
    const nick = normalize(raw, 40);
    if (!/^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(nick)) return { ok: false, reason: 'Nicks are 3-20 letters, numbers or _-[]{}^`|, starting with a letter.' };
    const low = nick.toLowerCase().replace(/[_\-[\]{}^`|]/g, '');
    if (!band && RESERVED_NICKS.some((r) => low === r || low.startsWith(r) && /^\d*$/.test(low.slice(r.length)) || low.includes('stalemate') || low.includes('stalebot'))) return { ok: false, reason: 'That nick is reserved.' };
    const verdict = checkText(nick.replace(/[_\-[\]{}^`|]/g, ' '), lists, { handles: false });
    if (verdict.verdict !== 'ok' || presetMatcher.hasMatch(squash(nick))) return { ok: false, reason: 'Pick a different nick.' };
    return { ok: true, nick };
}
