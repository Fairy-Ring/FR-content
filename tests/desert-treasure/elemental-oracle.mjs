import assert from 'node:assert/strict';

// Contract equations, not a product-script replay. Configuration is read from
// this pack by name. No attack, hit-roll, XP or special procedure runs here.
export const elementalSeeds = [1, 2, 3, 6, 7, 31, 99, 377, 6543, 65535];

function stream(seed) {
  let state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  const bits = count => {
    state = (state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(state >> BigInt(48 - count));
  };
  const draws = [], rolls = [];
  return {
    draws, rolls,
    roll(limit, inclusive = true) {
      const value = (bits(26) * 134217728 + bits(27)) / 9007199254740992;
      draws.push(value);
      rolls.push([inclusive ? 'RANDOMINC' : 'RANDOM', limit]);
      return Math.trunc(value * (limit + Number(inclusive)));
    },
    suffix() { return bits(31) % 1000000; }
  };
}

export function elementalOracle({ p, n, attack, seed, successOnly, miss, types, id, PlayerStat, NpcStat, canonical }) {
  const random = stream(seed), kind = attack.kind, name = attack.row[0];
  const pv = key => p.getVar(id('VarPlayerType', key));
  const param = (type, key) => {
    const index = id('ParamType', key), definition = types.ParamType.get(index);
    return type.params.get(index) ?? definition.defaultInt;
  };
  const target = types.NpcType.get(n.type);
  const inv = id('InvType', 'inv'), worn = id('InvType', 'worn');
  const inventory = canonical([...p.invs.entries()].map(([key, value]) => [key, value.items]));
  const items = new Map(inventory);
  const held = slot => items.get(worn)[slot]?.id ?? -1;
  const weapon = types.ObjType.get(held(3));
  const category = key => id('CategoryType', key);
  const bow = weapon?.category === category('weapon_bow'), crossbow = weapon?.category === category('weapon_crossbow');
  const ammo = bow || crossbow ? types.ObjType.get(held(13)) : weapon;
  const playerVars = Array.from(p.vars), npcVars = Array.from(n.vars), npcLevels = Array.from(n.levels);
  const putPlayer = (key, value) => { playerVars[id('VarPlayerType', key)] = value; };
  const putNpc = (key, value) => { npcVars[id('VarNpcType', key)] = value; };
  const xp = Array.from(p.stats, () => 0), queue = [], damageHits = [];
  const playerVisual = [p.animId, p.animDelay, p.spotanimId, p.spotanimHeight, p.spotanimTime];
  const npcVisual = [n.animId, n.animDelay, n.spotanimId, n.spotanimHeight, n.spotanimTime];
  const effects = [], messages = [], ammoLoss = [];
  let hero = 0, poisoned = false, refused = false, unfilteredDamage = 0;
  const effect = (command, ...ints) => effects.push({ command, ints });
  const sound = (sound, count, delay) => { if (sound !== -1) effect('SOUND_SYNTH', sound, count, delay); };
  const animate = (animation, delay = 0) => { playerVisual[0] = animation; playerVisual[1] = delay; effect('ANIM', animation, delay); };
  const origin = (spot, height, delay = 0) => { playerVisual.splice(2, 3, spot, height, delay); effect('SPOTANIM_PL', spot, height, delay); };
  const defend = delay => {
    npcVisual[0] = param(target, 'defend_anim'); npcVisual[1] = delay;
    effect('NPC_ANIM', npcVisual[0], delay);
  };
  const impact = (spot, height, delay) => { npcVisual.splice(2, 3, spot, height, delay); effect('SPOTANIM_NPC', spot, height, delay); };
  const consume = (container, object, count) => {
    for (const item of items.get(container)) {
      if (item?.id !== object) continue;
      const used = Math.min(count, item.count);
      item.count -= used; count -= used;
      if (item.count === 0) item.id = -1;
      if (count === 0) return;
    }
    assert.equal(count, 0, 'oracle fixture has sufficient payment');
  };
  const defence = style => (n.levels[style === 4 ? NpcStat.MAGIC : NpcStat.DEFENCE] + 9) *
    (param(target, ['stabdefence', 'slashdefence', 'crushdefence', 'rangedefence', 'magicdefence'][style]) + 64);
  const attackRoll = style => miss ? 0 : pv(['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'][style]);
  const accurate = (style, bonus = false) => random.roll(bonus ? Math.trunc(attackRoll(style) * 10 / 7) : attackRoll(style)) > random.roll(defence(style));
  const experience = (damage, magic = false) => {
    const credited = Math.min(damage, n.levels[NpcStat.HITPOINTS]);
    const multiplier = n.getVar(id('VarNpcType', 'npc_combat_xp_multiplier'));
    const base = credited * 10;
    const scale = value => Math.trunc(value * multiplier / 1000);
    xp[magic ? PlayerStat.MAGIC : kind === 'melee' ? PlayerStat.ATTACK : PlayerStat.RANGED] += scale(base * (magic ? 2 : 4));
    xp[PlayerStat.HITPOINTS] += scale(Math.trunc(base * 133 / 100));
    hero += credited;
  };
  const retaliate = delay => {
    queue.push({ id: 1, damage: 0, delay });
    putNpc('npc_aggressive_player', p.uid); putNpc('npc_lastcombat', 1000);
  };
  const enqueue = (damage, delay) => { damageHits.push(damage); queue.push({ id: 2, damage, delay }); };
  const cap = maximum => Math.min(maximum, param(target, 'max_dealt'));
  const elementalAmmo = damage => n.type === 1977 && ammo.debugname !== 'ice_arrow' ? 0 : damage;
  const poison = (damage, special = false) => {
    const severity = param(ammo, 'poison_severity');
    if (damage > 0 && severity > 0 && random.roll(special ? 4 : 8, false) === 0) {
      const applied = special ? severity : Math.max(severity - 14, 0);
      if (applied > npcVars[id('VarNpcType', 'npc_poison')]) {
        putNpc('npc_poison', applied); poisoned = true;
        effect('NPC_SETTIMER', 30);
      }
    }
  };
  const projectile = (spot, startHeight, endHeight, delay, peak, length, arc, step) => {
    // All fixtures put a size-one player immediately west of the target.
    const duration = delay + length + step;
    effect('PROJANIM_NPC', (p.level << 28) | (p.x << 14) | p.z, n.uid, spot, startHeight, endHeight, delay, duration, peak, arc);
    return duration;
  };
  const drop = delay => {
    if (ammo.debugname === 'holy_water') {
      consume(worn, ammo.id, 1);
      ammoLoss.push({ loss: true, delay, object: ammo.id }, { loss: false, delay, object: id('ObjType', 'smashed_glass') });
      return;
    }
    const loss = random.roll(5, false) === 0;
    consume(worn, ammo.id, 1);
    ammoLoss.push({ loss, delay, object: ammo.id });
  };
  const energy = () => putPlayer('sa_energy', 1000 - param(weapon, 'sa_energy'));
  const checkAmmo = () => {
    if (bow && ammo.category !== category(weapon.debugname === 'ogre_bow' ? 'ogre_arrows' : 'arrows')) {
      refused = true; messages.push("You can't use that ammo with your bow.");
    }
    assert(!crossbow || ammo.category === category('bolts'), 'oracle fixture uses compatible bolts');
    return !refused;
  };
  if (kind === 'magic') {
    const table = types.DbTableType.get(id('DbTableType', 'magic_spell_table'));
    const row = types.DbRowType.get(id('DbRowType', `magic_spell_${name}`));
    const values = field => {
      const column = table.columnNames.indexOf(field);
      assert(column >= 0, field);
      return row.columnValues[column]?.length ? row.columnValues[column] : table.getDefault(column);
    };
    const value = field => values(field)[0];
    const undeadRefusal = name === 'crumble_undead' && !successOnly && param(target, 'undead') === 0;
    if (undeadRefusal) {
      refused = true; messages.push('This spell only affects skeletons, zombies, ghosts and shades.');
    } else {
      const runes = values('runesrequired');
      for (let index = 0; index < runes.length; index += 2) if (runes[index] >= 0 && runes[index + 1] > 0) consume(inv, runes[index], runes[index + 1]);
      xp[PlayerStat.MAGIC] += value('experience');
      putPlayer('action_delay', 1005);
      animate(value('anim'));
      if (row.columnValues[table.columnNames.indexOf('spotanim_origin')]?.length) origin(value('spotanim_origin'), 92);
      const proj = row.columnValues[table.columnNames.indexOf('spotanim_proj')];
      const flight = proj?.length ? projectile(...proj) : 0;
      const duration = successOnly || ['iban_blast', 'flames_of_zamorak', 'claws_of_guthix', 'saradomin_strike'].includes(name) ? 64 : flight;
      const hit = successOnly || accurate(4);
      sound(value('sound_cast'), 0, 0);
      if (hit) {
        const maximum = attack.row[2];
        let damage = random.roll(cap(maximum));
        unfilteredDamage = damage;
        const permit = n.type !== 1977 && n.type !== 1913 || (n.type === 1977 ? [1, 5, 9, 13] : [3, 7, 11, 15]).includes(attack.row[1]);
        if (!permit) damage = 0;
        if (!successOnly && ['claws_of_guthix', 'flames_of_zamorak'].includes(name)) {
          const stat = name === 'claws_of_guthix' ? NpcStat.DEFENCE : NpcStat.MAGIC;
          npcLevels[stat] = Math.max(0, n.levels[stat] - Math.trunc(1 + n.baseLevels[stat] * 5 / 100));
        }
        const delay = Math.trunc(duration / 30) + 1;
        retaliate(delay); enqueue(damage, delay); defend(duration);
        sound(param(target, 'defend_sound'), 0, duration);
        experience(damage, true);
        if (row.columnValues[table.columnNames.indexOf('sound_hit')]?.length) sound(value('sound_hit'), 0, duration);
        impact(...values('spotanim_target'), duration);
        if (!successOnly && ['snare', 'entangle'].includes(name)) {
          putNpc('npc_stunned', 1001 + value('freeze_time'));
          effect('NPC_WALKTRIGGER', 8, 0);
        }
      } else {
        sound(id('SynthType', 'spellfail'), 1, duration);
        impact(id('SpotanimType', 'failedspell_impact'), 92, duration);
        retaliate(0);
      }
      if (name === 'iban_blast') putPlayer('iban_staff_charges', 99);
    }
  } else if (kind === 'ranged' || kind === 'special') {
    if (kind === 'ranged') putPlayer('action_delay', 1000 + param(weapon, 'attackrate'));
    if (checkAmmo()) {
      const special = kind === 'special', short = special && name === 'magic_shortbow', long = special && name === 'magic_longbow';
      const axe = special && name === 'rune_thrownaxe';
      if (special) { energy(); putPlayer('sa_attack', 0); }
      const maximum = special ? Math.trunc(((99 + 10) * (param(ammo, 'rangebonus') + 64) + 320) / 640) : pv('com_maxhit');
      const damages = [], durations = [];
      const hit = () => {
        const accurateHit = long || accurate(pv('damagetype'), short);
        let damage = accurateHit ? random.roll(cap(kind === 'ranged' && name === 'holy water' ? 0 : maximum)) : 0;
        unfilteredDamage = Math.max(unfilteredDamage, damage);
        damage = elementalAmmo(damage);
        if (accurateHit) experience(damage);
        poison(damage, special);
        return damage;
      };
      if (short || long) {
        animate(short ? id('SeqType', 'snapshot') : pv('com_attackanim'));
        origin(id('SpotanimType', short ? 'sp_attack_snapshot_spotanim' : 'sp_attack_glow_arrow_launch'), 96);
        sound(id('SynthType', short ? 'snapshot' : 'powershot'), 1, 0);
        durations.push(projectile(id('SpotanimType', 'sp_attack_glow_arrow_travel'), 40, 36, short ? 20 : 41, 15, short ? 3 : 5, 11, short ? 3 : 5));
        if (short) durations.push(projectile(id('SpotanimType', 'sp_attack_glow_arrow_travel'), 40, 36, 50, 15, 3, 11, 3));
        for (const duration of durations) drop(Math.trunc(duration / 30));
        for (const duration of durations) {
          const damage = hit(), delay = Math.trunc(duration / 30) + 1;
          damages.push(damage); retaliate(delay); enqueue(damage, delay);
          sound(param(target, 'defend_sound'), 0, duration);
        }
      } else if (axe) {
        animate(id('SeqType', 'chainhit'));
        origin(id('SpotanimType', 'sp_attack_chainhit_launch_spotanim'), 96);
        const duration = projectile(id('SpotanimType', 'sp_attack_chainhit_travel_spotanim'), 40, 36, 32, 15, 0, 11, 5);
        const damage = hit(), delay = Math.trunc(duration / 30) + 1;
        damages.push(damage); retaliate(delay); enqueue(damage, delay); defend(duration);
        sound(param(target, 'defend_sound'), 0, duration);
        // One target only: the native search ends the chain and returns null.
        drop(0);
      } else {
        const damage = hit(); damages.push(damage);
        animate(pv('com_attackanim'));
        sound(pv('com_attacksound'), 0, 0);
        origin(param(ammo, 'proj_launch'), ammo.debugname === 'ogre_arrow' ? 50 : 96);
        let duration = 30;
        if (bow || crossbow || [category('weapon_thrown'), category('weapon_javelin')].includes(weapon.category)) {
          duration = projectile(param(ammo, 'proj_travel'), 40, 36, bow || crossbow ? 41 : 32, 15, bow || crossbow ? 5 : 0, 11, 5);
          drop(Math.trunc(duration / 30));
        }
        const delay = Math.trunc((duration + 30) / 30);
        retaliate(delay); enqueue(damage, delay); defend(duration);
        sound(param(target, 'defend_sound'), 0, duration);
      }
    }
  } else {
    assert.equal(kind, 'melee');
    const hit = accurate(pv('damagetype'));
    const damage = hit ? random.roll(cap(pv('com_maxhit'))) : 0;
    unfilteredDamage = damage;
    if (hit) experience(damage);
    animate(pv('com_attackanim')); sound(pv('com_attacksound'), 0, 0);
    retaliate(0); enqueue(damage, 0); defend(20); sound(param(target, 'defend_sound'), 0, 20);
    putPlayer('action_delay', 1000 + param(weapon, 'attackrate'));
  }
  if (miss && !(refused && kind === 'ranged')) {
    putPlayer(kind === 'magic' ? 'com_magicattack' : ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'][pv('damagetype')], 0);
  }
  return { random, nextRandom: random.suffix(), inventory, playerVars, npcVars, npcLevels, xp, queue,
    hero: hero > 0 ? [{ hash64: String(p.hash64), points: hero }] : [], playerVisual, npcVisual, effects, messages, ammoLoss,
    damage: damageHits[0] ?? null, hitmark: damageHits.length ? { damage: Math.min(damageHits[0], n.levels[NpcStat.HITPOINTS]), type: damageHits[0] > 0 ? 1 : 0 } : undefined,
    poisoned, refused, unfilteredDamage };
}

export function assertElementalOutcome(actual, expected, label) {
  for (const field of ['damage', 'queue', 'xp', 'inventory', 'playerVars', 'npcVars', 'npcLevels', 'playerVisual', 'npcVisual', 'nextRandom', 'hitmark']) {
    assert.deepEqual(actual[field], expected[field], `${label}: independent ${field}`);
  }
  assert.deepEqual(actual.hero.filter(hero => hero.points > 0), expected.hero, `${label}: independent owner credit`);
  assert.deepEqual(actual.draws, expected.random.draws, `${label}: independent draw order`);
  assert.deepEqual(actual.commands.filter(command => ['RANDOM', 'RANDOMINC'].includes(command.command))
    .map(command => [command.command, command.ints.at(-1)]), expected.random.rolls, `${label}: independent random bounds and call order`);
  const widths = { ANIM: 2, SOUND_SYNTH: 3, SPOTANIM_PL: 3, SPOTANIM_NPC: 3, NPC_ANIM: 2, NPC_SETTIMER: 1, NPC_WALKTRIGGER: 2, PROJANIM_NPC: 9 };
  assert.deepEqual(actual.commands.filter(command => widths[command.command]).map(command =>
    ({ command: command.command, ints: command.ints.slice(-widths[command.command]) })), expected.effects, `${label}: independent visuals, sounds and projectile outcomes`);
  assert.deepEqual(actual.commands.filter(command => command.command === 'MES').map(command => command.strings.at(-1)), expected.messages, `${label}: independent messages`);
  const paid = actual.commands.filter(command => ['INV_DEL', 'INV_DROPITEM_DELAYED'].includes(command.command) && command.ints[0] === actual.worn);
  assert.deepEqual(paid.map(command => ({ loss: command.command === 'INV_DEL', object: command.ints.at(command.command === 'INV_DEL' ? -2 : -4), delay: command.command === 'INV_DEL' ? undefined : command.ints.at(-1) })),
    expected.ammoLoss.map(row => ({ loss: row.loss || actual.blocked, object: row.object, delay: row.loss || actual.blocked ? undefined : row.delay })), `${label}: independent ammunition loss/drop outcome`);
}
