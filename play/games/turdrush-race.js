import { TUNING, act, advance, createRun, startRun, queueRushSwipe, rushSwipeAction } from './turdrush-core.js?v=fa8a8ce86510b759';

export const TURD_RUSH_RACE_VERSION = 1;
export const RUSH_COURSE_METRES = 480;
export const RUSH_COUNTDOWN_MS = 3000;
export const RUSH_INPUT_BUFFER_MS = 320;
export const RUSH_TICKS_PER_SECOND = 120;
export const RUSH_LIMIT_TICKS = 45 * RUSH_TICKS_PER_SECOND;
const actions = ['left', 'right', 'jump', 'slide', 'swipe-left', 'swipe-right', 'cancel-swipe'];
const kinds = ['barrier', 'beam', 'crate', 'pick', 'shield', 'magnet'];
const seats = ['a', 'b'];
const inputCost = 10, burstCredits = 60, maxQueued = 24, maxBatch = 4, futureTicks = 12;
const checkpointInterval = RUSH_TICKS_PER_SECOND;
const raceDurationMs = RUSH_LIMIT_TICKS / RUSH_TICKS_PER_SECOND * 1000 + RUSH_INPUT_BUFFER_MS;
const mapSeats = fn => Object.fromEntries(seats.map(seat => [seat, fn(seat)]));
const clone = value => globalThis.structuredClone(value);
const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{5,80}$/.test(value);

export function rushRaceTick(startsAt, now) {
  return Math.max(0, Math.min(RUSH_LIMIT_TICKS, Math.floor((now - startsAt) * RUSH_TICKS_PER_SECOND / 1000)));
}

function flushSwipe(racer) {
  const action = rushSwipeAction(racer.run, racer.pending);
  if (!action) { racer.pending = null; return; }
  act(racer.run, action);
  if (racer.run.player.lane === racer.pending.lane) { racer.pending = null; }
}

function raceAction(racer, action) {
  if (action === 'cancel-swipe') { racer.pending = null; return; }
  if (action === 'swipe-left' || action === 'swipe-right') {
    racer.pending = queueRushSwipe(racer.run, racer.pending, action.slice(6));
    flushSwipe(racer);
    return;
  }
  if (action === 'left' || action === 'right') { racer.pending = null; }
  act(racer.run, action);
}

function racerFor(seed) {
  const run = createRun(seed);
  startRun(run);
  return { tick: 0, run, pending: null, queue: [], status: 'running', sequence: 0, credits: burstCredits, chargedAt: 0, lastInputTick: 0 };
}

export function advanceRushRacer(racer, target) {
  let consumed = 0;
  while (racer.tick < target && racer.status === 'running') {
    racer.tick++;
    while (racer.queue[consumed]?.[0] <= racer.tick) { raceAction(racer, racer.queue[consumed++][1]); }
    advance(racer.run, TUNING.fixedStep);
    flushSwipe(racer);
    if (racer.run.phase === 'over') { racer.status = 'crashed'; }
    else if (racer.run.distance >= RUSH_COURSE_METRES) {
      racer.status = 'finished';
      racer.run.phase = 'over';
    }
  }
  if (racer.status !== 'running') { racer.queue.length = 0; racer.pending = null; }
  else if (consumed) { racer.queue.splice(0, consumed); }
}

function packRacer(racer) {
  const { run, pending, queue } = racer;
  return {
    ...racer, pending: pending ? { ...pending } : null, queue: queue.map(input => [...input]),
    run: { ...run, player: { ...run.player }, lastHit: run.lastHit ? { ...run.lastHit } : null,
      entities: run.entities.map(({ id, kind, lane, at }) => [id, kinds.indexOf(kind), lane, at]) }
  };
}

export function unpackRushRacer(receipt) {
  const racer = clone(receipt);
  racer.run.entities = racer.run.entities.map(([id, kind, lane, at]) => ({ id, kind: kinds[kind], lane, at }));
  return racer;
}

const validInput = input => Array.isArray(input) && input.length === 2 &&
  int(input[0], 1, RUSH_LIMIT_TICKS) && actions.includes(input[1]);

function validRunner(racer, seed, tick) {
  const run = racer?.run, player = run?.player;
  return int(racer?.tick, 0, tick) && int(racer.sequence, 0, RUSH_LIMIT_TICKS) &&
    int(racer.credits, 0, burstCredits) && int(racer.chargedAt, 0, tick + Math.ceil(RUSH_INPUT_BUFFER_MS * RUSH_TICKS_PER_SECOND / 1000) + 1) &&
    int(racer.lastInputTick, 0, RUSH_LIMIT_TICKS) && ['running', 'crashed', 'finished'].includes(racer.status) &&
    (racer.status !== 'running' || racer.tick === tick) &&
    (racer.pending === null || int(racer.pending?.lane, 0, 2) && bounded(racer.pending.until, 0, 46)) &&
    Array.isArray(racer.queue) && racer.queue.length <= maxQueued &&
    racer.queue.every((input, i) => validInput(input) && input[0] > racer.tick &&
      input[0] <= racer.lastInputTick && (!i || input[0] >= racer.queue[i - 1][0])) &&
    run?.version === TUNING.version && run.seed === seed && run.phase === (racer.status === 'running' ? 'running' : 'over') &&
    bounded(run.distance, 0, RUSH_COURSE_METRES + 1) && bounded(run.elapsed, 0, 46) &&
    int(run.score, 0, 100000) && int(run.picks, 0, 500) && bounded(run.speed, TUNING.baseSpeed, TUNING.maxSpeed) &&
    int(player?.lane, 0, 2) && bounded(player.x, -2.400001, 2.400001) && bounded(player.y, 0, 5) &&
    [player.slide, player.shield, player.magnet, run._laneCooldown, run._invulnerable].every(value => bounded(value, 0, 8)) &&
    bounded(run._velocityY, -30, 9) && run._accumulator === 0 && int(run._random, 0, 0xffffffff) &&
    int(run._nextId, 1, 1000) && int(run._nextChunk, 100, 1000) && int(run._chunk, 1, 12) && int(run._safeLane, 0, 2) &&
    Array.isArray(run.entities) && run.entities.length <= 120 && run.entities.every(entity => Array.isArray(entity) &&
      entity.length === 4 && int(entity[0], 1, run._nextId - 1) && int(entity[1], 0, kinds.length - 1) &&
      int(entity[2], 0, 2) && int(entity[3], 0, 1000)) &&
    (racer.status === 'finished' ? run.distance >= RUSH_COURSE_METRES : run.distance < RUSH_COURSE_METRES || racer.status === 'crashed') &&
    (racer.status === 'crashed' ? kinds.slice(0, 3).includes(run.reason) : run.reason === null);
}

function rank(a, b) {
  const lead = Number(a.status === 'finished') - Number(b.status === 'finished') ||
    a.run.distance - b.run.distance || a.run.picks - b.run.picks;
  return lead > 0 ? 'a' : lead < 0 ? 'b' : null;
}

export class TurdRushRace {
  #state;

  constructor(id, now, saved = null, seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
    if (!validId(id)) { throw new TypeError('Invalid Turd Rush match identity'); }
    if (saved) {
      if (saved.id !== id || saved.version !== TURD_RUSH_RACE_VERSION ||
          !int(saved.seed, 0, 0xffffffff) || !int(saved.startsAt, RUSH_COUNTDOWN_MS, Number.MAX_SAFE_INTEGER - raceDurationMs) ||
          !int(saved.tick, 0, RUSH_LIMIT_TICKS) || !seats.every(seat => validRunner(saved.racers?.[seat], saved.seed, saved.tick))) {
        throw new TypeError('Invalid Turd Rush checkpoint');
      }
      const bothEnded = seats.every(seat => saved.racers[seat].status !== 'running');
      const { result } = saved;
      if (result === null ? bothEnded || saved.tick === RUSH_LIMIT_TICKS :
        !result || result.tick !== saved.tick ||
        (result.reason === 'resign' ? !seats.includes(result.winner) || bothEnded :
          result.winner !== rank(saved.racers.a, saved.racers.b) ||
          (result.reason === 'course' ? !bothEnded : result.reason !== 'time' || saved.tick !== RUSH_LIMIT_TICKS))) {
        throw new TypeError('Invalid Turd Rush result');
      }
      this.#state = { ...saved, result: result ? { ...result } : null, racers: mapSeats(seat => unpackRushRacer(saved.racers[seat])) };
      return;
    }
    if (!int(now, 0, Number.MAX_SAFE_INTEGER - raceDurationMs - RUSH_COUNTDOWN_MS) || !int(seed, 0, 0xffffffff)) {
      throw new TypeError('Invalid Turd Rush start');
    }
    this.#state = { version: TURD_RUSH_RACE_VERSION, id, seed, startsAt: now + RUSH_COUNTDOWN_MS, tick: 0,
      result: null, racers: mapSeats(() => racerFor(seed)) };
  }

  static restore(saved) { return new TurdRushRace(saved?.id, null, saved, 0); }
  get deadline() { return this.#state.result ? null : this.#state.startsAt + raceDurationMs; }
  checkpoint() { return { ...this.#state, result: this.#state.result ? { ...this.#state.result } : null,
    racers: mapSeats(seat => packRacer(this.#state.racers[seat])) }; }

  expire(now) {
    const state = this.#state;
    if (state.result) { return false; }
    const prior = state.tick;
    const target = rushRaceTick(state.startsAt + RUSH_INPUT_BUFFER_MS, now);
    if (target <= prior) { return false; }
    const { a, b } = state.racers;
    for (const racer of [a, b]) { advanceRushRacer(racer, target); }
    const bothEnded = a.status !== 'running' && b.status !== 'running';
    state.tick = bothEnded ? Math.max(a.tick, b.tick) : target;
    if (bothEnded || target === RUSH_LIMIT_TICKS) {
      state.result = { reason: bothEnded ? 'course' : 'time', tick: state.tick, winner: rank(a, b) };
      return true;
    }
    // Bound replay after idle requests while leaving ordinary polling read-only.
    return state.tick - prior >= checkpointInterval;
  }

  command(seat, frame, now) {
    const state = this.#state;
    if (!seats.includes(seat)) { return { ok: false, reason: 'unavailable' }; }
    if (frame?.id !== state.id || frame.version !== TURD_RUSH_RACE_VERSION) { return { ok: false, reason: 'match-changed' }; }
    const changed = this.expire(now);
    if (state.result) { return { ok: false, reason: 'finished', changed }; }
    if (frame.action === 'resign') {
      state.result = { reason: 'resign', tick: state.tick, winner: seat === 'a' ? 'b' : 'a' };
      return { ok: true };
    }
    if (frame.action !== 'input') { return { ok: false, reason: 'unknown-action' }; }
    if (now < state.startsAt) { return { ok: false, reason: 'countdown' }; }
    const racer = state.racers[seat];
    if (racer.status !== 'running') { return { ok: false, reason: 'run-ended' }; }
    if (frame.sequence !== racer.sequence + 1) { return { ok: false, reason: 'sequence' }; }
    const { inputs } = frame;
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxBatch || !inputs.every(validInput)) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (inputs[0][0] <= state.tick) { return { ok: false, reason: 'late-input' }; }
    const current = rushRaceTick(state.startsAt, now);
    if (inputs[0][0] < racer.lastInputTick || inputs.some(([tick], index) =>
      tick > current + futureTicks || (index && tick < inputs[index - 1][0]))) { return { ok: false, reason: 'invalid-tick' }; }
    const credits = Math.min(burstCredits, racer.credits + Math.max(0, current - racer.chargedAt)) - inputCost * inputs.length;
    if (credits < 0 || racer.queue.length + inputs.length > maxQueued) { return { ok: false, reason: 'input-paced' }; }
    racer.sequence = frame.sequence;
    racer.credits = credits;
    racer.chargedAt = Math.max(racer.chargedAt, current);
    racer.lastInputTick = inputs.at(-1)[0];
    racer.queue.push(...inputs.map(input => [...input]));
    return { ok: true };
  }

  view(seat, now) {
    const { id, startsAt, seed, tick, result, racers } = this.#state;
    return {
      version: TURD_RUSH_RACE_VERSION, game: 'turdrush', id, seed, startsAt, at: now, tick, course: RUSH_COURSE_METRES,
      phase: result ? 'finished' : now < startsAt ? 'countdown' : 'play',
      result: result ? { ...result } : null, runner: packRacer(racers[seat === 'b' ? 'b' : 'a']),
      players: mapSeats(position => {
        const { run, status } = racers[position];
        return { status, distance: run.distance, picks: run.picks };
      })
    };
  }
}
