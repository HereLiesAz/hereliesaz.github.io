import { describe, it, expect } from 'vitest';
import { fnv1a32, shardRandom } from './hash.js';

describe('fnv1a32', () => {
  it('returns a 32-bit unsigned integer', () => {
    const h = fnv1a32('hello');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('is deterministic', () => {
    expect(fnv1a32('test_string')).toBe(fnv1a32('test_string'));
  });

  it('differs for different inputs', () => {
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'));
  });

  it('matches known FNV-1a 32-bit value for empty string', () => {
    // FNV offset basis for empty string = 2166136261
    expect(fnv1a32('')).toBe(2166136261);
  });
});

describe('shardRandom', () => {
  it('returns an array of 3 floats in [0, 1)', () => {
    const r = shardRandom('myPainting', 42);
    expect(r).toHaveLength(3);
    r.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });

  it('is deterministic for same inputs', () => {
    const r1 = shardRandom('painting_abc', 7);
    const r2 = shardRandom('painting_abc', 7);
    expect(r1).toEqual(r2);
  });

  it('differs for different shard indices', () => {
    const r1 = shardRandom('painting_abc', 0);
    const r2 = shardRandom('painting_abc', 1);
    expect(r1).not.toEqual(r2);
  });
});