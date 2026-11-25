#!/usr/bin/env node
import assert from 'node:assert/strict';
import { World, id, load, logoutAndLoad, player, run, types, v } from './runtime.mjs';

const { NpcMode } = await load('engine/entity/NpcMode.ts');
const active = () => [...World.npcs].filter(npc => npc.isActive && types.NpcType.get(npc.type).category === id('CategoryType', 'petcat'));
const owned = p => active().filter(npc => (npc.getVar(id('VarNpcType', 'npc_attacking_uid')) >>> 0) === p.uid);
for (const withFollower of [true, false]) {
  const p = player();
  const item = id('ObjType', 'kittenobject');
  if (withFollower) {
    // Establish the fixture through the real pet spawn proc, including its saved item.
    run(p, '[proc,cat_spawn]', [id('NpcType', 'kittenpet1')]);
    assert.equal(p.getVar(v('follower_obj')), item);
    assert.equal(owned(p).length, 1);
  }
  const previous = withFollower ? World.getNpcByUid(p.getVar(v('follower_uid'))) : null;
  const loaded = logoutAndLoad(p);
  if (previous) assert(!previous.isActive, 'compiled logout removes the old follower');
  assert.equal(loaded.getVar(v('follower_obj')), withFollower ? item : -1, 'saved follower item survives logout');
  assert.equal(loaded.getVar(v('follower_uid')), -1, 'session NPC UID is not saved');
  const before = active().length;
  loaded.onLogin();
  assert.equal(owned(loaded).length, 0, 'login must defer restoration to the player queue');
  const queued = [...loaded.queue.all()].filter(request => request.script.name === '[queue,follower_login]');
  assert.equal(queued.length, 1, 'compiled login schedules its real follower queue exactly once');
  loaded.processQueues();
  assert(![...loaded.queue.all()].some(request => request.script.name === '[queue,follower_login]'), 'native queue processing consumes follower login');
  const followers = owned(loaded);
  assert.equal(followers.length, withFollower ? 1 : 0, 'only a saved follower returns');
  assert.equal(active().length - before, withFollower ? 1 : 0, 'no extra pet is created');
  if (withFollower) {
    const [follower] = followers;
    assert.equal(follower.type, id('NpcType', 'kittenpet1'));
    assert.equal(loaded.getVar(v('follower_uid')), follower.uid, 'queue records the restored NPC UID');
    assert.equal(follower.targetOp, NpcMode.PLAYERFOLLOW, 'restored pet follows its owner');
    assert.deepEqual([follower.level, follower.x, follower.z], [loaded.level, loaded.x, loaded.z]);
    assert.equal(follower.sayMessage, 'Meeeew!');
    const growth = [...loaded.timers.values()].find(timer => timer.script.name === '[timer,petcat_growth]');
    assert(growth && growth.interval > 0, 'queue restores the growth timer');
  } else {
    assert.equal(loaded.getVar(v('follower_uid')), -1);
    assert(![...loaded.timers.values()].some(timer => timer.script.name === '[timer,petcat_growth]'));
  }
  run(loaded, '[logout,_]');
  console.log(`PASS compiled follower logout/save/login queue: follower=${withFollower}`);
}
process.exit(0);
