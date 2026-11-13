#!/usr/bin/env node
/** Execute the packed Mort Myre NPC scripts against real engine entities. */
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const packDir = path.join(engineRoot, 'data/pack');
const failures = [];
let cases = 0;

function record(name, actual, expected) {
  const pass = isDeepStrictEqual(actual, expected);
  cases++;
  console.log(`CASE ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify({ name, actual, expected })}`);
  if (!pass) failures.push(name);
}

function scenario(name, action) {
  try {
    const result = action();
    record(name, result.actual, result.expected);
  } catch (error) {
    record(name, { error: error instanceof Error ? error.message : String(error) }, { error: null });
  }
}

function randomValue(exclusiveMax, wanted) {
  return (wanted + 0.25) / exclusiveMax;
}

function randomIncValue(maximum, wanted) {
  return (wanted + 0.25) / (maximum + 1);
}

async function main() {
  try {
    const load = async relative => import(pathToFileURL(path.join(engineRoot, relative)).href);
    const World = (await load('src/engine/World.ts')).default;
    const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
    const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
    const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
    const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
    const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
    const Npc = (await load('src/engine/entity/Npc.ts')).default;
    const Player = (await load('src/engine/entity/Player.ts')).default;
    const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
    const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
    const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
    const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
    const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
    const Environment = (await load('src/util/Environment.ts')).default;
    const configNames = [
      'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType',
      'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType',
      'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType',
      'Component', 'FontType'
    ];
    const configs = {};
    for (const name of configNames) {
      configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
      configs[name].load(packDir);
    }
    (await load('src/cache/config/DbTableIndex.ts')).default.init();
    assert(ScriptProvider.load(packDir) > 0, 'load the compiled script pack after building the sibling engine');
    assert.equal(Environment.NODE_MEMBERS, true, 'Mort Myre clue and member seed tables require the normal members-world pack');
    const questConstants = readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
    const legendsComplete = Number(questConstants.match(/^\s*\^legends_complete\s*=\s*(\d+)\s*$/m)?.[1]);
    assert(Number.isSafeInteger(legendsComplete), 'resolve the packed Legends Quest completion constant');

    const { VarPlayerType, VarNpcType, ObjType, NpcType, InvType, CategoryType, SeqType } = configs;
    const requireId = (kind, value, name) => {
      assert(value >= 0, `missing packed ${kind} ${name}`);
      return value;
    };
    const ids = {
      worn: requireId('inventory', InvType.getId('worn'), 'worn'),
      inventory: requireId('inventory', InvType.getId('inv'), 'inv'),
      npcActionDelay: requireId('varn', VarNpcType.getId('npc_action_delay'), 'npc_action_delay'),
      npcAggressivePlayer: requireId('varn', VarNpcType.getId('npc_aggressive_player'), 'npc_aggressive_player'),
      npcLastCombat: requireId('varn', VarNpcType.getId('npc_lastcombat'), 'npc_lastcombat'),
      npcInt: requireId('varn', VarNpcType.getId('npc_int'), 'npc_int'),
      protectMelee: requireId('varp', VarPlayerType.getId('prayer14'), 'prayer14'),
      protectRanged: requireId('varp', VarPlayerType.getId('prayer13'), 'prayer13'),
      legendsQuest: requireId('varp', VarPlayerType.getId('legendsquest'), 'legendsquest')
    };
    const objId = name => requireId('object', ObjType.getId(name), name);
    const npcType = name => {
      const type = NpcType.getByName(name);
      assert(type, `missing packed NPC ${name}`);
      return type;
    };
    const scriptByName = name => {
      const script = ScriptProvider.getByName(name);
      assert(script, `missing packed script ${name}`);
      return script;
    };
    const trigger = (serverTrigger, npc, expectedName) => {
      const type = NpcType.get(npc.type);
      const script = ScriptProvider.getByTrigger(serverTrigger, type.id, type.category);
      assert(script, `missing packed ${expectedName} for ${type.debugname}`);
      assert.equal(script.name, expectedName, `${type.debugname} resolves to the intended trigger`);
      return script;
    };
    let playerSerial = 0;
    let npcSerial = 0;
    let coordSerial = 0;
    function nextCoord() {
      const serial = coordSerial++;
      return { x: 3500 + (serial % 32), z: 3500 + Math.floor(serial / 32), level: 0 };
    }
    function makePlayer(x, z) {
      const slot = ++playerSerial;
      const username37 = BigInt(1000 + slot);
      const hash64 = BigInt(0x100000 + slot);
      const player = new Player(`mortmyre${slot}`, username37, hash64);
      player.slot = slot;
      player.pid = slot;
      player.uid = ((Number(username37 & 0x1fffffn) << 11) | slot) >>> 0;
      player.level = 0;
      player.x = x;
      player.z = z;
      player.isActive = true;
      player.vars.fill(0);
      player.baseLevels.fill(99);
      player.levels.fill(99);
      player.stats.fill(0);
      player.baseLevels[PlayerStat.HITPOINTS] = 99;
      player.levels[PlayerStat.HITPOINTS] = 99;
      player.getInventory(ids.worn);
      player.getInventory(ids.inventory);
      player.testMessages = [];
      player.write = packet => player.testMessages.push(packet);
      player.messageGame = message => player.testMessages.push({ text: String(message) });
      player.wrappedMessageGame = message => player.testMessages.push({ text: String(message) });
      World.players[slot] = player;
      World.playerLoop.add(hash64, player);
      return player;
    }
    function makeNpc(name, x, z) {
      const type = npcType(name);
      const npc = new Npc(0, x, z, type.size, type.size, EntityLifeCycle.RESPAWN, ++npcSerial, type.id, type.blockwalk);
      World.addNpc(npc, -1);
      npc.lastMovement = -100;
      return npc;
    }
    function withRandom(values, action) {
      const original = JavaRandom.nextDouble;
      let index = 0;
      JavaRandom.nextDouble = () => {
        if (index < values.length) return values[index++];
        throw new Error(`unexpected JavaRandom.nextDouble call ${index + 1}; stream has ${values.length} values`);
      };
      try {
        return { result: action(), draws: index };
      } finally {
        JavaRandom.nextDouble = original;
      }
    }
    function withMathRandom(value, action) {
      const original = Math.random;
      Math.random = () => value;
      try {
        return action();
      } finally {
        Math.random = original;
      }
    }
    function settlePlayer(player, ticks = 12) {
      for (let tick = 0; tick < ticks; tick++) {
        World.currentTick++;
        player.processQueues();
      }
    }
    function finishNpc(npc, state, players = []) {
      for (let step = 0; state.execution === ScriptState.NPC_SUSPENDED && step < 30; step++) {
        for (const player of players) player.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
        npc.delayed = false;
        npc.executeScript(state);
      }
      if (state.execution !== ScriptState.FINISHED) {
        throw new Error(`${state.script.name} did not finish (execution=${state.execution})`);
      }
      return state;
    }
    function executeNamed(name, self, target, args = []) {
      const script = typeof name === 'string' ? scriptByName(name) : name;
      const state = ScriptRunner.init(script, self, target, args);
      if (self instanceof Npc) {
        if (target instanceof Player) state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
        self.executeScript(state);
        finishNpc(self, state, target instanceof Player ? [target] : []);
      } else if (self instanceof Player) {
        state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
        self.executeScript(state, true, true);
        if (state.execution !== ScriptState.FINISHED) throw new Error(`${script.name} did not finish (execution=${state.execution})`);
      } else {
        ScriptRunner.execute(state);
        if (state.execution !== ScriptState.FINISHED) throw new Error(`${script.name} did not finish (execution=${state.execution})`);
      }
      return { state, draws: 0 };
    }
    function executeNamedWithRandom(name, self, target, args, randomValues) {
      const script = typeof name === 'string' ? scriptByName(name) : name;
      const state = ScriptRunner.init(script, self, target, args);
      return withRandom(randomValues, () => {
        if (self instanceof Npc) {
          if (target instanceof Player) state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
          self.executeScript(state);
          finishNpc(self, state, target instanceof Player ? [target] : []);
        } else if (self instanceof Player) {
          state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
          self.executeScript(state, true, true);
          if (state.execution !== ScriptState.FINISHED) throw new Error(`${script.name} did not finish (execution=${state.execution})`);
        } else {
          ScriptRunner.execute(state);
          if (state.execution !== ScriptState.FINISHED) throw new Error(`${script.name} did not finish (execution=${state.execution})`);
        }
        return state;
      });
    }
    function addHero(npc, player) {
      npc.heroPoints.addHero(player.hash64, 10);
      npc.setVar(ids.npcAggressivePlayer, player.uid);
    }
    function objectName(id) {
      const type = ObjType.get(id);
      return type?.debugname ?? `object-${id}`;
    }
    function captureObjects(action) {
      const objects = [];
      const originalAddObj = World.addObj;
      World.addObj = function (object, receiver, duration) {
        objects.push({ name: objectName(object.type), count: object.count });
        return originalAddObj.call(this, object, receiver, duration);
      };
      try {
        return { result: action(), objects: objects.sort((a, b) => a.name.localeCompare(b.name) || a.count - b.count) };
      } finally {
        World.addObj = originalAddObj;
      }
    }
    function expectedObjects(items) {
      return items.map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name) || a.count - b.count);
    }
    function runDeath(typeName, serverTrigger, expectedScriptName, player, randomValues = []) {
      const { x, z } = nextCoord();
      player.x = x;
      player.z = z;
      const npc = makeNpc(typeName, x, z);
      addHero(npc, player);
      npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
      const script = trigger(serverTrigger, npc, expectedScriptName);
      const captured = captureObjects(() => executeNamedWithRandom(script, npc, null, [], randomValues));
      if (captured.result.result.execution !== ScriptState.FINISHED) throw new Error(`${script.name} did not finish`);
      return { npc, objects: captured.objects, draws: captured.result.draws };
    }
    function runPureProc(name, args, randomValues) {
      const executed = executeNamedWithRandom(name, null, null, args, randomValues);
      return { stack: executed.result.intStack.slice(0, executed.result.isp), draws: executed.draws };
    }
    function setWorn(player, slot, name) {
      const worn = player.getInventory(ids.worn);
      worn.set(slot, name === null ? null : { id: objId(name), count: 1 });
    }
    function runRangedAttack(typeName, helmet, roll, protect = false, forcedNpcDelay = false, lockSelf = false) {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc(typeName, x, z);
      setWorn(player, 0, helmet);
      player.setVar(ids.protectRanged, protect ? 1 : 0);
      if (forcedNpcDelay) npc.setVar(ids.npcActionDelay, World.currentTick + 1);
      if (lockSelf) {
        npc.setVar(ids.npcLastCombat, World.currentTick);
        npc.setVar(ids.npcAggressivePlayer, player.uid + 1);
      }
      const initialMode = npc.targetOp;
      const maxhit = SNAILS.find(item => item.name === typeName).maxhit;
      const randomValues = forcedNpcDelay || lockSelf ? [] : [randomIncValue(maxhit, roll)];
      const script = trigger(ServerTriggerType.AI_APPLAYER2, npc, '[ai_applayer2,_snail]');
      const { result, draws } = executeNamedWithRandom(script, npc, player, [], randomValues);
      settlePlayer(player);
      return {
        execution: result.execution,
        hpDamage: 99 - player.levels[PlayerStat.HITPOINTS],
        npcMode: npc.targetOp,
        initialMode,
        draws,
        anim: npc.animId
      };
    }
    const UNCOMMON_SEEDS = [
      ['limpwurt_seed', 137], ['strawberry_seed', 131], ['marrentill_seed', 125],
      ['jangerberry_bush_seed', 92], ['tarromin_seed', 85], ['wildblood_hop_seed', 83],
      ['watermelon_seed', 63], ['harralander_seed', 56], ['ranarr_seed', 39],
      ['whiteberry_bush_seed', 34], ['mushroom_seed', 29], ['toadflax_seed', 27],
      ['belladonna_seed', 18], ['irit_seed', 18], ['poisonivy_bush_seed', 13],
      ['avantoe_seed', 12], ['cactus_seed', 12], ['kwuarm_seed', 9], ['snapdragon_seed', 5],
      ['cadantine_seed', 4], ['lantadyme_seed', 3], ['dwarf_weed_seed', 2], ['torstol_seed', 1]
    ];
    const UNCOMMON_SEED_ROLL_COUNT = UNCOMMON_SEEDS.reduce((total, [, weight]) => total + weight, 0);
    function addVampireDrops(roll, { seedRoll = 0, jewelRoll = 0, legendsCompleteState = false, megaRoll = 0 } = {}) {
      const player = makePlayer(0, 0);
      if (legendsCompleteState) player.setVar(ids.legendsQuest, legendsComplete);
      const values = [randomValue(128, 1), randomValue(128, roll)];
      if (roll >= 34 && roll < 44) values.push(randomValue(128, 0));
      if (roll >= 44 && roll < 63) values.push(randomValue(UNCOMMON_SEED_ROLL_COUNT, seedRoll));
      if (roll >= 108 && roll < 112) {
        values.push(randomValue(128, jewelRoll));
        if (legendsCompleteState && jewelRoll === 61) values.push(randomValue(128, megaRoll));
      }
      return runDeath('vampire_flyer', ServerTriggerType.AI_QUEUE3, '[ai_queue3,_vampire]', player, values);
    }
    function runLizardDrop(roll) {
      const player = makePlayer(0, 0);
      const values = [randomValue(128, roll)];
      if (roll < 10 || (roll >= 10 && roll < 14)) values.push(randomValue(128, 0));
      if (roll >= 14 && roll < 23) values.push(randomValue(420, 0), randomValue(1000, 0));
      return runDeath('slayer_lizard_massive', ServerTriggerType.AI_QUEUE4, '[ai_queue4,_slayer_lizard]', player, values).objects;
    }

    const SNAILS = [
      { name: 'mmsnailround_swamp', shell: 'shellround_swamp', corpse: 'snail_corpse1', corpseLabel: 'thin', maxhit: 1 },
      { name: 'mmsnailround_red+black', shell: 'shellround_red+black', corpse: 'snail_corpse3', corpseLabel: 'fat', maxhit: 2 },
      { name: 'mmsnailround_yellow', shell: 'shellround_yellow', corpse: 'snail_corpse1', corpseLabel: 'thin', maxhit: 2 },
      { name: 'mmsnailround_blue', shell: 'shellround_blue', corpse: 'snail_corpse3', corpseLabel: 'fat', maxhit: 2 },
      { name: 'mmsnailround_orange', shell: 'shellround_orange', corpse: 'snail_corpse2', corpseLabel: 'lean', maxhit: 2 },
      { name: 'mmsnailpoint_swamp', shell: 'shellpoint_swamp', corpse: 'snail_corpse1', corpseLabel: 'thin', maxhit: 1 },
      { name: 'mmsnailpoint_red+black', shell: 'shellpoint_red+black', corpse: 'snail_corpse3', corpseLabel: 'fat', maxhit: 3 },
      { name: 'mmsnailpoint_yellow', shell: 'shellpoint_yellow', corpse: 'snail_corpse2', corpseLabel: 'lean', maxhit: 2 },
      { name: 'mmsnailpoint_blue', shell: 'shellpoint_blue', corpse: 'snail_corpse3', corpseLabel: 'fat', maxhit: 3 }
    ];
    const HELMETS = [
      { name: null, reduction: 0 },
      { name: 'snelm_round_swamp', reduction: 4 },
      { name: 'snelm_point_swamp', reduction: 4 },
      { name: 'snelm_round_yellow', reduction: 4 },
      { name: 'snelm_point_yellow', reduction: 8 },
      { name: 'snelm_round_blue', reduction: 8 },
      { name: 'snelm_point_blue', reduction: 12 },
      { name: 'snelm_round_red+black', reduction: 12 },
      { name: 'snelm_point_red+black', reduction: 12 },
      { name: 'snelm_round_orange', reduction: 8 }
    ];
    const AUDITED_IDS = [
      '[ai_queue1,_snail]', '[ai_opplayer2,_snail]', '[ai_applayer2,_snail]',
      '[ai_queue3,mmsnailround_swamp]', '[ai_queue3,mmsnailpoint_swamp]',
      '[ai_queue3,mmsnailround_yellow]', '[ai_queue3,mmsnailpoint_yellow]',
      '[ai_queue3,mmsnailround_blue]', '[ai_queue3,mmsnailpoint_blue]',
      '[ai_queue3,mmsnailround_red+black]', '[ai_queue3,mmsnailpoint_red+black]',
      '[label,thin_snail_drop]', '[ai_queue3,mmsnailround_orange]', '[label,fat_snail_drop]',
      '[ai_queue3,_vampire]', '[proc,vampire_holysymbol_weaken]', '[ai_opplayer2,_vampire]',
      '[proc,vampire_attack]', '[proc,vampire_bite]', '[ai_opplayer2,vampire_leech]',
      '[proc,leech_attack]', '[proc,leech_meleeattack]', '[proc,leech_reduce_stats]',
      '[ai_opplayer2,vampire_spider]', '[ai_applayer2,vampire_spider]',
      '[ai_timer,vampire_spider]', '[proc,spawn_vampire]'
    ];
    const MORTMYRE_TRIGGER_NAMES = new Set([
      '[ai_queue1,_snail]', '[ai_opplayer2,_snail]', '[ai_applayer2,_snail]',
      ...SNAILS.map(item => `[ai_queue3,${item.name}]`),
      '[ai_queue3,_vampire]', '[ai_opplayer2,_vampire]', '[ai_opplayer2,vampire_leech]',
      '[ai_opplayer2,vampire_spider]', '[ai_applayer2,vampire_spider]', '[ai_timer,vampire_spider]'
    ]);
    const triggerKinds = [
      [ServerTriggerType.AI_QUEUE1, '[ai_queue1,_snail]'],
      [ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,_snail]'],
      [ServerTriggerType.AI_APPLAYER2, '[ai_applayer2,_snail]'],
      [ServerTriggerType.AI_QUEUE3, '[ai_queue3,_vampire]'],
      [ServerTriggerType.AI_QUEUE4, '[ai_queue4,_slayer_lizard]'],
      [ServerTriggerType.AI_TIMER, '[ai_timer,vampire_spider]']
    ];

    record('the audited lost-trigger fixture contains 27 unique identities', new Set(AUDITED_IDS).size, 27);
    record('all 27 audited script identities load by exact name',
      AUDITED_IDS.filter(name => !ScriptProvider.getByName(name)), []);
    const control = npcType('cow');
    for (const [triggerId, label] of triggerKinds) {
      const resolved = ScriptProvider.getByTrigger(triggerId, control.id, control.category);
      const byType = ScriptProvider.getByTriggerSpecific(triggerId, control.id);
      const byCategory = control.category < 0 ? undefined : ScriptProvider.getByTriggerSpecific(triggerId, -1, control.category);
      const leaked = [resolved, byType, byCategory].some(script => script && MORTMYRE_TRIGGER_NAMES.has(script.name));
      record(`published cow control has no Mort Myre leakage for ${label}`, leaked, false);
    }

    for (const snail of SNAILS) {
      const probe = makeNpc(snail.name, 3300, 3300);
      for (const [triggerId, name] of [
        [ServerTriggerType.AI_QUEUE1, '[ai_queue1,_snail]'],
        [ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,_snail]'],
        [ServerTriggerType.AI_APPLAYER2, '[ai_applayer2,_snail]']
      ]) {
        scenario(`resolve ${name} on ${snail.name}`, () => ({ actual: trigger(triggerId, probe, name).name, expected: name }));
      }
      scenario(`resolve ${`[ai_queue3,${snail.name}]`} on exact type`, () => ({
        actual: trigger(ServerTriggerType.AI_QUEUE3, probe, `[ai_queue3,${snail.name}]`).name,
        expected: `[ai_queue3,${snail.name}]`
      }));
    }
    for (const vampire of ['vampire_flyer', 'vampire_juve']) {
      const probe = makeNpc(vampire, 3300, 3300);
      for (const [triggerId, name] of [
        [ServerTriggerType.AI_QUEUE3, '[ai_queue3,_vampire]'],
        [ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,_vampire]']
      ]) {
        scenario(`resolve ${name} on ${vampire}`, () => ({ actual: trigger(triggerId, probe, name).name, expected: name }));
      }
    }
    for (const [npcName, triggerId, scriptName] of [
      ['vampire_leech', ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,vampire_leech]'],
      ['vampire_spider', ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,vampire_spider]'],
      ['vampire_spider', ServerTriggerType.AI_APPLAYER2, '[ai_applayer2,vampire_spider]'],
      ['vampire_spider', ServerTriggerType.AI_TIMER, '[ai_timer,vampire_spider]']
    ]) {
      const probe = makeNpc(npcName, 3300, 3300);
      scenario(`resolve ${scriptName}`, () => ({ actual: trigger(triggerId, probe, scriptName).name, expected: scriptName }));
    }

    for (const name of [
      '[proc,vampire_holysymbol_weaken]', '[proc,vampire_attack]', '[proc,vampire_bite]',
      '[proc,leech_attack]', '[proc,leech_meleeattack]', '[proc,leech_reduce_stats]',
      '[proc,spawn_vampire]', '[proc,snelm_reduction]', '[proc,roll_uncommon_seed_table]',
      '[proc,roll_general_seed_table]', '[proc,npc_melee_attack_roll_typeless]'
    ]) {
      scenario(`packed helper exists ${name}`, () => ({ actual: scriptByName(name).name, expected: name }));
    }

    for (const vampire of ['vampire_flyer', 'vampire_juve']) {
      scenario(`${vampire} default drop is period-listed vampire dust, not bones`, () => {
        const player = makePlayer(0, 0);
        const result = runDeath(vampire, ServerTriggerType.AI_QUEUE3, '[ai_queue3,_vampire]', player,
          [randomValue(128, 1), randomValue(128, 127)]);
        return { actual: result.objects, expected: expectedObjects([['vampire_dust', 1]]) };
      });
    }

    for (const helmet of HELMETS) {
      for (const damage of [0, 4, 8, 12, 20]) {
        scenario(`isolated snelm reduction ${helmet.name ?? 'none'} at damage ${damage}`, () => {
          const { x, z } = nextCoord();
          const player = makePlayer(x, z);
          setWorn(player, 0, helmet.name);
          const executed = executeNamed('[proc,snelm_reduction]', player, null, [damage]);
          return {
            actual: executed.state.intStack.slice(0, executed.state.isp),
            expected: [Math.max(0, damage - helmet.reduction)]
          };
        });
      }
    }
    for (const snail of SNAILS) {
      for (const [kind, name] of [
        [ServerTriggerType.AI_QUEUE1, '[ai_queue1,_snail]'],
        [ServerTriggerType.AI_OPPLAYER2, '[ai_opplayer2,_snail]']
      ]) {
        scenario(`execute ${name} on ${snail.name}`, () => {
          const { x, z } = nextCoord();
          const player = makePlayer(x, z);
          const npc = makeNpc(snail.name, x, z);
          npc.setVar(ids.npcAggressivePlayer, player.uid);
          const executed = executeNamedWithRandom(trigger(kind, npc, name), npc, player, [], []);
          return {
            actual: { execution: executed.result.execution, mode: npc.targetOp, draws: executed.draws },
            expected: { execution: ScriptState.FINISHED, mode: NpcMode.APPLAYER2, draws: 0 }
          };
        });
      }
    }

    for (const snail of SNAILS) {
      const player = makePlayer(0, 0);
      const result = runDeath(snail.name, ServerTriggerType.AI_QUEUE3, `[ai_queue3,${snail.name}]`, player);
      record(`death drops exact ${snail.corpseLabel} corpse and shell for ${snail.name}`, result.objects,
        expectedObjects([[snail.shell, 1], [snail.corpse, 1]]));
    }

    for (const snail of SNAILS) {
      for (const helmet of HELMETS) {
        for (let damage = 0; damage <= snail.maxhit; damage++) {
          const expectedDamage = Math.max(0, damage - helmet.reduction);
          scenario(`${snail.name} spit ${damage} with ${helmet.name ?? 'no helmet'}`, () => {
            const actual = runRangedAttack(snail.name, helmet.name, damage);
            return {
              actual: { execution: actual.execution, hpDamage: actual.hpDamage, draws: actual.draws },
              expected: { execution: ScriptState.FINISHED, hpDamage: expectedDamage, draws: 1 }
            };
          });
        }
      }
      scenario(`${snail.name} Protect Missiles blocks the spit`, () => {
        const actual = runRangedAttack(snail.name, null, snail.maxhit, true);
        return {
          actual: { execution: actual.execution, hpDamage: actual.hpDamage },
          expected: { execution: ScriptState.FINISHED, hpDamage: 0 }
        };
      });
    }
    scenario('snail action delay guard avoids projectile and damage', () => {
      const snail = SNAILS[0];
      const actual = runRangedAttack(snail.name, null, 0, false, true, false);
      return {
        actual: { execution: actual.execution, hpDamage: actual.hpDamage, mode: actual.npcMode, draws: actual.draws },
        expected: { execution: ScriptState.FINISHED, hpDamage: 0, mode: NpcMode.APPLAYER2, draws: 0 }
      };
    });
    scenario('snail single-combat self guard avoids damage', () => {
      const snail = SNAILS[0];
      const actual = runRangedAttack(snail.name, null, 0, false, false, true);
      return {
        actual: { execution: actual.execution, hpDamage: actual.hpDamage, draws: actual.draws },
        expected: { execution: ScriptState.FINISHED, hpDamage: 0, draws: 0 }
      };
    });

    const vampireBoundaries = [
      [0, [['earthrune', 4]]], [9, [['earthrune', 4]]],
      [10, [['deathrune', 2]]], [19, [['deathrune', 2]]],
      [20, [['chaosrune', 3]]], [27, [['chaosrune', 3]]],
      [28, [['bloodrune', 1]]], [32, [['bloodrune', 1]]],
      [33, [['bloodrune', 2]]], [34, [['unidentified_guam', 1]]],
      [43, [['unidentified_guam', 1]]], [44, [['limpwurt_seed', 1]]],
      [62, [['limpwurt_seed', 1]]], [63, [['coins', 15]]],
      [102, [['coins', 15]]], [103, [['black_axe', 1]]],
      [105, [['black_axe', 1]]], [106, [['earth_talisman', 1]]],
      [107, [['earth_talisman', 1]]], [108, [['uncut_sapphire', 1]]],
      [111, [['uncut_sapphire', 1]]], [112, []], [127, []]
    ];
    for (const [roll, extra] of vampireBoundaries) {
      scenario(`vampire table boundary random(${roll})`, () => {
        const result = addVampireDrops(roll);
        return {
          actual: result.objects,
          expected: expectedObjects([['vampire_dust', 1], ...extra])
        };
      });
    }
    scenario('vampire death guarantees vampire dust and a medium clue at random zero', () => {
      const player = makePlayer(0, 0);
      const result = runDeath('vampire_flyer', ServerTriggerType.AI_QUEUE3, '[ai_queue3,_vampire]', player, [0, 0, 0]);
      const clueCategory = requireId('category', CategoryType.getId('trail_clue_medium'), 'trail_clue_medium');
      const clueDrops = result.objects.filter(item => ObjType.getId(item.name) >= 0 &&
        ObjType.get(ObjType.getId(item.name)).category === clueCategory);
      return {
        actual: {
          mediumClues: clueDrops.length,
          vampireDust: result.objects.some(item => item.name === 'vampire_dust' && item.count === 1),
          earthRunes: result.objects.some(item => item.name === 'earthrune' && item.count === 4)
        },
        expected: { mediumClues: 1, vampireDust: true, earthRunes: true }
      };
    });
    const jewelBoundaries = [
      [58, 'rune_javelin', 5], [59, 'keyhalf1', 1], [60, 'keyhalf2', 1],
      [61, 'nature_talisman', 1], [62, 'nature_talisman', 1], [64, 'nature_talisman', 1]
    ];
    for (const [roll, name, count] of jewelBoundaries) {
      scenario(`vampire shared jewel roll ${roll} returns ${name} x${count}`, () => {
        const result = addVampireDrops(roll < 61 ? 108 : 111, { jewelRoll: roll });
        return {
          actual: result.objects,
          expected: expectedObjects([['vampire_dust', 1], [name, count]])
        };
      });
    }
    for (const [megaRoll, name] of [
      [7, 'rune_spear'], [8, 'dragonshield_a'], [11, 'dragonshield_a'],
      [12, 'dragon_spear'], [14, 'dragon_spear'], [15, null]
    ]) {
      scenario(`Legends-complete vampire jewel roll 61, mega-rare roll ${megaRoll}`, () => {
        const result = addVampireDrops(111, { jewelRoll: 61, legendsCompleteState: true, megaRoll });
        const extra = name === null ? [] : [[name, 1]];
        return {
          actual: result.objects,
          expected: expectedObjects([['vampire_dust', 1], ...extra])
        };
      });
    }

    let seedStart = 0;
    for (const [name, weight] of UNCOMMON_SEEDS) {
      for (const roll of new Set([seedStart, seedStart + weight - 1])) {
        scenario(`uncommon seed roll ${roll} returns ${name} x1`, () => {
          const actual = runPureProc('[proc,roll_uncommon_seed_table]', [], [randomValue(UNCOMMON_SEED_ROLL_COUNT, roll)]);
          return {
            actual: { stack: actual.stack, draws: actual.draws },
            expected: { stack: [objId(name), 1], draws: 1 }
          };
        });
      }
      seedStart += weight;
    }
    record('uncommon seed weights cover the specified cumulative interval', seedStart, 998);
    for (const [roll, seedRoll, quantity] of [[44, 653, 2], [62, 715, 2]]) {
      scenario(`vampire seed caller overrides watermelon to x${quantity} at seed roll ${seedRoll}`, () => {
        const result = addVampireDrops(roll, { seedRoll });
        return {
          actual: result.objects,
          expected: expectedObjects([['vampire_dust', 1], ['watermelon_seed', quantity]])
        };
      });
    }

    const GENERAL_SEED_GROUPS = [
      { outer: 0, rows: [
        ['potato_seed', 368, 4], ['onion_seed', 276, 4], ['cabbage_seed', 184, 4],
        ['tomato_seed', 92, 3], ['sweetcorn_seed', 46, 3], ['strawberry_seed', 23, 2], ['watermelon_seed', 11, 2]
      ] },
      { outer: 484, rows: [
        ['barley_seed', 229, 1], ['hammerstone_hop_seed', 228, 1], ['asgarnian_hop_seed', 172, 1],
        ['jute_seed', 171, 1], ['yanillian_hop_seed', 114, 1], ['krandorian_hop_seed', 58, 1], ['wildblood_hop_seed', 28, 1]
      ] },
      { outer: 727, rows: [
        ['marigold_seed', 376, 1], ['nasturtium_seed', 249, 1], ['rosemary_seed', 161, 1], ['woad_seed', 119, 1], ['limpwurt_seed', 95, 1]
      ] },
      { outer: 849, rows: [
        ['redberry_bush_seed', 400, 1], ['cadavaberry_bush_seed', 280, 1], ['dwellberry_bush_seed', 200, 1],
        ['jangerberry_bush_seed', 80, 1], ['whiteberry_bush_seed', 29, 1], ['poisonivy_bush_seed', 11, 1]
      ] },
      { outer: 946, rows: [
        ['guam_seed', 320, 1], ['marrentill_seed', 218, 1], ['tarromin_seed', 149, 1], ['harralander_seed', 101, 1],
        ['ranarr_seed', 69, 1], ['toadflax_seed', 47, 1], ['irit_seed', 32, 1], ['avantoe_seed', 21, 1],
        ['kwuarm_seed', 15, 1], ['snapdragon_seed', 10, 1], ['cadantine_seed', 7, 1], ['lantadyme_seed', 5, 1],
        ['dwarf_weed_seed', 3, 1], ['torstol_seed', 3, 1]
      ] },
      { outer: 994, rows: [
        ['mushroom_seed', 500, 1], ['belladonna_seed', 300, 1], ['cactus_seed', 200, 1]
      ] }
    ];
    for (const group of GENERAL_SEED_GROUPS) {
      let innerStart = 0;
      for (const [name, weight, count] of group.rows) {
        for (const roll of [...new Set([innerStart, innerStart + weight - 1])]) {
          scenario(`existing general seed table ${name} boundary ${roll}`, () => {
            const actual = runPureProc('[proc,roll_general_seed_table]', [100], [
              randomValue(1000, group.outer), randomValue(1000, roll)
            ]);
            return {
              actual: { stack: actual.stack, draws: actual.draws },
              expected: { stack: [objId(name), count], draws: 2 }
            };
          });
        }
        innerStart += weight;
      }
    }
    const generalOuterBoundaries = [
      [0, 'potato_seed', 4], [483, 'potato_seed', 4], [484, 'barley_seed', 1], [726, 'barley_seed', 1],
      [727, 'marigold_seed', 1], [848, 'marigold_seed', 1], [849, 'redberry_bush_seed', 1],
      [945, 'redberry_bush_seed', 1], [946, 'guam_seed', 1], [993, 'guam_seed', 1],
      [994, 'mushroom_seed', 1], [999, 'mushroom_seed', 1]
    ];
    for (const [roll, name, count] of generalOuterBoundaries) {
      scenario(`existing general seed outer boundary ${roll}`, () => {
        const actual = runPureProc('[proc,roll_general_seed_table]', [100], [
          randomValue(1000, roll), randomValue(1000, 0)
        ]);
        return {
          actual: { stack: actual.stack, draws: actual.draws },
          expected: { stack: [objId(name), count], draws: 2 }
        };
      });
    }

    const lizardBoundaries = [
      [0, 'unidentified_guam', 1], [9, 'unidentified_guam', 1],
      [10, 'uncut_sapphire', 1], [13, 'uncut_sapphire', 1],
      [14, 'potato_seed', 4], [22, 'potato_seed', 4],
      [23, 'mithril_ore', 1], [24, 'silver_bar', 1], [25, 'silver_bar', 1],
      [26, 'copper_ore', 1], [28, 'copper_ore', 1], [29, 'silver_ore', 1], [31, 'silver_ore', 1],
      [32, 'tin_ore', 1], [35, 'tin_ore', 1], [36, 'coal', 1], [48, 'coal', 1],
      [49, 'iron_ore', 1], [70, 'iron_ore', 1], [71, 'kebab', 1], [83, 'kebab', 1],
      [84, 'water_skin0', 1], [96, 'water_skin0', 1], [97, 'firerune', 5], [126, 'firerune', 5],
      [127, 'firerune', 42]
    ];
    for (const [roll, name, count] of lizardBoundaries) {
      scenario(`unchanged slayer lizard table random(${roll})`, () => ({
        actual: runLizardDrop(roll),
        expected: expectedObjects([['bones', 1], [name, count]])
      }));
    }

    function runHolySymbolCase(allCurrentAtBase) {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_flyer', x, z);
      setWorn(player, 2, 'blessedstar');
      for (const stat of [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC]) {
        npc.baseLevels[stat] = 99;
        npc.levels[stat] = allCurrentAtBase || stat !== NpcStat.STRENGTH ? 99 : 70;
      }
      const messagesBefore = player.testMessages.length;
      const result = executeNamed('[proc,vampire_holysymbol_weaken]', npc, player);
      const values = [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC]
        .map(stat => npc.levels[stat]);
      const emitted = player.testMessages.slice(messagesBefore)
        .map(message => typeof message === 'string' ? message : message?.text)
        .filter(Boolean);
      return { execution: result.state.execution, values, emitted };
    }
    scenario('holy symbol quarters each current-equals-base stat and emits one inherited message', () => {
      const actual = runHolySymbolCase(true);
      return {
        actual: { execution: actual.execution, values: actual.values, messageCount: actual.emitted.length,
          message: actual.emitted[0] ?? null },
        expected: { execution: ScriptState.FINISHED, values: [75, 75, 75, 75], messageCount: 1,
          message: 'The vampire is weakened by your holy symbol of Saradomin.' }
      };
    });

    scenario('holy symbol weakens only the current-equals-base stats', () => {
      const actual = runHolySymbolCase(false);
      return {
        actual: { execution: actual.execution, values: actual.values, messageCount: actual.emitted.length },
        expected: { execution: ScriptState.FINISHED, values: [75, 70, 75, 75], messageCount: 1 }
      };
    });
    scenario('holy symbol does not repeatedly weaken already changed stats', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_flyer', x, z);
      setWorn(player, 2, 'blessedstar');
      for (const stat of [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC]) {
        npc.baseLevels[stat] = 99;
        npc.levels[stat] = 75;
      }
      const result = executeNamed('[proc,vampire_holysymbol_weaken]', npc, player);
      const emitted = player.testMessages.map(message => typeof message === 'string' ? message : message?.text).filter(Boolean);
      return {
        actual: { execution: result.state.execution, values: [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC].map(stat => npc.levels[stat]), messages: emitted.length },
        expected: { execution: ScriptState.FINISHED, values: [75, 75, 75, 75], messages: 0 }
      };
    });

    function configureCombat(player, npc, shouldHit) {
      for (const name of ['com_stabdef', 'com_slashdef', 'com_crushdef', 'com_rangedef', 'com_magicdef']) {
        const id = requireId('varp', VarPlayerType.getId(name), name);
        player.setVar(id, 0);
      }
      npc.baseLevels[NpcStat.ATTACK] = shouldHit ? 99 : 1;
      npc.levels[NpcStat.ATTACK] = shouldHit ? 99 : 1;
      npc.baseLevels[NpcStat.STRENGTH] = 99;
      npc.levels[NpcStat.STRENGTH] = 99;
      npc.baseLevels[NpcStat.HITPOINTS] = 99;
      npc.levels[NpcStat.HITPOINTS] = 50;
      player.baseLevels[PlayerStat.DEFENCE] = shouldHit ? 1 : 99;
      player.levels[PlayerStat.DEFENCE] = shouldHit ? 1 : 99;
      player.baseLevels[PlayerStat.STRENGTH] = 20;
      player.levels[PlayerStat.STRENGTH] = 10;
    }
    for (const vampire of ['vampire_flyer', 'vampire_juve']) {
      scenario(`${vampire} non-bite branch runs ordinary combat without a holy symbol`, () => {
        const { x, z } = nextCoord();
        const player = makePlayer(x, z);
        const npc = makeNpc(vampire, x, z);
        configureCombat(player, npc, false);
        const before = [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC].map(stat => npc.levels[stat]);
        const script = trigger(ServerTriggerType.AI_OPPLAYER2, npc, '[ai_opplayer2,_vampire]');
        const executed = executeNamedWithRandom(script, npc, player, [], [randomValue(6, 1), 0, 0.999999]);
        settlePlayer(player, 4);
        return {
          actual: {
            execution: executed.result.execution,
            draws: executed.draws,
            hp: player.levels[PlayerStat.HITPOINTS],
            strength: player.levels[PlayerStat.STRENGTH],
            vampireHp: npc.levels[NpcStat.HITPOINTS],
            vampireStats: [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE, NpcStat.MAGIC].map(stat => npc.levels[stat]),
            messages: player.testMessages.filter(message => typeof message === 'string' || message?.text).length
          },
          expected: { execution: ScriptState.FINISHED, draws: 3, hp: 99, strength: 10, vampireHp: 50, vampireStats: before, messages: 0 }
        };
      });
    }
    function runBite(isHit, useAttackTrigger = false, protectMelee = false) {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_flyer', x, z);
      configureCombat(player, npc, isHit);
      if (protectMelee) player.setVar(ids.protectMelee, 1);
      const attackRollProc = executeNamed('[proc,npc_melee_attack_roll_typeless]', npc, player);
      const attackRoll = attackRollProc.state.intStack[attackRollProc.state.isp - 1];
      const maxhitProc = executeNamed('[proc,npc_melee_maxhit]', npc, player);
      const maxhit = maxhitProc.state.intStack[maxhitProc.state.isp - 1];
      assert(maxhit > 0, 'vampire melee maxhit fixture must be positive');
      if (isHit) assert(attackRoll > 0, 'typeless vampire attack roll must allow a hit');
      const damage = maxhit % 2 === 1 ? maxhit : Math.max(1, maxhit - 1);
      const randomValues = isHit
        ? [randomIncValue(attackRoll, attackRoll), 0, randomIncValue(maxhit, damage)]
        : [0, 0.999999];
      const scriptName = useAttackTrigger ? '[ai_opplayer2,_vampire]' : '[proc,vampire_bite]';
      const script = useAttackTrigger
        ? trigger(ServerTriggerType.AI_OPPLAYER2, npc, scriptName)
        : scriptByName(scriptName);
      if (useAttackTrigger) randomValues.unshift(randomValue(6, 0));
      const executed = executeNamedWithRandom(script, npc, player, [], randomValues);
      settlePlayer(player, 4);
      return {
        execution: executed.result.execution,
        maxhit,
        damage: 99 - player.levels[PlayerStat.HITPOINTS],
        strengthDrain: 10 - player.levels[PlayerStat.STRENGTH],
        vampireHeal: npc.levels[NpcStat.HITPOINTS] - 50,
        expectedDamage: isHit ? damage : 0
      };
    }
    scenario('vampire bite hit without Protect Melee damages, drains Strength and heals', () => {
      const actual = runBite(true, false, false);
      return {
        actual: { execution: actual.execution, damage: actual.damage, strengthDrain: actual.strengthDrain, vampireHeal: actual.vampireHeal },
        expected: { execution: ScriptState.FINISHED, damage: actual.expectedDamage, strengthDrain: 1, vampireHeal: Math.floor(actual.expectedDamage / 2) }
      };
    });
    scenario('vampire bite hit through Protect Melee still damages, drains Strength and heals', () => {
      const actual = runBite(true, false, true);
      return {
        actual: { execution: actual.execution, damage: actual.damage, strengthDrain: actual.strengthDrain, vampireHeal: actual.vampireHeal },
        expected: { execution: ScriptState.FINISHED, damage: actual.expectedDamage, strengthDrain: 1, vampireHeal: Math.floor(actual.expectedDamage / 2) }
      };
    });
    scenario('vampire bite miss under Protect Melee has no damage, Strength drain or heal', () => {
      const actual = runBite(false, false, true);
      return {
        actual: { execution: actual.execution, damage: actual.damage, strengthDrain: actual.strengthDrain, vampireHeal: actual.vampireHeal },
        expected: { execution: ScriptState.FINISHED, damage: 0, strengthDrain: 0, vampireHeal: 0 }
      };
    });
    scenario('vampire AI opplayer trigger enters its bite proc on the forced one-in-six outcome', () => {
      const actual = runBite(true, true, false);
      return {
        actual: { execution: actual.execution, damage: actual.damage, strengthDrain: actual.strengthDrain, vampireHeal: actual.vampireHeal },
        expected: { execution: ScriptState.FINISHED, damage: actual.expectedDamage, strengthDrain: 1, vampireHeal: Math.floor(actual.expectedDamage / 2) }
      };
    });
    scenario('vampire attack delay guard consumes no random draw', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_flyer', x, z);
      npc.setVar(ids.npcActionDelay, World.currentTick + 1);
      const script = trigger(ServerTriggerType.AI_OPPLAYER2, npc, '[ai_opplayer2,_vampire]');
      const executed = executeNamedWithRandom(script, npc, player, [], []);
      return {
        actual: { execution: executed.result.execution, draws: executed.draws },
        expected: { execution: ScriptState.FINISHED, draws: 0 }
      };
    });

    const LEECH_SKILLS = [
      ['attack', PlayerStat.ATTACK], ['defence', PlayerStat.DEFENCE], ['strength', PlayerStat.STRENGTH],
      ['hitpoints', PlayerStat.HITPOINTS], ['ranged', PlayerStat.RANGED], ['prayer', PlayerStat.PRAYER],
      ['magic', PlayerStat.MAGIC], ['cooking', PlayerStat.COOKING], ['woodcutting', PlayerStat.WOODCUTTING],
      ['fletching', PlayerStat.FLETCHING], ['fishing', PlayerStat.FISHING], ['firemaking', PlayerStat.FIREMAKING],
      ['crafting', PlayerStat.CRAFTING], ['smithing', PlayerStat.SMITHING], ['mining', PlayerStat.MINING],
      ['herblore', PlayerStat.HERBLORE], ['agility', PlayerStat.AGILITY], ['thieving', PlayerStat.THIEVING],
      ['runecraft', PlayerStat.RUNECRAFT], ['slayer', PlayerStat.SLAYER]
    ];
    const leechProcs = LEECH_SKILLS.map(([, stat]) => stat);
    function runLeechDrain(targetIndex) {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_leech', x, z);
      player.levels.fill(10);
      player.baseLevels.fill(20);
      const randomValues = LEECH_SKILLS.map((_, index) => randomValue(5, index === targetIndex ? 0 : 1));
      const executed = executeNamedWithRandom('[proc,leech_reduce_stats]', npc, player, [], randomValues);
      return {
        execution: executed.result.execution,
        draws: executed.draws,
        levels: leechProcs.map(stat => player.levels[stat]),
        farming: player.levels[PlayerStat.FARMING]
      };
    }
    scenario('leech nonzero random outcome leaves all 20 period skills and Farming unchanged', () => {
      const actual = runLeechDrain(-1);
      return {
        actual: { execution: actual.execution, draws: actual.draws, levels: actual.levels, farming: actual.farming },
        expected: { execution: ScriptState.FINISHED, draws: 20, levels: Array(20).fill(10), farming: 10 }
      };
    });
    for (let index = 0; index < LEECH_SKILLS.length; index++) {
      const [name] = LEECH_SKILLS[index];
      scenario(`leech random zero independently drains ${name}`, () => {
        const actual = runLeechDrain(index);
        const expectedLevels = Array(20).fill(10);
        expectedLevels[index] = 9;
        return {
          actual: { execution: actual.execution, draws: actual.draws, levels: actual.levels, farming: actual.farming },
          expected: { execution: ScriptState.FINISHED, draws: 20, levels: expectedLevels, farming: 10 }
        };
      });
    }
    scenario('leech hit under Protect Melee deals zero but still drains a skill', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_leech', x, z);
      configureCombat(player, npc, true);
      player.setVar(ids.protectMelee, 1);
      const maxhitProc = executeNamed('[proc,npc_melee_maxhit]', npc, player);
      const maxhit = maxhitProc.state.intStack[maxhitProc.state.isp - 1];
      const values = [0.999999, 0, randomIncValue(maxhit, maxhit), ...LEECH_SKILLS.map((_, index) => randomValue(5, index === 0 ? 0 : 1))];
      const script = trigger(ServerTriggerType.AI_OPPLAYER2, npc, '[ai_opplayer2,vampire_leech]');
      const executed = executeNamedWithRandom(script, npc, player, [], values);
      settlePlayer(player, 4);
      return {
        actual: { execution: executed.result.execution, hpDamage: 99 - player.levels[PlayerStat.HITPOINTS], attackDrain: 99 - player.levels[PlayerStat.ATTACK] },
        expected: { execution: ScriptState.FINISHED, hpDamage: 0, attackDrain: 1 }
      };
    });
    scenario('leech hit without Protect Melee deals damage and still drains a skill', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const npc = makeNpc('vampire_leech', x, z);
      configureCombat(player, npc, true);
      const maxhitProc = executeNamed('[proc,npc_melee_maxhit]', npc, player);
      const maxhit = maxhitProc.state.intStack[maxhitProc.state.isp - 1];
      const values = [0.999999, 0, randomIncValue(maxhit, maxhit), ...LEECH_SKILLS.map((_, index) => randomValue(5, index === 0 ? 0 : 1))];
      const script = trigger(ServerTriggerType.AI_OPPLAYER2, npc, '[ai_opplayer2,vampire_leech]');
      const executed = executeNamedWithRandom(script, npc, player, [], values);
      settlePlayer(player, 4);
      return {
        actual: { execution: executed.result.execution, hpDamage: 99 - player.levels[PlayerStat.HITPOINTS], attackDrain: 99 - player.levels[PlayerStat.ATTACK] },
        expected: { execution: ScriptState.FINISHED, hpDamage: maxhit, attackDrain: 1 }
      };
    });

    scenario('spider opplayer trigger selects proximity mode', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const spider = makeNpc('vampire_spider', x, z);
      const script = trigger(ServerTriggerType.AI_OPPLAYER2, spider, '[ai_opplayer2,vampire_spider]');
      const executed = executeNamed(script, spider, player);
      return {
        actual: { execution: executed.state.execution, mode: spider.targetOp },
        expected: { execution: ScriptState.FINISHED, mode: NpcMode.APPLAYER2 }
      };
    });
    scenario('spider AI timer decrements cooldown and holds zero', () => {
      const { x, z } = nextCoord();
      const spider = makeNpc('vampire_spider', x, z);
      const script = trigger(ServerTriggerType.AI_TIMER, spider, '[ai_timer,vampire_spider]');
      spider.setVar(ids.npcInt, 100);
      const first = executeNamed(script, spider, null).state.execution;
      const afterFirst = spider.getVar(ids.npcInt);
      spider.setVar(ids.npcInt, 0);
      const second = executeNamed(script, spider, null).state.execution;
      return {
        actual: { first, afterFirst, second, atZero: spider.getVar(ids.npcInt) },
        expected: { first: ScriptState.FINISHED, afterFirst: 99, second: ScriptState.FINISHED, atZero: 0 }
      };
    });
    scenario('spider proximity creates a real owned flyer with timer, mode and landing animation', () => {
      const { x, z } = nextCoord();
      const player = makePlayer(x, z);
      const spider = makeNpc('vampire_spider', x, z);
      spider.setVar(ids.npcInt, 0);
      const script = trigger(ServerTriggerType.AI_APPLAYER2, spider, '[ai_applayer2,vampire_spider]');
      const adds = [];
      const originalAddNpc = World.addNpc;
      World.addNpc = function (npc, duration, firstSpawn = true) {
        adds.push({ npc, duration });
        return originalAddNpc.call(this, npc, duration, firstSpawn);
      };
      let execution;
      try {
        const ran = withMathRandom(0, () => executeNamed(script, spider, player));
        execution = ran.state.execution;
        const repeated = executeNamed(script, spider, player);
        assert.equal(repeated.state.execution, ScriptState.FINISHED, 'cooldown-blocked proximity finishes without a second flyer');
      } finally {
        World.addNpc = originalAddNpc;
      }
      assert.equal(adds.length, 1, 'real NPC_ADD creates one vampire flyer');
      const { npc: flyer, duration } = adds[0];
      const distance = Math.max(Math.abs(flyer.x - spider.x), Math.abs(flyer.z - spider.z));
      return {
        actual: {
          execution,
          type: NpcType.get(flyer.type).debugname,
          duration,
          lifecycleTick: flyer.lifecycleTick,
          owner: flyer.getVar(ids.npcAggressivePlayer),
          mode: flyer.targetOp,
          withinThreeTileRadius: distance <= 3,
          landingAnimation: flyer.animId,
          spiderCooldown: spider.getVar(ids.npcInt)
        },
        expected: {
          execution: ScriptState.FINISHED,
          type: 'vampire_flyer',
          duration: 1000,
          lifecycleTick: 1000,
          owner: player.uid,
          mode: NpcMode.OPPLAYER2,
          withinThreeTileRadius: true,
          landingAnimation: requireId('sequence', SeqType.getId('vamp_land'), 'vamp_land'),
          spiderCooldown: 100
        }
      };
    });

    const failed = failures.length;
    console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} mortmyre-creatures: ${cases - failed}/${cases} cases passed`);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    record('packed runtime setup and execution completed', { error: error instanceof Error ? error.message : String(error) }, { error: null });
    console.log(`RESULT FAIL mortmyre-creatures: ${cases - failures.length}/${cases} cases passed`);
    process.exit(1);
  }
}

main();
