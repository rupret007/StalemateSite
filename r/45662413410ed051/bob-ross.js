/* Bob Ross Paint-Along data for the hidden Hang Out room.
 * Episodes are official Bob Ross channel uploads (youtube.com/@bobross_thejoyofpainting),
 * each checked with YouTube oEmbed (embeddable) on 2026-10-16. */
(function initBobRoss(global) {
    'use strict';

    const EPISODES = Object.freeze([
        { id: 'sS-hNYgDUak', title: 'Grey Winter', s: 7, e: 11, level: 'Easy', blurb: 'Few colors, soft greys. The gentlest first-timer ever.' },
        { id: 'aiK9xOIJtV8', title: 'Quiet Pond', s: 5, e: 5, level: 'Easy', blurb: 'Still water, a few trees. Basically training wheels.' },
        { id: 'oh5p5f5_-7A', title: 'A Walk in the Woods', s: 1, e: 1, level: 'Easy', blurb: 'Where it all started. Muddy path, happy trees, zero pressure.' },
        { id: 'RInDWhYceLU', title: 'Mt. McKinley', s: 1, e: 2, level: 'Easy', blurb: 'One big mountain and the palette knife. Fan top-two all-timer.' },
        { id: 'lLWEXRAnQd0', title: 'Island in the Wilderness', s: 29, e: 1, level: 'Easy', blurb: 'The most-watched Bob ever. Tiny island, huge vibes.' },
        { id: 'uj5FE70BcB0', title: 'Waterside Way', s: 8, e: 4, level: 'Medium', blurb: 'Fans’ #1 rated episode. Trail to a glassy lake.' },
        { id: 'qx2IsmrCs3c', title: 'In the Midst of Winter', s: 31, e: 12, level: 'Easy', blurb: 'Snowy cabin, cold blues. Second-most-viewed on his channel.' },
        { id: '8ysFkNYwhAE', title: 'Winter Night', s: 3, e: 4, level: 'Medium', blurb: 'Moonlit snow. A 9/10 fan pick for the dark-mode crowd.' },
        { id: 'se7wOprxRGs', title: 'Blaze of Color', s: 6, e: 13, level: 'Medium', blurb: 'Loud autumn fire on canvas. Tied for top fan rating.' },
        { id: '87MMbN1bQCs', title: 'Meadow Stream', s: 5, e: 13, level: 'Medium', blurb: 'Babbling brook through a meadow. 11M+ views.' },
        { id: 'kasGRkfkiPM', title: 'Mountain Summit', s: 13, e: 10, level: 'Medium', blurb: 'Knife-work bootcamp. Carve a peak, feel powerful.' },
        { id: 'vgbMONXc9Cs', title: 'Northern Lights', s: 8, e: 13, level: 'Spicy', blurb: 'Bob loses his mind over Alaska skies. Pure joy.' }
    ]);

    // Hex approximations of the classic Bob Ross oil set.
    const PALETTE = Object.freeze([
        { name: 'Titanium White', hex: '#ffffff' },
        { name: 'Phthalo Blue', hex: '#0c0040' },
        { name: 'Prussian Blue', hex: '#021e44' },
        { name: 'Midnight Black', hex: '#000000' },
        { name: 'Dark Sienna', hex: '#5f2e1f' },
        { name: 'Van Dyke Brown', hex: '#221b15' },
        { name: 'Alizarin Crimson', hex: '#4e1500' },
        { name: 'Sap Green', hex: '#0a3410' },
        { name: 'Cadmium Yellow', hex: '#ffec00' },
        { name: 'Yellow Ochre', hex: '#c79b00' },
        { name: 'Indian Yellow', hex: '#ffb800' },
        { name: 'Bright Red', hex: '#db0000' }
    ]);

    // Widths are in canvas units (1200 wide); the core clamps strokes to 1..48.
    const BRUSHES = Object.freeze([
        { name: 'Liner', size: 2, hint: 'Twigs, signatures, tiny critters' },
        { name: 'Knife', size: 6, hint: 'Mountain edges and snowcaps' },
        { name: 'Fan brush', size: 16, hint: 'Happy little trees' },
        { name: '1-inch', size: 28, hint: 'Bushes and foliage' },
        { name: '2-inch', size: 44, hint: 'Skies and big washes' }
    ]);

    function findEpisode(id) { return EPISODES.find((ep) => ep.id === id) || null; }
    function label(ep) { return `S${ep.s} E${ep.e}`; }

    const api = { EPISODES, PALETTE, BRUSHES, findEpisode, label };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.BobRoss = api;
}(typeof window !== 'undefined' ? window : globalThis));
