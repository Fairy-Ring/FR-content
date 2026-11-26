import assert from 'node:assert/strict';
import { advance, check, coord, count, draws, Environment, environmentTick, finish, id, O, op, player, run, ScriptRunner, ServerTriggerType, tile, types, useLoc, v, World } from './runtime.mjs';

const event = 23;
const targetProc = '[proc,macro_prison_pete_choose_target]';
const rewardProc = '[proc,macro_prison_pete_reward]';
const balloonModels = [10734, 10735, 10736, 10737];
const balloonName = index => `prisonpete_balloon${index + 1}`;
const balloonComponents = ['balloon_animal:com_0', 'balloon_animal:com_4'].map(name => id('Component', name));
const sceneRegion = { x: 32, z: 69 };

function enter() {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [event]);
  assert.equal(p.getVar(v('macro_event')), event);
  assert.deepEqual(tile(p), [0, 2096, 4436], 'Prison Pete entry reaches the assigned native scene tile');
  assert.equal(p.getVar(v('xplamp')), 5, 'the event starts unbriefed');
  assert.equal(p.getVar(v('macro_transmit')), 0);
  assert.equal(p.tabs[3], id('Component', 'inventory'), 'the key-delivery inventory remains available');
  return p;
}
function nearestLoc(p, names, radius = 32) {
  const candidates = names.map(name => [name, id('LocType', name)]);
  let nearest = null;
  let distance = Infinity;
  for (let x = p.x - radius; x <= p.x + radius; x++) {
    for (let z = p.z - radius; z <= p.z + radius; z++) {
      for (const [, type] of candidates) {
        const loc = World.getLoc(x, z, p.level, type);
        if (!loc) continue;
        const nextDistance = Math.abs(x - p.x) + Math.abs(z - p.z);
        if (nextDistance < distance) {
          nearest = loc;
          distance = nextDistance;
        }
      }
    }
  }
  assert(nearest, `native ${names.join('/')} exists within ${radius} tiles`);
  return nearest;
}
function nearestNpc(p, name) {
  const type = id('NpcType', name);
  const candidates = [...World.npcs].filter(npc => npc.isActive
    && npc.type === type
    && npc.level === p.level
    && Math.floor(npc.x / 64) === sceneRegion.x
    && Math.floor(npc.z / 64) === sceneRegion.z);
  candidates.sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z));
  assert(candidates.length, `a real native ${name} is present in the Prison Pete scene`);
  return candidates[0];
}
function npcOption(p, name, npc = nearestNpc(p, name)) {
  p.target = npc;
  p.targetOp = ServerTriggerType.APNPC1;
  const script = p.getOpTrigger();
  assert.equal(script?.name, `[opnpc1,${name}]`, `native Talk/Pop trigger for ${name}`);
  const state = ScriptRunner.init(script, p, npc);
  p.executeScript(state, true, true);
  advance(p, state);
  finish(p);
  return npc;
}
function locOption(p, loc, trigger = ServerTriggerType.APLOC1) {
  p.target = loc;
  p.targetOp = trigger;
  const script = p.getOpTrigger();
  assert(script, `native location option resolves for ${loc.type}`);
  const state = ScriptRunner.init(script, p, loc);
  p.executeScript(state, true, true);
  advance(p, state);
  finish(p);
}
function talkPete(p) {
  npcOption(p, 'prisonpete_pete');
}
function pullLever(p) {
  const lever = World.getLoc(2089, 4430, p.level, id('LocType', 'prisonpete_lever'));
  assert(lever, 'the original native lever exists at its scene binding');
  locOption(p, lever);
}
function assertTargetModel(p, index) {
  assert.equal(p.modalMain, id('Component', 'balloon_animal'));
  const updates = p.packets
    .filter(packet => packet.constructor.name === 'IfSetModel' && balloonComponents.includes(packet.component))
    .slice(-2)
    .map(packet => [packet.component, packet.model]);
  assert.deepEqual(updates, balloonComponents.map(component => [component, balloonModels[index]]));
}
function popBalloon(p, index) {
  const name = balloonName(index);
  const npc = nearestNpc(p, name);
  const animations = [];
  const original = ScriptRunner.HANDLERS[op.NPC_ANIM];
  const tick = World.currentTick;
  ScriptRunner.HANDLERS[op.NPC_ANIM] = state => {
    animations.push(state.intStack[state.isp - 2]);
    original(state);
  };
  try { npcOption(p, name, npc); } finally { ScriptRunner.HANDLERS[op.NPC_ANIM] = original; }
  assert(animations.includes(id('SeqType', 'balloon_pop')), `${name} plays the native balloon_pop sequence`);
  assert(World.currentTick > tick, `${name} pop observes the one-tick pause`);
  assert.equal(types.NpcType.get(npc.baseType).respawnrate, 100, 'native balloon respawn rate remains unchanged');
  assert.equal(npc.lifecycleTick, World.scaleByPlayerCount(100), 'deletion uses the native respawn duration');
  assert.equal(npc.isActive, false, `${name} deletes the original native balloon for its respawn window`);
  return npc;
}
function logoutLogin(p) {
  run(p, '[proc,macro_event_logout]');
  p.closeModal();
  p.timers.clear();
  run(p, '[queue,macro_event_login]');
  assert.equal(p.getVar(v('macro_event')), event);
}

check('Prison Pete target one renders its native animal model after the required speech', () => {
  const p = enter();
  talkPete(p);
  draws({ [targetProc]: [1] }, () => {
    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 1);
    assertTargetModel(p, 1);
  });
  run(p, '[proc,macro_arena_return]', [event]);
});

check('Prison Pete requires Pete speech, pops each native balloon type, hands keys to Pete, and exits only through Open', () => {
  const p = enter();
  const door = nearestLoc(p, ['prisonpete_fakedoor_r', 'prisonpete_fakedoor_l']);
  draws({ [targetProc]: [0, 0, 2, 3], [rewardProc]: [0] }, () => {
    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 5, 'pulling before Pete speaks does not reveal an animal');
    assert.notEqual(p.modalMain, id('Component', 'balloon_animal'));

    talkPete(p);
    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 0);
    assertTargetModel(p, 0);
    logoutLogin(p);
    assert.equal(p.getVar(v('xplamp')), 0, 'login restores the active animal prompt');
    assertTargetModel(p, 0);

    popBalloon(p, 1);
    assert.equal(p.getVar(v('xplamp')), 4, 'wrong Pop clears the selected animal');
    assert.equal(p.getVar(v('macro_transmit')), 0, 'wrong Pop does not count as a handed-in key');
    assert.equal(count(p, 'prisonpete_key'), 0);

    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 0);
    popBalloon(p, 0);
    assert.equal(count(p, 'prisonpete_key'), 1);
    assert.equal(p.getVar(v('macro_transmit')), 0, 'popping creates a key but does not accept it yet');
    logoutLogin(p);
    assert.equal(count(p, 'prisonpete_key'), 1, 'logout preserves the unhanded key');
    talkPete(p);
    assert.equal(count(p, 'prisonpete_key'), 0, 'talking to Pete consumes one key');
    assert.equal(p.getVar(v('macro_transmit')), 1, 'only Pete hand-in advances accepted progress');

    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 2);
    assertTargetModel(p, 2);
    popBalloon(p, 2);
    assert.equal(count(p, 'prisonpete_key'), 1);
    talkPete(p);
    assert.equal(p.getVar(v('macro_transmit')), 2);
    assert.equal(count(p, 'prisonpete_key'), 0);

    pullLever(p);
    assert.equal(p.getVar(v('xplamp')), 3);
    assertTargetModel(p, 3);
    popBalloon(p, 3);
    assert.equal(count(p, 'prisonpete_key'), 1);
    talkPete(p);
    assert.equal(p.getVar(v('macro_transmit')), 3);
    assert.equal(count(p, 'prisonpete_key'), 0);

    locOption(p, door);
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
  assert.deepEqual(tile(p), O);
  assert.equal(count(p, 'coins'), 500);
  assert.equal(count(p, 'prisonpete_key'), 0);
});

check('A prison key on the fake door cannot bypass the required Pete hand-in', () => {
  const p = enter();
  const door = nearestLoc(p, ['prisonpete_fakedoor_r', 'prisonpete_fakedoor_l']);
  p.invAdd(id('InvType', 'inv'), id('ObjType', 'prisonpete_key'), 1); // Test fixture: key not produced by this case.
  assert(useLoc(p, 'prisonpete_key', door), 'native item-on-door packet is accepted for the refusal check');
  finish(p);
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('macro_transmit')), 0);
  assert.equal(count(p, 'prisonpete_key'), 1);
  assert.equal(count(p, 'coins'), 0);
  run(p, '[proc,macro_arena_return]', [event]);
});

check('Prison Pete escape cleans a held key without paying a reward', () => {
  const p = enter();
  p.invAdd(id('InvType', 'inv'), id('ObjType', 'prisonpete_key'), 1); // Test fixture for the escape cleanup.
  p.closeModal();
  run(p, '[proc,p_telejump_safe]', [coord(O)]);
  run(p, '[softtimer,macro_arena_guard]');
  environmentTick(p);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, 'prisonpete_key'), 0);
  assert.equal(count(p, 'coins'), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(p.tabs[3], id('Component', 'inventory'));
});

check('Prison Pete reward categories and four noted-gem variants follow the approved UNKNOWN draws', () => {
  const categories = [
    [0, 'coins', 500],
    [2, 'airrune', 20],
    [3, 'kebab', 1],
    [4, 'unidentified_guam', 1],
  ];
  for (const [roll, item, amount] of categories) {
    const p = player();
    draws({ [rewardProc]: [roll] }, () => run(p, rewardProc));
    assert.equal(count(p, item), amount, `reward category ${roll} grants ${amount} ${item}`);
  }
  for (const [species, item] of ['cert_uncut_sapphire', 'cert_uncut_emerald', 'cert_uncut_ruby', 'cert_uncut_diamond'].entries()) {
    const p = player();
    draws({ [rewardProc]: [1, species] }, () => run(p, rewardProc));
    assert.equal(count(p, item), 1, `uniform species slot ${species} grants one noted gem`);
  }
  const oldMembers = Environment.NODE_MEMBERS;
  Environment.NODE_MEMBERS = false;
  try {
    const p = player();
    draws({ [rewardProc]: [4] }, () => run(p, rewardProc));
    assert.equal(count(p, 'coins'), 500, 'the free-world herb slot uses the approved coin replacement');
    assert.equal(count(p, 'unidentified_guam'), 0);
  } finally { Environment.NODE_MEMBERS = oldMembers; }
});

console.log('Prison Pete compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
