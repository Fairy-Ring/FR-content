import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = file => import(pathToFileURL(path.join(engine, file)).href);
const rt = await runtime(engine, pack);
const [{ default: Runner }, { default: Trigger }, { default: Player }, { default: JavaRandom }, { CoordGrid }, routefinder, { CollisionFlag: Flag }] = await Promise.all([
  load('src/engine/script/ScriptRunner.ts'), load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'),
  load('src/util/JavaRandom.ts'), load('src/engine/CoordGrid.ts'), load('src/engine/routefinder/index.ts'), load('src/engine/routefinder/flags.ts'),
]);
const [{ NetworkPlayer }, { default: Packet }, { default: CamMoveToEncoder }, { default: CamLookAtEncoder }] = await Promise.all([
  load('src/engine/entity/NetworkPlayer.ts'), load('src/io/Packet.ts'),
  load('src/network/game/server/codec/CamMoveToEncoder.ts'), load('src/network/game/server/codec/CamLookAtEncoder.ts'),
]);
const { World, Provider, State, Pointer, configs, id } = rt;
const { VarPlayerType, VarSharedType, VarBitType, LocType, NpcType, ObjType, InvType, Component } = configs;
const pv = name => id(VarPlayerType, name), sv = name => id(VarSharedType, name);
const world = (name, value) => value === undefined ? World.vars[sv(name)] : (World.vars[sv(name)] = value);
const coord = (x, z, level = 0) => CoordGrid.packCoord(level, x, z);
const inv = id(InvType, 'inv'), worn = id(InvType, 'worn'), token = id(ObjType, 'tzhaar_token');
let passed = 0;
const check = (label, action) => { action(); passed++; console.log(`PASS Fight Pits ${label}`); };
World.vars = new Int32Array(VarSharedType.count);
World.varsString = new Array(VarSharedType.count).fill('');
await World.gameMap.init();
rt.dispose();
const fixture = rt.fixture('tzhaar_fightpit_master');
const master = fixture.npc;
master.teleport(2399, 5178, 0);
const players = [fixture.player];
function makePlayer(slot) {
  const player = new Player(`pits_fixture_${slot}`, BigInt(1000 + slot), BigInt(100000 + slot));
  player.slot = player.pid = slot; player.uid = ((1000 + slot) << 11) | slot; player.isActive = true;
  player.baseLevels.fill(80); player.levels.fill(80); player.vars.fill(0); player.stats.fill(0);
  player.getInventory(inv); player.getInventory(worn); player.testMessages = []; player.write = () => {};
  player.messageGame = text => player.testMessages.push(String(text)); player.wrappedMessageGame = player.messageGame;
  World.players[slot] = player; World.playerLoop.add(player.hash64, player); players.push(player); return player;
}
const p = players[0], q = makePlayer(2), r = makePlayer(3);
const status = player => player.getVar(pv('fightpits_state')) & 3;
function tick() {
  World.currentTick++;
  for (const player of players) {
    if (player.delayed && World.currentTick >= player.delayedUntil) player.delayed = false;
    if (!player.delayed && player.activeScript?.execution === State.SUSPENDED) player.executeScript(player.activeScript, true, true);
    player.processQueues();
  }
}
function run(name, player = p, target = null, args = []) {
  const script = typeof name === 'string' ? Provider.getByName(name.startsWith('[') ? name : `[proc,${name}]`) : name;
  assert(script, `compiled script ${name}`);
  const state = Runner.init(script, player, target, args);
  state.pointerAdd(Pointer.ProtectedActivePlayer);
  if (target instanceof Player) state.pointerAdd(Pointer.ProtectedActivePlayer2);
  player.executeScript(state, true, true);
  return state;
}
function complete(name, player = p, target = null, args = []) {
  const state = run(name, player, target, args);
  for (let step = 0; state.execution === State.SUSPENDED && step < 16; step++) tick();
  assert.equal(state.execution, State.FINISHED, `${typeof name === 'string' ? name : name.name} finishes`);
  return state;
}
function int(name, player = p, target = null, args = []) {
  const state = complete(name, player, target, args); assert.equal(state.isp, 1); return state.intStack[0];
}
function controller() {
  const result = rt.run('[proc,fightpits_controller]', { player: p, npc: master });
  assert.equal(result.state.execution, State.FINISHED, 'native master controller completes');
}
function loc(name, x, z) { const value = World.getLoc(x, z, 0, id(LocType, name)); assert(value, `real packed ${name}`); return value; }
const outer = loc('hot_vent_door_9369', 2399, 5176), inner = loc('hot_vent_door_9368', 2399, 5168), orb = loc('viewing_orb', 2399, 5172);
function interact(player, target, trigger = Trigger.OPLOC1) {
  player.target = target; player.targetOp = trigger - 7;
  const script = player.getOpTrigger(); assert(script, `native operation dispatch ${trigger}`);
  return complete(script, player, target);
}
function button(player, component) {
  return complete(Provider.getByTrigger(Trigger.IF_BUTTON, id(Component, component), -1), player);
}
function route(x, z, endX, endZ, label) {
  assert(!routefinder.isFlagged(x, z, 0, Flag.WALK_BLOCKED), `${label}: landing walkable`);
  const result = [...routefinder.findPath(0, x, z, endX, endZ, 1, 1, 1, 0, -1, false, 0, 25, 0)]; assert(result.length, `${label}: route out is nonempty`);
  const end = CoordGrid.unpackCoord(result.at(-1)); assert.equal(end.x, endX); assert.equal(end.z, endZ);
}
function reset() {
  World.vars.fill(0); World.varsString.fill('');
  for (const player of players) {
    player.queue.clear(); player.timers.clear(); player.activeScript = null; player.protect = false; player.delayed = false;
    player.vars.fill(0); player.baseLevels.fill(80); player.levels.fill(80); player.stats.fill(0);
    player.getInventory(inv).items.fill(null); player.getInventory(worn).items.fill(null);
    player.teleport(2398, 5178, 0); player.testMessages.length = 0;
    player.setVar(pv('tutorial'), 1000);
  }
}
function enter(player) { player.teleport(2399, 5177, 0); interact(player, outer); assert.equal(status(player), 1); }
function start(contenders = [p, q]) {
  reset(); for (const player of contenders) enter(player);
  controller(); assert.equal(world('fightpits_phase'), 1, 'two contenders start countdown');
  World.currentTick = world('fightpits_deadline'); controller();
  tick(); controller(); tick();
  assert.equal(world('fightpits_phase'), 3, 'native admission queues start active round');
  for (const player of contenders) { assert.equal(status(player), 2); assert.equal(player.z, 5166); }
  assert.equal(world('fightpits_remaining_count'), contenders.length);
}
function life(player, name) {
  complete(Provider.getByTriggerSpecific(name === 'login' ? Trigger.LOGIN : Trigger.LOGOUT, -1, -1), player);
}

try {
  check('original configs, UI identities and all destination routes derive from real map counterparts', () => {
    assert.equal(pv('fightpits_state'), 410); assert.equal(VarPlayerType.get(pv('fightpits_state')).transmit, false);
    assert.equal(pv('tzhaar_fightpit_remaining'), 560); assert.equal(pv('tzhaar_temp'), 561);
    assert.equal(id(VarBitType, 'tzhaar_fightpit_orb'), 1050);
    assert.equal(id(Component, 'current_champion'), 2804); assert.equal(id(Component, 'stop_viewing'), 3209);
    // Counterparts are independently pinned to cache placements, not product constants.
    route(2399, 5178, outer.x + 1, outer.z + 1, 'lobby');
    route(2399, 5174, orb.x + 1, orb.z, 'waiting room/orb');
    route(2399, 5166, inner.x + 1, inner.z - 1, 'arena entry/exit');
    assert.equal(NpcType.get(id(NpcType, 'tzhaar_fightpit_master')).name, 'TzHaar-Mej-Kah');
    assert.equal(ObjType.get(token).tradeable, false, 'full-inventory reward remains private');
    const source = fs.readFileSync(path.join(content, 'maps/multiway.csv'), 'utf8');
    assert(source.includes('0_37_80_24_40')); assert(!source.includes('0_37_80_24_48'));
  });
  check('native master Talk-to explains rules, safety, reward and champion', () => {
    reset(); p.target = master; p.targetOp = Trigger.OPNPC1 - 7;
    const script = p.getOpTrigger(); assert.equal(script.name, '[opnpc1,tzhaar_fightpit_master]');
    const state = run(script, p, master);
    assert([State.SUSPENDED, State.FINISHED].includes(state.execution), 'dialogue is reachable, not an absent handler');
    assert(state.opcount > 5, 'master executes dialogue rather than an empty return');
    assert(p.testMessages.some(text => text.includes('Current Champion:')));
    assert(p.testMessages.some(text => text.includes('Tokkul')));
    assert(p.testMessages.some(text => text.includes('keep your items')));
    assert(p.testMessages.some(text => text.includes('waiting room')));
    p.activeScript = null; p.protect = false; p.delayed = false; p.closeModal();
  });
  check('all five native orb views encode in-scene fast cameras and restore controls', () => {
    reset(); enter(p); p.setVar(pv('tzhaar_temp'), 0x11f);
    interact(p, orb);
    assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 1);
    assert.equal(p.tabs[10], id(Component, 'stop_viewing'));
    // Entering the room retains the scene built from the original outer-door approach.
    p.originX = outer.x; p.originZ = outer.z + 1;
    p.cameraPackets.clear();
    const written = [], originalWrite = p.write;
    const encoders = [new CamMoveToEncoder(), new CamLookAtEncoder()];
    p.write = message => written.push(message);
    try {
      for (let view = 1; view <= 5; view++) {
        button(p, `stop_viewing:com_${view + 10}`);
        assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), view);
        assert.equal(p.getVar(pv('tzhaar_temp')) & ~0xe0, 0x11f);
        written.length = 0; // Observe the native camera flush, not the button's varp update.
        NetworkPlayer.prototype.updateMap.call(p);
        assert.deepEqual(written.map(message => message.constructor.name), ['CamMoveTo', 'CamLookAt']);
        for (let index = 0; index < encoders.length; index++) {
          const message = written[index], packet = new Packet(new Uint8Array(6));
          encoders[index].encode(packet, message);
          assert.equal(packet.pos, 6);
          const [x, z, , , rate, rate2] = packet.data;
          assert(x >= 0 && x < 104 && z >= 0 && z < 104, `view ${view}: encoded camera target inside loaded scene`);
          assert.equal(x, message.x, `view ${view}: local x did not wrap to a byte`);
          assert.equal(z, message.z, `view ${view}: local z did not wrap to a byte`);
          assert(rate >= 100 && rate2 >= 100, `view ${view}: encoded camera snaps immediately`);
          const worldX = x + CoordGrid.zoneOrigin(p.originX), worldZ = z + CoordGrid.zoneOrigin(p.originZ);
          assert(worldX >= 2377 && worldX <= 2418 && worldZ >= 5129 && worldZ <= 5167, `view ${view}: target on inset arena floor`);
          assert(!routefinder.isFlagged(worldX, worldZ, 0, Flag.WALK_BLOCKED), `view ${view}: target walkable on packed map`);
        }
      }
    } finally {
      p.write = originalWrite;
    }
    button(p, 'stop_viewing:com_5');
    assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 0);
    assert.equal(p.getVar(pv('tzhaar_temp')) & ~0xe0, 0x11f);
    complete('fightpits_orb_stop', p); // clean stop is idempotent
    assert.equal(p.tabs[10], id(Component, 'logout'));
    interact(p, orb); complete('[walktrigger,fightpits_orb_walk]', p);
    assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 0);
    assert.equal(p.tabs[10], id(Component, 'logout'));
    interact(p, orb); complete('[if_close,stop_viewing]', p); tick();
    assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 0);
    assert.equal(p.tabs[10], id(Component, 'logout'));
    interact(p, outer); assert.equal(status(p), 0, 'native exit restores movement and leaves waiting room');
  });
  check('one player cannot start; two enter through queues and an orb spectator is restored', () => {
    reset(); enter(p); controller(); assert.equal(world('fightpits_phase'), 0);
    enter(q); interact(p, orb); controller(); assert.equal(world('fightpits_phase'), 1);
    World.currentTick = world('fightpits_deadline') - 1; controller(); assert.equal(status(p), 1);
    World.currentTick++; controller(); tick(); controller(); tick();
    assert.equal(status(p), 2); assert.equal(status(q), 2);
    assert.equal(p.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 0);
    assert.equal(p.getVar(pv('tzhaar_fightpit_remaining')), 1);
    // The published wrappers fall through to null on success; their callers
    // reject exactly false. The genuine attack below proves this allow path.
    assert.notEqual(int('pvp_is_attackable', p, q), 0);
    assert.notEqual(int('pvp_is_attackable_opt', p, q), 0);
    p.setVar(pv('lastcombat'), World.currentTick); p.setVar(pv('pk_predator1'), r.uid);
    assert.equal(int('pvp_in_combat_check', p, q), 1, 'packed multiway admits another opponent');
    assert.equal(int('pvp_level_check_reason', p, r), 1, 'outside player cannot enter round via attack');
    assert.equal(int('deserves_pk_skull', p, q), 0);
    assert.equal(int('pre_tele_checks_no_ana', p, null, [coord(p.x, p.z)]), 0);
  });
  check('genuine native PvP damage invokes safe death, preserves carried/worn items and crowns once', () => {
    start();
    const spade = id(ObjType, 'spade'), weapon = id(ObjType, 'bronze_sword');
    q.invAdd(inv, spade, 1); q.invAdd(worn, weapon, 1);
    q.levels[3] = 1; q.levels[5] = 1; q.runenergy = 0; q.setVar(pv('poison'), 20);
    for (const [name, value] of Object.entries({ damagetype: 0, damagestyle: 0, com_stabattack: 1000000, com_maxhit: 20, action_delay: 0 })) p.setVar(pv(name), value);
    q.setVar(pv('com_stabdef'), 1);
    const ownLevel = int('player_combat_level', p), loserLevel = int('player_combat_level', q);
    assert.equal(world('fightpits_total_levels'), ownLevel + loserLevel);
    p.target = q; p.targetOp = Trigger.OPPLAYER2 - 7;
    const attack = p.getOpTrigger(); assert.equal(attack.name, '[opplayer2,_]');
    const old = JavaRandom.nextDouble; let draw = 0;
    JavaRandom.nextDouble = () => [0.999999, 0, 0.999999][draw++] ?? 0.5;
    try { complete(attack, p, q); } finally { JavaRandom.nextDouble = old; }
    assert.equal(p.getVar(pv('pk_skull')), 0, 'safe PvP never grants a PK skull');
    assert([...q.queue.all()].some(request => request.script.name === '[queue,pvp_damage]'), 'real attack schedules real damage');
    for (let i = 0; i < 12; i++) tick();
    assert.equal(status(q), 1); assert.equal(q.z, 5174);
    assert.equal(q.invTotal(inv, spade), 1); assert.equal(q.invTotal(worn, weapon), 1);
    assert.equal(q.levels[3], q.baseLevels[3]); assert.equal(q.levels[5], q.baseLevels[5]);
    assert.equal(q.runenergy, 10000); assert.equal(q.getVar(pv('poison')), 0);
    controller(); tick(); assert.equal(status(p), 3);
    assert.equal(p.invTotal(inv, token), loserLevel, 'only defeated opponent levels pay Tokkul');
    assert(World.varsString[sv('fightpits_champion_name')].includes(p.displayName));
    const paid = p.invTotal(inv, token); complete('[queue,fightpits_win]', p, null, [world('fightpits_round')]);
    assert.equal(p.invTotal(inv, token), paid, 'duplicate finish cannot pay twice');
    interact(p, inner); assert.equal(status(p), 1); assert.equal(p.z, 5174);
  });
  check('a full-inventory champion receives a private, untradeable floor reward', () => {
    start(); const loserLevel = int('player_combat_level', q);
    p.invAdd(inv, id(ObjType, 'spade'), 28); q.levels[3] = 0;
    complete('[queue,player_death_default]', q); controller(); tick();
    assert.equal(status(p), 3); assert.equal(p.invTotal(inv, token), 0);
    const reward = World.getObj(p.x, p.z, p.level, token, p.hash64);
    assert(reward); assert.equal(reward.count, loserLevel);
    assert.equal(World.getObj(p.x, p.z, p.level, token, r.hash64), null);
  });
  check('withdrawal and disconnect remove contenders without paying their combat levels', () => {
    start([p, q, r]);
    interact(r, inner); assert.equal(status(r), 1);
    const excluded = int('player_combat_level', r);
    assert.equal(world('fightpits_total_levels'), int('player_combat_level', p) + int('player_combat_level', q));
    life(q, 'logout'); assert.equal(status(q), 0); assert.equal(q.z, 5174);
    assert.equal(world('fightpits_remaining_count'), 1);
    controller(); tick(); assert.equal(status(p), 3); assert.equal(p.invTotal(inv, token), 0);
    assert(excluded > 0); life(q, 'login'); assert.equal(status(q), 1);
    q.teleport(2399, 5150, 0); q.setVar(pv('fightpits_state'), 0); life(q, 'login');
    assert.equal(q.z, 5174, 'coordinate recovery handles restart with temp state lost');
    enter(q); interact(q, orb); life(q, 'logout');
    assert.equal(q.getVarBit(id(VarBitType, 'tzhaar_fightpit_orb')), 0);
  });
  check('bounded escalation spawns each native tier on reachable floor, then cleans all hazards', () => {
    start();
    for (let tier = 1; tier <= 4; tier++) {
      World.currentTick = world('fightpits_deadline'); controller();
      assert.equal(world('fightpits_escalation'), tier);
      const hazards = [...World.npcs].filter(npc => npc.isActive && NpcType.get(npc.type).category === NpcType.get(id(NpcType, 'tzhaar_fightpit_swarm_1a')).category);
      assert.equal(hazards.length, Math.min(tier, 3) * 4);
      for (const npc of hazards) for (let x = npc.x; x < npc.x + npc.width; x++) for (let z = npc.z; z < npc.z + npc.length; z++) assert(!routefinder.isFlagged(x, z, 0, Flag.WALK_BLOCKED), `${npc.type} footprint ${x},${z}`);
      for (const npc of hazards) assert(routefinder.findPath(0, npc.x, npc.z, 2399, 5148, npc.width, 1, 1, 0, -1, false, 0, 25, 0).length, 'whole hazard can reach the arena centre');
      if (tier === 4) assert([...p.queue.all()].some(request => request.script.name === '[queue,combat_damage_player]'));
    }
    life(q, 'logout'); controller(); tick();
    assert.equal([...World.npcs].filter(npc => npc.isActive && NpcType.get(npc.type).category === NpcType.get(id(NpcType, 'tzhaar_fightpit_swarm_1a')).category).length, 0);
  });
  check('late waiters cannot enter an active round and zero survivors cannot win', () => {
    start(); enter(r); interact(r, inner); assert.equal(status(r), 1);
    assert.equal(int('pvp_level_check_reason', p, r), 1);
    life(p, 'logout'); life(q, 'logout'); controller(); tick();
    assert.equal(world('fightpits_phase'), 0);
    assert.equal(world('fightpits_remaining_count'), 0);
    assert.equal(World.varsString[sv('fightpits_champion_name')], '');
    assert.equal(p.invTotal(inv, token), 0); assert.equal(q.invTotal(inv, token), 0);
  });
  check('ordinary PvP and Wilderness skull/death eligibility stay unchanged', () => {
    reset(); p.teleport(3200, 3200, 0); q.teleport(3201, 3200, 0);
    const tabs = [...p.tabs], movement = Provider.getByName('[walktrigger,fightpits_orb_walk]').id;
    p.walktrigger = movement; complete('fightpits_logout', p); complete('fightpits_login', p);
    assert.deepEqual(p.tabs, tabs, 'non-viewers keep unrelated interface state');
    assert.equal(p.walktrigger, movement, 'non-viewers keep unrelated movement triggers');
    p.walktrigger = -1;
    assert.equal(int('pvp_level_check_reason', p, q), 1);
    assert.equal(int('pre_tele_checks_no_ana', p, null, [coord(p.x, p.z)]), 1);
    p.teleport(3200, 3800, 0); q.teleport(3201, 3800, 0);
    assert.equal(int('pvp_level_check_reason', p, q), 0);
    assert.equal(int('deserves_pk_skull', p, q), 1);
    complete('set_pk_vars', p, q); assert(p.getVar(pv('pk_skull')) > World.currentTick);
    assert.equal(int('deserves_pk_skull', p, q), 1, 'existing aggressor policy remains unchanged');
    q.invAdd(inv, id(ObjType, 'spade'), 8); q.levels[3] = 0;
    complete('[queue,player_death_default]', q);
    assert.equal(q.invTotal(inv, id(ObjType, 'spade')), 3, 'ordinary death still loses unprotected items');
    assert(q.x >= 3216 && q.x <= 3226 && q.z >= 3213 && q.z <= 3223, 'ordinary death still returns to Lumbridge');
  });
  console.log(`Fight Pits: ${passed} groups passed, 0 failures`);
} finally {
  for (const player of players) { player.queue.clear(); player.activeScript = null; player.protect = false; }
  rt.dispose();
}
// World retains native workers; the assertions above are synchronous offline work.
process.exit(0);
