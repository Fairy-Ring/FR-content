#!/usr/bin/env node
/**
 * Compiled S3 pickpocket boundaries: a dropped pre-grant delay stays dropped,
 * while a resumed real handler grants one ring and queues one completion.
 *
 * Run after npm run build in the sibling engine:
 *   node --import tsx ../content/tests/fenkenstrain-completion/test_fenk_s3_rewards.mjs
 *
 * No engine is started. The test loads isolated compiled scripts and runs the
 * production handlers through ScriptRunner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ok(message) {
  console.log(`OK ${message}`);
}

assert(fs.existsSync(SCRIPT_DAT), `missing compiled script.dat at ${SCRIPT_DAT} — run npm run build in the sibling engine`);
const eng = rel => import(pathToFileURL(path.join(ENGINE_ROOT, rel)).href);
const World = (await eng('src/engine/World.ts')).default;
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.js');
const Environment = (await eng('src/util/Environment.ts')).default;

VarPlayerType.load(PACK_DIR);
VarBitType.load(PACK_DIR);
VarNpcType.load(PACK_DIR);
NpcType.load(PACK_DIR);
World.currentTick = 1;
InvType.load(PACK_DIR);
ObjType.load(PACK_DIR);
FontType.load(PACK_DIR);
assert(FontType.get(3), 'FontType q8_full (id 3) missing — need ISO data/pack/client/title');
Component.load(PACK_DIR);
assert(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider.load found no compiled scripts');

function packMap(relativePath, name) {
  const text = fs.readFileSync(path.join(CONTENT_ROOT, relativePath), 'utf8');
  const match = text.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
  if (!match) throw new Error(`${relativePath} missing ${name}`);
  return Number(match[1]);
}

const ID = {
  inv: packMap('pack/inv.pack', 'inv'),
  coins: packMap('pack/obj.pack', 'coins'),
  charos: packMap('pack/obj.pack', 'ring_of_charos'),
  fenkQuest: packMap('pack/varp.pack', 'fenk_quest'),
  questPoints: packMap('pack/varp.pack', 'qp'),
  priestperil: packMap('pack/varp.pack', 'priestperil'),
  prieststart: packMap('pack/varp.pack', 'prieststart'),
  creatureKnownBit: packMap('pack/varbit.pack', 'fenk_counter'),
  doctor: packMap('pack/npc.pack', 'fenk_fenkenstrain_model'),
  questScrollRows: [9, 10, 11, 12, 13, 14].map(row => packMap('pack/interface.pack', `questscroll_death:com_${row}`))
};
const PRIESTPERIL_COMPLETE = 60;
const PRIEST_COMPLETE = 5;

function makePlayer() {
  const player = new Player('fenk_s3_test', 0n, 0n);
  player.uid = 1;
  player.pid = 1;
  player.staffModLevel = 0;
  player.messages = [];
  player.packets = [];
  player.lastMovement = 0;
  player.write = message => {
    player.packets.push(message);
    if (typeof message.text === 'string') player.messages.push(message.text);
  };
  player.messageGame = message => player.messages.push(message);
  player.wrappedMessageGame = message => player.messages.push(message);
  return player;
}

function qualifiedPlayer() {
  const player = makePlayer();
  player.setVar(ID.priestperil, PRIESTPERIL_COMPLETE);
  player.setVar(ID.prieststart, PRIEST_COMPLETE);
  return player;
}

function doctor() {
  return new Npc(0, 3551, 3550, 1, 1, EntityLifeCycle.DESPAWN, 1, ID.doctor, NpcType.get(ID.doctor).blockwalk);
}

function inventory(player) {
  const inv = player.getInventory(ID.inv);
  assert(inv, 'player inventory was not loaded');
  return inv;
}

function fillInventory(player, objectId, slots) {
  const inv = inventory(player);
  for (let slot = 0; slot < slots && slot < inv.capacity; slot++) inv.set(slot, { id: objectId, count: 1 });
}

function total(player, objectId) {
  return inventory(player).getItemCount(objectId);
}

function runProc(player, name) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing ${name}`);
  const state = ScriptRunner.init(script, player);
  const exec = player.runScript(state, true, true);
  assert(exec !== -1 && exec !== ScriptState.ABORTED, `${name} failed to execute (exec=${exec})`);
  return { state, exec };
}

function questPointsBefore(player) {
  const result = runProc(player, '[proc,count_questpoints]');
  assert(result.exec === ScriptState.FINISHED, 'quest-point counter did not finish');
  assert(result.state.isp > 0, 'quest-point counter returned no value');
  return result.state.popInt();
}

function beginPickpocket(player, handler) {
  const attempt = ScriptRunner.init(handler, player, doctor());
  player.executeScript(attempt, true, true);
  return attempt;
}

// S3 STEP 10: interrupt only at the product's actual pre-grant p_delay(1).
{
  const player = qualifiedPlayer();
  player.setVar(ID.fenkQuest, 5);
  player.setVarBit(ID.creatureKnownBit, 1);
  player.levels[PlayerStat.THIEVING] = 25;
  const pointsBefore = questPointsBefore(player);
  player.setVar(ID.questPoints, pointsBefore);
  const xpBefore = player.stats[PlayerStat.THIEVING];
  const handler = ScriptProvider.getByName('[opnpc3,fenk_fenkenstrain_model]');
  assert(handler, 'compiled doctor pickpocket handler missing');
  const attempt = beginPickpocket(player, handler);
  assert(attempt.execution === ScriptState.SUSPENDED && player.activeScript === attempt, 'pickpocket must suspend at its real p_delay(1) boundary');
  assert(player.delayed && player.delayedUntil === World.currentTick + 2, 'pickpocket delay includes the engine continuation tick');
  assert(player.getVar(ID.fenkQuest) === 5 && total(player, ID.charos) === 0, 'pre-grant state keeps stage and ring unchanged');
  assert(player.getVar(ID.questPoints) === pointsBefore && player.stats[PlayerStat.THIEVING] === xpBefore, 'pre-grant delay gives no completion rewards');
  assert([...player.queue.all()].length === 0, 'pre-grant delay has not scheduled quest completion');
  player.cleanup();
  assert(player.activeScript === null && [...player.queue.all()].length === 0, 'player teardown drops the suspended attempt and pending queue');
  assert(player.getVar(ID.fenkQuest) === 5 && total(player, ID.charos) === 0, 'dropped pre-grant attempt does not synthesize a retry or reward');
  assert(player.getVar(ID.questPoints) === pointsBefore && player.stats[PlayerStat.THIEVING] === xpBefore, 'dropped attempt preserves QP and Thieving XP');
  ok('pre-grant p_delay interruption stays dropped: no retry, ring, stage or reward');
}

// S3 STEP 7/10: resume the real handler, assert ring-before-queue, then award once.
{
  const player = qualifiedPlayer();
  player.setVar(ID.fenkQuest, 5);
  player.setVarBit(ID.creatureKnownBit, 1);
  player.levels[PlayerStat.THIEVING] = 25;
  fillInventory(player, ID.coins, inventory(player).capacity - 1);
  const pointsBefore = questPointsBefore(player);
  player.setVar(ID.questPoints, pointsBefore);
  const xpBefore = player.stats[PlayerStat.THIEVING];
  const handler = ScriptProvider.getByName('[opnpc3,fenk_fenkenstrain_model]');
  assert(handler, 'compiled doctor pickpocket handler missing');
  const attempt = beginPickpocket(player, handler);
  assert(attempt.execution === ScriptState.SUSPENDED && player.activeScript === attempt, 'pickpocket waits at p_delay(1)');
  assert(player.delayed && total(player, ID.charos) === 0, 'no ring is granted before the delay resumes');
  assert(player.getVar(ID.fenkQuest) === 5 && player.getVar(ID.questPoints) === pointsBefore, 'no stage or QP write before the queue boundary');
  assert(player.stats[PlayerStat.THIEVING] === xpBefore && [...player.queue.all()].length === 0, 'no XP or completion queue before the ring grant');

  World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
  player.delayed = false;
  player.executeScript(attempt, true, true);
  assert(attempt.execution === ScriptState.FINISHED && player.activeScript === null, 'pickpocket resumes to the ring/queue boundary');
  assert(total(player, ID.charos) === 1, 'one real pickpocket grants one Ring of Charos');
  assert(player.getVar(ID.fenkQuest) === 5 && player.getVar(ID.questPoints) === pointsBefore, 'ring commit precedes queued completion');
  assert(player.stats[PlayerStat.THIEVING] === xpBefore, 'Thieving XP waits for the completion queue');
  assert([...player.queue.all()].filter(request => request.script.name === '[queue,fenk_quest_complete]').length === 1, 'ring commit schedules exactly one completion queue');

  const repeat = beginPickpocket(player, handler);
  assert(repeat.execution === ScriptState.FINISHED, 'held-ring repeat refuses without another delay');
  assert(total(player, ID.charos) === 1, 'held-ring repeat cannot grant a second ring');
  assert([...player.queue.all()].filter(request => request.script.name === '[queue,fenk_quest_complete]').length === 1, 'held-ring repeat preserves the one pending completion queue');

  player.processQueues();
  const rows = new Map(player.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => [packet.component, packet.text]));
  const scroll = ID.questScrollRows.map(component => rows.get(component));
  assert(scroll[0] === '2 Quest Points', `shared scroll must show its own quest-point row: ${JSON.stringify(scroll)}`);
  assert(scroll[1] === '1000 Thieving XP' && scroll[2] === 'Ring of Charos', `reward rows must contain XP and ring: ${JSON.stringify(scroll)}`);
  assert(scroll.filter(text => /Quest Points?/.test(text ?? '')).length === 1, `quest points duplicated in completion scroll: ${JSON.stringify(scroll)}`);
  assert(scroll.slice(3).every(text => text === ''), `unused reward rows must be empty: ${JSON.stringify(scroll)}`);
  assert(player.getVar(ID.fenkQuest) === 8 && player.getVar(ID.questPoints) === pointsBefore + 2, 'completion retains stage 8 and exactly two quest points');
  const xpAfter = player.stats[PlayerStat.THIEVING];
  assert(xpAfter === xpBefore + 10000 * Environment.NODE_XPRATE, 'completion retains 1000 Thieving XP at the configured rate');
  assert(total(player, ID.charos) === 1, 'completion does not duplicate the ring');
  assert([...player.queue.all()].length === 0, 'completion consumes its pending queue entry');
  const packetsBeforeRepeat = player.packets.length;
  const repeated = runProc(player, '[queue,fenk_quest_complete]');
  assert(repeated.exec === ScriptState.FINISHED, 'quest-complete repeat finishes');
  assert(player.packets.length === packetsBeforeRepeat && player.stats[PlayerStat.THIEVING] === xpAfter && player.getVar(ID.questPoints) === pointsBefore + 2, 'repeat completion sends no second scroll or rewards');
  ok(`real pickpocket and completion scroll: ${JSON.stringify(scroll)}; one free slot, ring/queue boundary, stage, QP, XP and repeat guard preserved`);
}
// World import starts background workers; exit after the assertions finish.
console.log('RESULT PASS (compiled pickpocket delay and reward boundary)');
process.exit(0);
