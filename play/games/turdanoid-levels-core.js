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

  const CAMPAIGN_COLS = 9;
  const BALL_BASE_SPEED = 5.4;
  const BALL_PER_LEVEL = 0.16;
  const BALL_MAX_BONUS = 3.0;

  /**
   * Cell alphabet for campaign grids.
   * . empty  1-4 HP  M metal(4)  S silver(2)  X steel (indestructible)
   * D drip(2)  G gold(3)  T tar(3)  H heavy steel(6)  Y heavy gold(5)
   * a-f one-hit colour bricks (palette 0-5)
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
    T: { hp: 3, material: 'tar' },
    S: { hp: 2, metal: true, material: 'metal', silver: true },
    H: { hp: 6, metal: true, material: 'metal', heavy: true },
    Y: { hp: 5, material: 'gold', heavy: true },
    a: { hp: 1, color: 0 },
    b: { hp: 1, color: 1 },
    c: { hp: 1, color: 2 },
    d: { hp: 1, color: 3 },
    e: { hp: 1, color: 4 },
    f: { hp: 1, color: 5 }
  };

  /*
   * Hand-designed 9-column campaign modelled on Arkanoid (Taito, 1986):
   * World 1 teaches with flat colour bands and clusters, World 2 adds 2-hit
   * tiles and the first silver/metal fittings, Worlds 3-5 move to shaped
   * pictures with steel (gold-style indestructible) frames, drips and tar.
   * Letters a-f are 1-hit colour bricks so clusters read as one colour.
   * See docs/arkanoid-level-research.md.
   */
  const CAMPAIGN = [
    { level: 1, name: 'Fresh Tiles', pattern: 'Classic Wall', blurb: 'A plain Arkanoid wall. Learn the bounce.',
      grid: ['.aaaaaaa.', '.bbbbbbb.', '.ccccccc.'] },
    { level: 2, name: 'Rainbow Rows', pattern: 'Colour Bands', blurb: 'Three full bands. Aim for the corners.',
      grid: ['ddddddddd', 'ccccccccc', 'bbbbbbbbb'] },
    { level: 3, name: 'Soap Pyramid', pattern: 'Pyramid', blurb: 'First shaped wall. Work the sides in.',
      grid: ['....a....', '...bbb...', '..ccccc..', '.ddddddd.', 'eeeeeeeee', 'fffffffff'] },
    { level: 4, name: 'Diamond Mine', pattern: 'Diamond', blurb: 'A rainbow diamond with corner studs.',
      grid: ['a...a...a', '...bbb...', '..ccccc..', '.ddddddd.', 'eeeeeeeee', '.ddddddd.', '..ccccc..', '...bbb...', 'a...a...a'] },
    { level: 5, name: 'Ripple', pattern: 'Wave', blurb: 'First 2-hit tiles ride the wave.',
      grid: ['22.....22', 'a22...22a', 'aa22.22aa', 'bbb222bbb', 'ccccccccc'] },
    { level: 6, name: 'Tile Keep', pattern: 'Fortress', blurb: 'Bathroom boss. Steel corners, 2-hit walls.',
      grid: ['X2222222X', '2a.....a2', 'X2bbbbb2X', '2a.....a2', 'X2222222X', '..ccccc..', '..ddddd..'] },
    { level: 7, name: 'Chevrons', pattern: 'Arrows', blurb: 'Stacked arrows point the way up.',
      grid: ['....2....', '...2a2...', '..2a.a2..', '.2a...a2.', '2bb.2.bb2', '..b2b2b..', '.2bb.bb2.', '2ccc.ccc2', 'ddddddddd'] },
    { level: 8, name: 'Bullseye', pattern: 'Target', blurb: 'Rings around a 2-hit bull.',
      grid: ['..22222..', '.2bbbbb2.', '2bb222bb2', '2b22e22b2', '2bb222bb2', '.2bbbbb2.', '..22222..'] },
    { level: 9, name: 'Space Turd', pattern: 'Invader', blurb: 'The classic invader. Metal eyes.',
      grid: ['..2...2..', '...2.2...', '..22222..', '.2M222M2.', '222222222', '2.22222.2', '2.2...2.2', '...2.2...', 'aaaaaaaaa'] },
    { level: 10, name: 'Up Arrow', pattern: 'Arrow', blurb: 'A silver arrowhead on a 2-hit shaft.',
      grid: ['....S....', '...S2S...', '..S222S..', '.S22222S.', 'SSS222SSS', '..22222..', '..22222..', '..22222..', 'd2d2d2d2d'] },
    { level: 11, name: 'Drip Line', pattern: 'Twin Waves', blurb: 'Two waves and the first slime drip.',
      grid: ['2.......2', '22.....22', 'a22.D.22a', 'aa22322aa', '2aa232aa2', '22aa3aa22', '.22aaa22.', '..22222..', 'ccccccccc'] },
    { level: 12, name: 'Pump Station', pattern: 'Castle', blurb: 'Sewer boss. Steel towers, silver gate.',
      grid: ['X.X...X.X', '222...222', '2222D2222', '222222222', '2S2S2S2S2', '222222222', '22S...S22', '22S...S22'] },
    { level: 13, name: 'Crossfire', pattern: 'X Cross', blurb: 'Two diagonals cross at a silver heart.',
      grid: ['3.......3', '43.....34', '.43...34.', '..43D34..', '...4S4...', '..43D34..', '.43...34.', '43.....34', '3.......3'] },
    { level: 14, name: 'Soft Serve', pattern: 'Swirl', blurb: 'The classic swirl in 3-hit tiles.',
      grid: ['....3....', '...333...', '..D333D..', '..33333..', '.3333333.', '.2222222.', '333333333', '.eeeeeee.', '..ddddd..'] },
    { level: 15, name: 'Checkmate', pattern: 'Checkerboard', blurb: 'Punk checkerboard. Every other tile fights back.',
      grid: ['3a3a3a3a3', 'a3a3a3a3a', '3a3D3D3a3', 'a3a3a3a3a', '3a3a3a3a3', 'a3a3a3a3a', '3a3a3a3a3', 'a3a3a3a3a'] },
    { level: 16, name: 'Butterfly', pattern: 'Butterfly', blurb: 'Wings out, steel body.',
      grid: ['33.....33', '333...333', '3333X3333', '3D33X33D3', '.333X333.', '.333X333.', '3333X3333', '333...333', '33.....33'] },
    { level: 17, name: 'Love Log', pattern: 'Heart', blurb: 'A 4-hit heart that drips.',
      grid: ['.33...33.', '3443.3443', '344434443', '344444443', '.3444443.', '..3D4D3..', '...3D3...', '....3....', 'fffffffff'] },
    { level: 18, name: 'Porcelain Gate', pattern: 'Castle', blurb: 'Lagoon boss. Steel battlements, silver gate.',
      grid: ['X.X.X.X.X', '444444444', '4D44S44D4', '444S.S444', '44S...S44', '44S.D.S44', '444...444', 'XX4...4XX'] },
    { level: 19, name: 'Tar Pit', pattern: 'Hexagon', blurb: 'Gold-cored hexagon in sticky tar.',
      grid: ['..TTTTT..', '.T44444T.', 'T44DGD44T', 'T44GGG44T', 'T44DGD44T', '.T44444T.', '..TTTTT..'] },
    { level: 20, name: 'Hourglass', pattern: 'Hourglass', blurb: 'Steel pinch in the middle.',
      grid: ['444444444', '.4444444.', '..D444D..', '...X4X...', '...XGX...', '..34443..', '.3344433.', '33DGDGD33', 'TTTTTTTTT'] },
    { level: 21, name: 'Diamond Flush', pattern: 'Diamond', blurb: 'A gold-cored diamond in steel brackets.',
      grid: ['X..4D4..X', 'X.44444.X', '..44G44..', '.44GDG44.', '444D4D444', '.44GDG44.', '..44G44..', 'X.44444.X', 'X..444..X'] },
    { level: 22, name: 'Pinwheel', pattern: 'Spiral Arms', blurb: 'Four arms whirl round a gold hub.',
      grid: ['4444.MMMM', '4.....DM.', '4..TTT..M', '4.TGGGT.4', 'MDTGDGTD4', '4.TGGGT.4', 'M..TTT..4', '.MD.....4', 'MMMM.4444'] },
    { level: 23, name: 'Starburst', pattern: 'Star', blurb: 'A gold star blasts out in eight rays.',
      grid: ['4T4.M.4T4', 'T4T.M.T4T', '4.4GMG4.4', '..DGGGD..', 'MMGGDGGMM', '..DGGGD..', '4.4GMG4.4', 'T4T.M.T4T', '4T4.M.4T4'] },
    { level: 24, name: 'Royal Flush', pattern: 'Crown', blurb: 'Candy boss. A heavy gold crown with jewels.',
      grid: ['Y.Y.Y.Y.Y', 'YY..Y..YY', 'YYY.Y.YYY', 'YYYYYYYYY', 'YDYTDTYDY', 'HHHDHDHHH'] },
    { level: 25, name: 'Close Encounter', pattern: 'Alien', blurb: 'A big grey alien head. Black almond eyes.',
      grid: ['..MMMMM..', '.MSSSSSM.', 'MMSSSSSMM', 'MTTSSSTTM', 'MTTTSTTTM', 'MMMTSTMMM', '.MMSSSMM.', '.DMMDMMD.', '..DMMMD..'] },
    { level: 26, name: 'Skull Bowl', pattern: 'Skull', blurb: 'Heavy steel skull, hollow eyes, dripping grin.',
      grid: ['..HHHHH..', '.HHHDHHH.', 'HH..H..HH', 'HHD.H.DHH', '.HHH.HHH.', '..HHDHH..', '..H.D.H..', '..S.S.S..'] },
    { level: 27, name: 'Sludge Drain', pattern: 'Drain', blurb: 'Steel rings swirl down to a slime plug.',
      grid: ['.MMHDHMM.', 'H...D...H', 'H.HMDMH.H', 'H.H...H.H', '..H.D.H..', 'H.H...H.H', 'H.HMDMH.H', 'H.......H', '.MMHMHMM.'] },
    { level: 28, name: 'Septic Fort', pattern: 'Fortress', blurb: 'Heavy steel walls round a gold vault.',
      grid: ['HDH.H.HDH', 'MMMMMMMMM', 'HD.....DH', 'H..YYY..H', 'H..YDY..H', 'H..YYY..H', 'H.......H', 'MMHHDHHMM'] },
    { level: 29, name: 'Last Wipe', pattern: 'Gauntlet', blurb: 'Gold bars and steel rails before the king.',
      grid: ['YYYYYYYYY', 'H...D...H', 'H.MMMMM.H', '..D...D..', 'YYYYYYYYY', 'H...D...H', 'H.......H', '..D...D..', 'HHHH.HHHH'] },
    { level: 30, name: 'Anarchy Throne', pattern: 'Anarchy', blurb: 'Final boss. Smash the anarchy sign.',
      grid: ['..HHHHH..', '.HH.Y.HH.', 'H..Y.Y..H', 'HYYYYYYYH', 'H.Y...Y.H', 'H.Y...Y.H', '.HD...DH.', '..HDHDH..', '.D.D.D.D.'] }
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

  /**
   * Plain multi-hit tiles get one colour per hit count (2 cyan, 3 orange,
   * 4 pink) so shapes read as clusters, like Arkanoid, instead of random tints.
   */
  const HP_COLOR = { 2: 1, 3: 3, 4: 4 };

  function cellColor(spec) {
    if (Number.isInteger(spec.color)) {
      return spec.color;
    }
    if (!spec.material && Object.hasOwn(HP_COLOR, spec.hp)) {
      return HP_COLOR[spec.hp];
    }
    return null;
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

  /** Smallest brick the campaign may draw, measured on a 320px phone. */
  const MIN_BRICK_W = 28;
  const MIN_BRICK_H = 20;
  /** Tallest wall; keeps 20px bricks inside 60% of a 320x480 phone (304x464 canvas). */
  const MAX_ROWS = 9;

  /**
   * Brick placement for a playfield. Fewer, wider columns (9) with a 0.7
   * height ratio so a 320px phone still gets ~28x20 bricks.
   */
  function brickGeometry(width, height, cols = CAMPAIGN_COLS, rows = 1) {
    const W = Math.max(1, Number(width) || 0);
    const H = Math.max(1, Number(height) || 0);
    const n = Math.max(1, Math.floor(cols) || CAMPAIGN_COLS);
    const top = 70;
    const padX = Math.max(8, Math.round(W * 0.03));
    const gap = W < 420 ? 4 : 6;
    let rowGap = 4;
    const bw = (W - padX * 2 - gap * (n - 1)) / n;
    let bh = Math.max(MIN_BRICK_H, Math.min(32, Math.round(bw * 0.7)));
    const maxWallH = H * 0.6 - top;
    const r = Math.max(1, Math.min(MAX_ROWS, Math.floor(rows) || 1));
    // Short phones: tighten the row gap first, then shrink toward (never below) MIN_BRICK_H.
    if (r * (bh + rowGap) > maxWallH) {
      rowGap = 2;
    }
    if (r * (bh + rowGap) > maxWallH) {
      bh = Math.max(MIN_BRICK_H, Math.floor(maxWallH / r - rowGap));
    }
    return { top, padX, gap, rowGap, bw, bh };
  }

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
          material: spec.material || null,
          heavy: !!spec.heavy,
          color: cellColor(spec)
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

  /**
   * Last-bricks assist (Shatter-style "influence", not autopilot).
   * When only a few breakable bricks remain and the ball has gone a while
   * without touching one, bend an upward-moving ball a little toward the
   * nearest remaining brick each frame. Speed is preserved; steel is ignored.
   */
  const ENDGAME_MAX_BRICKS = 3;
  const ENDGAME_IDLE_FRAMES = 360;
  const ENDGAME_TURN_RAD = 0.0175;

  function endgameAssistActive(breakable, idleFrames) {
    return breakable > 0 && breakable <= ENDGAME_MAX_BRICKS && idleFrames >= ENDGAME_IDLE_FRAMES;
  }

  function endgameSteer(ball, bricks, idleFrames, ts = 1) {
    if (!ball || ball.stuck || !(ball.vy < 0)) {
      return null;
    }
    const live = (bricks || []).filter(isBreakable);
    if (!endgameAssistActive(live.length, idleFrames)) {
      return null;
    }
    let best = null;
    let bestD = Infinity;
    for (const br of live) {
      const tx = br.x + br.w / 2;
      const ty = br.y + br.h / 2;
      const d = (tx - ball.x) ** 2 + (ty - ball.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { tx, ty };
      }
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (!best || !speed) {
      return null;
    }
    const cur = Math.atan2(ball.vy, ball.vx);
    const want = Math.atan2(best.ty - ball.y, best.tx - ball.x);
    let diff = want - cur;
    while (diff > Math.PI) {diff -= Math.PI * 2;}
    while (diff < -Math.PI) {diff += Math.PI * 2;}
    const step = Math.max(-ENDGAME_TURN_RAD * ts, Math.min(ENDGAME_TURN_RAD * ts, diff));
    const ang = cur + step;
    let vx = Math.cos(ang) * speed;
    let vy = Math.sin(ang) * speed;
    // Never flatten into a near-horizontal crawl.
    const minVy = speed * 0.3;
    if (Math.abs(vy) < minVy) {
      vy = -minVy;
      vx = Math.sign(vx || 1) * Math.sqrt(speed * speed - minVy * minVy);
    }
    return { vx, vy };
  }

  root.TurdanoidLevels = {
    BASE_PATTERN_NAMES,
    EXTRA_PATTERN_NAMES,
    CELL_TYPES,
    CAMPAIGN_COLS,
    MIN_BRICK_W,
    MIN_BRICK_H,
    MAX_ROWS,
    brickGeometry,
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
    hazardHitsPaddle,
    ENDGAME_MAX_BRICKS,
    ENDGAME_IDLE_FRAMES,
    endgameAssistActive,
    endgameSteer
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
