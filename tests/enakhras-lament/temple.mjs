import assert from 'node:assert/strict';
import {
  World, ScriptState, ScriptProvider, ServerTriggerType, PlayerStat, map,
  engineModule, id, obj, inv, worn, count, seed, held, use, execute, types,
  loc, npc, stand, approach, finish, dispatch, talk, click, useOn,
  value, set, stage, qualified, remove, placements, Interaction
} from './runtime.mjs';
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const variable = (p, name, n) => p.setVar(id('VarPlayerType', name), n);
const runes = ['airrune', 'firerune', 'earthrune', 'mindrune', 'chaosrune'];
function supplyRunes(p) { for (const name of runes) p.invAdd(inv, obj(name), 20); }
function cast(p, root, spell, distance = 1) {
  const target = npc(root);
  let tile;
  for (let dx = -distance; dx <= distance && !tile; dx++) for (let dz = -distance; dz <= distance; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
    const x = target.x + dx, z = target.z + dz;
    if (!map.isMapBlocked(x, z, target.level) && map.isLineOfSight(target.level, x, z, target.x, target.z)) { tile = { x, z, level: target.level }; break; }
  }
  assert(tile, `${root}: real ${distance}-tile spell approach`);
  Object.assign(p, tile);
  p.delayed = false;
  assert(p.setInteraction(Interaction.ENGINE, target, ServerTriggerType.APNPCT, id('Component', `magic:${spell}`)), 'production spell interaction accepts natural target');
  const op = p.getOpTrigger(), ap = p.getApTrigger();
  assert(ap || op, `${spell}: production spell trigger exists`);
  if (distance === 1 && spell === 'crumble_undead') assert.equal(op?.name, '[opnpct,magic:crumble_undead]', 'adjacent Crumble uses its native OP entry');
  if (spell !== 'crumble_undead') assert.equal(op, null, 'elemental spells correctly use AP even while adjacent');
  assert(p.tryInteract(true), `${spell}: ${distance === 1 ? 'adjacent' : 'ranged'} native interaction executes`);
  if (p.activeScript) finish(p, p.activeScript);
  return { op: op?.name ?? null, ap: ap?.name ?? null };
}
export function spellGates() {
  for (const [root, spell, bit] of [
    ['enakh_dummy_fountain_multinpc', 'fire_strike', 'enakh_ice_room'],
    ['enakh_dummy_furnace_multinpc', 'wind_strike', 'enakh_smoke_room'],
    ['enakh_boneguard_multinpc', 'crumble_undead', 'enakh_player_seen_boneguard']
  ]) {
    for (const distance of [1, 3]) {
      const p = qualified(30); supplyRunes(p);
      const before = p.stats[PlayerStat.MAGIC];
      cast(p, root, spell, distance);
      assert.equal(value(p, bit), 1, `${spell}: actual visible form accepts distance ${distance}`);
      assert(p.stats[PlayerStat.MAGIC] > before, 'normal spell XP paid');
      assert(p.getVar(id('VarPlayerType', 'action_delay')) > World.currentTick, 'normal spell cooldown armed');
      assert(count(p, 'airrune') < 20, 'normal runes consumed');
    }
    for (const gate of ['runes', 'level', 'spellbook', 'delay', 'wrong-spell']) {
      const p = qualified(30);
      if (gate !== 'runes') supplyRunes(p);
      if (gate === 'level') p.levels[PlayerStat.MAGIC] = 0;
      if (gate === 'spellbook') variable(p, 'alternate_spells', 1);
      if (gate === 'delay') variable(p, 'action_delay', World.currentTick + 10);
      const before = p.stats[PlayerStat.MAGIC], air = count(p, 'airrune');
      cast(p, root, gate === 'wrong-spell' ? 'water_strike' : spell);
      assert.equal(value(p, bit), 0, `${root}: ${gate} never solves the obstacle`);
      assert.equal(p.stats[PlayerStat.MAGIC], before, 'refusal gives no XP');
      assert.equal(count(p, 'airrune'), air, 'refusal consumes no runes');
      assert.equal(stage(p), 30, 'refusal cannot advance the quest');
    }
  }
  const p = qualified(30), target = npc('enakh_pentyn');
  const proc = ScriptProvider.getByName('[proc,enakh_puzzle_spell]');
  const state = ScriptRunner.init(proc, p, target, [0]);
  p.runScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(state.popInt(), 0, 'unrelated NPC returns false before any spell processing');
  console.log('PASS native adjacent/ranged spell dispatch, runes, levels, book, delay and unrelated-target isolation');
}
export function auditTravel() {
  const p = qualified(50);
  for (const name of ['enakh_temple_ladderup', 'enakh_temple_ladderdown', 'enakh_temple_pillar_ladder', 'enakh_temple_pillar_ladder_top']) {
    const rows = placements.filter(row => row.kind === 'LocType' && row.type === id('LocType', name));
    assert(rows.length > 0, `${name} is naturally placed`);
    for (let index = 0; index < rows.length; index++) {
      const target = loc(name, index), before = stand(p, target);
      click(p, target);
      assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, `${name} ${target.x},${target.z}: landing is not blocked`);
      assert.equal(Math.abs(p.level - before.level), 1, 'ladder changes exactly one level');
    }
  }
  const approaches = [];
  for (const row of placements.filter(row => row.kind === 'LocType')) {
    const name = types.LocType.get(row.type).debugname;
    if (!/^(rocks_1094[67]|enakh_(door_|pedestal_|fallen_statue_east|statue_east|brazier_[1-6]_multi|largewall_[lr]_multi|rubblepile_by|temple_.*ladder|magic_wall))/.test(name)) continue;
    // Quarry the same first natural rock used by the end-to-end fixture and cell.
    if (name.startsWith('rocks_') && row !== placements.find(other => other.kind === 'LocType' && other.type === row.type)) continue;
    const target = World.getLoc(row.x, row.z, row.level, row.type);
    assert(target, `${name}: packed target exists`);
    approaches.push({ name, target: { level: row.level, x: row.x, z: row.z }, stand: approach(target) });
  }
  for (const row of placements.filter(row => row.kind === 'NpcType')) {
    const name = types.NpcType.get(row.type).debugname;
    if (!name.startsWith('enakh_')) continue;
    const target = npc(name), tile = stand(p, target);
    approaches.push({ name, target: { level: row.level, x: row.x, z: row.z }, stand: tile });
  }
  console.log('PACKED_APPROACHES', JSON.stringify(approaches));
  console.log('PASS packed-map approaches and all natural temple ladder landings');
}
export function runTemple(p) {
  assert.equal(stage(p), 10, 'surface product, not the temple fixture, writes entry stage');
  seed(p, ['chisel', 'softclay', 'enakh_granite_medium']);
  const fallen = loc('enakh_fallen_statue_east_multiloc');
  for (const limb of ['enakh_arm_left', 'enakh_arm_right', 'enakh_leg_left', 'enakh_leg_right']) {
    stand(p, fallen); useOn(p, 'chisel', fallen);
    assert.equal(count(p, limb), 1, `${limb}: chiseled from the changing visible statue`);
  }
  stand(p, fallen); useOn(p, 'chisel', fallen);
  for (const limb of ['enakh_arm_left', 'enakh_arm_right', 'enakh_leg_left', 'enakh_leg_right']) assert.equal(count(p, limb), 1, 'exhausted statue does not duplicate limbs');
  remove(p, 'enakh_arm_left');
  talk(p, 'enakh_lazim_fallen_statue_east_multinpc', [2]);
  assert.equal(count(p, 'enakh_arm_left'), 1, 'Lazim replaces a lost, unused limb');
  for (const [side, item, bit] of [
    ['left_arm', 'enakh_arm_left', 'enakh_left_armlock'], ['right_arm', 'enakh_arm_right', 'enakh_right_armlock'],
    ['left_leg', 'enakh_leg_left', 'enakh_left_leglock'], ['right_leg', 'enakh_leg_right', 'enakh_right_leglock']
  ]) {
    const target = loc(`enakh_door_${side}`); stand(p, target); click(p, target);
    assert.equal(value(p, bit), 1); assert.equal(count(p, item), 0, 'matching limb is consumed exactly once');
    const destination = [p.level, p.x, p.z];
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'unlocked limb door lands on a walkable tile');
    click(p, target); assert.equal(value(p, bit), 1);
    assert.notDeepEqual([p.level, p.x, p.z], destination, 'unlocked door crosses back without another limb');
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'return limb-door crossing also lands safely');
  }
  for (const letter of ['z', 'm', 'r', 'k']) {
    const pedestal = loc(`enakh_pedestal_sigil_${letter}`); stand(p, pedestal); click(p, pedestal);
    assert.equal(count(p, `enakh_sigil_${letter}`), 1);
    const door = loc(`enakh_door_${letter}_sigil`); stand(p, door); useOn(p, `enakh_sigil_${letter}`, door);
    assert.equal(value(p, `enakh_${letter}_door`), 1);
    assert.equal(count(p, `enakh_sigil_${letter}`), 0);
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'sigil door lands on a walkable tile');
    const destination = [p.level, p.x, p.z];
    click(p, door);
    assert.notDeepEqual([p.level, p.x, p.z], destination, 'unlocked sigil door crosses back');
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'return sigil-door crossing also lands safely');
  }
  const pedestal = loc('enakh_pedestal_multiloc'); stand(p, pedestal);
  useOn(p, 'softclay', pedestal);
  assert.equal(count(p, 'enakh_camel_mould_positive'), 1);
  use(p, 'chisel', 'enakh_granite_medium');
  if (p.activeScript) finish(p, p.activeScript);
  assert.equal(count(p, 'enakh_stone_head_akthanakos'), 1, 'mould directs ordinary granite chiseling to the fitted head');
  useOn(p, 'enakh_stone_head_akthanakos', pedestal);
  assert.equal(stage(p), 20); assert.equal(value(p, 'enakh_pedestal_head'), 1);
  const fuels = ['logs', 'oak_logs', 'willow_logs', 'maple_logs', 'unlit_candle', 'coal'];
  seed(p, ['bullseye_lantern_lit', 'tinderbox', ...fuels]);
  for (let i = 0; i < fuels.length; i++) {
    const brazier = loc(`enakh_brazier_${i + 1}_multiloc`); stand(p, brazier);
    useOn(p, fuels[i], brazier);
    assert.equal(count(p, fuels[i]), 0, 'each brazier consumes its own cached-position fuel');
    assert.equal(value(p, `enakh_brazier_${i + 1}_multivar`), 1);
  }
  assert.equal(value(p, 'enakh_blood_room'), 1);
  supplyRunes(p); cast(p, 'enakh_dummy_fountain_multinpc', 'fire_strike');
  variable(p, 'action_delay', 0); cast(p, 'enakh_dummy_furnace_multinpc', 'wind_strike');
  seed(p, ['cake']); useOn(p, 'cake', npc('enakh_pentyn'));
  assert.equal(count(p, 'cake'), 0); assert.equal(stage(p), 30, 'all four rooms plus head unlock barrier');
  const barrier = loc('enakh_magic_wall'); stand(p, barrier); click(p, barrier);
  assert.equal(p.z, 9320, 'barrier crosses to the stair side');
  variable(p, 'action_delay', 0); cast(p, 'enakh_boneguard_multinpc', 'crumble_undead');
  assert.equal(stage(p), 50, 'Crumble selects the original bone-pile multi state');
  const bones = npc('enakh_boneguard_multinpc'); Object.assign(p, { level: 2, x: 3104, z: 9310 });
  dispatch(p, bones, ServerTriggerType.OPNPC1);
  assert.equal(p.z, 9305);
  talk(p, 'enakh_akthanakos_multinpc');
  assert.equal(value(p, 'enakh_player_helps_akthanakos'), 0, 'Protect from Melee is required for the offer');
  variable(p, 'prayer14', 1);
  talk(p, 'enakh_akthanakos_multinpc', [1]);
  assert.equal(value(p, 'enakh_player_helps_akthanakos'), 1);
  const rubble = loc('enakh_rubblepile_by_largewall'), wall = loc('enakh_largewall_r_multiloc');
  for (let i = 0; i < 3; i++) {
    stand(p, rubble); click(p, rubble); assert.equal(count(p, 'enakh_sandstone_medium'), 1);
    stand(p, wall); useOn(p, 'enakh_sandstone_medium', wall);
    assert.equal(value(p, 'enakh_largewall_multivar'), i, 'adding alone does not finish a course');
    useOn(p, 'chisel', wall);
    assert.equal(value(p, 'enakh_largewall_multivar'), i + 1, 'every fitted course requires chiseling');
  }
  assert.equal(stage(p), 60); assert.equal(value(p, 'enakh_akthanakos_form'), 1);
  const before = [PlayerStat.CRAFTING, PlayerStat.FIREMAKING, PlayerStat.MINING, PlayerStat.MAGIC].map(skill => p.stats[skill]);
  const qp = execute('[proc,count_questpoints]', p).popInt();
  talk(p, 'enakh_akthanakos_multinpc');
  assert.equal(stage(p), 70); assert.equal(count(p, 'camulet'), 1); assert.equal(value(p, 'enakh_camulet_charge'), 4);
  assert.deepEqual([PlayerStat.CRAFTING, PlayerStat.FIREMAKING, PlayerStat.MINING, PlayerStat.MAGIC].map((skill, i) => p.stats[skill] - before[i]), [70000, 70000, 70000, 70000]);
  assert.equal(execute('[proc,count_questpoints]', p).popInt() - qp, 2);
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && /completed Enakhra/.test(packet.text)), 'native completion scroll is sent');
  const terminal = [...p.stats]; talk(p, 'enakh_akthanakos_multinpc');
  assert.deepEqual([...p.stats], terminal, 'terminal conversation cannot repeat XP');
  assert.equal(count(p, 'camulet'), 1, 'terminal conversation cannot duplicate reward');
  held(p, 'camulet', 4); if (p.activeScript) finish(p, p.activeScript);
  assert.equal(value(p, 'enakh_camulet_charge'), 3); assert.equal(p.level, 1);
  seed(p, ['feud_camel_pooh_bucket']);
  use(p, 'feud_camel_pooh_bucket', 'camulet');
  assert.equal(value(p, 'enakh_camulet_charge'), 3, 'later reverse recharge direction is not introduced');
  use(p, 'camulet', 'feud_camel_pooh_bucket');
  assert.equal(value(p, 'enakh_camulet_charge'), 4); assert.equal(count(p, 'bucket_empty'), 1);
  remove(p, 'camulet'); talk(p, 'enakh_lazim_altar_multinpc', [1]);
  assert.equal(count(p, 'camulet'), 1, 'post-quest lost Camulet can be replaced');
  talk(p, 'enakh_lazim_altar_multinpc', [2]);
  assert.equal(p.z, 2925, 'post-quest Lazim gives a safe surface exit');
  const hole = loc('enakh_statue_east_multiloc'); stand(p, hole); click(p, hole);
  assert.equal(p.z, 9325, 'original surface hole allows post-quest temple re-entry');
  assert.deepEqual([...p.stats], terminal, 'Camulet recovery, recharge and re-entry cannot repeat XP');
  console.log('PASS surface-produced entry through limbs, sigils, head, four rooms, Boneguard, wall, climax, once-only rewards and Camulet recovery');
}
