/* Themed worlds: 6 levels each across 30-level classic campaign (render + copy only). */
(function attachTurdanoidWorlds(root) {
  'use strict';

  const theme = root.TurdanoidTheme;
  const WORLDS = theme
    ? theme.worlds()
    : [
      {
        id: 'bathroom',
        name: 'Bathroom Tiles',
        sky: ['#061018', '#0a1820', '#123040'],
        accent: '#b8d4c8',
        wallMortar: '#061018',
        pipe: ['#123040', '#5ec8e0', '#2a5560'],
        playWallTint: 'rgba(94,200,224,.12)'
      },
      {
        id: 'sewer',
        name: 'Sewer Pipes',
        sky: ['#05141a', '#0a1820', '#15394a'],
        accent: '#3ecf9a',
        wallMortar: '#061018',
        pipe: ['#0f2b24', '#1a7a58', '#1d4a3c'],
        playWallTint: 'rgba(62,207,154,.11)'
      },
      {
        id: 'toxic',
        name: 'Toxic Lagoon',
        sky: ['#061610', '#102818', '#1a3824'],
        accent: '#86d86a',
        wallMortar: '#061208',
        pipe: ['#1a3020', '#3d7a48', '#254a30'],
        playWallTint: 'rgba(134,216,106,.1)'
      },
      {
        id: 'candy',
        name: 'Candy Clog',
        sky: ['#140c18', '#241428', '#341838'],
        accent: '#d878a8',
        wallMortar: '#120810',
        pipe: ['#7a2858', '#e878b8', '#6a2860'],
        playWallTint: 'rgba(216,120,168,.12)'
      },
      {
        id: 'throne',
        name: 'Golden Throne',
        sky: ['#141008', '#241c10', '#342814'],
        accent: '#e8c56a',
        wallMortar: '#100c08',
        pipe: ['#a8781c', '#f0d478', '#5a4018'],
        playWallTint: 'rgba(232,197,106,.12)'
      }
    ];

  function worldIndexForLevel(level) {
    const lv = Math.max(1, Math.floor(level || 1));
    return Math.min(WORLDS.length - 1, Math.floor((lv - 1) / 6));
  }

  function worldForLevel(level) {
    return WORLDS[worldIndexForLevel(level)];
  }

  function levelIntroLine(level, patternName) {
    const w = worldForLevel(level);
    const pat = patternName || 'Classic';
    return `${w.name} · Level ${level} · ${pat}`;
  }

  root.TurdanoidWorlds = {
    WORLDS,
    worldIndexForLevel,
    worldForLevel,
    levelIntroLine
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
