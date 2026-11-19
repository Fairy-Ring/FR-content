// Source-backed ordinary options, using packed dispatch and native Player state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(content, '../engine');
process.chdir(engine);
const load = async name => (await import(pathToFileURL(path.join(engine, 'src', name)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const Trigger = await load('engine/script/ServerTriggerType.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
const cfg = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'NpcType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType']) {
  cfg[name] = await load(`cache/config/${name}.ts`);
  cfg[name].load('data/pack');
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load('data/pack') > 0);
const { NpcType, ObjType, InvType, VarPlayerType, Component } = cfg;
const normalize = text => text.replace(/<[^>]*>/g, '').replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
const pause = new ResumePauseButtonHandler();
const placements = new Map();
for (const file of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  let section = '';
  for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('NPC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+)$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match;
    const rows = placements.get(+type) ?? [];
    rows.push({ level: +level, x: +mx * 64 + +x, z: +mz * 64 + +z });
    placements.set(+type, rows);
  }
}
function items(player, inventory) {
  return player.getInventory(InvType.getId(inventory)).items.map(item => item ? { id: item.id, count: item.count } : null);
}
function run(name, op, fixture = {}) {
  World.currentTick = 100;
  const type = NpcType.getByName(name);
  assert(type && type.id >= 0, `packed NPC ${name}`);
  const tile = placements.get(type.id)?.[fixture.placement ?? 0];
  assert(tile, `${name}: retained map placement`);
  const player = new Player('npcoptionstest', 1n, 0n);
  player.pid = 1; player.uid = 1; player.vars.fill(0); player.levels.fill(99); player.baseLevels.fill(99);
  player.level = tile.level; player.x = tile.x; player.z = tile.z - 1;
  player.buildArea.originX = tile.x - 32; player.buildArea.originZ = tile.z - 32;
  for (const [key, value] of Object.entries(fixture.vars ?? {})) {
    const id = VarPlayerType.getId(key); assert(id >= 0, key); player.setVar(id, value);
  }
  for (const [key, value] of Object.entries(fixture.inventory ?? {})) {
    const id = ObjType.getId(key); assert(id >= 0, key); player.invAdd(InvType.getId('inv'), id, value);
  }
  for (const [key, value] of Object.entries(fixture.bank ?? {})) player.invAdd(InvType.getId('bank'), ObjType.getId(key), value);
  for (const key of fixture.worn ?? []) player.invAdd(InvType.getId('worn'), ObjType.getId(key), 1);
  const packets = [], npcs = [];
  player.write = packet => packets.push(packet);
  for (const key of [name, ...(fixture.nearby ?? [])]) {
    const otherType = NpcType.getByName(key), otherTile = placements.get(otherType.id)?.[key === name ? fixture.placement ?? 0 : 0];
    assert(otherTile, key);
    const npc = new Npc(otherTile.level, otherTile.x, otherTile.z, otherType.size, otherType.size, EntityLifeCycle.RESPAWN, npcs.length + 1, otherType.id, BlockWalk.NONE);
    npc.isActive = true; npc.lastMovement = -100; npcs.push(npc);
    World.gameMap.getZone(npc.x, npc.z, npc.level).enter(npc);
  }
  const before = {
    vars: player.vars.slice(), inv: items(player, 'inv'), worn: items(player, 'worn'), xp: player.stats.slice(),
    tile: [player.level, player.x, player.z], npcs: npcs.map(npc => [npc.type, npc.level, npc.x, npc.z])
  };
  player.target = npcs[0]; player.targetOp = Trigger[`OPNPC${op}`] - 7;
  const item = fixture.readItem ? ObjType.getByName(fixture.readItem) : null;
  const script = item ? ScriptProvider.getByTrigger(Trigger.OPHELD1, item.id, item.category) : player.getOpTrigger();
  assert(script, `${name}: operation must dispatch from packed type/category`);
  assert.equal(script.name, item ? `[opheld1,${fixture.readItem}]` : `[opnpc${op},${name}]`);
  JavaRandom.setSeed(fixture.seed ?? 1);
  const state = ScriptRunner.init(script, player, npcs[0]);
  player.executeScript(state, true);
  let choice = 0;
  try {
    for (let step = 0; step < 150; step++) {
      assert.notEqual(state.execution, ScriptState.ABORTED, `${name}: VM aborted`);
      if (state.execution === ScriptState.FINISHED) {
        assert.equal(choice, (fixture.choices ?? []).length);
        const textMessages = packets.filter(packet => packet instanceof IfSetText || packet instanceof MessageGame)
          .map(packet => ({ type: packet.constructor.name, text: normalize(packet.text ?? packet.msg) }))
          .filter(message => Boolean(message.text));
        return {
          before, vars: player.vars.slice(), inv: items(player, 'inv'), worn: items(player, 'worn'), xp: player.stats.slice(),
          tile: [player.level, player.x, player.z], npcs: npcs.map(npc => [npc.type, npc.level, npc.x, npc.z]),
          text: textMessages.map(message => message.text), textMessages
        };
      }
      if (state.execution === ScriptState.SUSPENDED) {
        World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
        player.delayed = false; player.executeScript(state, true, true); continue;
      }
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${name}: real dialogue pause`);
      const menu = Component.get(player.modalChat)?.comName;
      if (/^multi[2-5]$/.test(menu)) {
        const index = fixture.choices?.[choice++]; assert(index >= 1 && index <= +menu.slice(5));
        const component = Component.getId(`${menu}:com_${index}`);
        assert(player.resumeButtons.includes(component)); player.lastCom = component;
        assert(pause.handle(new ResumePauseButton(component), player));
      } else assert(pause.handle(new ResumePauseButton(0), player));
    }
    assert.fail(`${name}: exceeded 150 production resumes`);
  } finally {
    for (const npc of npcs) World.gameMap.getZone(npc.x, npc.z, npc.level).leave(npc);
  }
}
function unchanged(result, allowed = []) {
  const ids = new Set(allowed.map(name => VarPlayerType.getId(name)));
  for (let id = 0; id < result.vars.length; id++) if (!ids.has(id)) assert.equal(result.vars[id], result.before.vars[id], `unrelated varp ${id}`);
  assert.deepEqual(result.worn, result.before.worn, 'equipment unchanged');
  assert.deepEqual(result.xp, result.before.xp, 'no XP transfer');
}
function count(result, key) {
  const id = ObjType.getId(key); assert(id >= 0, key);
  return result.inv.filter(item => item?.id === id).reduce((sum, item) => sum + item.count, 0);
}
// Fishing Contest transcript: 5 coins, same assignment as conversational entry.
for (const coins of [0, 4, 5, 19]) for (const garlic of [0, 1]) for (const paid of [0, 1]) {
  const fixture = { vars: { fishingcompo: 1, hemenster_comp_stage: paid, hemenster_pipe_stashed: garlic }, inventory: { coins }, nearby: ['sinister_stranger'] };
  const direct = run('bonzo', 3, fixture);
  const talk = run('bonzo', 1, { ...fixture, choices: paid ? [] : [1] });
  for (const key of ['vars', 'inv', 'worn', 'xp', 'tile', 'npcs']) assert.deepEqual(direct[key], talk[key], `Pay/Talk exact native ${key}: ${JSON.stringify(fixture)}`);
  unchanged(direct, ['fishingcompo', 'hemenster_comp_stage']);
  const entered = paid || coins >= 5;
  assert.equal(count(direct, 'coins'), Math.max(0, coins - (!paid && entered ? 5 : 0)), 'exact one fee');
  assert.equal(direct.vars[VarPlayerType.getId('fishingcompo')], entered ? garlic ? 3 : 2 : 1);
  assert.equal(direct.vars[VarPlayerType.getId('hemenster_comp_stage')], entered ? 1 : 0);
  if (!paid && entered) assert(direct.text.join(' ').includes('You pay Bonzo 5 coins to enter the competition.'));
}
for (const stage of [2, 3, 4, 5]) {
  const result = run('bonzo', 3, { vars: { fishingcompo: stage, hemenster_comp_stage: 1 }, inventory: { coins: 19 } });
  unchanged(result); assert.deepEqual(result.inv, result.before.inv, 'no repeat fee or reward');
  const expected = stage < 4 ? "You've already paid, you don't need to pay me again!" : "You've already won the Fishing Competition and don't need to enter again.";
  assert(result.text.join(' ').includes(expected));
  if (stage >= 4) {
    assert.deepEqual(result.textMessages.filter(message => message.text === expected), [
      { type: 'MessageGame', text: expected }
    ], 'won/completed submits the native game message rather than dialogue text');
    assert.deepEqual(result.tile, result.before.tile, 'won/completed position unchanged');
    assert.deepEqual(result.npcs, result.before.npcs, 'won/completed NPC state unchanged');
  }
}
// Ali the Camel transcript. Seeds only drive the engine's actual JavaRandom.
const camelLines = [
  ['That beast would probably bite my fingers off if I tried to pet it.', "If you want me to bite your fingers off, you're going the right way about it!"],
  ["I'm not going to pet that! It will probably bite my hand off, that filthy beast.", "Watch who you're calling a filthy beast, human."],
  ["Mmmm... you'd make a tasty kebab.", "And you'd make an excellent spit bucket! Pchoo!"],
  ["I'm not going to pet that nasty creature! I might get fleas... or worse!", "You're fairly nasty yourself, human. When was the last time you took a shower?"]
];
const seen = new Set();
for (let index = 0; index < 32; index++) for (const placement of [0, 1]) for (const equipment of ['none', 'carried', 'worn']) {
  const result = run('feud_camel', 3, { seed: index * 104729, placement, inventory: equipment === 'carried' ? { camulet: 1 } : {}, worn: equipment === 'worn' ? ['camulet'] : [] });
  unchanged(result); assert.deepEqual(result.inv, result.before.inv, 'flavour transfers no items');
  const text = result.text.join(' ');
  const pair = camelLines.find(lines => text.includes(lines[0])); assert(pair, 'exact sourced provocation'); seen.add(pair[0]);
  for (const [, reply] of camelLines) assert.equal(text.includes(reply), equipment === 'worn' && pair[1] === reply, 'only equipped camulet enables matching answer');
}
assert.equal(seen.size, 4, 'all four sourced reactions exercised');
// Plague cow transcript: the Pet option is ordinary flavour on all original forms.
const cowLines = [
  "Awww, look at the poor sick cow. We'd never make a burger out of you.",
  "Don't worry cow, I'm sure somebody will find a cure for this plague soon."
];
const cowSeen = new Set();
for (const name of ['ics_little_plague_cow1', 'ics_little_plague_cow2', 'ics_little_plague_cow3']) {
  for (let index = 0; index < 32; index++) for (const stage of [0, 1]) {
    const result = run(name, 1, { seed: index * 104729, vars: { main_ics_var: stage }, inventory: { coins: 19 } });
    unchanged(result); assert.deepEqual(result.inv, result.before.inv, 'cow flavour transfers no items');
    const line = cowLines.find(line => result.text.join(' ').includes(line)); assert(line, 'exact sourced cow response');
    assert.equal(cowLines.filter(line => result.text.join(' ').includes(line)).length, 1, 'one random response');
    cowSeen.add(line);
  }
}
assert.equal(cowSeen.size, 2, 'both sourced cow responses exercised');
// CANDIDATE item-page property, loaded from the compiled server object config.
assert.equal(ObjType.getByName('leaflet_dropper_flyer').tradeable, false, 'flyer is not tradeable');
// Direct Take-flyer transcript: one free held copy, no bank-wide claim flag.
for (const [inventory, bank, expected, line] of [
  [{ coins: 19 }, {}, 1, 'Here! Take one and let me get back to work.'],
  [{ leaflet_dropper_flyer: 1, coins: 19 }, {}, 1, 'You already have a flyer!'],
  [{ hammer: 28 }, {}, 0, "I'd give you a flyer but it looks like your hands are full."],
  [{ coins: 19 }, { leaflet_dropper_flyer: 1 }, 1, 'Here! Take one and let me get back to work.']
]) {
  const result = run('ali_leaflet_dropper', 3, { inventory, bank });
  unchanged(result); assert.equal(count(result, 'leaflet_dropper_flyer'), expected);
  assert.equal(count(result, 'coins'), inventory.coins ?? 0, 'handout is free');
  assert(result.text.join(' ').includes(line), 'source-backed grant/refusal wording');
  const expectedItems = result.before.inv.filter(Boolean);
  if (!inventory.leaflet_dropper_flyer && expected) expectedItems.push({ id: ObjType.getId('leaflet_dropper_flyer'), count: 1 });
  assert.deepEqual(result.inv.filter(Boolean).sort((a, b) => a.id - b.id), expectedItems.sort((a, b) => a.id - b.id), 'only the sourced flyer transfer');
}
const handout = run('ali_leaflet_dropper', 3, { inventory: { coins: 19 } });
assert(handout.text.join(' ').includes('Here! Take one and let me get back to work. I still have hundreds of these flyers to hand out, I wonder if Ali would notice if I quietly dumped them somewhere?'),
  'direct Take-flyer preserves its own transcript, not the different Old School Talk-to branch');
const read = run('ali_leaflet_dropper', 3, { readItem: 'leaflet_dropper_flyer', inventory: { leaflet_dropper_flyer: 1 } });
unchanged(read); assert.deepEqual(read.inv, read.before.inv, 'Read preserves the flyer');
assert(read.text.join(' ').includes('Come to the Al Kharid Market place! High quality produce at low, low prices! Show this flyer to a merchant for money off your next purchase, courtesy of Ali Morrisane!'));
assert(read.text.join(' ').includes('You notice that the money off voucher is out of date.'));
// The headed cell reads these checked-out offsets and the slot's own map placements.
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
World.gameMap.init();
for (const fixture of JSON.parse(fs.readFileSync(path.join(content, 'tests/npc-other-options/approaches.json'), 'utf8'))) {
  const type = NpcType.getByName(fixture.npc), tile = placements.get(type.id)?.[0];
  const x = tile.x + fixture.offset[0], z = tile.z + fixture.offset[1];
  assert(!map.isMapBlocked(x, z, tile.level), `${fixture.npc}: headed approach is not packed floor/loc blocked`);
  assert(map.reachedEntity(tile.level, x, z, tile.x, tile.z, type.size, type.size, 1), `${fixture.npc}: headed approach can operate its naturally placed NPC`);
  console.log(`APPROACH ${fixture.npc} ${tile.level},${x},${z}`);
}
console.log('PASS npc-other-options: Bonzo Pay/Talk native equivalence and repeat gates; both camel placements/four reactions/camulet; all cow forms/two reactions; flyer handout, capacity, held limit and Read');
// World imports create workers; this offline test starts no network listener.
process.exit(0);
