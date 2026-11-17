#!/usr/bin/env node
/** Real packed S7 Azzanadra transition and once-only reward regression. Run from the sibling engine after a full pack:
 *   NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx ../content/tests/desert-treasure/test_s7_effects.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
assert(fs.existsSync(path.join(pack, 'server/script.dat')), `missing compiled script.dat at ${pack} — run npm run build in the sibling engine`);
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const { NetworkPlayer: Player } = await load('src/engine/entity/NetworkPlayer.ts');
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const Environment = (await load('src/util/Environment.ts')).default;
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'ScriptProvider did not load compiled scripts');
// Real teleport admission needs allocated packed floors, not a staff bypass.
const { unzipSync } = createRequire(path.join(engine, 'package.json'))('fflate');
const squares = [[45, 77], [44, 77], [43, 77], [50, 145], [50, 45]];
const mapNames = new Set(squares.flatMap(([x, z]) => [`m${x}_${z}`, `l${x}_${z}`]));
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => mapNames.has(entry.name) });
for (const [x, z] of squares) {
  const m = maps[`m${x}_${z}`], l = maps[`l${x}_${z}`];
  assert(m?.length && l?.length, `packed pyramid map ${x}_${z}`);
  World.gameMap.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, x * 64, z * 64);
}
const ScriptVarType = (await load('src/cache/config/ScriptVarType.ts')).default;
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
assert.equal(Environment.NODE_XPRATE, 1, 'run with NODE_XPRATE=1 so the test measures the script award directly');

const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind}:${name}`);
  return value;
};
function numericConstant(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(0x[\\da-f]+|\\d+)\\s*$`, 'im'));
  assert(match, `named numeric constant ${name} in ${file}`);
  return Number(match[1]);
}
const configDir = path.join(content, 'scripts/general/configs');
const questConstants = path.join(content, 'scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant');
const stageInside = numericConstant(questConstants, 'dt_stage_inside_pyramid');
const stageFourColumns = numericConstant(questConstants, 'dt_stage_four_columns');
const stagePending = numericConstant(questConstants, 'dt_stage_reward_pending');
const stageComplete = numericConstant(questConstants, 'dt_stage_complete');
const standardBook = numericConstant(questConstants, 'dt_spellbook_standard');
const ancientBook = numericConstant(questConstants, 'dt_spellbook_ancient');
const magicTab = numericConstant(path.join(configDir, 'tabs.constant'), 'tab_magic');
const greenColour = numericConstant(path.join(configDir, 'colour.constant'), 'green_rgb');
const packedGreen = ((greenColour >>> 19) << 10) | (((greenColour >>> 11) & 31) << 5) | ((greenColour >>> 3) & 31);
const mainVarp = id('VarPlayerType', 'deserttreasuremain');
const stageBitId = id('VarBitType', 'deserttreasure');
const stageBit = types.VarBitType.get(stageBitId);
assert.equal(stageBit.basevar, mainVarp, 'Desert Treasure stage is a field of its original main varp');
const stageWidth = stageBit.endbit - stageBit.startbit + 1;
const stageMask = (stageWidth >= 32 ? 0xffffffff : ((2 ** stageWidth - 1) << stageBit.startbit)) >>> 0;
const nonStageMask = (~stageMask) >>> 0;
const questScroll = id('Component', 'questscroll_death');
const questPointsText = id('Component', 'questscroll_death:com_9');
const rewardTextComponents = new Set([10, 11, 12, 13, 14].map(n => id('Component', `questscroll_death:com_${n}`)));
const questRow = id('Component', 'questlist:deserttreasure');
const ancientBookInterface = id('Component', 'inter_267');
const getBit = (p, name) => p.getVarBit(id('VarBitType', name));
const setBit = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
const getVar = (p, name) => p.getVar(id('VarPlayerType', name));
const setVar = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const rawMain = p => p.getVar(mainVarp) >>> 0;
const script = name => {
  const value = ScriptProvider.getByName(name);
  assert(value, `compiled ${name} missing`);
  return value;
};
function runPlayer(p, name) {
  const state = ScriptRunner.init(script(name), p);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
  p.encodeOut(); // Main interface packets flush at the real network tick boundary.
  return state;
}
let serial = 0;
function player() {
  const slot = ++serial;
  World.currentTick = 1000 * slot;
  const p = new Player(`s7_effect_${slot}`, BigInt(slot), BigInt(30000 + slot), { uuid: `dt-s7-${slot}` });
  p.slot = slot;
  p.pid = slot;
  p.uid = ((slot << 11) | slot) >>> 0;
  p.x = 3233;
  p.z = 9317;
  p.level = 0;
  p.isActive = true;
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.stats.fill(130344310);
  p.packets = [];
  p.messages = [];
  p.messageGame = text => p.messages.push(text);
  p.wrappedMessageGame = p.messageGame;
  p.write = packet => p.packets.push(packet);
  setVar(p, 'tutorial', 1000);
  World.players[slot] = p;
  World.playerLoop.add(p.hash64, p);
  return p;
}
function seedMainFields(p, stage) {
  for (let varbitId = 0; varbitId < types.VarBitType.count; varbitId++) {
    const bit = types.VarBitType.get(varbitId);
    if (bit.basevar !== mainVarp || varbitId === stageBitId) continue;
    const width = bit.endbit - bit.startbit + 1;
    p.setVarBit(varbitId, width >= 32 ? 0xffffffff : 2 ** width - 1);
  }
  setBit(p, 'deserttreasure', stage);
  const preserved = rawMain(p) & nonStageMask;
  assert.notEqual(preserved, 0, 'fixture sets original varp440 fields outside the quest stage');
  return preserved;
}
function assertMainFieldsPreserved(p, before, label) {
  assert.equal(rawMain(p) & nonStageMask, before, `${label}: preserve every original varp440 bit outside the main stage`);
}
const packetsNamed = (p, name) => p.packets.filter(packet => packet.constructor.name === name);
const questScrollOpens = p => packetsNamed(p, 'IfOpenMain').filter(packet => packet.component === questScroll);
const ancientTabPackets = p => packetsNamed(p, 'IfSetTab').filter(packet => packet.component === ancientBookInterface);
function assertNoRewardPackets(p, label) {
  assert.equal(questScrollOpens(p).length, 0, `${label}: no quest-completion scroll`);
  assert.equal(ancientTabPackets(p).length, 0, `${label}: no Ancient spellbook tab selection`);
}

function rejectsCompletionOutsidePendingStages(stage) {
  const p = player();
  const preserved = seedMainFields(p, stage);
  setVar(p, 'alternate_spells', standardBook);
  runPlayer(p, '[proc,update_questpoints]');
  const xpBefore = p.stats[PlayerStat.MAGIC];
  const qpBefore = getVar(p, 'qp');
  p.packets.length = 0;
  runPlayer(p, '[proc,dt_azzanadra_complete]');
  assert.equal(getBit(p, 'deserttreasure'), stage, `completion refuses stage ${stage}`);
  assert.equal(p.stats[PlayerStat.MAGIC], xpBefore, `stage ${stage}: no Magic XP`);
  assert.equal(getVar(p, 'qp'), qpBefore, `stage ${stage}: no QP change`);
  assert.equal(getVar(p, 'alternate_spells'), standardBook, `stage ${stage}: no spellbook selector reward`);
  assertMainFieldsPreserved(p, preserved, `stage ${stage}`);
  assertNoRewardPackets(p, `stage ${stage}`);
}

const hazard = script('[timer,dt_pyramid_hazards]');
for (const [stage, missing] of [[stageFourColumns - 1, null], [stageFourColumns, 'fire'], [stageFourColumns, null]]) {
  const p = player();
  seedMainFields(p, stage);
  for (const colour of ['blood', 'fire', 'ice', 'shadow']) setBit(p, `fd_column_${colour}`, colour === missing ? 0 : 1);
  const before = rawMain(p) & nonStageMask;
  p.x = 3233; p.z = 2900; p.level = 0;
  runPlayer(p, '[proc,dt_pyramid_enter]');
  if (stage === stageFourColumns && missing === null) {
    assert.equal(getBit(p, 'deserttreasure'), stageInside, 'all four columns admit stage 12 and write stage 13');
    assert.deepEqual([p.level, p.x, p.z], [3, 2913, 4952], 'top entry reaches the original first pyramid floor');
    assert(p.timers.has(hazard.id), 'top entry arms the real pyramid hazard timer');
  } else {
    assert.equal(getBit(p, 'deserttreasure'), stage, 'entry refusal preserves the quest stage');
    assert.deepEqual([p.level, p.x, p.z], [0, 3233, 2900], 'entry refusal stays outside');
    assert.equal(p.timers.has(hazard.id), false, 'entry refusal does not arm hazards');
  }
  assertMainFieldsPreserved(p, before, 'pyramid entry');
}
for (const [startZ, endZ] of [[9325, 9323], [9323, 9325]]) {
  const p = player();
  setBit(p, 'deserttreasure', stageComplete);
  p.level = 0; p.x = 3234; p.z = startZ;
  runPlayer(p, '[oploc1,dt_ancient_temple_door_open]');
  assert.deepEqual([p.level, p.x, p.z], [0, 3234, endZ], 'the mapped chamber door crosses only its local doorway');
  assert(p.timers.has(hazard.id), 'door traversal arms hazards for a completed safe-portal arrival');
  assert.equal(getBit(p, 'deserttreasure'), stageComplete, 'door traversal does not write quest progress');
}
for (const [level, x, z] of [[3, 2913, 4952], [2, 2845, 4963], [1, 2782, 4972], [0, 3232, 9292]]) {
  const p = player();
  p.level = level; p.x = x; p.z = z;
  runPlayer(p, '[proc,dt_pyramid_start]');
  const timer = p.timers.get(hazard.id);
  assert(timer, 'each original floor re-arms hazards on login');
  assert.equal(timer.interval, 20);
  World.currentTick++;
  runPlayer(p, '[proc,dt_pyramid_start]');
  assert.strictEqual(p.timers.get(hazard.id), timer, 'a running hazard clock is not postponed');
  p.level = 0; p.x = 3233; p.z = 2887;
  runPlayer(p, '[timer,dt_pyramid_hazards]');
  assert.equal(p.timers.has(hazard.id), false, 'outside arrival clears the hazard clock');
}
{
  const p = player(), random = Math.random;
  p.level = 0; p.x = 3233; p.z = 9317;
  try {
    Math.random = () => { throw new Error('the dialogue chamber must not roll hazards'); };
    runPlayer(p, '[timer,dt_pyramid_hazards]');
  } finally { Math.random = random; }
}

for (const stage of [0, stageFourColumns, stageInside]) rejectsCompletionOutsidePendingStages(stage);

const hero = player();
const preserved = seedMainFields(hero, stageInside);
setVar(hero, 'alternate_spells', standardBook);
runPlayer(hero, '[proc,update_questpoints]');
const qpBefore = getVar(hero, 'qp');
const magicXpBefore = hero.stats[PlayerStat.MAGIC];
hero.packets.length = 0;
runPlayer(hero, '[proc,dt_azzanadra_pending]');
assert.equal(getBit(hero, 'deserttreasure'), stagePending, 'Azzanadra first-talk transition writes reward-pending stage 14');
assert.equal(hero.stats[PlayerStat.MAGIC], magicXpBefore, 'first-talk transition does not award Magic XP');
assert.equal(getVar(hero, 'qp'), qpBefore, 'first-talk transition does not award QP');
assert.equal(getVar(hero, 'alternate_spells'), standardBook, 'Ancient selector remains standard until the reward section');
assertMainFieldsPreserved(hero, preserved, 'Azzanadra pending transition');
assertNoRewardPackets(hero, 'Azzanadra pending transition');

hero.packets.length = 0;
runPlayer(hero, '[proc,dt_azzanadra_pending]');
assert.equal(getBit(hero, 'deserttreasure'), stagePending, 'pending procedure does not advance again from stage 14');
assert.equal(hero.stats[PlayerStat.MAGIC], magicXpBefore, 'repeated pending call still awards no Magic XP');
assert.equal(getVar(hero, 'qp'), qpBefore, 'repeated pending call still awards no QP');
assert.equal(getVar(hero, 'alternate_spells'), standardBook, 'repeated pending call does not select Ancient Magicks');
assertNoRewardPackets(hero, 'repeated pending call');

hero.packets.length = 0;
runPlayer(hero, '[proc,dt_azzanadra_complete]');
assert.equal(getBit(hero, 'deserttreasure'), stageComplete, 'reward section commits stage 14 to complete stage 15');
assert.equal(hero.stats[PlayerStat.MAGIC] - magicXpBefore, 200000, 'completion awards exactly 20,000 Magic XP in server tenths');
assert.equal(getVar(hero, 'qp'), qpBefore + 3, 'shared quest-point recount increases the baseline by exactly 3');
assert.equal(getVar(hero, 'alternate_spells'), ancientBook, 'completion selects the Ancient Magicks server selector');
assertMainFieldsPreserved(hero, preserved, 'once-only completion');

assert.equal(questScrollOpens(hero).length, 1, 'send_quest_complete opens the packed quest reward scroll');
const qpLine = packetsNamed(hero, 'IfSetText').find(packet => packet.component === questPointsText);
assert(qpLine, 'quest reward scroll sets its Quest Point line');
assert.match(qpLine.text, /\b3\b/, 'quest reward scroll states 3 Quest Points');
assert.match(qpLine.text, /Quest Point/i, 'quest reward scroll labels the points');
const rewardText = packetsNamed(hero, 'IfSetText')
  .filter(packet => rewardTextComponents.has(packet.component))
  .map(packet => packet.text)
  .join(' ');
assert.match(rewardText, /\b20,?000\b/, 'quest reward scroll states 20,000 Magic XP');
assert.match(rewardText, /Magic/i, 'quest reward scroll identifies Magic XP');
assert.match(rewardText, /Ancient\s+Magicks/i, 'quest reward scroll unlocks Ancient Magicks');
const rowColour = packetsNamed(hero, 'IfSetColour').find(packet => packet.component === questRow);
assert(rowColour, 'completion sends a colour update for the Desert Treasure quest row');
assert.equal(rowColour.colour, packedGreen, 'completion makes the Desert Treasure quest row green in the 15-bit wire colour');
const ancientTab = ancientTabPackets(hero);
assert.equal(ancientTab.length, 1, 'completion sends one actual Ancient spellbook tab packet');
assert.equal(ancientTab[0].tab, magicTab, 'completion selects the packed magic sidebar tab');

const xpAfterReward = hero.stats[PlayerStat.MAGIC];
const qpAfterReward = getVar(hero, 'qp');
hero.packets.length = 0;
runPlayer(hero, '[proc,dt_azzanadra_complete]');
assert.equal(getBit(hero, 'deserttreasure'), stageComplete, 'replay remains complete');
assert.equal(hero.stats[PlayerStat.MAGIC], xpAfterReward, 'replay awards no duplicate Magic XP');
assert.equal(getVar(hero, 'qp'), qpAfterReward, 'replay awards no duplicate QP');
assert.equal(getVar(hero, 'alternate_spells'), ancientBook, 'replay leaves the Ancient selector intact');
assertMainFieldsPreserved(hero, preserved, 'completion replay');
assertNoRewardPackets(hero, 'completion replay');

console.log('PASS compiled Desert Treasure S7 pending transition, stage-gated 20,000 Magic XP/3 QP reward, preserved varp440 fields, Ancient tab/scroll packets, and once-only replay');
process.exit(0);
