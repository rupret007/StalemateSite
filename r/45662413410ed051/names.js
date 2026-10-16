/* StaleNames: the 🎲 "Make me a name" generator for the lobby and rooms. Family-friendly combos of silly
 * adjectives with punk, Bob Ross and potty-humor nouns, plus rare legendaries. Every possible output is checked
 * against the server's nick filter in tests/unit/hangout-names.test.js. Nicks: letters/digits/-, 3-20 chars. */
(function (root) {
    'use strict';
    const TITLES = ['Captain', 'Sir', 'Lady', 'Grandma', 'Grandpa', 'Uncle', 'Auntie', 'Professor', 'Baron', 'Duchess', 'DJ', 'Lil', 'Big', 'Doctor', 'Count', 'Major', 'Mayor', 'Coach', 'Granny', 'Chef'];
    const ADJS = ['Happy', 'Soggy', 'Sloppy', 'Grumpy', 'Feral', 'Fuzzy', 'Crusty', 'Wobbly', 'Stinky', 'Rad', 'Snotty', 'Sneaky', 'Squishy', 'Moldy', 'Spicy', 'Cranky', 'Loud', 'Sticky', 'Gnarly', 'Chunky', 'Funky', 'Dizzy', 'Rusty', 'Lumpy', 'Salty', 'Toasty', 'Clumsy', 'Bonkers', 'Fancy', 'Little', 'Mighty', 'Saucy', 'Tiny', 'Burly', 'Goofy', 'Itchy', 'Jiggly', 'Nifty', 'Zesty', 'Muddy'];
    const NOUNS = ['Tree', 'Cloud', 'Squirrel', 'Easel', 'Palette', 'Mountain', 'Bush', 'Mosh', 'Riff', 'Amp', 'Feedback', 'Pogo', 'Mohawk', 'Van', 'Drumstick', 'Encore', 'Mullet', 'Plunger', 'Toilet', 'Stinker', 'Burrito', 'Sock', 'Noodle', 'Pickle', 'Tater', 'Possum', 'Goat', 'Raccoon', 'Nugget', 'Wedgie', 'Booger', 'Bandit', 'Gremlin', 'Goblin', 'Waffle', 'Hotdog', 'Meatball', 'Taco', 'Gutter', 'Hoagie'];
    const LOTS = ['Mosh', 'Shred', 'Riff', 'Pogo', 'Snack', 'Toot', 'Doodle', 'Wobble', 'Splat', 'Stomp'];
    const MCS = ['Riff', 'Mosh', 'Plunge', 'Shred', 'Stink', 'Noodle', 'Pickle', 'Squish', 'Wobble', 'Snort'];
    const CLASSICS = ['SloppyJoeStrummer', 'GrandmaFeedback', 'ToiletPaperBandit', 'SirMosh-a-Lot', 'CaptainHappyTree', 'TheHappyAccident', 'PlungerPunk', 'IggyPopTart', 'JoeyRamenone', 'SidVicious-ish', 'TitanicSquirrel', 'FeedbackGoblin', 'SoggyEncore', 'CrustyMohawk', 'PottyMouthPete'];
    const LEGENDARY = ['TheJoyOfMoshing', 'BeatTheDevilOut', 'NoMistakesJustRiffs', 'LordOfTheFlush', 'TitaniumPlunger', 'HappyLittleMoshPit', 'TheGoldenPlunger', 'AlmightyAfro'];
    const MAX = 20;
    const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
    // Only digits that can't turn into letters (1→i, 7→t…) and no 69.
    const NUMS = ['22', '26', '28', '29', '62', '66', '68', '82', '86', '88', '89', '92', '96', '98', '99'];
    const num = (rnd) => (rnd() < 0.35 ? pick(NUMS, rnd) : '');
    const shapes = [
        (r) => `${pick(TITLES, r)}${pick(ADJS, r)}${pick(NOUNS, r)}`,
        (r) => `${pick(ADJS, r)}${pick(NOUNS, r)}${num(r)}`,
        (r) => `${pick(TITLES, r)}${pick(NOUNS, r)}`,
        (r) => `${pick(TITLES, r)}${pick(LOTS, r)}-a-Lot`,
        (r) => `${pick(NOUNS, r)}Mc${pick(MCS, r)}`,
        (r) => `${pick(ADJS, r)}${pick(ADJS, r)}${pick(NOUNS, r)}`,
        (r) => pick(CLASSICS, r)
    ];
    // Returns {name, legendary}. rnd is injectable for tests.
    function roll(rnd = Math.random) {
        if (rnd() < 0.02) return { name: pick(LEGENDARY, rnd), legendary: true };
        for (let i = 0; i < 20; i += 1) {
            const name = pick(shapes, rnd)(rnd);
            if (name.length >= 3 && name.length <= MAX) return { name, legendary: false };
        }
        return { name: pick(CLASSICS, rnd), legendary: false };
    }
    function all() { // every possible non-numbered output, for the filter test
        const out = new Set([...CLASSICS, ...LEGENDARY]);
        for (const t of TITLES) for (const a of ADJS) for (const n of NOUNS) out.add(`${t}${a}${n}`);
        for (const a of ADJS) for (const n of NOUNS) { out.add(`${a}${n}`); for (const d of NUMS) out.add(`${a}${n}${d}`); for (const b of ADJS) out.add(`${a}${b}${n}`); }
        for (const t of TITLES) { for (const n of NOUNS) out.add(`${t}${n}`); for (const l of LOTS) out.add(`${t}${l}-a-Lot`); }
        for (const n of NOUNS) for (const m of MCS) out.add(`${n}Mc${m}`);
        return [...out].filter((x) => x.length >= 3 && x.length <= MAX);
    }
    root.StaleNames = { roll, all, LEGENDARY };
}(typeof window !== 'undefined' ? window : globalThis));
