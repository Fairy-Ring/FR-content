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
import Loc from "#/engine/entity/Loc.js";
import { allocateIfAbsent } from "#/engine/routefinder/index.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import ServerTriggerType from "#/engine/script/ServerTriggerType.js";
import { ScriptOpcode } from "#/engine/script/ScriptOpcode.js";
import ResumePauseButtonHandler from "#/network/game/client/handler/ResumePauseButtonHandler.js";
import ResumePauseButton from "#/network/game/client/model/ResumePauseButton.js";
import IfSetText from "#/network/game/server/model/IfSetText.js";
import MessageGame from "#/network/game/server/model/MessageGame.js";
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
// Run the original packed Wear/Remove, ledge and Tenzing handlers, not test procs.
const inv = InvType.getId("inv");
const worn = InvType.getId("worn");
const boots = ObjType.getByName("death_spikedboots")!;
assert(boots && boots.wearpos >= 0);
const refusal = "Trying to walk in these would be difficult. I'll carry them for now.";
const wear = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, boots.id, boots.category)!;
assert(wear);
if (process.env.DTS5_BOOTS_REFUSAL_MUTANT === "1") {
  // Isolated in-memory mutant of this one handler: the published unconditional refusal.
  wear.opcodes = [ScriptOpcode.PUSH_CONSTANT_STRING, ScriptOpcode.MES, ScriptOpcode.RETURN];
  wear.intOperands = [0, 0, 0];
  wear.stringOperands = [refusal, "", ""];
}
function output(): string {
  return packets.map(packet => packet instanceof IfSetText ? packet.text :
    packet instanceof MessageGame ? packet.msg : "").join("\n");
}
function runPacked(trigger: NonNullable<ReturnType<typeof ScriptProvider.getByTrigger>>,
  target: Npc | Loc | null = null): void {
  const state = ScriptRunner.init(trigger, hero, target);
  hero.executeScript(state, true);
  for (let turn = 0; turn < 100 && state.execution !== ScriptState.FINISHED; turn++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${trigger.name} aborted`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(), hero));
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, hero.delayedUntil);
      hero.delayed = false;
      hero.executeScript(state, true, true);
    } else assert.fail(`unexpected ${trigger.name} suspension ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, trigger.name);
}
hero.baseLevels.fill(1);
hero.levels.fill(1);
hero.x = 2836; hero.z = 3700; hero.level = 0;
hero.invSet(inv, boots.id, 1, 0);
hero.lastItem = boots.id; hero.lastSlot = 0;
packets.length = 0;
runPacked(wear);
assert.equal(hero.invTotal(inv, boots.id), 1, "outside Wear leaves inventory unchanged");
assert.equal(hero.invTotal(worn, boots.id), 0, "outside Wear cannot equip");
assert(output().includes(refusal), "outside Wear retains the exact published refusal");
console.log("PASS packed spiked-boots Wear outside the Ice area: exact refusal, still carried");

hero.x = 2837; hero.z = 3805;
runPacked(wear);
assert.equal(hero.invGetSlot(worn, boots.wearpos)?.id, boots.id,
  "inside Wear equips spiked boots at the ledge hint tile with no skill requirement");
assert.equal(hero.invTotal(inv, boots.id), 0);
console.log("PASS packed spiked-boots Wear inside the Ice area: feet slot, level1 skills");
const remove = ScriptProvider.getByTrigger(ServerTriggerType.INV_BUTTON1,
  Component.getId("wornitems:worn"), -1)!;
assert(remove);
hero.lastSlot = boots.wearpos;
runPacked(remove);
assert.equal(hero.invTotal(worn, boots.id), 0);
assert.equal(hero.invTotal(inv, boots.id), 1, "Remove returns boots to inventory");
console.log("PASS packed spiked-boots Remove: no worn boots, one carried");

hero.setVarBit(VarBitType.getId("fd_icewarrior_dead"), 1);
const ledgeType = LocType.getByName("trollrescue_blankmodel")!;
assert(ledgeType);
const ledge = new Loc(0, 2837, 3804, 1, 1, EntityLifeCycle.RESPAWN,
  ledgeType.id, 10, 0);
const climb = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,
  ledgeType.id, ledgeType.category)!;
assert(climb);
packets.length = 0;
runPacked(climb, ledge);
assert.equal(hero.level, 0, "carried boots do not admit the ledge");
assert.equal(hero.getVarBit(VarBitType.getId("fd_icewarrior_bootshint")), 1);
assert(output().includes("without some spiked boots"));
hero.lastSlot = hero.getInventory(inv)!.items.findIndex(item => item?.id === boots.id);
runPacked(wear);
// This trigger test has no world map loader: allocate the real destination zone.
allocateIfAbsent(2838, 3803, 1);
runPacked(climb, ledge);
assert.equal(hero.level, 1, "worn boots admit the original local height transition");
assert.equal(hero.invGetSlot(worn, boots.wearpos)?.id, boots.id);
console.log("PASS packed ledge: carried boots hint; worn boots admit level1");
hero.lastSlot = boots.wearpos;
runPacked(remove);

// Tenzing consumes inventory supplies, not equipment; the published flow is unchanged.
hero.baseLevels.fill(99); hero.levels.fill(99);
hero.x = 2822; hero.z = 3554; hero.level = 0;
hero.setVar(VarPlayerType.getId("death_equiproom"), 70);
hero.setVar(VarPlayerType.getId("death_map"), 5);
const bread = ObjType.getId("bread"), trout = ObjType.getId("trout");
hero.invAdd(inv, bread, 10); hero.invAdd(inv, trout, 10);
const tenzing = actor("death_sherpa");
const handin = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1,
  tenzing.type, NpcType.get(tenzing.type).category)!;
assert(handin);
runPacked(handin, tenzing);
assert.equal(hero.getVar(VarPlayerType.getId("death_map")) & 15, 7,
  "inventory hand-in reaches the original map-given state");
assert.equal(hero.invTotal(inv, boots.id), 0);
assert.equal(hero.invTotal(inv, bread), 0);
assert.equal(hero.invTotal(inv, trout), 0);
assert.equal(hero.invTotal(inv, ObjType.getId("death_secretwaymap")), 1);
console.log("PASS packed Death Plateau hand-in: one carried boots, ten bread/trout, map received");

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
