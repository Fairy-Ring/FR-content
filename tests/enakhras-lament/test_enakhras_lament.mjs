import assert from 'node:assert/strict';
import {
  World, ServerTriggerType, PlayerStat, id, obj, inv, count, seed, use,
  finish, qualified, value, set, stage, loc, npc, stand, talk, click, useOn,
  dispatch, random, remove, types
} from './runtime.mjs';
import { spellGates, auditTravel, runTemple } from './temple.mjs';
for (const [skill, minimum] of [[PlayerStat.CRAFTING, 50], [PlayerStat.FIREMAKING, 45], [PlayerStat.PRAYER, 43], [PlayerStat.MAGIC, 39]]) {
  const p = qualified(); p.baseLevels[skill] = minimum - 1;
  talk(p, 'enakh_lazim_statue_east_multinpc');
  assert.equal(stage(p), 0, `listed skill ${skill} refuses acceptance below ${minimum}`);
}
{
  const p = qualified(); talk(p, 'enakh_lazim_statue_east_multinpc', [2]);
  assert.equal(stage(p), 0, 'declining does not start quest');
}
const p = qualified();
seed(p, ['chisel', 'bronze_pickaxe']);
talk(p, 'enakh_lazim_statue_east_multinpc', [1, 2]);
assert.equal(stage(p), 1);
const statue = loc('enakh_statue_east_multiloc');
const quarry = loc('rocks_10946');
function mine(rolls, expected) {
  stand(p, quarry); p.setVar(id('VarPlayerType', 'action_delay'), World.currentTick);
  random(rolls, () => click(p, quarry));
  assert(count(p, expected) > 0, 'original quarry produces the required stone through its compiled handler');
  if (quarry.isChanged()) World.revertLoc(quarry);
  p.clearInteraction();
}
for (let i = 0; i < 3; i++) mine([0], 'enakh_sandstone_large');
mine([0.999999, 0.999999, 0], 'enakh_sandstone_small');
for (let i = 0; i < 3; i++) useOn(p, 'enakh_sandstone_large', npc('enakh_lazim_statue_east_multinpc'));
assert.equal(value(p, 'enakh_lazim_carrying_stone'), 30, 'Lazim persists partial 32 kg hand-in');
useOn(p, 'enakh_sandstone_small', npc('enakh_lazim_statue_east_multinpc'));
assert.equal(count(p, 'enakh_sandstone_huge_base+legs'), 1);
use(p, 'chisel', 'enakh_sandstone_huge_base+legs'); if (p.activeScript) finish(p, p.activeScript);
assert.equal(count(p, 'enakh_sandstone_crafted_base+legs'), 1);
stand(p, statue); useOn(p, 'enakh_sandstone_crafted_base+legs', statue);
assert.equal(value(p, 'enakh_statue_multivar'), 1);
for (let i = 0; i < 2; i++) { mine([0], 'enakh_sandstone_large'); useOn(p, 'enakh_sandstone_large', npc('enakh_lazim_statue_east_multinpc')); }
assert.equal(count(p, 'enakh_sandstone_huge_body'), 1);
use(p, 'chisel', 'enakh_sandstone_huge_body'); if (p.activeScript) finish(p, p.activeScript);
stand(p, statue); useOn(p, 'enakh_sandstone_crafted_body', statue);
assert.equal(value(p, 'enakh_statue_multivar'), 2);
useOn(p, 'chisel', statue); assert.equal(value(p, 'enakh_statue_multivar'), 3);
talk(p, 'enakh_lazim_statue_east_multinpc', [4]);
assert.equal(value(p, 'enakh_choose_statue_head'), 3);
const granite = loc('rocks_10947'); stand(p, granite);
p.setVar(id('VarPlayerType', 'action_delay'), World.currentTick);
random([0], () => click(p, granite));
assert.equal(count(p, 'enakh_granite_medium'), 1);
if (granite.isChanged()) World.revertLoc(granite);
p.clearInteraction();
use(p, 'chisel', 'enakh_granite_medium'); if (p.activeScript) finish(p, p.activeScript);
assert.equal(count(p, 'enakh_statue_head_camel'), 1);
stand(p, statue); useOn(p, 'enakh_statue_head_camel', statue);
assert.equal(stage(p), 10); assert.equal(value(p, 'enakh_statue_multivar'), 31);
assert.equal(value(p, 'enakh_fallen_statue_multivar'), 3, 'overlapping original selector shows limbful fallen statue');
assert.deepEqual([p.level, p.x, p.z], [0, 3127, 9325]);
runTemple(p);
spellGates();
auditTravel();
// Independent boundary fixtures seed only their own branch, not the end-to-end path.
{
  const p = qualified(1); seed(p, ['enakh_sandstone_large']);
  set(p, 'enakh_lazim_carrying_stone', 30);
  useOn(p, 'enakh_sandstone_large', npc('enakh_lazim_statue_east_multinpc'));
  assert.equal(count(p, 'enakh_sandstone_large'), 1, 'overweight hand-in never deletes the offered stone');
  assert.equal(value(p, 'enakh_lazim_carrying_stone'), 30);
}
{
  const p = qualified(10); set(p, 'enakh_where_is_lazim', 1); set(p, 'enakh_left_arm_taken', 1);
  const bank = id('InvType', 'bank'); p.invAdd(bank, obj('enakh_arm_left'), 1);
  talk(p, 'enakh_lazim_fallen_statue_east_multinpc', [2]);
  assert.equal(count(p, 'enakh_arm_left'), 0, 'banked limb is not duplicated');
}
{
  const p = qualified(60); set(p, 'enakh_akthanakos_form', 1);
  p.invAdd(inv, obj('bronze_pickaxe'), 28);
  talk(p, 'enakh_akthanakos_multinpc');
  assert.equal(stage(p), 60, 'full reward inventory cannot consume the once-only terminal write');
}
console.log('PASS Q097 Enakhras Lament: start-to-70 native visible forms, natural quarry, recovery, rewards, spell gates and packed approaches');
// World owns workers; this transport-free suite starts no server.
process.exit(0);
