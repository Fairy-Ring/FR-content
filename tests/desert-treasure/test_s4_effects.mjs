#!/usr/bin/env node
/** Real packed Blood-hunt and shared dispatch regression. Run from the sibling engine. */
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
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const { NpcInfoSay } = await load('src/network/rsbuf/messages.ts');
const { Packet } = await load('src/network/rsbuf/packet.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'pack the sibling engine first');
const ScriptVarType = (await load('src/cache/config/ScriptVarType.ts')).default;
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: e => ['m55_53', 'l55_53'].includes(e.name) });
World.gameMap.loadPackedMapsquare({ m: maps.m55_53, l: maps.l55_53, n: new Uint8Array(), o: new Uint8Array() }, 55 * 64, 53 * 64);
const id = (kind, name) => { const value = types[kind].getId(name); assert(value >= 0, `packed ${kind}:${name}`); return value; };
const inv = id('InvType', 'inv');
const bank = id('InvType', 'bank');
const POTS = ['fd_silver_pot', 'fd_silver_pot_blessed', 'fd_silver_pot_blood', 'fd_silver_pot_blood_blessed',
  'fd_silver_pot_blood_garlic', 'fd_silver_pot_blood_garlic_blessed', 'fd_silver_pot_blood_spiced',
  'fd_silver_pot_blood_spiced_blessed', 'fd_silver_pot_blood_garlic_spiced', 'fd_silver_pot_blood_garlic_spiced_blessed'].map(name => id('ObjType', name));
const constants = fs.readFileSync(path.join(content, 'scripts/quests/quest_deserttreasure/configs/dt_blood.constant'), 'utf8');
function constant(name) {
  const match = constants.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  assert(match, `named numeric constant ${name}`);
  return Number(match[1]);
}
const getBit = (p, name) => p.getVarBit(id('VarBitType', name));
const setBit = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
const setVar = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const setNpc = (n, name, value) => n.setVar(id('VarNpcType', name), value);
const script = name => { const value = ScriptProvider.getByName(name); assert(value, `compiled ${name}`); return value; };
function runPlayer(p, name, target = null, args = []) {
  const state = ScriptRunner.init(script(name), p, target, args);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
  return state;
}
let serial = 0;
function player({ online = true, x = 3570, z = 3410 } = {}) {
  const slot = ++serial;
  World.currentTick = 1000 * slot;
  const p = new Player(`s4_effect_${slot}`, BigInt(slot), BigInt(20000 + slot));
  p.slot = slot; p.pid = slot; p.uid = ((slot << 11) | slot) >>> 0;
  p.x = x; p.z = z; p.level = 0; p.isActive = true;
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  p.messages = []; p.packets = [];
  p.messageGame = text => p.messages.push(text); // Observe output; do not replace gameplay.
  p.wrappedMessageGame = p.messageGame;
  p.write = packet => p.packets.push(packet);
  setVar(p, 'tutorial', 1000);
  setBit(p, 'deserttreasure', 10);
  if (online) { World.players[slot] = p; World.playerLoop.add(p.hash64, p); }
  return p;
}
function actor(name, x = 3570, z = 3409) {
  const t = types.NpcType.get(id('NpcType', name));
  const n = new Npc(0, x, z, t.size, t.size, EntityLifeCycle.DESPAWN, World.getNextNid(), t.id, t.blockwalk);
  World.addNpc(n, 1000);
  return n;
}
function dessous(owner, invalid = false, x = 3570, z = 3409) {
  const n = actor(invalid ? 'blooddiamond_vampirewarrior_unkillable' : 'blooddiamond_vampirewarrior', x, z);
  setNpc(n, 'npc_attacking_uid', owner.uid);
  setNpc(n, 'npc_aggressive_player', owner.uid);
  return n;
}
function runNpc(n, name, target = null, lastInt = null) {
  const state = ScriptRunner.init(script(name), n, target);
  if (lastInt !== null) state.lastInt = lastInt;
  n.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  return state;
}
function talk(p, name, target, choices = []) {
  const state = ScriptRunner.init(script(name), p, target);
  let execution = p.runScript(state, true, true);
  for (let step = 0; execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.equal(execution, ScriptState.PAUSEBUTTON, `${name}: normal dialogue pause`);
    const menu = ['multi2', 'multi3', 'multi4', 'multi5'].find(name => p.modalChat === id('Component', name));
    if (menu) {
      assert(choices.length > 0, `${name}: explicit choice for ${menu}`);
      const choice = id('Component', `${menu}:com_${choices.shift()}`);
      assert(p.resumeButtons.includes(choice), `${name}: offered menu choice`);
      p.lastCom = choice;
    }
    execution = p.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.FINISHED, `${name}: conversation finishes`);
  assert.equal(choices.length, 0, `${name}: all requested menus reached`);
  return p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ').replace(/[|\s]+/g, ' ').trim();
}
function random(value, fn) {
  const previous = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try { return fn(); } finally { JavaRandom.nextDouble = previous; }
}
function attack(n, p, value = 0.99) {
  setNpc(n, 'npc_action_delay', 0);
  n.animId = -1;
  p.queue.clear();
  return random(value, () => runNpc(n, '[proc,dt_dessous_attack]', p));
}
const damageRequests = p => [...p.queue.all()].filter(request => request.script === script('[queue,combat_damage_player]'));
const distance = (p, n) => Math.max(Math.abs(p.x - n.x), Math.abs(p.z - n.z));
const batAnimation = id('SeqType', 'vampire_summonbats');
const cases = {
  attackable() {
    const owner = player(), other = player();
    for (const invalid of [false, true]) {
      const n = dessous(owner, invalid);
      for (const proc of ['[proc,npc_is_attackable]', '[proc,npc_is_attackable_opt]']) {
        owner.messages.length = 0; other.messages.length = 0;
        assert.equal(runPlayer(owner, proc, n).popInt(), 1, `${proc}: owner may attack ${n.type}`);
        assert.deepEqual(owner.messages, []);
        assert.equal(runPlayer(other, proc, n).popInt(), 0, `${proc}: spectator refused ${n.type}`);
        assert.deepEqual(other.messages, ['Someone else is fighting that.']);
      }
      World.removeNpc(n, 0);
    }
    const goblin = actor('goblin');
    for (const proc of ['[proc,npc_is_attackable]', '[proc,npc_is_attackable_opt]']) {
      other.messages.length = 0;
      assert.equal(runPlayer(other, proc, goblin).popInt(), 1, `${proc}: ordinary op2 NPC unchanged`);
      assert.deepEqual(other.messages, []);
    }
    World.removeNpc(goblin, 0);
  },
  death() {
    for (const variant of ['owner-hero', 'spectator-hero', 'offline-owner-hero', 'owner-hero-not-active']) {
      const owner = player({ online: variant !== 'offline-owner-hero' });
      const spectator = player();
      setBit(owner, 'fdvw_subquest', variant === 'owner-hero-not-active' ? 5 : 6);
      setBit(spectator, 'fdvw_subquest', 6);
      const n = dessous(owner);
      n.heroPoints.addHero((variant === 'spectator-hero' ? spectator : owner).hash64, 150);
      n.applyDamage(n.levels[NpcStat.HITPOINTS], 1);
      const online = [spectator, ...(variant === 'offline-owner-hero' ? [] : [owner])];
      const state = ScriptRunner.init(script('[ai_queue3,blooddiamond_vampirewarrior]'), n);
      n.executeScript(state);
      for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
        for (const p of online) p.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil);
        n.delayed = false; n.executeScript(state);
      }
      for (const p of online) p.processQueues();
      assert.equal(state.execution, ScriptState.FINISHED, `${variant}: shared death finishes`);
      assert.equal(n.isActive, false, `${variant}: shared death removes Dessous`);
      assert.equal(getBit(owner, 'fdvw_subquest'), variant === 'owner-hero' ? 7 : variant === 'owner-hero-not-active' ? 5 : 6, variant);
      assert.equal(getBit(spectator, 'fdvw_subquest'), 6, `${variant}: spectator gets no credit`);
      for (const p of [owner, spectator]) {
        assert.equal(getBit(p, 'deserttreasure'), 10);
        assert.equal(p.invTotal(inv, id('ObjType', 'fd_blood_diamond')), 0);
      }
    }
  },
  cleanup() {
    for (const invalid of [false, true]) for (const variant of ['present', 'logged-out', 'dead', 'left']) {
      const owner = player({ online: variant !== 'logged-out', ...(variant === 'left' ? { x: 3540, z: 3404 } : {}) });
      if (variant === 'dead') setVar(owner, 'death', 1);
      const n = dessous(owner, invalid);
      runNpc(n, `[ai_timer,${invalid ? 'blooddiamond_vampirewarrior_unkillable' : 'blooddiamond_vampirewarrior'}]`);
      assert.equal(n.isActive, variant === 'present', `${variant}: owned timer ${n.type}`);
      if (n.isActive) World.removeNpc(n, 0);
    }
  },
  confiscation() {
    const p = player();
    const pestle = id('ObjType', 'pestle_and_mortar');
    for (const pot of POTS) { p.invAdd(inv, pot, 1); p.invAdd(bank, pot, 2); }
    p.invAdd(inv, pestle, 1); p.invAdd(bank, pestle, 1);
    runPlayer(p, '[proc,dt_blood_take_pots]');
    for (const pot of POTS) {
      assert.equal(p.invTotal(inv, pot), 0, `held ${pot} confiscated`);
      assert.equal(p.invTotal(bank, pot), 0, `banked ${pot} confiscated`);
    }
    assert.equal(p.invTotal(inv, pestle), 1, 'held ordinary tool positive control');
    assert.equal(p.invTotal(bank, pestle), 1, 'banked ordinary tool positive control');
    for (const pot of POTS) p.invAdd(bank, pot, 2);
    runPlayer(p, '[proc,dt_blood_take_pots]');
    for (const pot of POTS) assert.equal(p.invTotal(bank, pot), 0, `bank-only ${pot} confiscated without a held copy`);
  },
  spices() {
    for (const [input, output] of [['fd_silver_pot_blood_blessed', 'fd_silver_pot_blood_spiced_blessed'], ['uncooked_stew', 'uncooked_curry']]) {
      const p = player();
      setBit(p, 'fdvw_subquest', 3);
      const spice = id('ObjType', 'spicespot'), pot = id('ObjType', input), result = id('ObjType', output);
      p.invAdd(inv, pot, 1); p.invAdd(inv, spice, 1);
      p.lastItem = spice; p.lastUseItem = pot; p.lastSlot = 1; p.lastUseSlot = 0;
      runPlayer(p, '[opheldu,spicespot]');
      assert.equal(p.invTotal(inv, result), 1, `${input}: shared spice route produces ${output}`);
      assert.equal(p.invTotal(inv, pot), 0);
      assert.equal(p.invTotal(inv, spice), 0);
      assert.equal(getBit(p, 'fdvw_subquest'), input === 'uncooked_stew' ? 3 : 4);
    }
  },
  blessing() {
    const priest = actor('high_priest_of_entrana');
    const ordinary = player(); setBit(ordinary, 'deserttreasure', 0);
    const ordinaryPages = talk(ordinary, '[opnpc1,high_priest_of_entrana]', priest);
    assert(ordinaryPages.includes('Many greetings. Welcome to our fair island.'));
    assert(ordinaryPages.includes('Enjoy your stay here. May it be spiritually uplifting!'));
    assert(!ordinaryPages.includes('bless this'));
    for (const [input, output] of [['fd_silver_pot', 'fd_silver_pot_blessed'], ['fd_silver_pot_blood', 'fd_silver_pot_blood_blessed'],
      ['fd_silver_pot_blood_garlic', 'fd_silver_pot_blood_garlic_blessed'], ['fd_silver_pot_blood_spiced', 'fd_silver_pot_blood_spiced_blessed'],
      ['fd_silver_pot_blood_garlic_spiced', 'fd_silver_pot_blood_garlic_spiced_blessed']]) {
      const p = player(); setBit(p, 'fdvw_subquest', 3); p.invAdd(inv, id('ObjType', input), 1);
      const pages = talk(p, '[opnpc1,high_priest_of_entrana]', priest);
      assert(pages.includes('Many greetings. Welcome to our fair island.'));
      assert(pages.includes('Hi, I was wondering, can you quickly bless this for me?'));
      if (input === 'fd_silver_pot') {
        assert(pages.includes('A somewhat strange request, but I see no harm in it. There you go. May Saradomin walk with you.'));
        assert(!pages.includes('BLOOD?'));
      } else {
        for (const line of ['A somewhat strange request, but I see no harm in... Wait a moment... is that BLOOD?', 'Erm... yes...',
          'Why do you want me to bless a pot full of someones blood???', "Oh, don't worry, it's not 'someones', it's my own!",
          'I... see... Well it is an unusual thing, but I see no harm in it. Take this, and walk in peace with Saradomin.']) assert(pages.includes(line), line);
        assert(!pages.includes('There you go.'));
      }
      assert.equal(p.invTotal(inv, id('ObjType', output)), 1);
      assert.equal(p.invTotal(inv, id('ObjType', input)), 0);
    }
    World.removeNpc(priest, 0);
  },
  dialogue() {
    const ruantun = actor('malak');
    const unknown = player();
    assert.equal(talk(unknown, '[opnpc1,malak]', ruantun), '', 'no-agreement Ruantun is silent');
    assert.deepEqual(unknown.messages, []);
    const agreed = player(); setBit(agreed, 'fdvw_subquest', 1);
    assert(talk(agreed, '[opnpc1,malak]', ruantun).includes('You ssshould not be down here...'), 'agreement positive control');
    World.removeNpc(ruantun, 0);
    const malak = actor('fourdiamonds_vampire_lord');
    for (const choice of [1, 2, 3]) {
      const p = player(); setBit(p, 'fdvw_subquest', 1);
      const pages = talk(p, '[opnpc1,fourdiamonds_vampire_lord]', malak, [choice]);
      assert(pages.includes('How do I kill Dessous again?'), 'repeat menu, not first-visit menu');
      assert(pages.includes(choice === 1 ? 'Come and see my when you have prepared a silver ritual pot in the manner I have told you.' :
        choice === 2 ? 'Take a silver bar to the man in the Draynor sewers. He will fashion a ritualistic pot for you, which you should then take to Entrana and get blessed.' :
          'As you wish. Come and see me when you have managed to kill Dessous.'));
      assert.equal(getBit(p, 'fdvw_subquest'), 1);
    }
    World.removeNpc(malak, 0);
  },
  award() {
    const malak = actor('fourdiamonds_vampire_lord');
    const diamond = id('ObjType', 'fd_blood_diamond'), tool = id('ObjType', 'pestle_and_mortar');
    for (const heldPot of [false, true]) {
      const p = player(); setBit(p, 'fdvw_subquest', 7);
      p.invAdd(inv, tool, heldPot ? 27 : 28);
      if (heldPot) p.invAdd(inv, POTS[0], 1);
      p.invAdd(bank, POTS[1], 2);
      talk(p, '[opnpc1,fourdiamonds_vampire_lord]', malak);
      assert.equal(p.invTotal(inv, diamond), heldPot ? 1 : 0, 'only a reclaimable held pot makes room');
      assert.equal(getBit(p, 'fdvw_subquest'), heldPot ? 8 : 7);
      assert.equal(p.invTotal(bank, POTS[1]), heldPot ? 0 : 2, 'refusal never confiscates banked pots');
      assert.equal(p.invTotal(inv, tool), heldPot ? 27 : 28);
    }
    World.removeNpc(malak, 0);
  },
  attacks() {
    const rolls = constant('dt_dessous_melee_rolls'), chances = constant('dt_dessous_melee_chances');
    assert(chances > 0 && chances * 2 === rolls, 'near-target CANDIDATE: adjacent attacks are half melee');
    for (const prayer of [null, 'prayer14', 'prayer12']) {
      const p = player(), n = dessous(p);
      if (prayer) setVar(p, prayer, 1);
      let melee = 0, bats = 0;
      for (let i = 0; i < rolls * 32; i++) {
        attack(n, p, ((i % rolls) + 0.5) / rolls);
        if (n.animId === batAnimation) bats++; else { assert(n.animId >= 0, 'native melee animation'); melee++; }
      }
      assert.deepEqual({ melee, bats }, { melee: chances * 32, bats: (rolls - chances) * 32 }, `${prayer ?? 'no prayer'}: same exact attack choices`);
      console.log(`OBSERVE attack choices ${prayer ?? 'none'} melee=${melee} bats=${bats}`);
      World.removeNpc(n, 0);
    }
    const p = player(), n = dessous(p, false, 3570, 3407);
    attack(n, p, 0);
    assert.equal(n.animId, batAnimation, 'non-adjacent roll can never melee');
    assert.equal(n.getVar(id('VarNpcType', 'npc_int')), 0, 'ordinary short distance does not teleport');
    setVar(p, 'prayer13', 1);
    attack(n, p);
    assert(distance(p, n) <= 1, 'missile prayer teleports beside owner before attacking');
    assert.equal(n.getVar(id('VarNpcType', 'npc_int')), 1, 'missile-prayer teleport counts');
    World.removeNpc(n, 0);
  },
  bats() {
    for (const invalid of [false, true]) for (const prayer of [null, 'prayer12', 'prayer13', 'prayer14']) {
      const p = player(), n = dessous(p, invalid);
      if (prayer) setVar(p, prayer, 1);
      attack(n, p);
      assert.equal(n.animId, batAnimation);
      const damage = constant(invalid ? 'dt_dessous_invalid_bat_damage' : 'dt_dessous_bat_damage');
      if (invalid) assert(damage > 5, 'period evidence says more than five, exact default UNKNOWN');
      const expectedDelays = [prayer === 'prayer12' ? null : constant('dt_dessous_bat_first_delay'),
        prayer === 'prayer13' ? null : constant('dt_dessous_bat_second_delay')].filter(value => value !== null);
      const requests = damageRequests(p);
      assert.deepEqual(requests.map(request => request.args), expectedDelays.map(() => [damage]), `${invalid}/${prayer}: per-hit damage`);
      assert.deepEqual(requests.map(request => request.delay), expectedDelays, `${invalid}/${prayer}: independent delayed hits`);
      World.removeNpc(n, 0);
    }
    for (const [attackReady, roll] of [[false, 0.99], [true, 0], [true, 0.99]]) {
      const p = player(), n = dessous(p, true);
      setBit(p, 'fdvw_subquest', 4);
      const base = n.baseLevels[NpcStat.HITPOINTS];
      const issued = [];
      const say = n.say.bind(n);
      n.say = text => { issued.push({ tick: World.currentTick, text }); say(text); };
      n.setInteraction(Interaction.SCRIPT, p, NpcMode.APPLAYER2);
      setNpc(n, 'npc_action_delay', attackReady ? 0 : World.currentTick + 1);
      n.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, base + 50);
      random(roll, () => n.turn());
      assert.equal(n.levels[NpcStat.HITPOINTS], base, 'invalid form regenerates a lethal hit');
      assert.equal(n.isActive, true);
      assert.equal(getBit(p, 'fdvw_subquest'), 4);
      const batsDue = attackReady && roll === 0.99;
      assert.deepEqual(issued.map(call => call.text), batsDue
        ? ['You will never defeat me', 'Hssssssssssss'] : ['You will never defeat me'],
        'the real NPC turn issues regeneration speech before a due bat special');
      assert(issued.every(call => call.tick === World.currentTick), 'both say calls belong to the same tick');
      const text = batsDue ? 'Hssssssssssss' : 'You will never defeat me';
      assert.equal(n.sayMessage, text, 'the native NPC retains only the last say');
      const message = new NpcInfoSay(n.sayMessage);
      const wire = new Packet(message.test());
      message.encode(wire);
      assert.deepEqual([...wire.data], [...Buffer.from(`${text}\n`)],
        'the native SAY block encodes exactly one final overhead string');
      console.log(`regeneration-speech ${JSON.stringify({ attackReady, roll, issued, hit: n.hitmarkDamage,
        health: n.levels[NpcStat.HITPOINTS], wireText: Buffer.from(wire.data).toString('latin1') })}`);
      assert.equal(ScriptProvider.getByName('[ai_queue3,blooddiamond_vampirewarrior_unkillable]'), undefined);
      World.removeNpc(n, 0);
    }
  },
  chases() {
    const p = player(), n = dessous(p);
    assert.equal(constant('dt_dessous_teleports_limit'), 3, 'period return threshold');
    for (let chase = 1; chase <= 4; chase++) {
      n.x = p.x - 8; n.z = p.z;
      attack(n, p);
      assert.equal(n.getVar(id('VarNpcType', 'npc_int')), chase);
      assert.equal(n.isActive, chase <= 3, `chase ${chase}: three teleports visible, fourth removes`);
      if (n.isActive) assert(distance(p, n) <= 1, `chase ${chase}: actually moved beside the owner`);
    }
  }
};
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(cases);
let failed = false;
for (const name of selected) {
  assert(cases[name], `unknown case ${name}`);
  try { cases[name](); console.log(`PASS packed S4 ${name}`); }
  catch (error) { failed = true; console.error(`FAIL packed S4 ${name}`, error); }
}
process.exit(failed ? 1 : 0);
