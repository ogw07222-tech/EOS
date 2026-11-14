// Keep the server's probabilistic harvest boundary directly testable.
export function treeWoodYieldForRoll(roll) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('roll must be in [0, 1)');
  return roll < 0.7 ? 2 : 3;
}

// Saved wetness is a remaining game-time duration, not a wall-clock timestamp.
export function isFarmTileWatered(remainingGameMs) {
  return Number.isFinite(remainingGameMs) && remainingGameMs > 0;
}
