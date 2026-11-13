// Offline fixtures only: execute production packed triggers, opcodes and queues.
import assert from "node:assert/strict";
import Component from "#/cache/config/Component.js";
import CategoryType from "#/cache/config/CategoryType.js";
import DbRowType from "#/cache/config/DbRowType.js";
import DbTableType from "#/cache/config/DbTableType.js";
import DbTableIndex from "#/cache/config/DbTableIndex.js";
import EnumType from "#/cache/config/EnumType.js";
import FontType from "#/cache/config/FontType.js";
import InvType from "#/cache/config/InvType.js";
import LocType from "#/cache/config/LocType.js";
import MesanimType from "#/cache/config/MesanimType.js";
import NpcType from "#/cache/config/NpcType.js";
import ObjType from "#/cache/config/ObjType.js";
import ParamType from "#/cache/config/ParamType.js";
import SeqType from "#/cache/config/SeqType.js";
import StructType from "#/cache/config/StructType.js";
import VarBitType from "#/cache/config/VarBitType.js";
import VarNpcType from "#/cache/config/VarNpcType.js";
import VarPlayerType from "#/cache/config/VarPlayerType.js";
import { EntityLifeCycle } from "#/engine/entity/EntityLifeCycle.js";
import { BlockWalk } from "#/engine/entity/BlockWalk.js";
import Npc from "#/engine/entity/Npc.js";
import { NpcStat } from "#/engine/entity/NpcStat.js";
import Player from "#/engine/entity/Player.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import ServerTriggerType from "#/engine/script/ServerTriggerType.js";
import World from "#/engine/World.js";

for (const config of [VarPlayerType, VarBitType, VarNpcType, ParamType, ObjType,
  LocType, NpcType, InvType, CategoryType, EnumType, StructType, SeqType,
  MesanimType, DbTableType, DbRowType]) config.load("data/pack");
DbTableIndex.init();
Component.load("data/pack");
FontType.load("data/pack");
assert(ScriptProvider.load("data/pack") > 0);
World.currentTick = 10;

const hero = new Player("s5onlinehero", 101n, 101n);
hero.slot = 1;
hero.uid = ((Number(hero.username37 & 0x1fffffn) << 11) | hero.slot) >>> 0;
hero.vars.fill(0);
hero.baseLevels.fill(99);
hero.levels.fill(99);
const packets: unknown[] = [];
hero.write = message => { packets.push(message); }; // Transport capture only.
World.players[hero.slot] = hero;
World.playerLoop.add(1n, hero);
const stageBit = VarBitType.getId("deserttreasure");
assert(stageBit >= 0, "main quest stage is an original varbit, not a varp");
hero.setVarBit(stageBit, 10);
assert.equal(hero.getVarBit(stageBit), 10);
hero.setVarBit(VarBitType.getId("fd_icewarrior_subquest"), 1);
const countBit = VarBitType.getId("fd_icewarrior_trollskilled");
assert(countBit >= 0);
let nextNid = 1;
function actor(name: string): Npc {
  const type = NpcType.getByName(name);
  assert(type, `missing packed NPC ${name}`);
  const npc = new Npc(0, 2848, 3738, 1, 1, EntityLifeCycle.RESPAWN,
    nextNid++, type.id, BlockWalk.NONE);
  World.addNpc(npc, -1);
  npc.lastMovement = -100;
  npc.vars[VarNpcType.getId("npc_aggressive_player")] = hero.uid;
  return npc;
}
function death(npc: Npc): ScriptState {
  const type = NpcType.get(npc.type);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(trigger, `missing packed death trigger for ${type.debugname}`);
  npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
  const state = ScriptRunner.init(trigger, npc);
  npc.executeScript(state);
  for (let turn = 0; state.execution === ScriptState.NPC_SUSPENDED && turn < 20; turn++) {
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.executeScript(state);
  }
  return state;
}

for (let variant = 1; variant <= 7; variant++) {
  const npc = actor(`trollrescue_icetroll_melee${variant}`);
  hero.setVarBit(countBit, 0);
  npc.heroPoints.addHero(hero.hash64, npc.levels[NpcStat.HITPOINTS]);
  const state = death(npc);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.match(state.script.name, new RegExp(`trollrescue_icetroll_melee${variant}`),
    "packed dispatch selects the owned NPC trigger rather than the default");
  console.log("Ice completion control", {
    trigger: state.script.name, hero: String(npc.heroPoints.findHero()),
    activePlayer: String(state._activePlayer?.hash64), coord: [npc.x, npc.z],
    mainStage: hero.getVarBit(stageBit),
    substate: hero.getVarBit(VarBitType.getId("fd_icewarrior_subquest")),
  });
  assert.equal(npc.isActive, false, "native npc_del completed");
  assert.equal(World.getPlayerByHash64(hero.hash64), hero, "native online hero registration");
  assert([...hero.queue.all()].some(request => request.script.name.includes("dt_ice_troll_credit")),
    `native credit was queued; state=${hero.getVarBit(VarBitType.getId("fd_icewarrior_subquest"))}`);
  assert(hero.canAccess(), "offline player permits native protected queue");
  for (let turn = 0; turn < 3; turn++) {
    World.currentTick++;
    hero.processQueues();
  }
  assert.equal(hero.getVarBit(countBit), 1, "native protected Ice credit queue completed");
  console.log(`PASS packed Ice death ${variant}: online sole hero, native removal and credit1`);
}

for (const countBefore of [0, 4]) {
  for (const [name, expectedCount] of [
    ["ice_wolf_5", countBefore],
    ["trollrescue_icetroll_melee1", countBefore + 1],
  ] as const) {
    hero.setVarBit(countBit, countBefore);
    const npc = actor(name);
    if (name === "ice_wolf_5") assert.equal(npc.type, 1955);
    assert.equal(hero.getVarBit(stageBit), 10);
    assert.equal(hero.getVarBit(VarBitType.getId("fd_icewarrior_subquest")), 1);
    assert.equal(World.getPlayerByHash64(hero.hash64), hero);
    npc.heroPoints.addHero(hero.hash64, npc.levels[NpcStat.HITPOINTS]);
    assert.equal(npc.heroPoints.findHero(), hero.hash64, "online sole hero");
    const state = death(npc);
    assert.equal(state.execution, ScriptState.FINISHED, `${name} death completes`);
    assert.equal(npc.isActive, false, `${name} native removal completes`);
    assert(hero.canAccess(), "native protected queue can run");
    for (let turn = 0; turn < 3; turn++) {
      World.currentTick++;
      hero.processQueues();
    }
    assert.equal(hero.getVarBit(countBit), expectedCount,
      `${name} death at count${countBefore}: only an Ice troll earns credit`);
    console.log(`PASS packed ${name} death: type${npc.type}, online sole hero, ` +
      `native removal, count${countBefore}->${expectedCount}; ${state.script.name}`);
  }
}

// Published control: no S5 death handler is on this call path. The winning hero
// logged out after 85 damage; the online last attacker supplies the remaining 15.
const shade = actor("shade_level1");
shade.heroPoints.addHero(999n, 85);
shade.heroPoints.addHero(hero.hash64, 15);
assert.equal(World.getPlayerByHash64(999n), undefined);
console.log("EXPECTED inherited abort: published shade_level1; offline hero999 damage85, online last attacker101 damage15");
const inherited = death(shade);
assert.equal(inherited.execution, ScriptState.ABORTED);
assert.match(inherited.script.name, /check_progress_task/);
assert.equal(inherited.intOperand, 1, "failing opcode accesses secondary NPC");
assert.equal(inherited._activeNpc, shade, "primary NPC was not lost or rebound");
assert.equal(inherited._activeNpc2, null, "published path has no secondary NPC");
assert.equal(shade.isActive, true, "inherited abort prevents native removal");
console.log("PASS published offline-hero control reproduces inherited secondary-NPC abort before removal");
