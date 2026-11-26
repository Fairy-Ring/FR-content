#!/usr/bin/env node
/** Q079: native Juna/blue-rock/item dispatch, stage, recovery and once-only reward. */
import assert from 'node:assert/strict';
import { quests } from '../quest-points/registry.mjs';
import {
  PlayerStat, ScriptState, World, count, engineModule, execute, id, inv,
  inventory, map, obj, player, resumeDialogue, seed, types, use
} from '../swamp-caves/runtime.mjs';

const Environment = (await engineModule('util/Environment.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const rsbuf = await engineModule('network/rsbuf/index.ts');
const questStage = id('VarBitType', 'tog_juna_bowl');
const questPointsVar = id('VarPlayerType', 'qp');
const hud = id('Component', 'water_collected');
const juna = () => {
  const loc = World.getLoc(3252, 9516, 2, id('LocType', 'hidey_unbuilt_bush_easy'));
  assert(loc, 'the original Juna location is packed');
  return { name: 'hidey_unbuilt_bush_easy', loc, level: 2 };
};
const rockNames = ['tog_blue_stone_rocks1', 'tog_blue_stone_rocks2', 'tog_blue_stone_rocks3'];
const mapSquares = [[49, 149], [50, 148], [50, 149], [50, 150], [51, 150]];
let cases = 0;
let failures = 0;

function test(name, run) {
  cases++;
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack ?? error}`);
  }
}

function withPlayer(run) {
  const p = player();
  try {
    return run(p);
  } finally {
    p.delayed = false;
    p.activeScript = null;
    p.clearInteraction();
    p.weakQueue.clear();
    rsbuf.removePlayer(p.slot);
    p.isActive = false;
    World.players[p.pid] = null;
    p.unlink();
  }
}

function setBaseSkill(p, skill, level) {
  p.baseLevels[skill] = level;
  p.levels[skill] = level;
}

function setQuestFixtureValue(p, name, value) {
  const varbit = types.VarBitType.getId(name);
  if (varbit >= 0) p.setVarBit(varbit, value);
  else p.setVar(id('VarPlayerType', name), value);
}

function seedQuestPoints(p, minimum = 43) {
  let seededPoints = 0;
  for (const quest of quests) {
    if (quest.component === 'tog' || seededPoints >= minimum) continue;
    for (const [name, value] of quest.fixture) setQuestFixtureValue(p, name, value);
    seededPoints += quest.points;
  }
  assert(seededPoints >= minimum, `registered quest fixtures provide at least ${minimum} QP`);
  execute('[proc,update_questpoints]', p);
  const total = p.getVar(questPointsVar);
  assert(total >= minimum, `player QP fixture is ${total}`);
  return total;
}

function findPlacedLoc(name) {
  const type = id('LocType', name);
  for (const [mapX, mapZ] of mapSquares) {
    for (let level = 0; level < 4; level++) {
      for (let x = mapX * 64; x < (mapX + 1) * 64; x++) {
        for (let z = mapZ * 64; z < (mapZ + 1) * 64; z++) {
          const loc = World.getLoc(x, z, level, type);
          if (loc) {
            const entry = { name, loc, level };
            if (approach(entry)) return entry;
          }
        }
      }
    }
  }
  assert.fail(`a reachable placed ${name} loc exists in the original Tears map squares`);
}

function approach(entry) {
  const { loc, level } = entry;
  const type = types.LocType.get(loc.type);
  const candidates = [];
  for (let x = loc.x - 5; x <= loc.x + 5; x++) {
    for (let z = loc.z - 5; z <= loc.z + 5; z++) {
      if (map.isMapBlocked(x, z, level)) continue;
      if (!map.reachedLoc(level, x, z, loc.x, loc.z, type.width, type.length, 1,
        loc.angle, loc.shape, type.forceapproach)) continue;
      candidates.push([level, x, z]);
    }
  }
  candidates.sort((a, b) => Math.abs(a[1] - loc.x) + Math.abs(a[2] - loc.z)
    - Math.abs(b[1] - loc.x) - Math.abs(b[2] - loc.z) || a[1] - b[1] || a[2] - b[2]);
  return candidates[0];
}

function standAt(p, entry) {
  const tile = approach(entry);
  assert(tile, `a walkable native approach exists for ${entry.name}`);
  [p.level, p.x, p.z] = tile;
  p.originX = p.x;
  p.originZ = p.z;
}

function clickLoc(p, entry, option = 1) {
  standAt(p, entry);
  const accepted = locHandler.handle(new OpLoc(option, entry.loc.x, entry.loc.z, entry.loc.type), p);
  assert(accepted, `native OpLoc accepts ${entry.name}`);
  p.processInteraction();
}

function talkToJuna(p, option = 1) {
  clickLoc(p, juna());
  const state = p.activeScript;
  assert(state, 'Juna Talk-to starts its packed handler');
  let choices = 0;
  for (let page = 0; state.execution === ScriptState.PAUSEBUTTON && page < 40; page++) {
    const root = types.Component.get(p.modalChat).comName;
    if (/^multi[2-5]$/.test(root)) {
      choices++;
      resumeDialogue(p, option);
    } else {
      resumeDialogue(p);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'Juna interaction finishes');
  return choices;
}

function texts(p) {
  return p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
}

function mine(p, entry) {
  clickLoc(p, entry, 1);
}

function chiselStone(p) {
  assert(use(p, 'chisel', 'tog_stone'), 'native item-on-item dispatch accepts chisel on stone');
  p.processInteraction();
}

function questPointCount(p) {
  return execute('[proc,count_questpoints]', p).popInt();
}

const junaLoc = juna();
const rocks = rockNames.map(findPlacedLoc);

for (const gate of [
  { label: '43 Quest Points', prepare: p => p.setVar(questPointsVar, 42) },
  { label: '49 Firemaking', prepare: p => { seedQuestPoints(p); setBaseSkill(p, PlayerStat.FIREMAKING, 48); } },
  { label: '20 Crafting', prepare: p => { seedQuestPoints(p); setBaseSkill(p, PlayerStat.CRAFTING, 19); } },
  { label: '20 Mining', prepare: p => { seedQuestPoints(p); setBaseSkill(p, PlayerStat.MINING, 19); } }
]) {
  test(`Juna refuses a player below ${gate.label}`, () => withPlayer(p => {
    gate.prepare(p);
    assert.equal(talkToJuna(p), 0, 'a refusal offers no story choice');
    assert.equal(p.getVarBit(questStage), 0, 'refusal leaves the quest unstarted');
    assert.equal(count(p, 'tog_stone'), 0);
    assert.equal(count(p, 'tog_bowl'), 0);
    assert.notEqual(p.overlay, hud, 'a quest gate never opens the minigame HUD');
  }));
}

test('Juna decline leaves Q079 untouched; accepting the original story starts it without a HUD', () => withPlayer(p => {
  const qp = seedQuestPoints(p);
  const xp = p.stats[PlayerStat.CRAFTING];
  assert.equal(talkToJuna(p, 2), 1);
  assert.equal(p.getVarBit(questStage), 0);
  assert.match(texts(p), /Tell me\.\.\. a story\.\.\./);
  assert.match(texts(p), /Not now\./);
  assert.notEqual(p.overlay, hud);
  p.packets.length = 0;
  assert.equal(talkToJuna(p, 1), 1);
  assert.equal(p.getVarBit(questStage), 1, 'accepted story writes the started stage');
  const dialogue = texts(p);
  const opener = dialogue.indexOf('Tell me... a story...');
  const playerStory = dialogue.indexOf('You tell me a story.');
  const welcome = dialogue.indexOf('Your stories have entertained me. I will let you into the cave for a short time.');
  assert(opener >= 0 && opener < playerStory && playerStory < welcome, 'the preserved Juna story lines stay in order');
  assert.equal(p.getVar(questPointsVar), qp, 'starting the quest grants no QP');
  assert.equal(p.stats[PlayerStat.CRAFTING], xp, 'starting the quest grants no XP');
  assert.equal(count(p, 'tog_stone'), 0);
  assert.equal(count(p, 'tog_bowl'), 0);
  assert.notEqual(p.overlay, hud, 'quest start never opens the minigame HUD');
}));

test('each placed blue-rock form uses native Mine dispatch, rejects duplicates and permits stone recovery', () => withPlayer(p => {
  seedQuestPoints(p);
  assert.equal(talkToJuna(p, 1), 1);
  seed(p, ['bronze_pickaxe']);
  for (const [index, rock] of rocks.entries()) {
    mine(p, rock);
    assert.equal(count(p, 'tog_stone'), 1, `${rock.name} yields one quest stone`);
    if (index === 0) {
      mine(p, rock);
      assert.equal(count(p, 'tog_stone'), 1, 'mining again cannot duplicate a carried stone');
    }
    if (index < rocks.length - 1) p.invDel(inv, obj('tog_stone'), 1); // Fixture simulates the stone being lost.
  }
}));

test('mining requires level 20 and a pickaxe, and a full bag loses nothing', () => withPlayer(p => {
  seedQuestPoints(p);
  assert.equal(talkToJuna(p, 1), 1);
  const rock = rocks[0];
  seed(p, ['bronze_pickaxe']);
  setBaseSkill(p, PlayerStat.MINING, 19);
  mine(p, rock);
  assert.equal(count(p, 'tog_stone'), 0, 'low Mining leaves the inventory unchanged');
  setBaseSkill(p, PlayerStat.MINING, 20);
  p.invDel(inv, obj('bronze_pickaxe'), 1);
  mine(p, rock);
  assert.equal(count(p, 'tog_stone'), 0, 'missing pickaxe leaves the inventory unchanged');
  for (let i = 0; i < 27; i++) p.invAdd(inv, obj('chisel'), 1);
  p.invAdd(inv, obj('bronze_pickaxe'), 1);
  assert.equal(inventory(p).filter(Boolean).length, 28, 'fixture fills every inventory slot');
  const before = inventory(p);
  mine(p, rock);
  assert.deepEqual(inventory(p), before, 'no space never consumes or drops an item');
  assert.equal(count(p, 'tog_stone'), 0);
}));

test('chisel requires level 20 and the item can be recovered after either loss', () => withPlayer(p => {
  seedQuestPoints(p);
  assert.equal(talkToJuna(p, 1), 1);
  seed(p, ['bronze_pickaxe', 'chisel']);
  mine(p, rocks[0]);
  setBaseSkill(p, PlayerStat.CRAFTING, 19);
  chiselStone(p);
  assert.equal(count(p, 'tog_stone'), 1, 'failed Crafting check preserves the stone');
  assert.equal(count(p, 'tog_bowl'), 0);
  setBaseSkill(p, PlayerStat.CRAFTING, 20);
  p.invDel(inv, obj('tog_stone'), 1); // Fixture simulates losing a mined stone.
  mine(p, rocks[1]);
  chiselStone(p);
  assert.equal(count(p, 'tog_stone'), 0);
  assert.equal(count(p, 'tog_bowl'), 1);
  p.invDel(inv, obj('tog_bowl'), 1); // Fixture simulates losing the crafted bowl.
  mine(p, rocks[2]);
  chiselStone(p);
  assert.equal(count(p, 'tog_stone'), 0);
  assert.equal(count(p, 'tog_bowl'), 1, 'the quest remains recoverable after losing the bowl');
}));

test('talking to Juna with the bowl completes the quest and post-quest talk cannot replay the reward', () => withPlayer(p => {
  const qpBefore = seedQuestPoints(p);
  const xpBefore = p.stats[PlayerStat.CRAFTING];
  assert.equal(talkToJuna(p, 1), 1);
  seed(p, ['bronze_pickaxe', 'chisel']);
  mine(p, rocks[0]);
  chiselStone(p);
  assert.equal(count(p, 'tog_bowl'), 1);
  clickLoc(p, junaLoc);
  assert.equal(p.getVarBit(questStage), 2, 'Juna Talk-to with the bowl commits the complete stage');
  assert.equal(count(p, 'tog_stone'), 0);
  assert.equal(count(p, 'tog_bowl'), 0);
  assert.equal(p.getVar(questPointsVar), qpBefore + 1, 'one QP is awarded immediately');
  assert.equal(questPointCount(p), qpBefore + 1, 'the quest-point counter includes exactly one new point');
  assert.equal(p.stats[PlayerStat.CRAFTING], xpBefore + 10_000 * Environment.NODE_XPRATE, '1,000 XP uses the engine tenths unit');
  assert.equal(p.modalMain, types.Component.get(id('Component', 'questscroll_death:com_3')).rootLayer, 'completion opens the original reward scroll');
  const rows = new Map(p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => [packet.component, packet.text]));
  assert.match(rows.get(id('Component', 'questscroll_death:com_3')), /Tears of Guthix Quest!/);
  assert.equal(rows.get(id('Component', 'questscroll_death:com_9')), '1 Quest Point');
  const rewards = [10, 11, 12, 13, 14].map(row => rows.get(id('Component', `questscroll_death:com_${row}`))).join(' ');
  assert.match(rewards, /1,000 Crafting XP/);
  assert.match(rewards, /Weekly access to the Tears of Guthix minigame/);
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetColour'
    && packet.component === id('Component', 'questlist:tog') && packet.colour === 0x3e0), 'completion colours the quest row green');
  assert.notEqual(p.overlay, hud, 'quest completion never opens the minigame HUD');

  p.closeModal();
  p.packets.length = 0;
  p.invAdd(inv, obj('tog_bowl'), 1); // Fixture tests the post-quest Talk-to path with another bowl present.
  clickLoc(p, junaLoc);
  assert.equal(p.getVarBit(questStage), 2);
  assert.equal(count(p, 'tog_bowl'), 1, 'post-quest Talk-to does not consume another bowl');
  assert.equal(p.getVar(questPointsVar), qpBefore + 1);
  assert.equal(questPointCount(p), qpBefore + 1);
  assert.equal(p.stats[PlayerStat.CRAFTING], xpBefore + 10_000 * Environment.NODE_XPRATE);
}));

test('cut sapphire attaches to a ToG lantern in either item-use direction', () => {
  for (const [used, target] of [
    ['sapphire', 'bullseye_lantern_unlit'],
    ['bullseye_lantern_unlit', 'sapphire']
  ]) {
    withPlayer(p => {
      seed(p, ['sapphire', 'bullseye_lantern_unlit']);
      assert(use(p, used, target), `native item-on-item dispatch accepts ${used} on ${target}`);
      p.processInteraction();
      assert.equal(count(p, 'tog_sapphire_lantern_unlit'), 1);
      assert.equal(count(p, 'bullseye_lantern_lens'), 1, 'the ordinary lens is returned');
      assert.equal(count(p, 'sapphire'), 0);
      assert.equal(count(p, 'bullseye_lantern_unlit'), 0);
    });
  }
});

test('ordinary lantern lens assembly and tinderbox relighting remain intact', () => withPlayer(p => {
  p.setVarBit(id('VarBitType', 'know_how_to_make_lanterns'), 1);
  setBaseSkill(p, PlayerStat.FIREMAKING, 49);
  seed(p, ['bullseye_lantern_lens', 'bullseye_lantern_nolens', 'bullseye_lantern_unlit', 'tinderbox']);
  assert(use(p, 'bullseye_lantern_lens', 'bullseye_lantern_nolens'), 'native item-on-item dispatch accepts the ordinary lantern lens');
  p.processInteraction();
  assert.equal(count(p, 'bullseye_lantern_empty'), 1);
  assert.equal(count(p, 'bullseye_lantern_lens'), 0);
  assert.equal(count(p, 'bullseye_lantern_nolens'), 0);

  assert(use(p, 'tinderbox', 'bullseye_lantern_unlit'), 'native item-on-item dispatch accepts a tinderbox on the ordinary unlit lantern');
  p.processInteraction();
  assert.equal(count(p, 'bullseye_lantern_lit'), 1);
  assert.equal(count(p, 'bullseye_lantern_unlit'), 0);
}));
console.log(`RESULT ${failures ? 'FAIL' : 'PASS'} (${cases} quest cases, ${failures} failures)`);
if (failures) process.exitCode = 1;

