/**
 * Stack specific cards on top of a shoe for deterministic deal order (unit-tested).
 * First entry in dealOrder is the first card dealt (first pop from shoe).
 */

/**
 * @param {Array<{ rank: string, suit: string }>} shoe
 * @param {Array<{ rank: string, suit: string }>} dealOrder
 */
export function stackShoeForDealOrder(shoe, dealOrder) {
  if (!Array.isArray(shoe) || !Array.isArray(dealOrder)) {return;}
  for (let i = dealOrder.length - 1; i >= 0; i--) {
    shoe.push(dealOrder[i]);
  }
}

/**
 * @param {string} rank
 * @param {string} [suit]
 */
export function card(rank, suit = 'S') {
  return { rank, suit };
}
