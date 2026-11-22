// Independent guide/cache values for the Burst and Barrage rows.
// The damage and effect model follows the retained U1 oracle conventions.
export const areaSpells = [
  ['smoke_burst', 107, 62, 36, 19, [['chaosrune', 4], ['deathrune', 2], ['firerune', 2], ['airrune', 2]], 1, 10, 0],
  ['shadow_burst', 155, 64, 37, 20, [['chaosrune', 4], ['deathrune', 2], ['airrune', 2], ['soulrune', 2]], 2, 0, 0],
  ['blood_burst', 63, 68, 39, 21, [['chaosrune', 4], ['deathrune', 2], ['bloodrune', 2]], 3, 0, 0],
  ['ice_burst', 25, 70, 40, 22, [['chaosrune', 4], ['deathrune', 2], ['waterrune', 4]], 4, 0, 16],
  ['smoke_barrage', 119, 86, 48, 27, [['deathrune', 4], ['bloodrune', 2], ['firerune', 4], ['airrune', 4]], 1, 20, 0],
  ['shadow_barrage', 167, 88, 49, 28, [['deathrune', 4], ['bloodrune', 2], ['airrune', 4], ['soulrune', 3]], 2, 0, 0],
  ['blood_barrage', 73, 92, 51, 29, [['deathrune', 4], ['bloodrune', 4], ['soulrune', 1]], 3, 0, 0],
  ['ice_barrage', 35, 94, 52, 30, [['deathrune', 4], ['bloodrune', 2], ['waterrune', 6]], 4, 0, 32]
].map(([name, widget, level, xp, maximum, runes, family, poison, freeze]) => ({ name, widget, level, xp, maximum, runes, family, poison, freeze, area: true }));

export function randomStream(seed) {
  let state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  const bits = count => {
    state = (state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(state >> BigInt(48 - count));
  };
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

// A null roll means an accuracy splash. A numeric zero is an accurate zero hit.
export function rollArea(seed, spell, victims) {
  const rng = randomStream(seed);
  const results = [];
  for (const victim of victims) {
    const attackRoll = rng.roll(victim.attack);
    const defenceRoll = rng.roll(victim.defence);
    const accurate = attackRoll > defenceRoll;
    const maximum = victim.pvp && victim.protectedMagic
      ? Math.trunc(spell.maximum * 6 / 10)
      : Math.min(spell.maximum, victim.cap ?? spell.maximum);
    const rolled = accurate ? rng.roll(maximum) : null;
    const poison = accurate && spell.family === 1 ? rng.roll(8, false) === 0 : false;
    const damage = accurate ? (victim.immune ? 0 : Math.min(rolled, victim.hp ?? 99)) : null;
    results.push({ accurate, attackRoll, defenceRoll, maximum, rolled, damage, poison });
  }
  return { results, draws: rng.draws, nextRandom: rng.suffix() };
}

const scale = (value, multiplier) => Math.trunc(value * multiplier / 1000);

export function areaExperience(spell, outcomes, { defensive = false, multiplier = 1000 } = {}) {
  const total = { magic: spell.xp * 10, defence: 0, hitpoints: 0 };
  for (const result of outcomes.results) {
    const base = (result.damage ?? 0) * 10;
    total.magic += scale(defensive ? Math.trunc(base * 133 / 100) : base * 2, multiplier);
    if (defensive) total.defence += scale(base, multiplier);
    total.hitpoints += scale(Math.trunc(base * 133 / 100), multiplier);
  }
  return total;
}

export function bloodHeal(outcomes) {
  const accurate = outcomes.results.filter(result => result.accurate);
  return {
    hasAccuracy: accurate.length > 0,
    amount: Math.ceil(accurate.reduce((sum, result) => sum + result.rolled, 0) / 4)
  };
}
