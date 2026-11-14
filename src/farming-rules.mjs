// Keep the server's probabilistic harvest boundary directly testable.
export function treeWoodYieldForRoll(roll) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('roll must be in [0, 1)');
  return roll < 0.7 ? 2 : 3;
}
