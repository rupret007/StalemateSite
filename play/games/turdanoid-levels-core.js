/* Campaign walls: 30 unique data-driven layouts plus the legacy 18 pattern stamps. */
(function attachTurdanoidLevels(root) {
  'use strict';

  const EXTRA_PATTERN_NAMES = [
    'Fortress',
    'Ring',
    'Columns',
    'Plunger X',
    'Drip Wall'
  ];

  const BASE_PATTERN_NAMES = [
    'Classic Wall',
    'Checker',
    'Tunnel',
    'Wave',
    'Pyramid',
    'Diamond',
    'Cross',
    'Spiral',
    'Hourglass',
    'Brick House',
    'Skull',
    'Funhouse',
    'Sewer Maze'
  ];

  const CAMPAIGN_COLS = 11;
  const BALL_BASE_SPEED = 5.4;
  const BALL_PER_LEVEL = 0.16;
  const BALL_MAX_BONUS = 3.0;

  /**
   * Cell alphabet for campaign grids.
   * . empty  1-4 HP  M metal(4)  X steel  D drip(2)  G gold(3)  T tar(3)
   */
  const CELL_TYPES = {
    1: { hp: 1 },
    2: { hp: 2 },
    3: { hp: 3 },
    4: { hp: 4 },
    M: { hp: 4, metal: true, material: 'metal' },
    X: { hp: 99, metal: true, material: 'metal', indestructible: true },
    D: { hp: 2, hazard: 'drip', material: 'slime' },
    G: { hp: 3, material: 'gold' },
    T: { hp: 3, material: 'tar' }
  };

  const CAMPAIGN = [
    {
      level: 1,
      name: 'Fresh Tiles',
      pattern: 'Lesson Wall',
      blurb: 'Two clean rows. Learn the bounce.',
      grid: [
        '11111111111',
        '11111111111'
      ]
    },
    {
      level: 2,
      name: 'Aim Gaps',
      pattern: 'Split Lanes',
      blurb: 'Three rows with two aim holes.',
      grid: [
        '1111.1.1111',
        '11111111111',
        '1111.1.1111'
      ]
    },
    {
      level: 3,
      name: 'Soap Pyramid',
      pattern: 'Pyramid',
      blurb: 'First shaped wall. Work the sides in.',
      grid: [
        '11111111111',
        '.111111111.',
        '..1111111..',
        '...11111...',
        '....111....'
      ]
    },
    {
      level: 4,
      name: 'Pipe Lane',
      pattern: 'Tunnel',
      blurb: 'Hollow pipe with a mid strut.',
      grid: [
        '11111111111',
        '11.......11',
        '11..111..11',
        '11.......11',
        '11111111111'
      ]
    },
    {
      level: 5,
      name: 'Ripple',
      pattern: 'Wave',
      blurb: 'First 2-hit tiles ride the wave.',
      grid: [
        '.112111211.',
        '11111111111',
        '.121.1.121.',
        '11111111111'
      ]
    },
    {
      level: 6,
      name: 'Tile Keep',
      pattern: 'Fortress',
      blurb: 'Bathroom world boss. Steel corners, 2-hit core.',
      grid: [
        'X111111111X',
        '11.22222.11',
        'X1.......1X',
        '11.22222.11',
        'X111111111X'
      ]
    },
    {
      level: 7,
      name: 'Downspout',
      pattern: 'Columns',
      blurb: 'Vertical pipes of 2-hit bricks.',
      grid: [
        '.2.2.2.2.2.',
        '11111111111',
        '2.2.2.2.2.2',
        '11111111111',
        '.2.2.2.2.2.'
      ]
    },
    {
      level: 8,
      name: 'Manhole',
      pattern: 'Ring',
      blurb: 'A ring you can shoot through.',
      grid: [
        '.122222221.',
        '12.......21',
        '2....2....2',
        '12.......21',
        '.122222221.',
        '.12.....21.'
      ]
    },
    {
      level: 9,
      name: 'Iron Joints',
      pattern: 'Metal Accents',
      blurb: 'First metal fittings. Four hits each.',
      grid: [
        '.111211111.',
        '11M11111M11',
        '.111111111.',
        '11M11111M11',
        '.111211111.'
      ]
    },
    {
      level: 10,
      name: 'Sewer Maze',
      pattern: 'Corridors',
      blurb: 'Two shafts. Clear the corridors, not the walls.',
      grid: [
        '111.212.111',
        '1.1.2.1.2.1',
        '111.212.111',
        '1.1.2.2.1.1',
        '111.212.111',
        '1.1.1.1.1.1',
        '111.212.111'
      ]
    },
    {
      level: 11,
      name: 'Drip Line',
      pattern: 'Hazard Box',
      blurb: 'First slime drip. Break it to shut the leak.',
      grid: [
        '12121212121',
        '1111D111111',
        '12121212121',
        '.121212121.',
        '12121212121'
      ]
    },
    {
      level: 12,
      name: 'Pump Station',
      pattern: 'Fortress',
      blurb: 'Sewer world boss. Dual drips behind a 2-hit shell.',
      grid: [
        'X222222222X',
        '2D.22222.D2',
        'X2.2...2.2X',
        '22.22222.22',
        'X222222222X'
      ]
    },
    {
      level: 13,
      name: 'Lagoon Gem',
      pattern: 'Diamond',
      blurb: 'A 2-hit diamond with twin drips in the core.',
      grid: [
        '....323....',
        '...22322...',
        '..2222222..',
        '.2222D2222.',
        '..222D222..',
        '...22322...',
        '....323....'
      ]
    },
    {
      level: 14,
      name: 'Toxic Cross',
      pattern: 'Cross',
      blurb: 'A 3-hit cross. Arms first, then the dripping hub.',
      grid: [
        '..1.333.1..',
        '....333....',
        '....333....',
        '3333D3D3333',
        '....333....',
        '....333....',
        '..1.333.1..'
      ]
    },
    {
      level: 15,
      name: 'Hourglass Vat',
      pattern: 'Hourglass',
      blurb: 'Pour through the waist. Three drips in the neck.',
      grid: [
        '22222222222',
        '.222...222.',
        '..22...22..',
        '...2D2D2...',
        '..22.D.22..',
        '.222...222.',
        '22222222222'
      ]
    },
    {
      level: 16,
      name: 'Iron Gate',
      pattern: 'Steel Lanes',
      blurb: 'First steel lanes. Shoot the open columns.',
      grid: [
        'X.3333333.X',
        'X.3.222.3.X',
        'X.3.DDD.3.X',
        'X.3.222.3.X',
        'X.3333333.X',
        'X.3.....3.X',
        'X.3333333.X'
      ]
    },
    {
      level: 17,
      name: 'Eddy',
      pattern: 'Spiral',
      blurb: 'A 3-hit box around a 2-hit eddy of drips.',
      grid: [
        '33333333333',
        '3.........3',
        '3.2222222.3',
        '3.2.DDD.2.3',
        '3.2222222.3',
        '3.........3',
        '.2.2.2.2.2.'
      ]
    },
    {
      level: 18,
      name: 'Sludge Citadel',
      pattern: 'Fortress',
      blurb: 'Toxic world boss. Steel frame, four drips, 3-hit caps.',
      grid: [
        'X333333333X',
        'X2D22222D2X',
        'X2.2X.X2.2X',
        'X2D22222D2X',
        'X333333333X',
        'X2.......2X',
        'X222222222X'
      ]
    },
    {
      level: 19,
      name: 'Jawbreaker',
      pattern: 'Gold Checker',
      blurb: 'Candy gold mixed with 2-hits. Four drips.',
      grid: [
        'G2G1G2G1G2G',
        '2G21G2G12G1',
        'G2G1D2D1G2G',
        '2GD1G2G1DG1',
        'G2G1G2G1G2G'
      ]
    },
    {
      level: 20,
      name: 'Sugar Zig',
      pattern: 'Zigzag',
      blurb: 'A descending candy staircase over a 3-hit shelf.',
      grid: [
        '333........',
        '.333.......',
        '..333.D....',
        '...333.D...',
        '....333.D..',
        '.....333.D.',
        '......33333',
        '33333333333',
        '22222222222'
      ]
    },
    {
      level: 21,
      name: 'Sticky Swirl',
      pattern: 'Swirl',
      blurb: 'Nested 3-hit rings. Five drips in the coils.',
      grid: [
        '22222222222',
        '3.........3',
        '3.333D333.3',
        '3.3.D.D.3.3',
        '3.333D333.3',
        '3....D....3',
        '33333333333'
      ]
    },
    {
      level: 22,
      name: 'Candy Vault',
      pattern: 'Vault',
      blurb: 'Steel frame around gold and five drips.',
      grid: [
        'X.........X',
        'X222222222X',
        'X3D33333D3X',
        'X333D33333X',
        'X3D3G3G3D3X',
        'X333333333X',
        'X3.......3X',
        'X222222222X'
      ]
    },
    {
      level: 23,
      name: 'Caramel Wall',
      pattern: 'Dense Wall',
      blurb: 'A thick 3-hit caramel slab. Few gaps.',
      grid: [
        '33333333333',
        '3D3222323D3',
        '3333D333333',
        '3D3222323D3',
        '33333333333'
      ]
    },
    {
      level: 24,
      name: 'Cotton Keep',
      pattern: 'Fortress',
      blurb: 'Candy world boss. Gold turrets, six drips.',
      grid: [
        'X444444444X',
        'X3D33333D3X',
        'XG.3.D.3.GX',
        'X3D33333D3X',
        'X333D33333X',
        'X3.3.3.3.3X',
        'X333333333X'
      ]
    },
    {
      level: 25,
      name: 'Gilded Stairs',
      pattern: 'Steps',
      blurb: 'Gold steps over a 3-hit throne floor.',
      grid: [
        'GGG........',
        '.GGG.......',
        '..GGG.D....',
        '...GGG.D...',
        '....GGG.D..',
        '.....GGG.D.',
        '......GGG.D',
        '33333333333',
        '33333333333',
        'D4444444...'
      ]
    },
    {
      level: 26,
      name: 'Royal Skull',
      pattern: 'Skull',
      blurb: 'A 4-hit skull with gold eyes and a dripping grin.',
      grid: [
        '..4444444..',
        '.44.....44.',
        '44.GG.GG.44',
        '44.GG.GG.44',
        '.44.DDD.44.',
        '..44DDD44..',
        '...4...4...',
        '.233333332.'
      ]
    },
    {
      level: 27,
      name: 'Throne Guard',
      pattern: 'Gauntlet',
      blurb: 'Steel posts and seven drips. Stay in the lanes.',
      grid: [
        'X333333333X',
        '3.3.....3.3',
        'X4.4...4.4X',
        '4D.44444.D4',
        'X4.444D4.4X',
        '4D.44444.D4',
        'X4.D...D.4X',
        '3.3.....3.3',
        'X333333333X'
      ]
    },
    {
      level: 28,
      name: 'Crown Jewel',
      pattern: 'Framed Diamond',
      blurb: 'Gold gems in a 4-hit crown, steel sides.',
      grid: [
        'X.........X',
        'X322222223X',
        'X3D33333D3X',
        'X444434444X',
        'X4D4G4G4D4X',
        'X4444D4444X',
        'X3D33333D3X',
        'X333333333X'
      ]
    },
    {
      level: 29,
      name: 'Royal Gauntlet',
      pattern: 'Three Lanes',
      blurb: 'Three shafts. Eight drips. Do not get boxed in.',
      grid: [
        '33.33.33.33',
        '44.DD.DD.44',
        'XX.33.33.XX',
        '33.33.33.33',
        '33.33333.33',
        'XX.DD.DD.XX',
        '33.33.33.33',
        '33.33.33.33',
        '44.44444.44'
      ]
    },
    {
      level: 30,
      name: 'Golden Throne',
      pattern: 'Final Fortress',
      blurb: 'Campaign finale. Gold, steel, eight drips.',
      grid: [
        'X3X33333X3X',
        '4G4.....4G4',
        'X4D4.D.4D4X',
        '4G4.GDG.4G4',
        'X4D4...4D4X',
        '4G4.GGG.4G4',
        'X4D4...4D4X',
        '4G4.....4G4',
        'X4X44444X4X'
      ]
    }
  ];

  function allPatternNames() {
    return BASE_PATTERN_NAMES.concat(EXTRA_PATTERN_NAMES);
  }

  function shouldPlaceExtra(pat, c, r, cols, rows, level) {
    const cc = (cols - 1) / 2;
    const rc = (rows - 1) / 2;
    switch (pat) {
    case 'Fortress':
      return (
        r === 0 ||
          r === rows - 1 ||
          c === 0 ||
          c === cols - 1 ||
          (r === Math.floor(rows / 2) && c > 1 && c < cols - 2)
      );
    case 'Ring': {
      const dist = Math.abs(c - cc) + Math.abs(r - rc);
      return dist >= 2 && dist <= rows * 0.55;
    }
    case 'Columns':
      return c % 2 === 0 || r < 2;
    case 'Plunger X':
      return Math.abs(c - cc) <= 1.2 || Math.abs(r - rc) <= 1.2;
    case 'Drip Wall':
      return r >= Math.floor((Math.sin(c * 0.85 + level * 0.2) + 1) * 0.35 * rows);
    default:
      return true;
    }
  }

  function shouldPlaceBrick(pat, c, r, cols, rows, level) {
    if (EXTRA_PATTERN_NAMES.includes(pat)) {
      return shouldPlaceExtra(pat, c, r, cols, rows, level);
    }
    switch (pat) {
    case 'Checker':
      return (c + r) % 2 === 0;
    case 'Tunnel':
      return !(c > 1 && c < cols - 2 && r > 0 && r < rows - 1);
    case 'Wave':
      return (r + Math.round(Math.sin(c * 0.7) * 1.5)) % 2 === 0;
    case 'Pyramid':
      return c >= r && c < cols - r;
    case 'Diamond': {
      const cc2 = cols / 2 - 0.5;
      const rc2 = rows / 2 - 0.5;
      return Math.abs(c - cc2) + Math.abs(r - rc2) < rows * 0.6;
    }
    case 'Cross':
      return Math.abs(c - (cols - 1) / 2) < 2 || Math.abs(r - (rows - 1) / 2) < 2;
    case 'Spiral':
      return (c + r) % 3 !== 0;
    case 'Hourglass':
      return !(
        r > rows * 0.3 &&
          r < rows * 0.7 &&
          (c < cols * 0.3 || c > cols * 0.7)
      );
    case 'Brick House':
      return r % 2 === 0 ? c % 2 === 0 : c % 2 === 1;
    case 'Skull':
      return !((r === 0 && (c < 2 || c > cols - 3)) || (r === rows - 1 && c % 2 === 0));
    case 'Funhouse':
      return Math.random() > 0.18;
    case 'Sewer Maze':
      return !((r % 2 === 1) && c % 3 === 0);
    case 'Classic Wall':
    default:
      return true;
    }
  }

  function computeBallSpeed(level) {
    const lv = Math.max(1, Math.floor(level || 1));
    return BALL_BASE_SPEED + Math.min(lv * BALL_PER_LEVEL, BALL_MAX_BONUS);
  }

  function computeDropChance(level, remainingBricks) {
    const lv = Math.max(1, Math.floor(level || 1));
    let chance;
    if (lv <= 2) {
      chance = 0.32 - (lv - 1) * 0.04;
    } else if (lv <= 8) {
      chance = 0.26 - (lv - 2) * 0.02;
    } else {
      chance = Math.max(0.12, 0.16 - (lv - 8) * 0.005);
    }
    if (remainingBricks < 24) {
      chance += 0.06;
    }
    return chance;
  }

  function cellSpec(ch) {
    if (!ch || ch === '.') {
      return null;
    }
    return CELL_TYPES[ch] || null;
  }

  function normalizeDefinition(raw) {
    const grid = (raw.grid || []).map((row) => String(row));
    const cols = grid.reduce((max, row) => Math.max(max, row.length), 0) || CAMPAIGN_COLS;
    const rows = grid.length;
    const padded = grid.map((row) => row.padEnd(cols, '.'));
    return {
      level: raw.level,
      name: raw.name,
      pattern: raw.pattern,
      blurb: raw.blurb || '',
      bossBeat: raw.level % 6 === 0,
      cols,
      rows,
      grid: padded,
      speed: computeBallSpeed(raw.level),
      dropChance: computeDropChance(raw.level, 100)
    };
  }

  const DEFINITIONS = CAMPAIGN.map(normalizeDefinition);

  function definitionForLevel(level) {
    const lv = Math.max(1, Math.min(DEFINITIONS.length, Math.floor(level || 1)));
    return DEFINITIONS[lv - 1];
  }

  function campaignLevelCount() {
    return DEFINITIONS.length;
  }

  function buildCampaignCells(level) {
    const def = definitionForLevel(level);
    const cells = [];
    for (let r = 0; r < def.rows; r += 1) {
      const row = def.grid[r];
      for (let c = 0; c < def.cols; c += 1) {
        const spec = cellSpec(row[c]);
        if (!spec) {
          continue;
        }
        cells.push({
          c,
          r,
          hp: spec.hp,
          maxHp: spec.hp,
          metal: !!spec.metal,
          indestructible: !!spec.indestructible,
          hazard: spec.hazard || null,
          material: spec.material || null
        });
      }
    }
    return cells;
  }

  function metricsForDefinition(def) {
    let brickHpTotal = 0;
    let hazardCount = 0;
    let metalCount = 0;
    let goldCount = 0;
    let tarCount = 0;
    let indestructibleCount = 0;
    let breakableCount = 0;
    let multiHitCount = 0;
    for (let r = 0; r < def.rows; r += 1) {
      for (let c = 0; c < def.cols; c += 1) {
        const spec = cellSpec(def.grid[r][c]);
        if (!spec) {
          continue;
        }
        if (spec.indestructible) {
          indestructibleCount += 1;
          continue;
        }
        breakableCount += 1;
        brickHpTotal += spec.hp;
        if (spec.hp > 1) {
          multiHitCount += 1;
        }
        if (spec.hazard) {
          hazardCount += 1;
        }
        if (spec.metal) {
          metalCount += 1;
        }
        if (spec.material === 'gold') {
          goldCount += 1;
        }
        if (spec.material === 'tar') {
          tarCount += 1;
        }
      }
    }
    return {
      level: def.level,
      name: def.name,
      pattern: def.pattern,
      cols: def.cols,
      rows: def.rows,
      brickHpTotal,
      breakableCount,
      multiHitCount,
      hazardCount,
      metalCount,
      goldCount,
      tarCount,
      indestructibleCount,
      speed: def.speed,
      dropChance: def.dropChance,
      bossBeat: def.bossBeat,
      fingerprint: def.grid.join('|')
    };
  }

  function metricsForLevel(level) {
    return metricsForDefinition(definitionForLevel(level));
  }

  function campaignMetrics() {
    return DEFINITIONS.map(metricsForDefinition);
  }

  function isBreakable(brick) {
    return !!(brick && !brick.indestructible);
  }

  function remainingBreakable(list) {
    let n = 0;
    const bricks = list || [];
    for (let i = 0; i < bricks.length; i += 1) {
      if (isBreakable(bricks[i])) {
        n += 1;
      }
    }
    return n;
  }

  function applyDamage(brick, amount) {
    if (!isBreakable(brick)) {
      return { destroyed: false, blocked: true };
    }
    brick.hp -= amount;
    return { destroyed: brick.hp <= 0, blocked: false };
  }

  function isClearable(grid) {
    const rows = grid.length;
    const cols = grid[0] ? grid[0].length : 0;
    const cells = grid.map((row) => row.split(''));
    const required = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const spec = cellSpec(cells[r][c]);
        if (spec && !spec.indestructible) {
          required.push(r * cols + c);
        }
      }
    }
    const seen = new Set();
    const queue = [];
    for (let c = 0; c < cols; c += 1) {
      const start = rows * cols + c;
      queue.push(start);
      seen.add(start);
    }
    const destroyed = new Set();
    const neighbor = (r, c) => {
      if (c < 0 || c >= cols) {
        return;
      }
      if (r === rows) {
        const key = r * cols + c;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
        return;
      }
      if (r < 0 || r >= rows) {
        return;
      }
      const key = r * cols + c;
      if (seen.has(key) || destroyed.has(key)) {
        return;
      }
      const ch = cells[r][c];
      const spec = cellSpec(ch);
      if (!spec) {
        seen.add(key);
        queue.push(key);
        return;
      }
      if (spec.indestructible) {
        return;
      }
      destroyed.add(key);
      seen.add(key);
      queue.push(key);
    };
    while (queue.length) {
      const key = queue.shift();
      const r = Math.floor(key / cols);
      const c = key % cols;
      neighbor(r - 1, c);
      neighbor(r + 1, c);
      neighbor(r, c - 1);
      neighbor(r, c + 1);
    }
    return required.every((key) => destroyed.has(key));
  }

  function hazardIntervalFrames(level) {
    return Math.max(84, 168 - Math.max(1, Math.floor(level || 1)) * 3);
  }

  function collectDripSpawns(bricks, dt, level) {
    const spawned = [];
    const interval = hazardIntervalFrames(level);
    const list = bricks || [];
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (!b || b.hazard !== 'drip') {
        continue;
      }
      b.hazardCd = (b.hazardCd || 0) - dt;
      if (b.hazardCd <= 0) {
        b.hazardCd = interval;
        spawned.push({
          x: b.x + b.w / 2,
          y: b.y + b.h,
          vy: 1.05 + Math.max(1, level || 1) * 0.03,
          r: 8
        });
      }
    }
    return spawned;
  }

  /**
   * Bounded paddle overlap for falling hazards. A drip that has already
   * passed below the seat must not keep dealing damage.
   */
  function hazardHitsPaddle(sl, paddle) {
    if (!sl || !paddle) {
      return false;
    }
    const r = Number(sl.r) || 0;
    const half = (Number(paddle.w) || 0) / 2;
    return sl.y + r >= paddle.y
      && sl.y - r <= paddle.y + (Number(paddle.h) || 0)
      && Math.abs(sl.x - paddle.x) < half + r + 4;
  }

  root.TurdanoidLevels = {
    BASE_PATTERN_NAMES,
    EXTRA_PATTERN_NAMES,
    CELL_TYPES,
    CAMPAIGN_COLS,
    allPatternNames,
    shouldPlaceBrick,
    computeBallSpeed,
    computeDropChance,
    definitionForLevel,
    campaignLevelCount,
    buildCampaignCells,
    metricsForLevel,
    metricsForDefinition,
    campaignMetrics,
    isBreakable,
    remainingBreakable,
    applyDamage,
    isClearable,
    hazardIntervalFrames,
    collectDripSpawns,
    hazardHitsPaddle
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
