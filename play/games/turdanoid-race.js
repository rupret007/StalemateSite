import './turdanoid-physics-core.js';
import { buildCampaignCells, definitionForLevel, brickGeometry, applyDamage, computeBallSpeed, endgameSteer, ENDGAME_MAX_BRICKS, ENDGAME_IDLE_FRAMES } from './turdanoid-levels.js';
import { ACTION_TICKS_PER_SECOND, ACTION_INPUT_BUFFER_MS, ACTION_BURST_CREDITS, ACTION_QUEUE_LIMIT, actionTick, acceptTimedInputs } from './arcade-action-clock.js';

export const TURDANOID_RACE_VERSION = 1;
export const BRICK_WIDTH = 480, BRICK_HEIGHT = 400;
export const BRICK_COUNTDOWN_MS = 3000;
export const BRICK_LIMIT_TICKS = 75 * ACTION_TICKS_PER_SECOND;
const duration = BRICK_LIMIT_TICKS * 1000 / ACTION_TICKS_PER_SECOND + ACTION_INPUT_BUFFER_MS;
const frame = 60 / ACTION_TICKS_PER_SECOND, paddleY = BRICK_HEIGHT - 23, paddleHeight = 12, ballRadius = 8;
const holdLerp = 1 - Math.pow(1 - .62, frame), startLives = 3, powerTicks = 6 * ACTION_TICKS_PER_SECOND;
const seats = ['a', 'b'];
const powers = ['wide', 'sticky', 'slow'];
const { paddleVelocity, brickContact } = globalThis.TurdanoidPhysics;
const mapSeats = fn => Object.fromEntries(seats.map(seat => [seat, fn(seat)]));
const clone = value => globalThis.structuredClone(value);
const int = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const idPattern = /^[a-zA-Z0-9-]{5,80}$/;

function mix(seed, index) {
  let word = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  word = Math.imul(word ^ (word >>> 16), 0x7feb352d);
  word = Math.imul(word ^ (word >>> 15), 0x846ca68b);
  return (word ^ (word >>> 16)) >>> 0;
}

export function brickRaceWall(seed) {
  const level = [1, 2, 5][seed % 3], def = definitionForLevel(level);
  const { padX, top, gap, rowGap, bw, bh } = brickGeometry(BRICK_WIDTH, BRICK_HEIGHT, def.cols, def.rows);
  const bricks = buildCampaignCells(level).map((cell, id) => {
    const mark = mix(seed, id);
    return { ...cell, x: padX + cell.c * (bw + gap), y: top + cell.r * (bh + rowGap), w: bw, h: bh,
      drop: mark % 5 === 0 ? powers[Math.floor(mark / 5) % powers.length] : null };
  });
  return { level, name: def.name, bricks, bottom: Math.max(...bricks.map(brick => brick.y + brick.h)),
    total: bricks.filter(brick => !brick.indestructible).length };
}

export function brickRaceTick(startsAt, now) { return actionTick(startsAt, now, BRICK_LIMIT_TICKS); }
export function brickRacePaddle(run) {
  return { x: run.paddleX, y: paddleY, h: paddleHeight, w: run.powers.wide ? 116 : 82 };
}

function heldBall(x) { return { x, y: paddleY - ballRadius - 1, r: ballRadius, vx: 0, vy: 0, stuck: true }; }

function racerFor(wall) {
  return { tick: 0, sequence: 0, credits: ACTION_BURST_CREDITS, chargedAt: 0, lastInputTick: 0, queue: [],
    run: { status: 'play', lives: startLives, score: 0, broken: 0, hits: 0, rebounds: 0, serves: 0,
      paddleX: BRICK_WIDTH / 2, aim: null, axis: 0, ball: heldBall(BRICK_WIDTH / 2),
      hp: wall.bricks.map(brick => brick.hp), capsules: [], powers: { wide: 0, sticky: 0, slow: 0 }, combo: 0, comboTicks: 0, idle: 0 } };
}

function applyControl(run, [, action, value], seed, wall) {
  if (action === 'aim') { run.aim = value * BRICK_WIDTH / 1000; run.axis = 0; }
  else if (action === 'axis') { run.axis = value; run.aim = null; }
  else if (run.ball.stuck) {
    const speed = computeBallSpeed(wall.level);
    const offset = ((mix(seed, 300 + run.serves++) / 0xffffffff) - .5) * .30;
    const angle = -Math.PI / 2 + offset;
    Object.assign(run.ball, { stuck: false, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
}

function stepRacer(run, wall) {
  const paddle = brickRacePaddle(run);
  const target = run.axis ? run.paddleX + run.axis * (7 + wall.level * .2) * frame
    : run.aim === null ? run.paddleX : run.paddleX + (run.aim - run.paddleX) * holdLerp;
  paddle.x = run.paddleX = clamp(target, paddle.w / 2, BRICK_WIDTH - paddle.w / 2);
  const ball = run.ball;
  for (const power of powers) { run.powers[power] = Math.max(0, run.powers[power] - 1); }
  if (run.comboTicks && !--run.comboTicks) { run.combo = 0; }
  run.capsules = run.capsules.filter(capsule => {
    capsule.y += 2.7 * frame;
    if (capsule.y >= paddle.y && capsule.y < paddle.y + paddle.h && Math.abs(capsule.x - paddle.x) <= paddle.w / 2 + 8) {
      run.powers[capsule.kind] = powerTicks;
      return false;
    }
    return capsule.y <= BRICK_HEIGHT + 12;
  });
  if (ball.stuck) { ball.x = paddle.x; return; }

  const previousY = ball.y;
  run.idle++;
  if (wall.total - run.broken <= ENDGAME_MAX_BRICKS && run.idle >= ENDGAME_IDLE_FRAMES / frame) {
    const remaining = wall.bricks.filter((brick, id) => run.hp[id] > 0 && !brick.indestructible);
    const next = endgameSteer(ball, remaining, run.idle * frame, frame);
    if (next) { Object.assign(ball, next); }
  }
  const travel = frame * (run.powers.slow ? .78 : 1);
  ball.x += ball.vx * travel;
  ball.y += ball.vy * travel;
  if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
  if (ball.x > BRICK_WIDTH - ball.r) { ball.x = BRICK_WIDTH - ball.r; ball.vx = -Math.abs(ball.vx); }
  if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
  if (ball.vy > 0 && previousY + ball.r <= paddle.y && ball.y + ball.r >= paddle.y &&
      Math.abs(ball.x - paddle.x) < paddle.w / 2 + ball.r) {
    Object.assign(ball, paddleVelocity(ball, paddle));
    ball.y = paddle.y - ball.r - 1;
    run.rebounds++;
    if (run.powers.sticky) { run.ball = heldBall(paddle.x); return; }
  }
  if (ball.y - ball.r <= wall.bottom) {
    for (let id = wall.bricks.length - 1; id >= 0; id--) {
      if (!run.hp[id]) { continue; }
      const brick = wall.bricks[id], hit = brickContact(ball, brick);
      if (!hit) { continue; }
      const { dx, dy, px, py } = hit;
      if (px < py) { ball.vx = Math.abs(ball.vx) * (dx > 0 ? 1 : -1); ball.x += (px + .01) * (dx > 0 ? 1 : -1); }
      else { ball.vy = Math.abs(ball.vy) * (dy > 0 ? 1 : -1); ball.y += (py + .01) * (dy > 0 ? 1 : -1); }
      const damage = { hp: run.hp[id], indestructible: brick.indestructible };
      const { destroyed, blocked } = applyDamage(damage, 1);
      if (blocked) { break; }
      run.hp[id] = damage.hp;
      run.combo++;
      run.comboTicks = 105 / frame;
      run.score += Math.round((10 + wall.level * 2) * (1 + Math.floor(run.combo / 4) * .5));
      run.hits++;
      run.idle = 0;
      if (destroyed) {
        run.score += 5 * wall.level;
        run.broken++;
        if (brick.drop) { run.capsules.push({ id, kind: brick.drop, x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 }); }
        if (run.broken === wall.total) { run.status = 'clear'; }
      }
      break;
    }
  }
  if (ball.y - ball.r > BRICK_HEIGHT) {
    run.lives--;
    if (!run.lives) { run.status = 'out'; return; }
    run.ball = heldBall(paddle.x);
    run.capsules = [];
    run.powers = { wide: 0, sticky: 0, slow: 0 };
    run.idle = 0;
  }
}

export function advanceBrickRacer(racer, target, wall, seed) {
  let consumed = 0;
  while (racer.tick < target && racer.run.status === 'play') {
    racer.tick++;
    while (racer.queue[consumed]?.[0] <= racer.tick) { applyControl(racer.run, racer.queue[consumed++], seed, wall); }
    stepRacer(racer.run, wall);
  }
  if (racer.run.status !== 'play') { racer.queue.length = 0; }
  else if (consumed) { racer.queue.splice(0, consumed); }
}

function validInput(input) {
  if (!Array.isArray(input) || !int(input[0], 1, BRICK_LIMIT_TICKS)) { return false; }
  const [, action, value] = input;
  if (action === 'serve') { return input.length === 2; }
  return input.length === 3 && (action === 'aim' ? int(value, 0, 1000) : action === 'axis' && int(value, -1, 1));
}

function validRunner(racer, wall, tick) {
  const run = racer?.run, ball = run?.ball;
  return int(racer?.tick, 0, tick) && int(racer.sequence, 0, BRICK_LIMIT_TICKS) &&
    int(racer.credits, 0, ACTION_BURST_CREDITS) && int(racer.chargedAt, 0, tick + 40) &&
    int(racer.lastInputTick, 0, BRICK_LIMIT_TICKS) && Array.isArray(racer.queue) && racer.queue.length <= ACTION_QUEUE_LIMIT &&
    racer.queue.every((input, index) => validInput(input) && input[0] > racer.tick &&
      input[0] <= racer.lastInputTick && (!index || input[0] >= racer.queue[index - 1][0])) &&
    ['play', 'clear', 'out'].includes(run?.status) && (run.status !== 'play' || racer.tick === tick) &&
    int(run.lives, 0, startLives) && (run.status === 'out') === (run.lives === 0) &&
    int(run.broken, 0, wall.total) && (run.status === 'clear') === (run.broken === wall.total) &&
    [run.score, run.hits, run.rebounds, run.serves, run.combo, run.comboTicks, run.idle].every(value => int(value, 0, 1000000)) &&
    finite(run.paddleX, 0, BRICK_WIDTH) && (run.aim === null || finite(run.aim, 0, BRICK_WIDTH)) && int(run.axis, -1, 1) &&
    finite(ball?.x, 0, BRICK_WIDTH) && finite(ball.y, 0, BRICK_HEIGHT + 15) && ball.r === ballRadius &&
    finite(ball.vx, -10, 10) && finite(ball.vy, -10, 10) && typeof ball.stuck === 'boolean' &&
    powers.every(power => int(run.powers?.[power], 0, powerTicks)) &&
    Array.isArray(run.hp) && run.hp.length === wall.bricks.length && run.hp.every((hp, id) => int(hp, 0, wall.bricks[id].hp)) &&
    run.hp.filter(hp => hp === 0).length === run.broken &&
    Array.isArray(run.capsules) && run.capsules.length <= wall.total && run.capsules.every(capsule =>
    int(capsule.id, 0, wall.bricks.length - 1) && powers.includes(capsule.kind) &&
    finite(capsule.x, 0, BRICK_WIDTH) && finite(capsule.y, 0, BRICK_HEIGHT + 12));
}

function rank(a, b) {
  const lead = Number(a.status === 'clear') - Number(b.status === 'clear') || a.broken - b.broken || a.score - b.score;
  return lead > 0 ? 'a' : lead < 0 ? 'b' : null;
}

function resultReason(a, b, tick) {
  return a.status === 'clear' || b.status === 'clear' ? 'clear'
    : a.status === 'out' && b.status === 'out' ? 'out' : tick === BRICK_LIMIT_TICKS ? 'time' : null;
}

export class TurdanoidBrickRace {
  #state;
  #wall;

  constructor(id, now, saved = null, seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
    if (typeof id !== 'string' || !idPattern.test(id)) { throw new TypeError('Invalid Turdanoid race identity'); }
    if (saved) {
      if (saved.id !== id || saved.version !== TURDANOID_RACE_VERSION || !int(saved.seed, 0, 0xffffffff) ||
          !int(saved.startsAt, BRICK_COUNTDOWN_MS, Number.MAX_SAFE_INTEGER - duration) || !int(saved.tick, 0, BRICK_LIMIT_TICKS)) {
        throw new TypeError('Invalid Turdanoid checkpoint');
      }
      this.#wall = brickRaceWall(saved.seed);
      if (!seats.every(seat => validRunner(saved.racers?.[seat], this.#wall, saved.tick))) { throw new TypeError('Invalid Turdanoid checkpoint'); }
      const a = saved.racers.a.run, b = saved.racers.b.run, reason = resultReason(a, b, saved.tick), result = saved.result;
      if (result === null ? !!reason : !result || result.tick !== saved.tick ||
        (result.reason === 'resign' ? !!reason || !seats.includes(result.winner)
          : !reason || reason !== result.reason || result.winner !== rank(a, b))) { throw new TypeError('Invalid Turdanoid result'); }
      this.#state = clone(saved);
      return;
    }
    if (!int(now, 0, Number.MAX_SAFE_INTEGER - duration - BRICK_COUNTDOWN_MS) || !int(seed, 0, 0xffffffff)) {
      throw new TypeError('Invalid Turdanoid race start');
    }
    this.#wall = brickRaceWall(seed);
    this.#state = { version: TURDANOID_RACE_VERSION, id, seed, startsAt: now + BRICK_COUNTDOWN_MS,
      tick: 0, result: null, racers: mapSeats(() => racerFor(this.#wall)) };
  }

  static restore(saved) { return new TurdanoidBrickRace(saved?.id, null, saved, 0); }
  get deadline() { return this.#state.result ? null : this.#state.startsAt + duration; }
  checkpoint() { return clone(this.#state); }

  expire(now) {
    const state = this.#state;
    if (state.result) { return false; }
    const target = brickRaceTick(state.startsAt + ACTION_INPUT_BUFFER_MS, now), prior = state.tick;
    const { a, b } = state.racers;
    while (state.tick < target) {
      const tick = ++state.tick;
      for (const racer of [a, b]) { advanceBrickRacer(racer, tick, this.#wall, state.seed); }
      const reason = resultReason(a.run, b.run, tick);
      if (reason) {
        state.result = { reason, tick, winner: rank(a.run, b.run) };
        return true;
      }
    }
    return state.tick - prior >= ACTION_TICKS_PER_SECOND;
  }

  command(seat, request, now) {
    const state = this.#state;
    if (!seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (request?.id !== state.id || request.version !== TURDANOID_RACE_VERSION) { return { ok: false, reason: 'match-changed' }; }
    const changed = this.expire(now);
    if (state.result) { return { ok: false, reason: 'finished', changed }; }
    if (request.action === 'resign') {
      state.result = { reason: 'resign', tick: state.tick, winner: seat === 'a' ? 'b' : 'a' };
      return { ok: true };
    }
    if (request.action !== 'input') { return { ok: false, reason: 'unknown-action' }; }
    if (now < state.startsAt) { return { ok: false, reason: 'countdown' }; }
    const racer = state.racers[seat];
    if (racer.run.status !== 'play') { return { ok: false, reason: 'run-ended' }; }
    const reason = acceptTimedInputs(racer, request, state.tick, brickRaceTick(state.startsAt, now), validInput);
    return reason ? { ok: false, reason, changed } : { ok: true };
  }

  view(seat, now) {
    const { id, startsAt, seed, tick, result, racers } = this.#state;
    return { version: TURDANOID_RACE_VERSION, game: 'turdanoid', id, seed, startsAt, at: now, tick,
      endsAt: startsAt + duration - ACTION_INPUT_BUFFER_MS, phase: result ? 'finished' : now < startsAt ? 'countdown' : 'play',
      result: result ? { ...result } : null, wall: { name: this.#wall.name, total: this.#wall.total },
      runner: clone(racers[seat === 'b' ? 'b' : 'a']),
      players: mapSeats(position => {
        const { status, lives, broken, score } = racers[position].run;
        return { status, lives, broken, score };
      }) };
  }
}
