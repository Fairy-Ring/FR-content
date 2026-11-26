import { after } from 'node:test';

// UNKNOWN test-fixture seed, not a gameplay value. Use the existing actor-seed
// xorshift32 convention, but seed the whole native timeline before runtime loads.
const nativeWanderFixtureSeed = 0x0751118;

export function seededWander(seed) {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

const originalRandom = Math.random;
Math.random = seededWander(nativeWanderFixtureSeed);
after(() => { Math.random = originalRandom; });
console.log(`Feud native fixture RNG: xorshift32 seed=0x${nativeWanderFixtureSeed.toString(16)}`);
