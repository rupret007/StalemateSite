/* Power-up labels and QA metadata (localhost test hook / capture scripts). */
(function attachTurdanoidQA(root) {
  'use strict';

  const POWER_DISPLAY_NAMES = {
    enlarge: 'Big paddle',
    slow: 'Slow ball',
    catch: 'Sticky catch',
    multi: 'Multiball',
    life: 'Extra life',
    laser: 'Laser',
    paper: 'Toilet paper',
    shield: 'Shield',
    fire: 'Fire ball',
    bomb: 'Bomb',
    plunger: 'Plunger magnet',
    flush: 'Mega flush',
    hotdog: 'Hot dog rockets',
    ghost: 'Ghost ball',
    skunk: 'Skunk cloud',
    gold: 'Gold rush',
    shrink: 'Shrink paddle',
    speed: 'Speed up',
    reverse: 'Reversed controls'
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
