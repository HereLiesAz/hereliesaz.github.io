import { describe, it, expect, beforeEach } from 'vitest';

// We test the store logic as pure functions extracted from the store.
// Import helpers directly.
import { buildHistoryEntry, computeT, pickNextNode } from './storeHelpers.js';

describe('computeT', () => {
  it('returns 0 when camera is at sweet spot', () => {
    expect(computeT({ sweetZ: 0, cameraZ: 0, segmentLength: 200 })).toBeCloseTo(0);
  });

  it('returns 0.5 at halfway between sweet spots', () => {
    expect(computeT({ sweetZ: 0, cameraZ: -100, segmentLength: 200 })).toBeCloseTo(0.5);
  });

  it('returns 1.0 when camera reaches next sweet spot', () => {
    expect(computeT({ sweetZ: 0, cameraZ: -200, segmentLength: 200 })).toBeCloseTo(1.0);
  });

  it('is positive when camera moves forward (negative Z)', () => {
    expect(computeT({ sweetZ: -200, cameraZ: -300, segmentLength: 200 })).toBeCloseTo(0.5);
  });
});

describe('pickNextNode', () => {
  const edges = [
    { source: 'A', target: 'B', weight: 0.9 },
    { source: 'A', target: 'C', weight: 0.8 },
    { source: 'A', target: 'D', weight: 0.7 },
  ];

  it('returns a valid target id from available edges', () => {
    const result = pickNextNode('A', edges, []);
    expect(['B', 'C', 'D']).toContain(result);
  });

  it('excludes recently visited nodes', () => {
    const result = pickNextNode('A', edges, ['B', 'C']);
    expect(result).toBe('D');
  });

  it('returns any node if all neighbors are excluded', () => {
    const allEdges = [
      ...edges,
      { source: 'B', target: 'A', weight: 0.5 },
    ];
    // All neighbors excluded — fall back to any edge
    const result = pickNextNode('A', edges, ['B', 'C', 'D']);
    expect(['B', 'C', 'D']).toContain(result); // falls back
  });

  it('throws if no edges exist at all', () => {
    expect(() => pickNextNode('A', [], [])).toThrow();
  });
});

describe('buildHistoryEntry', () => {
  it('has required keys', () => {
    const entry = buildHistoryEntry({
      id: 'painting_1',
      sweetZ: -200,
      splineStart: [0, 0, 0],
      splineMid:   [1, 0, -100],
      splineEnd:   [0, 0, -200],
    });
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('sweetZ');
    expect(entry).toHaveProperty('splinePoints');
    expect(entry.splinePoints).toHaveLength(3);
  });
});