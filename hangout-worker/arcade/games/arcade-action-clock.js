export const ACTION_TICKS_PER_SECOND = 120;
export const ACTION_INPUT_BUFFER_MS = 320;
export const ACTION_BURST_CREDITS = 60;
export const ACTION_QUEUE_LIMIT = 24;
const inputCost = 10, maxBatch = 4, futureTicks = 12;

export function actionTick(startsAt, now, limit) {
  return Math.max(0, Math.min(limit, Math.floor((now - startsAt) * ACTION_TICKS_PER_SECOND / 1000)));
}

// A caller authenticates the seat and advances its immutable confirmation
// frontier before accepting an input. This only updates that seat's queue.
export function acceptTimedInputs(seat, frame, confirmed, current, validInput) {
  const { inputs, sequence } = frame;
  if (sequence !== seat.sequence + 1) { return 'sequence'; }
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxBatch || !inputs.every(validInput)) { return 'invalid-input'; }
  if (inputs[0][0] <= confirmed) { return 'late-input'; }
  if (inputs[0][0] < seat.lastInputTick || inputs.some(([tick], index) =>
    tick > current + futureTicks || (index && tick < inputs[index - 1][0]))) { return 'invalid-tick'; }
  const credits = Math.min(ACTION_BURST_CREDITS, seat.credits + Math.max(0, current - seat.chargedAt)) - inputCost * inputs.length;
  if (credits < 0 || seat.queue.length + inputs.length > ACTION_QUEUE_LIMIT) { return 'input-paced'; }
  seat.sequence = sequence;
  seat.credits = credits;
  seat.chargedAt = Math.max(seat.chargedAt, current);
  seat.lastInputTick = inputs.at(-1)[0];
  seat.queue.push(...inputs.map(input => [...input]));
  return null;
}
