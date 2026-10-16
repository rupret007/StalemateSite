/* Power-up labels and QA metadata (localhost test hook / capture scripts). */
(function attachTurdanoidQA(root) {
  'use strict';

  const POWER_DISPLAY_NAMES = {
    enlarge: 'Wide Load',
    slow: 'Air Freshener',
    catch: 'Plunger Catch',
    multi: 'Mosh Pit',
    life: 'Spare Roll',
    laser: 'TP Cannon',
    paper: 'Spitwad Spread',
    shield: 'Seat Cover',
    fire: 'Chili Fire',
    bomb: 'Cherry Bomb',
    plunger: 'Dookie Magnet',
    warp: 'Flush Warp',
    flush: 'Mega Wipe',
    hotdog: 'Wiener Rockets',
    chord: 'Power Chord',
    ghost: 'Ghost Poo',
    skunk: 'Skunk Cloud',
    gold: 'Golden Throne',
    shrink: 'Shrinkage',
    speed: 'Bad Curry',
    reverse: 'Backwash'
  };

  const POWER_TYPES = Object.keys(POWER_DISPLAY_NAMES);

  /** Powers that show a timed HUD chip after pickup (not instant one-shots). */
  const TIMED_POWER_TYPES = [
    'enlarge',
    'slow',
    'catch',
    'laser',
    'paper',
    'shield',
    'fire',
    'plunger',
    'hotdog',
    'ghost',
    'gold',
    'shrink',
    'speed',
    'reverse'
  ];

  const INSTANT_POWER_TYPES = POWER_TYPES.filter((t) => !TIMED_POWER_TYPES.includes(t));

  function displayName(type) {
    return POWER_DISPLAY_NAMES[type] || type;
  }

  root.TurdanoidQA = {
    POWER_DISPLAY_NAMES,
    POWER_TYPES,
    TIMED_POWER_TYPES,
    INSTANT_POWER_TYPES,
    displayName
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
