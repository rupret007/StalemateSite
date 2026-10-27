// Deterministic runner rules. Metres/seconds only; rendering, input and storage
// stay outside this module. A saved state contains the complete random stream.
export const TUNING = Object.freeze({
  version: 1,
  fixedStep: 1 / 120,
  maxFrame: 0.12,
  laneWidth: 2.4,
  laneChangeSeconds: 0.16,
  laneCooldown: 0.1,
  baseSpeed: 12,
  maxSpeed: 24,
  speedRamp: 0.1,
  jumpVelocity: 8.8,
  gravity: 24,
  slideSeconds: 0.72,
  shieldSeconds: 8,
  magnetSeconds: 8,
  crateClearance: 0.85,
  beamClearance: 0.25,
  collisionWidth: 0.88,
  collisionDepth: 0.62,
  rowGap: 24,
  firstHazard: 100,
  firstSkill: 250,
  lookAhead: 190,
  maxEvents: 32
});

const EPSILON = 1e-10;
const HAZARDS = new Set(['barrier', 'beam', 'crate']);
// Authored safe-lane movements; clamping at the outside lanes preserves a
// continuous route through ordinary rows. Spaced full-width skill rows require
// a jump or slide; their action windows remain reachable at maximum speed.
const PATTERNS = Object.freeze([
  [0, 1, 1, 0], [0, -1, -1, 0], [1, -1, 1, -1],
  [-1, 1, -1, 1], [0, 0, 1, 0], [0, 0, -1, 0]
]);

function seedNumber(seed) {
  const text = typeof seed === 'string' || Number.isFinite(seed) ? String(seed) : '1';
  let result = 2166136261;
  for (let index = 0; index < text.length; index++) {
    result = Math.imul(result ^ text.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function random(state) {
  state._random = (state._random + 0x6D2B79F5) >>> 0;
  let value = state._random;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

function addEntity(state, kind, lane, at) {
  state.entities.push({ id: state._nextId++, kind, lane, at });
}

function fillWorld(state) {
  while (state._nextChunk <= state.distance + TUNING.lookAhead) {
    const pattern = PATTERNS[Math.floor(random(state) * PATTERNS.length)];
    const variation = Math.floor(random(state) * 3);
    for (let row = 0; row < pattern.length; row++) {
      state._safeLane = Math.max(0, Math.min(2, state._safeLane + pattern[row]));
      const at = state._nextChunk + row * TUNING.rowGap;
      const rowNumber = state._chunk * pattern.length + row;
      const skillRow = at >= TUNING.firstSkill && rowNumber % 4 === 3;
      const skillKind = Math.floor(rowNumber / 4) % 2 === 0 ? 'crate' : 'beam';
      let optionalLane = null;
      for (let lane = 0; lane < 3; lane++) {
        if (skillRow || lane !== state._safeLane) {
          const kind = skillRow ? skillKind : ['crate', 'beam', 'barrier'][(variation + row + lane) % 3];
          addEntity(state, kind, lane, at);
          if (kind !== 'barrier') {
            optionalLane = lane;
          }
        }
      }
      for (const offset of [-8, -4, 0]) {
        addEntity(state, 'pick', state._safeLane, at + offset);
      }
      // A richer optional trail rewards a jump/slide through a traversable
      // obstacle instead of putting every reward in the empty ground lane.
      if (!skillRow && rowNumber % 3 === 1 && optionalLane !== null) {
        for (const offset of [-4, -2, 0, 2, 4]) {
          addEntity(state, 'pick', optionalLane, at + offset);
        }
      }
      if (row === 1) {
        addEntity(state, state._chunk % 2 === 0 ? 'shield' : 'magnet', state._safeLane, at - 12);
      }
    }
    state._nextChunk += TUNING.rowGap * pattern.length;
    state._chunk++;
  }
}

export function createRun(seed = 1) {
  const state = {
    version: TUNING.version,
    seed: typeof seed === 'string' || Number.isFinite(seed) ? seed : 1,
    phase: 'ready',
    distance: 0,
    elapsed: 0,
    score: 0,
    picks: 0,
    speed: TUNING.baseSpeed,
    player: { lane: 1, x: 0, y: 0, slide: 0, shield: 0, magnet: 0 },
    entities: [],
    reason: null,
    lastHit: null,
    _random: seedNumber(seed),
    _nextId: 1,
    _nextChunk: TUNING.firstHazard,
    _chunk: 0,
    _safeLane: 1,
    _accumulator: 0,
    _laneCooldown: 0,
    _velocityY: 0,
    _invulnerable: 0
  };
  for (const at of [18, 30, 42]) {
    addEntity(state, 'pick', 1, at);
  }
  fillWorld(state);
  return state;
}

export function startRun(state) {
  if (state?.phase === 'ready') {
    state.phase = 'running';
  }
  return [];
}

export function pauseRun(state) {
  if (state?.phase === 'running') {
    state.phase = 'paused';
  }
  return [];
}

export function resumeRun(state) {
  if (state?.phase === 'paused') {
    state.phase = 'running';
  }
  return [];
}

export function act(state, action) {
  if (state?.phase !== 'running') {
    return [];
  }
  const player = state.player;
  if (action === 'left' || action === 'right') {
    if (state._laneCooldown > EPSILON) {
      return [];
    }
    const lane = Math.max(0, Math.min(2, player.lane + (action === 'left' ? -1 : 1)));
    if (lane !== player.lane) {
      player.lane = lane;
      state._laneCooldown = TUNING.laneCooldown;
      return [{ type: 'lane', lane }];
    }
  } else if (action === 'jump' && player.y <= EPSILON) {
    // A jump press can cancel a grounded slide, but cannot double-jump.
    if (state._velocityY > 0) {
      return [];
    }
    player.slide = 0;
    state._velocityY = TUNING.jumpVelocity;
    return [{ type: 'jump' }];
  } else if (action === 'slide' && player.slide <= EPSILON) {
    player.slide = TUNING.slideSeconds;
    if (player.y > EPSILON) {
      state._velocityY = Math.min(-12, state._velocityY);
    }
    return [{ type: 'slide' }];
  }
  return [];
}

function countdown(value, seconds) {
  return value <= seconds + EPSILON ? 0 : value - seconds;
}

function emit(events, event) {
  if (events.length < TUNING.maxEvents) {
    events.push(event);
  } else if (event.type === 'over') {
    // A bounded decorative/pickup burst must never hide the terminal receipt.
    events[events.length - 1] = event;
  }
}

function collisions(state, from, events) {
  const player = state.player;
  for (const entity of state.entities) {
    if (entity._used) {
      continue;
    }
    const gap = entity.at - state.distance;
    const lateral = Math.abs((entity.lane - 1) * TUNING.laneWidth - player.x);
    if (HAZARDS.has(entity.kind)) {
      if (entity.at + TUNING.collisionDepth < from || gap > TUNING.collisionDepth ||
          gap < -TUNING.collisionDepth || lateral > TUNING.collisionWidth || state._invulnerable > 0) {
        continue;
      }
      const safe = entity.kind === 'crate' && player.y >= TUNING.crateClearance ||
        entity.kind === 'beam' && player.slide > 0 && player.y <= TUNING.beamClearance;
      if (safe) {
        continue;
      }
      entity._used = true;
      state.lastHit = { kind: entity.kind, lane: entity.lane, at: entity.at };
      emit(events, { type: 'hit', kind: entity.kind, lane: entity.lane, shielded: player.shield > 0 });
      if (player.shield > 0) {
        player.shield = 0;
        state._invulnerable = 0.4;
        emit(events, { type: 'shield', kind: entity.kind, absorbed: true });
      } else {
        state.phase = 'over';
        state.reason = entity.kind;
        emit(events, { type: 'over', reason: entity.kind, score: state.score, picks: state.picks });
        break;
      }
    } else {
      const magnet = entity.kind === 'pick' && player.magnet > 0;
      const depth = magnet ? 4 : 0.9;
      const width = magnet ? TUNING.laneWidth * 2 + 0.1 : 0.85;
      if (gap < -depth || gap > depth || lateral > width) {
        continue;
      }
      entity._used = true;
      if (entity.kind === 'pick') {
        state.picks++;
      } else if (entity.kind === 'shield') {
        player.shield = TUNING.shieldSeconds;
      } else if (entity.kind === 'magnet') {
        player.magnet = TUNING.magnetSeconds;
      }
      emit(events, { type: 'pickup', kind: entity.kind, id: entity.id });
    }
  }
}

function step(state, seconds, events) {
  const player = state.player;
  const from = state.distance;
  const oldSpeed = state.speed;
  state.elapsed += seconds;
  state.speed = Math.min(TUNING.maxSpeed, TUNING.baseSpeed + state.elapsed * TUNING.speedRamp);
  state.distance += (oldSpeed + state.speed) * 0.5 * seconds;
  const target = (player.lane - 1) * TUNING.laneWidth;
  const move = TUNING.laneWidth / TUNING.laneChangeSeconds * seconds;
  player.x += Math.max(-move, Math.min(move, target - player.x));
  if (player.y > 0 || state._velocityY > 0) {
    player.y = Math.max(0, player.y + state._velocityY * seconds - TUNING.gravity * seconds * seconds * 0.5);
    state._velocityY = player.y > 0 ? state._velocityY - TUNING.gravity * seconds : 0;
  }
  for (const power of ['slide', 'shield', 'magnet']) {
    player[power] = countdown(player[power], seconds);
  }
  state._laneCooldown = countdown(state._laneCooldown, seconds);
  state._invulnerable = countdown(state._invulnerable, seconds);
  // Distance and pickups are monotonic. No separate payout callback can run twice.
  state.score = Math.floor(state.distance * 10) + state.picks * 50;
  collisions(state, from, events);
  state.score = Math.floor(state.distance * 10) + state.picks * 50;
  // The over event contains the final score, including pickups in this step.
  const ended = events.find(event => event.type === 'over');
  if (ended) {
    ended.score = state.score;
  }
  state.entities = state.entities.filter(entity => !entity._used && entity.at >= state.distance - 5);
  fillWorld(state);
}

export function advance(state, dtSeconds) {
  const events = [];
  if (state?.phase !== 'running' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    return events;
  }
  // Discard background/stalled-frame time. The UI also explicitly pauses on blur.
  state._accumulator += Math.min(TUNING.maxFrame, dtSeconds);
  let steps = 0;
  const maxSteps = Math.ceil(TUNING.maxFrame / TUNING.fixedStep);
  while (state._accumulator + EPSILON >= TUNING.fixedStep && steps < maxSteps && state.phase === 'running') {
    state._accumulator = Math.max(0, state._accumulator - TUNING.fixedStep);
    step(state, TUNING.fixedStep, events);
    steps++;
  }
  if (state._accumulator < EPSILON) {
    state._accumulator = 0;
  }
  return events;
}
