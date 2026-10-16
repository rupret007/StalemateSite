/** Flying chip tokens during bet (must not linger over the felt). */

export const FLYING_CHIP_CLASS = 'flying-chip';
export const FLYING_CHIP_MAX_MS = 520;

/**
 * @param {ParentNode | null | undefined} root
 */
export function clearFlyingChips(root) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : null;
  if (!scope) {return 0;}
  const nodes = scope.querySelectorAll(`.${FLYING_CHIP_CLASS}`);
  nodes.forEach((el) => el.remove());
  return nodes.length;
}
