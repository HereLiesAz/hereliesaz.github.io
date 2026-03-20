/**
 * FNV-1a 32-bit hash. Must produce the same values as the Python preprocessor.
 * Used to generate deterministic per-shard aRandom attributes.
 */
export function fnv1a32(str) {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime, 32-bit multiply
    h >>>= 0;                   // unsigned 32-bit
  }
  return h >>> 0;
}

/**
 * Generate deterministic [r0, r1, r2] in [0,1) for a shard.
 * Matches the Python preprocessor's _aRandom() function exactly.
 */
export function shardRandom(paintingId, shardIndex) {
  const seedInt = fnv1a32(`${paintingId}_${shardIndex}`);
  const seed    = (seedInt & 0x7FFFFFFF) / 2147483647.0;

  const fract = (x) => x - Math.floor(x);
  const r0 = fract(Math.abs(Math.sin(seed * 127.1)) * 43758.5453);
  const r1 = fract(Math.abs(Math.sin(seed * 311.7)) * 43758.5453);
  const r2 = fract(Math.abs(Math.sin(seed *  74.3)) * 43758.5453);

  return [r0, r1, r2];
}