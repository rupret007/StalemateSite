// Verified streaming URLs for Stalemate Band (Apple artist 1718455763, Spotify artist 5cZqYe3bDw3xcKIk4aPHNH).
export const OTHER_BAND_SPOTIFY = '4rwTyXLXW0blHBUjQdJmA7';

const APPLE_PATHS = [
    'artist/stalemate-band/1718455763',
    'album/andrea/1718463871?i=1718463872',
    'album/its-been-only-18/1718464113?i=1718464114',
    'album/my-mom-says-were-cool/1718884118'
];
export const APPLE_LINKS = new Set(APPLE_PATHS.map((p) => `https://music.apple.com/us/${p}`));
export const APPLE_EMBEDS = new Set(APPLE_PATHS.map((p) => `https://embed.music.apple.com/us/${p}`));
export const SPOTIFY_LINKS = new Set([
    'https://open.spotify.com/artist/5cZqYe3bDw3xcKIk4aPHNH',
    'https://open.spotify.com/track/6GBydFSUtZ7wZ7pSAvbytw',
    'https://open.spotify.com/track/00i8GYyog0bCGJnhtqNJKo'
]);
// script.js only checks that an embed starts with this origin before injecting it.
const SCRIPT_ORIGIN_GUARD = 'https://embed.music.apple.com/';

function decode(url) {
    return url.replace(/&amp;/g, '&');
}

/** Every apple.com / spotify.com URL in text that is not on the verified allowlist. */
export function disallowedStreamingUrls(text) {
    const bad = [];
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>`)]+/gi)) {
        const url = decode(match[0]);
        const isApple = /(^|\.)apple\.com$/i.test(new URL(url).hostname);
        const isSpotify = /(^|\.)spotify\.com$/i.test(new URL(url).hostname);
        if (!isApple && !isSpotify) continue;
        if (url === SCRIPT_ORIGIN_GUARD) continue;
        if (APPLE_LINKS.has(url) || APPLE_EMBEDS.has(url) || SPOTIFY_LINKS.has(url)) continue;
        bad.push(url);
    }
    const withoutUrls = text.replace(/https?:\/\/[^\s"'<>`)]+/gi, ' ');
    for (const bare of withoutUrls.matchAll(/\b(?:[\w-]+\.)*(?:apple|spotify)\.com\b[^\s"'<>`)]*/gi)) {
        bad.push(bare[0]);
    }
    if (text.includes(OTHER_BAND_SPOTIFY)) bad.push(OTHER_BAND_SPOTIFY);
    return bad;
}

/** data-embed* attributes that are not a Listen tap-to-load button pointing at an allowlisted Apple embed. */
export function disallowedEmbedAttributes(html) {
    const bad = [];
    for (const match of html.matchAll(/<[a-z]+\b[^>]*\bdata-embed[^>]*>/gi)) {
        const tag = match[0];
        const src = (tag.match(/\bdata-embed-src="([^"]*)"/) || [])[1];
        const ok = /^<button\b/i.test(tag)
            && /\bdata-listen-load\b/.test(tag)
            && src !== undefined
            && APPLE_EMBEDS.has(decode(src));
        if (!ok) bad.push(tag);
    }
    return bad;
}
