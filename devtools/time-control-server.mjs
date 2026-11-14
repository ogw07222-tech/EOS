export const DEV_TIME_MULTIPLIERS = Object.freeze([1, 2, 5, 10, 50]);
export const BASE_GAME_MINUTES_PER_REAL_MINUTE = 12;

/**
 * Creates an in-memory game clock. The multiplier intentionally starts at 1
 * for every instance, so a server restart never restores a developer speed.
 * Call tick only for an active player session. Gaps above maxTickMs are treated
 * as disconnected time and discarded rather than applied as offline growth.
 */
export function createTimeControl({
  gameTimeMs = 0,
  now = Date.now(),
  maxTickMs = 6000,
} = {}) {
  if (!Number.isFinite(gameTimeMs) || gameTimeMs < 0) {
    throw new RangeError('gameTimeMs must be a non-negative finite number');
  }
  if (!Number.isFinite(now)) throw new RangeError('now must be finite');
  if (!(Number.isFinite(maxTickMs) || maxTickMs === Infinity) || maxTickMs < 0) {
    throw new RangeError('maxTickMs must be a non-negative number');
  }

  let accumulatedGameTimeMs = gameTimeMs;
  let multiplier = 1;
  let lastRealTimeMs = now;

  function tick(at = Date.now(), { active = true } = {}) {
    if (!Number.isFinite(at)) throw new RangeError('tick time must be finite');
    const elapsed = Math.max(0, at - lastRealTimeMs);
    lastRealTimeMs = at;
    const elapsedRealMs = active && elapsed <= maxTickMs ? elapsed : 0;
    const deltaGameMs = elapsedRealMs * BASE_GAME_MINUTES_PER_REAL_MINUTE * multiplier;
    accumulatedGameTimeMs += deltaGameMs;
    return { ...snapshot(), elapsedRealMs, deltaGameMs };
  }

  function setMultiplier(nextMultiplier, at = Date.now()) {
    if (!DEV_TIME_MULTIPLIERS.includes(nextMultiplier)) {
      throw new RangeError('Unsupported developer time multiplier');
    }
    // Settle all active time at the old rate before switching rates.
    const settled = tick(at);
    multiplier = nextMultiplier;
    return { ...snapshot(), deltaGameMs: settled.deltaGameMs };
  }

  function snapshot() {
    return {
      multiplier,
      gameTimeMs: accumulatedGameTimeMs,
      gameTimeMinutes: accumulatedGameTimeMs / 60_000,
      gameMinutesPerRealMinute: BASE_GAME_MINUTES_PER_REAL_MINUTE * multiplier,
    };
  }

  return Object.freeze({ tick, setMultiplier, snapshot });
}
