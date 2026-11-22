// Independent contract values from the retained period guide tables and Main's decision rows.
// No product procedure, generated identifier or recorded execution supplies an expectation.
export const spells = [
  ['smoke_rush', 83, 50, 30, 15, [['chaosrune', 2], ['deathrune', 2], ['firerune', 1], ['airrune', 1]], 1, 10, 0],
  ['shadow_rush', 131, 52, 31, 16, [['chaosrune', 2], ['deathrune', 2], ['airrune', 1], ['soulrune', 1]], 2, 0, 0],
  ['blood_rush', 45, 56, 33, 17, [['chaosrune', 2], ['deathrune', 2], ['bloodrune', 1]], 3, 0, 0],
  ['ice_rush', 5, 58, 34, 18, [['chaosrune', 2], ['deathrune', 2], ['waterrune', 2]], 4, 0, 8],
  ['smoke_blitz', 95, 74, 42, 23, [['deathrune', 2], ['bloodrune', 2], ['firerune', 2], ['airrune', 2]], 1, 20, 0],
  ['shadow_blitz', 143, 76, 43, 24, [['deathrune', 2], ['bloodrune', 2], ['airrune', 2], ['soulrune', 2]], 2, 0, 0],
  ['blood_blitz', 55, 80, 45, 25, [['deathrune', 2], ['bloodrune', 4]], 3, 0, 0],
  ['ice_blitz', 15, 82, 46, 26, [['deathrune', 2], ['bloodrune', 2], ['waterrune', 3]], 4, 0, 24]
].map(([name, widget, level, xp, maximum, runes, family, poison, freeze]) => ({ name, widget, level, xp, maximum, runes, family, poison, freeze }));

export const seeds = [0, 1, 2, 3, 6, 7, 31, 99, 377, 6543, 65535];
export function randomStream(seed) {
  let state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  const bits = count => { state = (state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n); return Number(state >> BigInt(48 - count)); };
  const draws = [];
  return {
    draws,
    roll(limit, inclusive = true) {
      const draw = (bits(26) * 134217728 + bits(27)) / 9007199254740992;
      draws.push(draw);
      return Math.trunc(draw * (limit + Number(inclusive)));
    },
    suffix() { return bits(31) % 1000000; }
  };
}
export function outcome({ seed, attack, defence, spell, cap = spell.maximum, protectedMagic = false, hp = 99, defensive = false, multiplier = 1000, pvp = false, immune = false }) {
  const rng = randomStream(seed);
  const accurate = rng.roll(attack) > rng.roll(defence);
  const maximum = pvp && protectedMagic ? Math.trunc(spell.maximum * 6 / 10) : Math.min(spell.maximum, cap);
  const rolled = accurate ? rng.roll(maximum) : 0;
  const poison = accurate && spell.family === 1 ? rng.roll(8, false) === 0 : false;
  const damage = accurate ? immune ? 0 : Math.min(rolled, hp) : null;
  const scale = n => Math.trunc(n * multiplier / 1000);
  const base = (damage ?? 0) * 10;
  const xp = { magic: spell.xp * 10 + scale(defensive ? Math.trunc(base * 133 / 100) : base * 2),
    defence: defensive ? scale(base) : 0, hitpoints: scale(Math.trunc(base * 133 / 100)) };
  return { accurate, rolled, damage, poison, xp, draws: rng.draws, nextRandom: rng.suffix() };
}
