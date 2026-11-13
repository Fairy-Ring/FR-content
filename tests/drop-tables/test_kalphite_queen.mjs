#!/usr/bin/env node
/**
 * Exhaust the direct KQ regular-table outcomes through the compiled ScriptRunner.
 * Run from the sibling engine after npm run build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

async function main() {
  assert(fs.existsSync(SCRIPT_DAT), `missing compiled script.dat at ${SCRIPT_DAT} — run npm run build in the sibling engine`);
  const load = async relative => (await import(pathToFileURL(path.join(ENGINE_ROOT, relative)).href)).default;
  const World = await load('src/engine/World.ts');
  const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
  const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
  const ScriptState = await load('src/engine/script/ScriptState.ts');
  const Player = await load('src/engine/entity/Player.ts');
  const Npc = await load('src/engine/entity/Npc.ts');
  const JavaRandom = await load('src/util/JavaRandom.ts');
  const { EntityLifeCycle } = await import(pathToFileURL(path.join(ENGINE_ROOT, 'src/engine/entity/EntityLifeCycle.ts')).href);
  const types = {};
  for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'CategoryType', 'FontType', 'Component']) {
    types[name] = await load(`src/cache/config/${name}.ts`);
    types[name].load(PACK_DIR);
  }
  World.currentTick = 1;
  assert(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider.load found no compiled scripts');

  const packMaps = new Map();
  function id(kind, name) {
    if (!packMaps.has(kind)) {
      const rows = fs.readFileSync(path.join(CONTENT_ROOT, `pack/${kind}.pack`), 'utf8').split('\n');
      packMaps.set(kind, new Map(rows.filter(line => /^\d+=/.test(line)).map(line => {
        const split = line.indexOf('=');
        return [line.slice(split + 1).trim(), Number(line.slice(0, split))];
      })));
    }
    const value = packMaps.get(kind).get(name);
    assert.notEqual(value, undefined, `pack/${kind}.pack is missing ${name}`);
    return value;
  }

  // These quantity allowances mirror facts.md. The iron-arrow and oyster-pearl
  // ranges preserve current behavior only; their May 2006 quantity is UNKNOWN.
  const allowedQuantities = new Map([
    ['rune_chainbody', [1, 1]],
    ['lava_battlestaff', [1, 1]],
    ['rune_warhammer', [1, 1]],
    ['rune_axe', [1, 1]],
    ['adamant_spear', [1, 1]],
    ['mithril_arrow', [500, 500]],
    ['iron_arrow', [1, 335]],
    ['rune_arrow', [100, 100]],
    ['bigoysterpearls', [40, 40]],
    ['bloodrune', [19, 19]],
    ['naturerune', [75, 75]],
    ['firerune', [600, 600]],
    ['lawrune', [20, 20]],
    ['deathrune', [30, 30]],
    ['cert_wine_of_zamorak', [20, 20]],
    ['amulet_of_power', [1, 1]],
    ['lobster', [7, 7]],
    ['dragon_chainbody', [1, 1]]
  ]);
  const allowedById = new Map([...allowedQuantities].map(([name, range]) => [id('obj', name), { name, range }]));
  const queenId = id('npc', 'kalphite_flyingqueen');
  const aggressivePlayerVar = id('varn', 'npc_aggressive_player');
  const dropScript = ScriptProvider.getByName('[ai_queue3,kalphite_flyingqueen]');
  assert(dropScript, 'compiled KQ flying-queen drop procedure is missing');
  const originalNextDouble = JavaRandom.nextDouble;
  const seen = new Set();
  let serial = 0;

  function makePlayer(roll) {
    const number = ++serial;
    const username37 = BigInt(number);
    const hash64 = BigInt(0x100000 + number);
    const player = new Player(`kq_loot_${roll}_${number}`, username37, hash64);
    player.slot = number;
    player.uid = (Number(username37 & 0x1fffffn) << 11) | number;
    player.pid = number;
    player.lastMovement = 0;
    player.packets = [];
    player.write = packet => player.packets.push(packet);
    player.messageGame = message => player.packets.push({ text: message });
    player.wrappedMessageGame = player.messageGame;
    World.players[number] = player;
    World.playerLoop.add(hash64, player);
    return player;
  }

  function finishDeath(player, target, roll) {
    const state = ScriptRunner.init(dropScript, player, target);
    let execution = player.runScript(state, true, true);
    let npcSuspensions = 0;
    while (execution === ScriptState.NPC_SUSPENDED && npcSuspensions++ < 20) {
      target.executeScript(state);
      execution = state.execution;
    }
    let playerPauses = 0;
    while (execution === ScriptState.PAUSEBUTTON && playerPauses++ < 20) {
      World.currentTick++;
      execution = player.runScript(state, true, true);
    }
    assert.equal(execution, ScriptState.FINISHED, `KQ drop procedure did not finish for random(${roll}) (exec=${execution})`);
  }

  try {
    // Exact mid-bin values make random(128) return each tested value. Values
    // 1-121 cover every direct regular-table branch without the zero-roll clue
    // helper or the 122-127 RDT branch, whose exact historical outputs are UNKNOWN.
    for (let roll = 1; roll <= 121; roll++) {
      const x = 3500 + (roll % 8);
      const z = 9500 + Math.floor(roll / 8);
      const player = makePlayer(roll);
      const target = new Npc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, roll, queenId, types.NpcType.get(queenId).blockwalk);
      target.heroPoints.addHero(player.hash64, 10);
      target.setVar(aggressivePlayerVar, player.uid);

      const value = (roll + 0.5) / 128;
      JavaRandom.nextDouble = () => value;
      finishDeath(player, target, roll);

      const zone = World.gameMap.getZone(x, z, 0);
      const objects = [...zone.getAllObjsSafe()].filter(obj => obj.x === x && obj.z === z && obj.receiver64 === player.hash64);
      assert(objects.length > 0, `random(${roll}) created no KQ loot objects`);
      const totals = new Map();
      for (const obj of objects) totals.set(obj.type, (totals.get(obj.type) ?? 0) + obj.count);
      assert.equal(totals.size, 1, `random(${roll}) yielded more than one regular-table item: ${JSON.stringify([...totals])}`);
      const [objectId, quantity] = [...totals.entries()][0];
      const allowed = allowedById.get(objectId);
      assert(allowed, `random(${roll}) yielded unlisted ${objectId} x${quantity}`);
      assert(quantity >= allowed.range[0] && quantity <= allowed.range[1], `random(${roll}) yielded ${allowed.name} x${quantity}; facts allow ${allowed.range[0]}-${allowed.range[1]}`);
      if (objectId === id('obj', 'dragon_chainbody')) {
        assert(quantity <= 1, `random(${roll}) yielded ${quantity} dragon chainbodies; at most one is allowed`);
      }
      seen.add(allowed.name);
    }
  } finally {
    JavaRandom.nextDouble = originalNextDouble;
  }

  assert.equal(seen.has('dragon_chainbody'), true, 'the dragon-chainbody unique roll was not exercised');
  assert.deepEqual([...seen].sort(), [...allowedQuantities.keys()].sort(), 'not every direct regular-table item row was exercised');
  console.log('RESULT PASS (121 deterministic KQ regular-table outcomes; item and quantity allowances; single dragon chainbody)');
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error?.stack ?? error);
    console.error('RESULT FAIL (compiled KQ loot table)');
    process.exit(1);
  }
);
