import test from 'node:test';
import assert from 'node:assert/strict';
import {levelForXp, levelingProgress, totalXpForLevel, xpForLevelAdvance} from '../shared/leveling.js';

test('approved progression milestones distinguish a single advance from lifetime XP', () => {
  const milestones = [
    [0n, 0n, 0n],
    [1n, 10n, 10n],
    [2n, 40n, 50n],
    [5n, 250n, 550n],
    [10n, 1_000n, 3_850n],
    [15n, 2_250n, 12_400n],
    [19n, 3_610n, 24_700n],
    [20n, 4_000n, 28_700n],
  ] as const;
  for (const [level, advance, lifetime] of milestones) {
    assert.equal(xpForLevelAdvance(level), advance);
    assert.equal(totalXpForLevel(level), lifetime);
    assert.equal(levelForXp(lifetime), level);
  }
});

test('a threshold grants its level exactly, while one less XP retains the prior level', () => {
  assert.equal(levelForXp(0n), 0n);
  assert.equal(levelForXp(9n), 0n);
  let threshold = 0n;
  // Independently accumulate individual costs to check cumulative thresholds.
  for (let level = 1n; level <= 200n; level += 1n) {
    threshold += 10n * level ** 2n;
    assert.equal(totalXpForLevel(level), threshold);
    assert.equal(levelForXp(threshold - 1n), level - 1n);
    assert.equal(levelForXp(threshold), level);
    assert.equal(levelForXp(threshold + 1n), level);
  }
});

test('progress describes remaining XP correctly before and immediately after a level up', () => {
  assert.deepEqual(levelingProgress(0n), {
    level: 0n, totalXp: 0n, xpIntoLevel: 0n, nextLevelCost: 10n, xpToNextLevel: 10n,
  });
  assert.deepEqual(levelingProgress(28_699n), {
    level: 19n, totalXp: 28_699n, xpIntoLevel: 3_999n, nextLevelCost: 4_000n, xpToNextLevel: 1n,
  });
  assert.deepEqual(levelingProgress(28_700n), {
    level: 20n, totalXp: 28_700n, xpIntoLevel: 0n, nextLevelCost: 4_410n, xpToNextLevel: 4_410n,
  });
});

test('large levels and XP remain exact beyond JavaScript Number precision', () => {
  // This level itself cannot be represented exactly by a JavaScript Number.
  const level = 9_007_199_254_740_993n;
  const threshold = totalXpForLevel(level);
  assert.equal(levelForXp(threshold - 1n), level - 1n);
  assert.equal(levelForXp(threshold), level);
  assert.equal(levelForXp(threshold + 1n), level);
  const progress = levelingProgress(threshold + 17n);
  assert.equal(progress.level, level);
  assert.equal(progress.xpIntoLevel, 17n);
  assert.equal(progress.xpToNextLevel, totalXpForLevel(level + 1n) - threshold - 17n);
});

test('inversion brackets arbitrary totals, including values far beyond a fixed-width integer', () => {
  const totals = [0n, 1n, 49n, 2_999n, 100_001n, 9_007_199_254_740_991n, 10n ** 100n + 123n];
  for (const total of totals) {
    const progress = levelingProgress(total);
    const threshold = totalXpForLevel(progress.level);
    const nextThreshold = totalXpForLevel(progress.level + 1n);
    assert.ok(threshold <= total);
    assert.ok(total < nextThreshold);
    assert.equal(progress.totalXp, total);
    assert.equal(progress.xpIntoLevel, total - threshold);
    assert.equal(progress.nextLevelCost, nextThreshold - threshold);
    assert.equal(progress.xpToNextLevel, nextThreshold - total);
    assert.ok(progress.xpToNextLevel > 0n);
  }
});

test('all progression APIs reject negative values and non-bigint inputs', () => {
  const functions = [xpForLevelAdvance, totalXpForLevel, levelForXp, levelingProgress];
  for (const fn of functions) {
    assert.throws(() => fn(-1n), RangeError);
    for (const value of [0, 1.5, NaN, Infinity, '10', null, undefined, true]) {
      assert.throws(() => fn(value as unknown as bigint), TypeError);
    }
  }
});
