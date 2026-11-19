// Packed Tindel dispatch, native inventory settlement and One Small Favour controls.
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
const PauseHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const Pause = await load('network/game/client/model/ResumePauseButton.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
const cfg = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'NpcType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType']) {
  cfg[name] = await load(`cache/config/${name}.ts`); cfg[name].load('data/pack');
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load('data/pack') > 0);
const { NpcType, ObjType, InvType, VarPlayerType, Component } = cfg;
const inv = InvType.getId('inv'), quest = VarPlayerType.getId('onesmallfavour');
const id = key => { const value = ObjType.getId(key); assert(value >= 0, key); return value; };
const normalize = text => text.replace(/<[^>]*>/g, '').replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
const pause = new PauseHandler();
const type = NpcType.getByName('tindel_marchant');
assert.equal(type.id, 1799, 'original cache NPC identity');
assert.equal(type.op[2], 'Sword give', 'pre-2007 exact cache option');
const map = fs.readFileSync(path.join(content, 'maps/m41_49.jm2'), 'utf8');
assert(map.includes(`0 54 17: ${type.id}`), 'original natural map placement');
const inventory = player => player.getInventory(inv).items.map(item => item ? { id: item.id, count: item.count } : null);
const totals = items => Object.fromEntries([...new Set(items.filter(Boolean).map(item => item.id))].map(key => [ObjType.get(key).debugname, items.filter(item => item?.id === key).reduce((sum, item) => sum + item.count, 0)]));
function run(trigger, fixture = {}) {
  World.currentTick = 100;
  const player = new Player('tindeltest', 1n, 0n);
  player.pid = 1; player.uid = 1; player.vars.fill(0); player.levels.fill(99); player.baseLevels.fill(99);
  player.x = 2678; player.z = 3152; player.buildArea.originX = 2646; player.buildArea.originZ = 3120;
  player.setVar(quest, fixture.stage ?? 0);
  for (const [key, count] of Object.entries(fixture.items ?? {})) player.invAdd(inv, id(key), count);
  if (fixture.full) while (player.getInventory(inv).freeSlotCount > 0) player.invAdd(inv, id('bucket_empty'), 1);
  const npc = new Npc(0, 2678, 3153, type.size, type.size, EntityLifeCycle.RESPAWN, 1, type.id, BlockWalk.NONE);
  npc.isActive = true; npc.lastMovement = -100;
  World.gameMap.getZone(npc.x, npc.z, npc.level).enter(npc);
  player.target = npc; player.targetOp = Trigger[trigger] - 7;
  if (trigger === 'OPNPCU') { player.lastUseItem = id(fixture.used ?? 'digsitesword'); player.lastUseSlot = 0; }
  const script = player.getOpTrigger();
  assert(script, `native ${trigger} dispatch`);
  assert.equal(script.name, `[${trigger.toLowerCase()},tindel_marchant]`);
  const packets = [], frames = [], choices = [];
  player.write = packet => packets.push(packet);
  const before = { vars: [...player.vars], inv: inventory(player), xp: [...player.stats] };
  JavaRandom.setSeed(fixture.seed ?? 1);
  const state = ScriptRunner.init(script, player, npc);
  player.executeScript(state, true);
  try {
    for (let step = 0; step < 150; step++) {
      assert.notEqual(state.execution, ScriptState.ABORTED, 'VM does not abort');
      frames.push(totals(inventory(player)));
      if (state.execution === ScriptState.FINISHED) return { before, vars: [...player.vars], inv: inventory(player), xp: [...player.stats], text: packets.filter(packet => packet instanceof IfSetText || packet instanceof MessageGame).map(packet => normalize(packet.text ?? packet.msg)).filter(Boolean), frames, choices };
      if (state.execution === ScriptState.SUSPENDED) { World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil); player.delayed = false; player.executeScript(state, true, true); continue; }
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'only native dialogue suspension');
      const menu = Component.get(player.modalChat)?.comName;
      if (/^multi[2-5]$/.test(menu)) {
        const choice = fixture.choices?.[choices.length] ?? (trigger === 'OPNPC3' ? 4 : 1);
        choices.push(choice);
        const component = Component.getId(`${menu}:com_${choice}`);
        assert(player.resumeButtons.includes(component), `valid menu choice ${choice}`);
        player.lastCom = component; assert(pause.handle(new Pause(component), player));
      } else assert(pause.handle(new Pause(0), player));
    }
    assert.fail('Tindel exceeds 150 production resumes');
  } finally { World.gameMap.getZone(npc.x, npc.z, npc.level).leave(npc); }
}
const questResults = [];
for (let stage = 18; stage <= 100; stage++) for (let mask = 0; mask < 8; mask++) for (const choice of [1, 2]) {
  const items = { coins: 1000 };
  for (const [bit, item] of ['favour_matress_stodgy', 'favour_matress_comfy', 'favour_iron_oxide'].entries()) if (mask & (1 << bit)) items[item] = 1;
  const result = run('OPNPC1', { stage, items, choices: [choice] });
  questResults.push({ stage, mask, choice, vars: result.vars, inv: result.inv, text: result.text, choices: result.choices });
  const after = result.vars[quest];
  assert([stage, ...(stage === 18 ? [19] : []), ...(stage === 23 && (mask & 2) && choice === 1 ? [24] : [])].includes(after), 'only existing quest transitions');
}
if (process.argv.includes('--quest-only')) {
  console.log(JSON.stringify(questResults)); process.exit(0);
}
assert.equal(ObjType.get(id('digsitesword')).stackable, false, 'rusty sword frees a slot on consumption');
const outcomes = [
  ['iron_sword', 20], ['iron_longsword', 37], ['bronze_sword', 17], ['bronze_longsword', 7],
  ['steel_sword', 6], ['steel_longsword', 4], ['mithril_sword', 1], ['mithril_longsword', 1],
  ['black_sword', 3], ['black_longsword', 2], ['antique', 1], ['nothing', 1]
];
const outcomeNames = new Set(outcomes.map(([key]) => key));
const count = (result, name) => totals(result.inv)[name] ?? 0;
function unchanged(result) { assert.deepEqual(result.vars, result.before.vars, 'all saved state unchanged'); assert.deepEqual(result.xp, result.before.xp, 'no player XP awarded'); }
function refusal(result, line) {
  unchanged(result); assert.deepEqual(result.inv, result.before.inv, 'refusal preserves every item'); assert(result.text.join(' ').includes(line), `${line}: ${JSON.stringify(result.text)}`);
}
for (const choices of [[1, 5], [2, 5], [3, 5], [5]]) {
  const result = run('OPNPC1', { items: { digsitesword: 2, coins: 1000 }, choices });
  assert.deepEqual(result.inv, result.before.inv, 'explanation and leaving do not charge');
  assert.deepEqual(result.vars, result.before.vars, 'explanation changes no saved state');
}
for (const trigger of ['OPNPC1', 'OPNPC3', 'OPNPCU']) {
  const choices = trigger === 'OPNPC1' ? [4] : [];
  refusal(run(trigger, { choices }), "Sorry my friend, but you don't seem to have any swords that need to be identified.");
  refusal(run(trigger, { items: { coins: 1000 }, choices, full: true }), "Sorry my friend, but you don't seem to have any swords that need to be identified.");
  for (const coins of [0, 99]) refusal(run(trigger, { items: { digsitesword: 1, coins }, choices }), "Sorry my friend, but you don't seem to have enough money to cover my fee!");
}
function outcome(result, { rusty = 2, coins = 1000 } = {}) {
  unchanged(result);
  assert.equal(count(result, 'digsitesword'), rusty - 1, 'exactly one rusty sword consumed');
  const received = Object.entries(totals(result.inv)).filter(([name]) => !['digsitesword', 'coins', 'bucket_empty'].includes(name));
  assert(received.length <= 1 && received.every(([, quantity]) => quantity === 1), 'at most one result sword');
  let key;
  if (received.length) { key = received[0][0]; assert.equal(count(result, 'coins'), coins - 100, 'fee exactly once'); }
  else if (count(result, 'coins') > coins - 100) { key = 'antique'; assert(count(result, 'coins') >= coins - 100 + 1500 && count(result, 'coins') <= coins - 100 + 1999, 'sourced antique bounds'); }
  else { key = 'nothing'; assert.equal(count(result, 'coins'), coins - 100, 'failure still charges fee'); }
  const text = result.text.join(' ');
  assert(text.includes('You hand Tindel 100 coins plus the rusty sword.'), 'sourced transfer wording');
  if (key === 'antique') {
    assert(text.includes("Wow! The item you gave me was a very rare antique...no real use...but hey, it's worth some money!"));
    assert(text.includes(`Tindel gives you ${count(result, 'coins') - coins + 100} coins.`));
    assert(text.includes("That's a fair price for the item! I'll add it to my collection!"));
  } else if (key === 'nothing') {
    assert(text.includes("Sorry my friend, but the item wasn't worth anything. I've disposed of it for you."));
  } else {
    const description = { iron_sword: 'an iron shortsword', iron_longsword: 'a long sword', bronze_sword: 'a bronze shortsword', bronze_longsword: 'a bronze long sword', steel_sword: 'a steel shortsword', steel_longsword: 'a steel long sword', mithril_sword: 'a mithril shortsword', mithril_longsword: 'a mithril long sword', black_sword: 'a black shortsword', black_longsword: 'a black longsword' }[key];
    assert(text.includes(`There you go my friend, it turned out to be ${description}.`));
    assert(text.includes(`Tindel gives you ${description}.`));
  }
  assert(outcomeNames.has(key), `only sourced outcome ${key}`);
  for (const frame of result.frames) {
    const before = (frame.digsitesword ?? 0) === rusty;
    assert(before ? (frame.coins ?? 0) === coins : (frame.digsitesword ?? 0) === rusty - 1, 'no suspension between input debits');
    if (before) assert(Object.keys(frame).every(name => ['digsitesword', 'coins', 'bucket_empty'].includes(name)), 'no result before payment');
    else assert.deepEqual(frame, totals(result.inv), 'complete transaction before next suspension');
  }
  return key;
}
const seeds = new Map(), frequencies = new Map(outcomes.map(([name]) => [name, 0]));
for (let seed = 0; seed < 10000; seed++) {
  const mixedSeed = seed * 9973 + 377;
  JavaRandom.setSeed(mixedSeed);
  const roll = Math.floor(JavaRandom.nextDouble() * 100);
  let cumulative = 0;
  const expected = outcomes.find(([, weight]) => (cumulative += weight) > roll)[0];
  const result = run('OPNPC3', { items: { digsitesword: 2, coins: 1000 }, seed: mixedSeed });
  const key = outcome(result); assert.equal(key, expected, `seed ${mixedSeed}: exact built weight interval`);
  frequencies.set(key, frequencies.get(key) + 1); if (!seeds.has(key)) seeds.set(key, mixedSeed);
}
assert.equal(seeds.size, outcomes.length, 'every sourced outcome reachable');
for (const [name, weight] of outcomes) assert(Math.abs(frequencies.get(name) - weight * 100) < 200, `seed sweep matches built ${name} weight ${weight}: ${frequencies.get(name)}`);
for (const trigger of ['OPNPC1', 'OPNPC3', 'OPNPCU']) for (const [key, seed] of seeds) {
  const fixture = { items: { digsitesword: 2, coins: 1000 }, seed, choices: trigger === 'OPNPC1' ? [4] : [] };
  assert.equal(outcome(run(trigger, fixture)), key, `${trigger} gives same seeded result`);
  assert.equal(outcome(run(trigger, { ...fixture, full: true })), key, 'full backpack replacement always fits freed rusty-sword slot');
  assert.equal(outcome(run(trigger, { ...fixture, items: { digsitesword: 1, coins: 100 } }), { rusty: 1, coins: 100 }), key, 'exact fee and last sword');
}
for (let stage = 0; stage <= 100; stage++) for (const trigger of ['OPNPC3', 'OPNPCU']) outcome(run(trigger, { stage, items: { digsitesword: 2, coins: 1000 } }));
const packedMap = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
World.gameMap.init();
const approach = JSON.parse(fs.readFileSync(path.join(content, 'tests/tindel-appraisal/approach.json'), 'utf8'));
const x = 2678 + approach.offset[0], z = 3153 + approach.offset[1];
assert(!packedMap.isMapBlocked(x, z, 0), 'headed approach is not floor/loc blocked');
assert(packedMap.reachedEntity(0, x, z, 2678, 3153, type.size, type.size, 1), 'headed approach reaches natural Tindel');
const startX = 2678 + approach.start_offset[0], startZ = 3153 + approach.start_offset[1];
assert(!packedMap.isMapBlocked(startX, startZ, 0), 'headed walk start is not floor/loc blocked');
assert(packedMap.isLineOfWalk(0, startX, startZ, x, z), 'headed native walk has a clear approach segment');
console.log(`APPROACH tindel_marchant 0,${x},${z}`);
console.log(`PASS tindel-appraisal: native Talk/Sword give/item use; no-sword/no-coins; 12 outcomes; 10000-seed odds; atomic single fee/sword; full backpack replacement; ${questResults.length} quest dialogue controls; frequencies=${JSON.stringify(Object.fromEntries(frequencies))}`);
process.exit(0);
