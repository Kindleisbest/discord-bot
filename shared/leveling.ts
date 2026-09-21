/** Exact progression values. Convert to decimal strings before sending through JSON. */
export interface LevelingProgress {
  level: bigint;
  totalXp: bigint;
  /** XP earned since reaching the current level. */
  xpIntoLevel: bigint;
  /** The full cost of advancing from the current level to the next. */
  nextLevelCost: bigint;
  /** XP still needed to reach the next level. */
  xpToNextLevel: bigint;
}

function requireNonnegativeInteger(value: bigint, name: string): void {
  if (typeof value !== 'bigint') throw new TypeError(`${name} must be a bigint.`);
  if (value < 0n) throw new RangeError(`${name} must not be negative.`);
}

/** XP for the single advance into this level: 10 × level². Starting level 0 costs 0. */
export function xpForLevelAdvance(level: bigint): bigint {
  requireNonnegativeInteger(level, 'Level');
  return 10n * level * level;
}

/** Total lifetime XP needed to reach this level, starting from level 0 at 0 XP. */
export function totalXpForLevel(level: bigint): bigint {
  requireNonnegativeInteger(level, 'Level');
  return 10n * level * (level + 1n) * (2n * level + 1n) / 6n;
}

/** Highest level whose cumulative threshold is at most totalXp; there is no fixed cap. */
export function levelForXp(totalXp: bigint): bigint {
  requireNonnegativeInteger(totalXp, 'Total XP');

  // Find an upper bound, then bisect. Both searches take logarithmically many
  // steps in the resulting level, with no floating-point or Number conversions.
  let lower = 0n;
  let upper = 1n;
  while (totalXpForLevel(upper) <= totalXp) {
    lower = upper;
    upper *= 2n;
  }
  while (upper - lower > 1n) {
    const middle = (lower + upper) / 2n;
    if (totalXpForLevel(middle) <= totalXp) lower = middle;
    else upper = middle;
  }
  return lower;
}

/** Progress toward the next level; exact thresholds start that level at zero progress. */
export function levelingProgress(totalXp: bigint): LevelingProgress {
  const level = levelForXp(totalXp);
  const xpIntoLevel = totalXp - totalXpForLevel(level);
  const nextLevelCost = xpForLevelAdvance(level + 1n);
  return {level, totalXp, xpIntoLevel, nextLevelCost, xpToNextLevel: nextLevelCost - xpIntoLevel};
}
