import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = file => import(pathToFileURL(path.join(engine, file)).href);
const rt = await runtime(engine, pack);
const { World, Provider, State, Pointer, configs, id, param } = rt;
const { NpcType, ObjType, InvType, VarPlayerType, VarNpcType, SeqType, SpotanimType, HuntType } = configs;
const [{ default: Runner }, { default: Trigger }, { default: Player }, { default: Npc }, { default: JavaRandom }, { EntityLifeCycle }, { PlayerStat }, { NpcStat }, { NpcModeMap }, map] = await Promise.all([
  load('src/engine/script/ScriptRunner.ts'), load('src/engine/script/ServerTriggerType.ts'),
  load('src/engine/entity/Player.ts'), load('src/engine/entity/Npc.ts'), load('src/util/JavaRandom.ts'),
  load('src/engine/entity/EntityLifeCycle.ts'), load('src/engine/entity/PlayerStat.ts'),
  load('src/engine/entity/NpcStat.ts'), load('src/engine/entity/NpcMode.ts'), load('src/engine/GameMap.ts')
]);
const { default: Environment } = await load('src/util/Environment.ts');
const type = NpcType.getByName('chaoselemental');
assert(type, 'original Chaos Elemental type');
const pv = name => id(VarPlayerType, name), nv = name => id(VarNpcType, name);
const invId = id(InvType, 'inv'), wornId = id(InvType, 'worn');
let serial = 0;
const checks = { config: 0, primary: 0, specials: 0, teleport: 0, loot: 0, lifecycle: 0 };
World.currentTick = 1000;
function fixture(position = { x: 3200, z: 3200, level: 0 }, distance = 5) {
  const hash = BigInt(60000 + ++serial);
  const player = new Player(`elemental${serial}`, hash, hash);
  player.slot = 1; player.pid = 1; player.uid = ((Number(hash & 0x1fffffn) << 11) | 1) >>> 0;
  player.x = position.x; player.z = position.z; player.level = position.level; player.isActive = true;
  player.vars.fill(0); player.baseLevels.fill(99); player.levels.fill(99);
  player.getInventory(invId); player.getInventory(wornId);
  player.write = () => {}; player.messageGame = () => {}; player.wrappedMessageGame = () => {};
  World.players[1] = player; World.playerLoop.add(hash, player);
  World.gameMap.getZone(player.x, player.z, player.level).enter(player);
  const npc = new Npc(player.level, player.x + distance, player.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1); World.processNpcEventQueue(); npc.lastMovement = -100;
  npc.setVar(nv('npc_aggressive_player'), player.uid);
  return { player, npc };
}
function dispose({ player, npc }) {
  if (npc.isActive) World.removeNpc(npc, -1);
  if (World.npcs.get(npc.nid) === npc) { World.npcs.remove(npc.nid); npc.cleanup(); }
  World.gameMap.getZone(player.x, player.z, player.level).leave(player);
  if (World.players[player.slot] === player) World.players[player.slot] = null;
  player.unlink();
}
function random(draws, action) {
  let cursor = 0;
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => { assert(cursor < draws.length, 'explicit native RNG stream'); return draws[cursor++]; };
  try { return action(); } finally { JavaRandom.nextDouble = original; }
}
function run(name, f, args = [], playerFirst = false) {
  const script = typeof name === 'string' ? Provider.getByName(name) : name;
  assert(script, `native packed ${name}`);
  const state = Runner.init(script, playerFirst ? f.player : f.npc, playerFirst ? f.npc : f.player, args);
  state.pointerAdd(Pointer.ProtectedActivePlayer);
  if (playerFirst) f.player.executeScript(state, true, true); else f.npc.executeScript(state);
  assert.equal(state.execution, State.FINISHED, `${script.name} finishes without a VM error`);
  return state;
}
function dispatch(kind) {
  const script = Provider.getByTrigger(Trigger[kind], type.id, type.category);
  assert(script, `visible Chaos Elemental ${kind} dispatch`); return script;
}
function settle(f, ticks = 12) {
  for (let i = 0; i < ticks; i++) { World.currentTick++; f.player.processQueues(); }
  assert(!f.player.queue.all().some(row => /chaoselemental_|combat_damage_player/.test(row.script.name)), 'all owned impact queues settle');
}
function observe(target, method, records) {
  const original = target[method], own = Object.hasOwn(target, method);
  target[method] = function (...args) { records.push(args); return original.apply(this, args); };
  return () => { if (own) target[method] = original; else delete target[method]; };
}
function same(a, b, message) { assert.deepEqual(a, b, message); checks.config++; }
same(type.id, 3200, 'original 377 identity');
same(type.size, 3, 'original footprint');
same(type.vislevel, 305, 'original visible level');
same(type.name, 'Chaos Elemental', 'original name');
same(type.desc, 'pUre A cHaOs of crEatuRe!', 'original examine');
same(type.op[1], 'Attack', 'original player Attack option');
same(type.readyanim, id(SeqType, 'chaoselemental_ready'), 'original ready animation');
same(type.walkanim, id(SeqType, 'chaoselemental_walk'), 'original walking animation');
same(type.stats[NpcStat.HITPOINTS], 350, '350 period hitpoints');
for (const stat of ['ATTACK', 'STRENGTH', 'DEFENCE', 'MAGIC', 'RANGED']) same(type.stats[NpcStat[stat]], 270, `${stat} engineering vector`);
same(param(type, 'attackrate'), 5, 'five-tick attack cadence');
same(param(type, 'death_anim'), id(SeqType, 'chaoselemental_death'), 'own-family death');
same(type.huntmode, id(HuntType, 'aggressive_ranged'), 'native ranged aggression');
same(type.attackrange, 10, 'distance attack route');
const attack = dispatch('AI_APPLAYER2');
assert.equal(attack.name, '[ai_applayer2,chaoselemental]');
assert.equal(dispatch('AI_QUEUE3').name, '[ai_queue3,chaoselemental]');

// The primary uses the same projectile at every distance and resolves all three
// native accuracy/protection styles. Wrong prayers must not block the other styles.
for (const [style, prayer] of ['prayer14', 'prayer13', 'prayer12'].entries()) {
  for (const protection of [null, prayer, ['prayer13', 'prayer12', 'prayer14'][style]]) {
    for (const magnitude of [0, 0.5, 0.999999]) {
      const f = fixture(), projectiles = [];
      const restore = observe(World, 'mapProjAnim', projectiles);
      try {
        if (protection) f.player.setVar(pv(protection), 1);
        for (const name of ['com_crushdef', 'com_rangedef', 'com_magicdef']) f.player.setVar(pv(name), 0);
        const before = f.player.levels[PlayerStat.HITPOINTS];
        random([0, (style + 0.5) / 3, 0.999999, 0, magnitude], () => run(attack, f));
        same(projectiles.length, 1, 'one primary projectile');
        same(projectiles[0][6], id(SpotanimType, 'chaoselemental_spotanim_discord_travel'), 'discord is the primary projectile');
        same(f.npc.getVar(nv('npc_action_delay')), World.currentTick + 5, 'one attack cooldown');
        settle(f);
        same(before - f.player.levels[PlayerStat.HITPOINTS], protection === prayer ? 0 : Math.floor(magnitude * 36), 'matching prayer blocks; damage stays within the engineering cap 0..35');
        checks.primary++;
      } finally { restore(); dispose(f); }
    }
  }
}
for (const variant of ['cooldown', 'dead-player']) {
  const f = fixture(), projectiles = [];
  const restore = observe(World, 'mapProjAnim', projectiles);
  try {
    if (variant === 'cooldown') f.npc.setVar(nv('npc_action_delay'), World.currentTick + 1);
    else { f.player.setVar(pv('death'), 1); f.player.levels[PlayerStat.HITPOINTS] = 0; }
    random([], () => run(attack, f));
    same(projectiles.length, 0, `${variant} cannot fire`);
  } finally { restore(); dispose(f); }
}

// Disarm tests include sparse worn slots, ammunition stacks, and a completely
// full pack that could otherwise accept a stack. Full inventory is counterplay.
for (const full of [false, true]) {
  for (const [slot, name, amount] of [[3, 'dragon_2h_sword', 1], [13, 'bronze_arrow', 100]]) {
    const f = fixture(), inv = f.player.getInventory(invId), worn = f.player.getInventory(wornId);
    try {
      worn.set(slot, { id: id(ObjType, name), count: amount });
      if (full) for (let i = 0; i < 28; i++) inv.set(i, { id: id(ObjType, i === 0 && slot === 13 ? name : 'shark'), count: 1 });
      const before = inv.getItemCount(id(ObjType, name)) + worn.getItemCount(id(ObjType, name));
      const drops = [], restore = observe(World, 'addObj', drops);
      try { random([0], () => run('[queue,chaoselemental_disarm]', f, [], true)); }
      finally { restore(); }
      same(inv.getItemCount(id(ObjType, name)) + worn.getItemCount(id(ObjType, name)), before, 'disarm conserves every item');
      same(worn.getItemCount(id(ObjType, name)), full ? amount : 0, 'only a free inventory slot permits disarm');
      same(drops.length, 0, 'disarm never creates ground loot');
      if (!full) {
        assert(f.player.masks > 0, 'equipment appearance update is marked');
        const before = [...f.player.vars];
        run('[proc,player_combat_stat]', f, [], true);
        same([...f.player.vars], before, 'disarm already rebuilt combat bonuses');
      }
      checks.specials++;
    } finally { dispose(f); }
  }
}
{
  const f = fixture();
  try { random([], () => run('[queue,chaoselemental_disarm]', f, [], true)); checks.specials++; }
  finally { dispose(f); }
}

// Real packed wilderness geometry, without clearing or replacing collision.
World.gameMap.init(); World.processNpcEventQueue();
const natural = [...World.npcs].filter(npc => npc.isActive && npc.type === type.id);
same(natural.length, 1, 'one unchanged map spawn');
const boss = natural[0];
same([boss.level, boss.x, boss.z], [0, 3261, 3927], 'spawn west of Rogues Castle, wilderness 51');
assert(World.gameMap.isMulti((boss.level << 28) | (boss.x << 14) | boss.z), 'natural boss is in multiway Wilderness');
{
  const f = fixture({ x: 3256, z: 3927, level: 0 }, -30), projectiles = [];
  const restore = observe(World, 'mapProjAnim', projectiles);
  try {
    const hunt = HuntType.get(type.huntmode);
    boss.huntTarget = null; boss.huntClock = hunt.rate; boss.huntAll(hunt);
    same(boss.huntTarget, f.player, 'natural boss acquires an approaching player');
    boss.setVar(nv('npc_aggressive_player'), f.player.uid);
    boss.enqueueScript(Trigger.AI_QUEUE1);
    random(Array.from({ length: 256 }, (_, i) => [0, 0.5, 0.999999, 0, 0.999999][i % 5]), () => {
      for (let tick = 0; tick < 20 && !projectiles.length; tick++) { World.currentTick++; boss.turn(); }
    });
    assert(projectiles.length > 0, 'native retaliation/approach route fires at range');
    same(boss.target, f.player, 'native approach keeps the actual target');
    same(boss.targetOp, NpcModeMap.get('APPLAYER2'), 'native ranged approach mode');
    settle({ player: f.player, npc: boss });
  } finally { restore(); dispose(f); }
}
const origins = [[3256, 3927], [3260, 3931], [3265, 3925]];
for (const [x, z] of origins) {
  assert(!map.isMapBlocked(x, z, 0), 'independent open origin next to the natural boss');
  const f = fixture({ x, z, level: 0 }, -30);
  try {
    const original = Math.random;
    for (let sample = 0; sample < 100; sample++) {
      f.player.x = x; f.player.z = z; f.player.tele = false;
      Math.random = () => (sample + 0.5) / 100;
      try { run('[queue,chaoselemental_teleport]', f, [], true); } finally { Math.random = original; }
      const p = f.player, distance = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
      assert(distance >= 5 && distance <= 10, 'teleport moves to the local 5..10 tile ring');
      same(p.level, 0, 'teleport preserves plane');
      assert(!map.isMapBlocked(p.x, p.z, p.level), 'every sampled destination is standable');
      const route = map.findPath(0, p.x, p.z, x, z);
      assert(route.length > 0, 'non-empty packed-map escape route returns toward original open ground');
      same(p.levels[PlayerStat.HITPOINTS], 99, 'teleport does not damage player');
      same(p.isActive, true, 'teleport does not disconnect player');
      checks.teleport++;
    }
  } finally { dispose(f); }
}

// Both specials are reachable from the native attack trigger, take one cooldown,
// and settle at projectile impact rather than immediately.
for (const [roll, queueName, projectile] of [[0.85, 'chaoselemental_teleport', 'confusion'], [0.95, 'chaoselemental_disarm', 'madness']]) {
  const f = fixture({ x: 3256, z: 3927, level: 0 }), shots = [];
  const restore = observe(World, 'mapProjAnim', shots);
  try {
    f.player.getInventory(wornId).set(3, { id: id(ObjType, 'bronze_sword'), count: 1 });
    random([roll], () => run(attack, f));
    same(shots.length, 1, 'special sends exactly one projectile');
    same(shots[0][6], id(SpotanimType, `chaoselemental_spotanim_${projectile}_travel`), 'special has its own 377 projectile');
    assert(f.player.queue.all().some(row => row.script.name === `[queue,${queueName}]`), 'native projectile schedules special impact');
    same(f.player.getInventory(wornId).getItemCount(id(ObjType, 'bronze_sword')), 1, 'no immediate disarm before projectile arrives');
    settle(f); checks.specials++;
  } finally { restore(); dispose(f); }
}

// Independent retained-table oracle: exhaust both roll spaces, all quantity
// endpoints and every original-cache herb. No unconditional bones are assumed.
const mainLoot = [
  ['dragon_2h_sword', 1], ['rune_javelin', 5], ['rune_2h_sword', 1],
  ['rune_spear', 1], ['rune_sq_shield', 1], ['dragon_med_helm', 1],
  ['uncut_sapphire', 1], ['uncut_emerald', 1], ['uncut_ruby', 1], ['uncut_diamond', 1],
  ['keyhalf1', 1], ['keyhalf2', 1], ['dragonshield_a', 1]
];
const secondaryLoot = [
  ['coins', 100, 3000], ['mithril_dart', 400], ['airrune', 500], ['deathrune', 30, 40],
  ['big_bones', 2, 3], ['iron_arrow', 200, 500], ['macro_triffidfruit', 1, 2],
  ['babydragon_bones', 2, 3], ['bloodrune', 40, 50], ['chaosrune', 100],
  ['1dose1attack', 1], ['weapon_poison', 1], ['bat_bones', 2, 5], ['plain_pizza', 3],
  ['4doseantipoison', 1], ['1dose1defense', 1], ['tuna', 5], ['herb', 1, 3],
  ['rune_arrow', 200], ['mithril_arrow', 400], ['bones', 3], ['wolf_bones', 5],
  ['dragon_bones', 1, 2], ['meat_pizza', 3], ['1dose1strength', 1], ['1dose2defense', 1]
];
const herbWeights = [
  ['unidentified_guam', 32], ['unidentified_marentill', 24], ['unidentified_tarromin', 18],
  ['unidentified_harralander', 14], ['unidentified_ranarr', 11], ['unidentified_irit', 8],
  ['unidentified_avantoe', 6], ['unidentified_kwuarm', 5], ['unidentified_cadantine', 4],
  ['unidentified_lantadyme', 3], ['unidentified_dwarf_weed', 3]
];
const herbs = herbWeights.map(([name]) => name);
const herbSlots = herbWeights.flatMap(([name, count]) => Array(count).fill(name));
assert.equal(herbSlots.length, 128, 'native shared herb roll space');
const originalObjects = new Map(readFileSync(path.join(content, 'pack/obj.pack'), 'utf8').trim().split(/\r?\n/).map(line => {
  const separator = line.indexOf('=');
  return [line.slice(separator + 1), Number(line.slice(0, separator))];
}));
for (const name of new Set([...mainLoot, ...secondaryLoot].map(row => row[0]).filter(name => name !== 'herb').concat(herbs))) {
  assert(originalObjects.has(name), `${name} exists in the original 377 object pack`);
  same(id(ObjType, name), originalObjects.get(name), `${name} retains its original cache identity`);
}
function deathLoot(main, secondary, magnitude = 0, hero = true, herbRoll = magnitude) {
  const f = fixture(), drops = [];
  const restore = observe(World, 'addObj', drops);
  try {
    if (hero) f.npc.heroPoints.addHero(f.player.hash64, 350);
    const tail = secondary === 17 ? [herbRoll, magnitude] : [magnitude];
    random(hero ? [(main + 0.5) / 128, (secondary + 0.5) / 32, ...tail] : [], () => {
      const state = Runner.init(dispatch('AI_QUEUE3'), f.npc, f.player);
      let pauses = 0;
      do { f.npc.executeScript(state); } while (state.execution === State.NPC_SUSPENDED && ++pauses < 20);
      assert.equal(state.execution, State.FINISHED, 'native death/drop trigger completes');
    });
    for (const [object, receiver, duration] of drops) {
      same(receiver, f.player.hash64, 'every rolled object has native hero ownership');
      same(object.receiver64, f.player.hash64, 'ground object stores the same private receiver');
      same(duration, 200, 'normal loot lifetime');
    }
    checks.loot++;
    const totals = new Map();
    for (const [object] of drops) totals.set(object.type, (totals.get(object.type) ?? 0) + object.count);
    return [...totals];
  } finally {
    restore();
    for (const [object] of drops) if (object.isActive) World.removeObj(object, -1);
    dispose(f);
  }
}
const expectedLoot = (row, magnitude, herbRoll = magnitude) => {
  if (!row) return [];
  const [name, low, high = low] = row;
  const object = name === 'herb' ? herbSlots[Math.floor(herbRoll * 128)] : name;
  return [[id(ObjType, object), low + Math.floor(magnitude * (high - low + 1))]];
};
for (let roll = 0; roll < 128; roll++) {
  same(deathLoot(roll, 31), expectedLoot(mainLoot[roll], 0), `main roll ${roll}, including explicit empty outcomes`);
}
for (let roll = 0; roll < 32; roll++) {
  for (const magnitude of [0, 0.999999]) {
    same(deathLoot(127, roll, magnitude), expectedLoot(secondaryLoot[roll], magnitude), `secondary roll ${roll}, quantity endpoint ${magnitude}`);
  }
}
for (let herb = 0; herb < 128; herb++) {
  const herbRoll = (herb + 0.5) / 128;
  for (const magnitude of [0, 0.999999]) {
    same(deathLoot(127, 17, magnitude, true, herbRoll), expectedLoot(secondaryLoot[17], magnitude, herbRoll), `native herb slot ${herb}, quantity endpoint ${magnitude}`);
  }
}
const members = Environment.NODE_MEMBERS;
try {
  Environment.NODE_MEMBERS = false;
  same(deathLoot(127, 17), [[id(ObjType, 'coins'), 10]], 'native non-members herb fallback preserves coins and its count');
} finally { Environment.NODE_MEMBERS = members; }
same(deathLoot(0, 0), [...expectedLoot(mainLoot[0], 0), ...expectedLoot(secondaryLoot[0], 0)], 'independent main and secondary rolls can both pay');
same(deathLoot(0, 0, 0, false), [], 'no hero means no loot and no loot RNG');

// The naturally placed NPC is killed twice through the real AI damage/death
// queue. Hero attribution, lifecycle and fully restored health are native.
const f = fixture({ x: 3256, z: 3927, level: 0 }, -30);
const originalAdd = World.addObj, drops = [];
World.addObj = function (object, receiver, duration) { drops.push({ object, receiver, duration }); return originalAdd.call(this, object, receiver, duration); };
try {
  for (let kill = 0; kill < 2; kill++) {
    const before = drops.length;
    boss.heroPoints.addHero(f.player.hash64, boss.levels[NpcStat.HITPOINTS]);
    boss.enqueueScript(Trigger.AI_QUEUE2, 0, boss.levels[NpcStat.HITPOINTS]);
    random(Array(128).fill(0), () => {
      for (let tick = 0; tick < 15 && boss.isActive; tick++) { World.currentTick++; boss.turn(); World.processNpcEventQueue(); }
    });
    same(boss.isActive, false, 'real damage/death queue removes the natural boss');
    const selected = drops.slice(before);
    assert(selected.length > 0, 'death produces era loot');
    assert(selected.every(drop => drop.receiver === f.player.hash64), 'every loot item belongs to the native hero');
    same(boss.lifecycle, EntityLifeCycle.RESPAWN, 'natural respawn lifecycle');
    const ticks = World.scaleByPlayerCount(type.respawnrate);
    for (let tick = 0; tick < ticks + 1 && !boss.isActive; tick++) { World.currentTick++; boss.turn(); World.processNpcEventQueue(); }
    same(boss.isActive, true, 'natural boss respawns');
    same([boss.x, boss.z, boss.type, boss.levels[NpcStat.HITPOINTS]], [3261, 3927, type.id, 350], 'respawn restores home, identity and period health');
    same([...boss.queue.all()].length, 0, 'no unit-owned timer/queue leaks into next fight');
    checks.lifecycle++;
  }
} finally {
  World.addObj = originalAdd;
  for (const { object } of drops) if (object.isActive) World.removeObj(object, -1);
  dispose(f);
}
console.log(JSON.stringify({ result: 'PASS', suite: 'chaos-elemental', checks }));
process.exit(0);
