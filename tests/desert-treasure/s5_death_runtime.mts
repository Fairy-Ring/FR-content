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
import { CoordGrid } from "#/engine/CoordGrid.js";
import { PlayerTimerType } from "#/engine/entity/EntityTimer.js";
import { Interaction } from "#/engine/entity/Interaction.js";
import { EntityLifeCycle } from "#/engine/entity/EntityLifeCycle.js";
import { BlockWalk } from "#/engine/entity/BlockWalk.js";
import Npc from "#/engine/entity/Npc.js";
import { NpcStat } from "#/engine/entity/NpcStat.js";
import { PlayerStat } from "#/engine/entity/PlayerStat.js";
import { isMapBlocked } from "#/engine/GameMap.js";
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
import JavaRandom from "#/util/JavaRandom.js";

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
  target: Npc | Loc | null = null, args: number[] = []): void {
  const state = ScriptRunner.init(trigger, hero, target, args);
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
const countBeforeShade = hero.getVarBit(countBit);
const published = death(shade);
assert.equal(published.execution, ScriptState.FINISHED, "published offline-hero death completes");
assert.match(published.script.name, /shade/);
assert.equal(published._activeNpc, shade, "primary NPC was not lost or rebound");
assert.equal(published._activeNpc2, null, "published path needs no secondary NPC");
assert.equal(shade.isActive, false, "native removal completes with an offline winning hero");
assert(shade.lifecycleTick > 0, "native respawn lifecycle is scheduled");
assert.equal(hero.getVarBit(countBit), countBeforeShade, "published shade path awards no S5 credit");
assert(![...hero.queue.all()].some(request => request.script.name.includes("dt_ice")),
  "published shade path queues no S5 handler");
console.log("PASS published offline-hero shade control", {
  execution: published.execution, script: published.script.name,
  active: shade.isActive, lifecycleTick: shade.lifecycleTick,
  primaryNpc: published._activeNpc === shade, secondaryNpc: published._activeNpc2,
  iceCountBefore: countBeforeShade, iceCountAfter: hero.getVarBit(countBit),
});

const substateBit = VarBitType.getId("fd_icewarrior_subquest");
const deadBit = VarBitType.getId("fd_icewarrior_dead");
const dadBit = VarBitType.getId("fd_icewarrior_dadfree");
const mumBit = VarBitType.getId("fd_icewarrior_mumfree");
function packed(name: string) {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing packed script ${name}`);
  return script;
}
function queues(players: Player[] = [hero], ticks = 3): void {
  for (let turn = 0; turn < ticks; turn++) {
    World.currentTick++;
    for (const player of players) player.processQueues();
  }
}
function resetIce(player = hero): void {
  player.closeModal();
  player.clearInteraction();
  player.clearWaypoints();
  player.queue.clear();
  player.weakQueue.clear();
  player.timers.clear();
  player.setVarBit(stageBit, 10);
  player.setVarBit(substateBit, 1);
  player.setVarBit(countBit, 5);
  player.setVarBit(deadBit, 0);
  player.setVarBit(dadBit, 0);
  player.setVarBit(mumBit, 0);
  player.setVar(VarPlayerType.getId("action_delay"), 0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  assert(player.canAccess(), "fixture starts with native protected access");
}

// Original multi-NPC bases, real interaction continuation and native world phases.
for (const parent of [1, 2]) {
  // Earlier death fixtures have no map/login setup for respawn AI; keep this world phase isolated.
  for (const npc of World.npcs) World.npcs.remove(npc.nid);
  resetIce();
  hero.setVarBit(substateBit, 2);
  hero.setVarBit(deadBit, 1);
  hero.levels[PlayerStat.STRENGTH] = 1; // Bound each hit below the block's 10 HP.
  hero.x = 2825; hero.z = 3808; hero.level = 2;
  for (const x of [2825, 2826, 2827]) for (const z of [3808, 3809]) allocateIfAbsent(x, z, 2);
  hero.invSet(worn, ObjType.getId("abyssal_whip"), 1, 3);
  const type = NpcType.getByName(`troll_block_${parent}`)!;
  assert.equal(type.id, parent === 1 ? 1943 : 1945);
  assert.equal(type.op, null, "the base has no Smash; native continuation resolves its form");
  const visible = NpcType.get(type.multinpc![hero.getVarBit(type.multivarbit)]);
  assert.equal(visible.op![1], "Smash-ice");
  const block = new Npc(2, 2826, 3808, type.size, type.size,
    EntityLifeCycle.RESPAWN, nextNid++, type.id, BlockWalk.NONE);
  World.addNpc(block, -1);
  block.lastMovement = -100;
  const hits: { tick: number; damage: number; hp: number }[] = [];
  const applyDamage = block.applyDamage;
  block.applyDamage = function (...args: Parameters<Npc["applyDamage"]>) {
    const result = applyDamage.apply(this, args);
    hits.push({ tick: World.currentTick, damage: args[0], hp: this.levels[NpcStat.HITPOINTS] });
    return result;
  };
  const step = () => {
    World.currentTick++;
    World.processNpcs();
    World.processPlayers();
  };
  JavaRandom.setSeed(4096);
  assert(hero.setInteraction(Interaction.ENGINE, block, ServerTriggerType.APNPC2));
  for (let turn = 0; turn < 12 && hits.length < 2; turn++) step();
  assert.equal(hits.length, 2, "one Smash repeats without a second input");
  assert(block.levels[NpcStat.HITPOINTS] > 0);
  assert.equal(hits[1].tick - hits[0].tick, 4, "Smash delay is four ticks");
  hero.clearInteraction();
  const stoppedAt = hits.length;
  for (let turn = 0; turn < 12; turn++) step();
  assert.equal(hits.length, stoppedAt, "clearing the interaction stops repeated Smash");
  assert.equal(hero.getVarBit(dadBit), 0);
  assert.equal(hero.getVarBit(mumBit), 0);
  assert(hero.setInteraction(Interaction.ENGINE, block, ServerTriggerType.APNPC2));
  const resumedAt = hits.length;
  for (let turn = 0; turn < 160 && hero.getVarBit(parent === 1 ? dadBit : mumBit) === 0; turn++) step();
  assert(hits.length > resumedAt, "a new native Smash resumes the loop");
  for (let index = resumedAt + 1; index < hits.length; index++) {
    assert.equal(hits[index].tick - hits[index - 1].tick, 4, "every resumed hit follows the Smash delay");
  }
  assert.equal(hits.at(-1)!.hp, 0, "the real terminal hit reaches zero before the rescue heal");
  assert.equal(block.levels[NpcStat.HITPOINTS], 10, "native rescue heals the shared block");
  assert.equal(hero.getVarBit(parent === 1 ? dadBit : mumBit), 1, "strong rescue queue writes this parent's flag");
  assert.equal(hero.getVarBit(parent === 1 ? mumBit : dadBit), 0, "the other parent's flag is unchanged");
  assert.equal(hero.getVarBit(substateBit), 2, "one parent does not complete the pair");
  console.log(`PASS packed parent ${type.id}: repeated four-tick Smash, stop/resume, terminal HP0, exclusive flag`, hits);
}

// Both candidates qualify; ownership is the only difference in the negative arm.
const other = new Player("s5otherhero", 202n, 202n);
other.slot = 2;
other.uid = ((Number(other.username37 & 0x1fffffn) << 11) | other.slot) >>> 0;
other.write = () => {};
World.players[other.slot] = other;
World.playerLoop.add(2n, other);
for (const killer of [other, hero]) {
  resetIce();
  resetIce(other);
  const kamil = actor("icediamond_icewarrior");
  kamil.vars[VarNpcType.getId("npc_macro_event_target")] = hero.uid;
  kamil.heroPoints.addHero(killer.hash64, kamil.levels[NpcStat.HITPOINTS]);
  assert.equal(World.getPlayerByHash64(killer.hash64), killer);
  assert.equal(killer.getVarBit(substateBit), 1);
  assert.equal(killer.getVarBit(countBit), 5);
  const result = death(kamil);
  assert.equal(result.execution, ScriptState.FINISHED);
  assert.equal(result.script.name, "[ai_queue3,icediamond_icewarrior]");
  queues([hero, other]);
  assert.equal(other.getVarBit(deadBit), 0, "qualifying online nonowner hero gets no Kamil credit");
  assert.equal(other.getVarBit(substateBit), 1, "nonowner's Ice state is unchanged");
  assert.equal(hero.getVarBit(deadBit), killer === hero ? 1 : 0);
  assert.equal(hero.getVarBit(substateBit), killer === hero ? 2 : 1);
  hero.closeModal();
  other.closeModal();
  console.log(`PASS packed Kamil death: ${killer === hero ? "owner credited dead1/substate2" : "qualifying online nonowner refused"}`);
}

const cold = packed("[timer,dt_ice_cold]");
resetIce();
hero.x = 2840; hero.z = 3738; hero.level = 0;
hero.setVarBit(countBit, 0); // Keep this timer fixture outside the Kamil clearing.
hero.runenergy = 7500;
hero.setVar(VarPlayerType.getId("sa_energy"), 600);
hero.setTimer(PlayerTimerType.NORMAL, cold, [], 1);
World.currentTick++;
hero.processTimers(PlayerTimerType.NORMAL);
assert.equal(hero.timers.get(cold.id)?.interval, 10, "inside pulse reschedules at ten ticks");
queues();
assert.equal(hero.levels[PlayerStat.HITPOINTS], 98, "cold takes exactly one hitpoint");
for (let stat = 0; stat < hero.levels.length; stat++) {
  if (stat !== PlayerStat.HITPOINTS) assert.equal(hero.levels[stat], 98, `cold drains stat ${stat} by one`);
}
assert.equal(hero.runenergy, 0);
assert.equal(hero.getVar(VarPlayerType.getId("sa_energy")), 0);
hero.levels.fill(1);
hero.levels[PlayerStat.HITPOINTS] = 2;
runPacked(cold); queues();
assert.equal(hero.levels[PlayerStat.HITPOINTS], 1);
runPacked(cold); queues();
assert.equal(hero.levels[PlayerStat.HITPOINTS], 1, "cold cannot take the last hitpoint");
assert(hero.levels.every(value => value === 1), "all non-HP drains also floor at one");
// Leave after a successful inside pulse, with a live timer still armed.
hero.x = 3222; hero.z = 3222;
hero.levels.fill(80);
hero.runenergy = 7500;
hero.setVar(VarPlayerType.getId("sa_energy"), 600);
const outsideStats = [...hero.levels];
World.currentTick += 10;
hero.processTimers(PlayerTimerType.NORMAL);
assert.equal(hero.timers.has(cold.id), false, "outside pulse clears its own armed timer");
queues();
assert.deepEqual([...hero.levels], outsideStats, "no outside stat or hitpoint change");
assert.equal(hero.runenergy, 7500, "no outside run-energy drain");
assert.equal(hero.getVar(VarPlayerType.getId("sa_energy")), 600, "no outside special-energy drain");
// A previously queued pulse must also reject a now-outside player.
runPacked(packed("[queue,dt_ice_cold_damage]"));
assert.deepEqual([...hero.levels], outsideStats);
console.log("PASS packed cold: inside one HP/ten ticks, floors one; after leaving timer clears and drains stop");

resetIce();
hero.x = 2838; hero.z = 3803; hero.level = 1;
hero.levels[PlayerStat.HITPOINTS] = 50;
runPacked(packed("[queue,dt_ice_slip]"));
assert.equal(hero.levels[PlayerStat.HITPOINTS], 48, "a slip takes exactly two hitpoints");
// Cover every native eight-bit chance, not a statistical sample or a replacement RNG.
const seeds = new Map<number, number>();
for (let seed = 0; seed < 1000000 && seeds.size < 256; seed++) {
  JavaRandom.setSeed(seed);
  const chance = Math.floor(JavaRandom.nextDouble() * 256);
  if (!seeds.has(chance)) seeds.set(chance, seed);
}
assert.equal(seeds.size, 256, "deterministic seeds cover every native chance bucket");
for (const [agility, success, expectedSlips] of [[1, 219, 37], [50, 231, 25], [99, 243, 13]]) {
  let slips = 0;
  hero.levels[PlayerStat.AGILITY] = agility;
  for (const [chance, seed] of seeds) {
    hero.queue.clear(); // Isolate this roll; damage and slip execution have their own cases.
    JavaRandom.setSeed(seed);
    runPacked(cold);
    const slipped = [...hero.queue.all()].some(request => request.script.name === "[queue,dt_ice_slip]");
    assert.equal(slipped, chance >= success, `Agility ${agility}, native chance ${chance}`);
    if (slipped) slips++;
  }
  assert.equal(slips, expectedSlips, `Agility ${agility} slip chance is ${expectedSlips}/256`);
  console.log(`PASS packed Agility ${agility}: ${slips}/256 slips from success bounds 218/242`);
}

resetIce();
hero.x = 3222; hero.z = 3222; hero.level = 0;
for (let x = 3221; x <= 3224; x++) for (let z = 3221; z <= 3223; z++) allocateIfAbsent(x, z, 0);
hero.levels[PlayerStat.HITPOINTS] = 50;
hero.setVar(VarPlayerType.getId("frozen"), 0);
runPacked(packed("[queue,dt_kamil_freeze]"), null, [0, 0]);
for (let turn = 0; turn < 3 && hero.getVar(VarPlayerType.getId("frozen")) <= World.currentTick; turn++) {
  queues([hero], 1);
}
const frozenUntil = hero.getVar(VarPlayerType.getId("frozen"));
const freezeStart = World.currentTick;
assert.equal(frozenUntil - freezeStart, 3, "published duration two adds one native boundary tick");
assert(hero.canAccess(), "movement freeze does not make the player busy");
const shark = ObjType.getByName("shark")!;
hero.invSet(inv, shark.id, 1, 20);
hero.lastSlot = 20; hero.lastItem = shark.id;
hero.setVar(VarPlayerType.getId("eat_delay"), 0);
const eat = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, shark.id, shark.category)!;
assert(eat);
runPacked(eat);
assert.equal(hero.invTotal(inv, shark.id), 0, "food is consumed during the movement freeze");
assert.equal(hero.levels[PlayerStat.HITPOINTS], 70, "a shark heals twenty during the freeze");
assert(World.currentTick < frozenUntil, "eat completed while the received freeze was active");
const move = () => {
  hero.resetPathingEntity(); // The normal end-of-tick reset releases a previous teleport's INSTANT speed.
  hero.queueWaypoints([CoordGrid.packCoord(0, 3223, 3222)]);
  hero.processWalktrigger();
  hero.updateMovement();
};
for (; World.currentTick < frozenUntil; World.currentTick++) {
  packets.length = 0;
  move();
  assert.deepEqual([hero.x, hero.z], [3222, 3222], "walking is refused on every frozen tick");
  assert(output().includes("A magical force stops you from moving."));
}
packets.length = 0;
move();
assert.deepEqual([hero.x, hero.z], [3223, 3222], "walking resumes at the native freeze boundary");
assert(!output().includes("A magical force stops you from moving."));
console.log("PASS packed Kamil freeze: three native boundary ticks, movement refused, eat heals during freeze, walking resumes");

resetIce();
hero.x = 3222; hero.z = 3222; hero.level = 0;
for (let x = 3220; x <= 3228; x++) for (let z = 3220; z <= 3224; z++) allocateIfAbsent(x, z, 0);
const attacker = actor("icediamond_icewarrior");
attacker.x = 3227; attacker.z = 3222;
attacker.vars[VarNpcType.getId("npc_macro_event_target")] = hero.uid;
const attack = ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2,
  attacker.type, NpcType.get(attacker.type).category)!;
assert(attack);
const attackOnce = () => {
  const script = ScriptRunner.init(attack, attacker, hero);
  attacker.executeScript(script);
  assert.equal(script.execution, ScriptState.FINISHED);
};
attackOnce();
assert.equal(CoordGrid.distanceToSW(hero, attacker), 1, "a distant ice attack teleports beside the player");
assert.equal(isMapBlocked(attacker.x, attacker.z, attacker.level), false, "the destination is a free walkable tile");
assert([...hero.queue.all()].some(request => request.script.name === "[queue,dt_kamil_freeze]"));
assert.equal(attacker.animId, SeqType.getId("human_castentangle"));
const beside = [attacker.x, attacker.z];
hero.queue.clear();
World.currentTick = attacker.vars[VarNpcType.getId("npc_action_delay")];
attackOnce();
assert.deepEqual([attacker.x, attacker.z], beside, "Kamil stays beside an adjacent player");
assert([...hero.queue.all()].some(request => request.script.name === "[queue,combat_damage_player]"),
  "the following adjacent attack uses the native melee damage queue");
assert(![...hero.queue.all()].some(request => request.script.name === "[queue,dt_kamil_freeze]"),
  "an adjacent following attack is not another ice cast");
console.log("PASS packed Kamil pattern: distant ice teleports to free adjacent tile, following attack is melee", beside);

const journal = ScriptProvider.getByTrigger(ServerTriggerType.IF_BUTTON,
  Component.getId("questlist:deserttreasure"), -1)!;
assert(journal);
const needed = (count: number) => `Ice trolls still needed to clear the cave: ${count}.`;
const opened = "The five icicles have fallen from the cave entrance.";
const alive = "I still need to defeat Kamil beyond the wolf valley.";
const defeated = "Kamil is defeated. I need spiked boots for the icy ledge.";
const dadFrozen = "The troll father is still frozen.";
const mumFrozen = "The troll mother is still frozen.";
const dadFree = "The troll father is free.";
const mumFree = "The troll mother is free.";
const journalCases: [string, number, number, number, number, number, string[]][] = [
  ["crying", 0, 0, 0, 0, 0, ["I should offer sweet food to the crying troll child and agree to rescue his parents."]],
  ["agreed/count0", 1, 0, 0, 0, 0, [needed(5), alive, dadFrozen, mumFrozen]],
  ["agreed/count4", 1, 4, 0, 0, 0, [needed(1), alive, dadFrozen, mumFrozen]],
  ["agreed/count5", 1, 5, 0, 0, 0, [opened, alive, dadFrozen, mumFrozen]],
  ["Kamil dead", 2, 5, 1, 0, 0, [opened, defeated, dadFrozen, mumFrozen]],
  ["father free", 2, 5, 1, 1, 0, [opened, defeated, dadFree, mumFrozen]],
  ["both free", 3, 5, 1, 1, 1, [opened, defeated, dadFree, mumFree, "I should speak to the parents and return to their child."]],
  ["returned", 4, 5, 1, 1, 1, ["The troll family is home. I should speak to the child about the diamond."]],
  ["awarded", 5, 5, 1, 1, 1, ["The troll family gave me the Ice diamond."]],
];
for (const [label, substate, count, dead, dad, mum, expected] of journalCases) {
  resetIce();
  for (const [bit, value] of [[substateBit, substate], [countBit, count], [deadBit, dead], [dadBit, dad], [mumBit, mum]]) {
    hero.setVarBit(bit, value);
  }
  packets.length = 0;
  runPacked(journal);
  const rendered = packets.filter(packet => packet instanceof IfSetText)
    .map(packet => packet.text.replace(/@[a-z0-9]{3}@/g, "")).join(" ").replace(/\s+/g, " ").trim();
  assert(rendered.includes("Ice diamond "), "the stage-ten journal actually dispatches the Ice section");
  assert.equal(rendered.slice(rendered.lastIndexOf("Ice diamond ") + "Ice diamond ".length),
    expected.join(" "), `exact stage-ten Ice journal sentences: ${label}`);
  console.log(`PASS packed stage-ten journal ${label}`, expected);
}
for (let variant = 1; variant <= 7; variant++) {
  assert.equal(NpcType.getByName(`trollrescue_icetroll_melee${variant}`)!.respawnrate, 50);
}
for (let variant = 1; variant <= 6; variant++) {
  assert.equal(NpcType.getByName(`ice_wolf_${variant}`)!.respawnrate, 10);
}
console.log("PASS packed respawn rates: all seven Ice trolls 50 ticks, all six Ice wolves 10 ticks");
