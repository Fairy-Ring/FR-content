import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, button, contentRoot, count, engineModule, execute, held, id, inv, invButton, obj, slotOf, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';

const rsbuf = await engineModule('network/rsbuf/index.ts');
const { PlayerInfoProt } = await engineModule('network/rsbuf/prot.ts');
const OpPlayer = (await engineModule('network/game/client/model/OpPlayer.ts')).default;
const playerAction = new (await engineModule('network/game/client/handler/OpPlayerHandler.ts')).default();
const OpObj = (await engineModule('network/game/client/model/OpObj.ts')).default;
const groundAction = new (await engineModule('network/game/client/handler/OpObjHandler.ts')).default();
const Obj = (await engineModule('engine/entity/Obj.ts')).default;
const registeredZones = new WeakMap();

export const questItems = [...fs.readFileSync(path.join(contentRoot,
  'scripts/quests/quest_feud/configs/feud.obj'), 'utf8').matchAll(/^\[([^\]]+)\]$/gm)]
  .map(match => match[1]);
export const ordinaryItems = [
  'coins', 'bones', 'adamant_scimitar', 'reddye', 'yellowdye', 'bluedye', 'kebab',
  'beer', 'whisky', 'jug_wine', 'vodka', 'brandy', 'grog', 'pot_empty', 'jug_empty',
  'water_skin3', 'desert_shirt', 'desert_boots', 'bucket_empty', 'cheese', 'lime',
  'orange', 'tomato', 'jug_water', 'bowl_water', 'bucket_water', 'papyrus', 'knife',
  'tinderbox', 'bronze_pickaxe', 'raw_chicken'
];
export const feudItems = [...questItems, ...ordinaryItems];

export function transferPair(p = player(), q = player(), position = { x: 3213, z: 3424 }) {
  for (const [who, x] of [[p, position.x], [q, position.x + 1]]) {
    const oldZone = registeredZones.get(who) ?? World.gameMap.getZone(who.x, who.z, who.level);
    if ([...oldZone.getAllPlayersUnsafe()].includes(who)) oldZone.leave(who);
    rsbuf.addPlayer(who.slot);
    who.closeModal();
    who.level = 0; who.x = x; who.z = position.z;
    who.originX = who.x; who.originZ = who.z;
    const zone = World.gameMap.getZone(who.x, who.z, who.level);
    zone.enter(who);
    registeredZones.set(who, zone);
    who.lastResponse = who.lastConnected = World.currentTick;
    execute('[proc,dt_restore_spellbook]', who);
    who.masks |= PlayerInfoProt.APPEARANCE;
  }
  World.processInfo();
  rsbuf.playerInfo(0, p.slot, 0, 0, true);
  rsbuf.playerInfo(0, q.slot, 0, 0, true);
  assert(rsbuf.hasPlayer(p.slot, q.slot) && rsbuf.hasPlayer(q.slot, p.slot),
    'both transfer participants are visible through the native player-info encoder');
  return [p, q];
}

function requestTrade(p, q) {
  for (const [who, other] of [[p, q], [q, p]]) {
    p.resetEntity(false); q.resetEntity(false);
    assert(playerAction.handle(new OpPlayer(4, other.slot), who), 'native Trade-with packet accepted');
    who.processInteraction();
  }
  assert.equal(p.modalMain, id('Component', 'trademain'));
  assert.equal(q.modalMain, id('Component', 'trademain'));
}

export function tradeAndDrop(p, q, name) {
  const tradeable = types.ObjType.get(obj(name)).tradeable;
  const beforeOwner = count(p, name), beforeOther = count(q, name);
  assert(beforeOwner >= 2, `${name}: disclosed owner-only fixture supplies two copies`);
  requestTrade(p, q);
  assert(invButton(p, 'tradeside:inv', name, 1, slotOf(p, name)), `${name}: native offer handler runs`);
  const offered = count(p, name, id('InvType', 'tradeoffer'));
  assert.equal(offered, tradeable ? 1 : 0, `${name}: compiled tradeability governs the real offer`);
  // Every refusal has a successful ordinary-item control in the same real trade.
  p.invAdd(inv, obj('shortbow'), 1);
  assert(invButton(p, 'tradeside:inv', 'shortbow', 1, slotOf(p, 'shortbow')));
  assert.equal(count(p, 'shortbow', id('InvType', 'tradeoffer')), 1);
  const bows = count(q, 'shortbow');
  for (const [who, component] of [[p, 'trademain:accept'], [q, 'trademain:accept'],
    [p, 'tradeconfirm:accept'], [q, 'tradeconfirm:accept']]) {
    p.resetEntity(false); q.resetEntity(false);
    assert(button(who, component), `native ${component} accepted`);
  }
  assert.equal(count(q, 'shortbow'), bows + 1, 'positive-control trade completes');
  assert.equal(count(q, name), beforeOther + offered, `${name}: recipient obtains exactly the actual offer`);
  assert.equal(count(p, name), beforeOwner - offered);

  p.resetEntity(false); q.resetEntity(false);
  const beforeDrop = count(p, name), otherBeforePickup = count(q, name);
  const dropped = types.ObjType.get(obj(name)).stackable ? beforeDrop : 1;
  assert(held(p, name, 5), `${name}: visible native Drop operation accepted`);
  assert.equal(count(p, name), beforeDrop - dropped);
  const ground = World.getObj(p.x, p.z, p.level, obj(name), p.hash64);
  assert(ground, `${name}: Drop creates the owner's actual ground object`);
  assert.equal(World.getObj(p.x, p.z, p.level, obj(name), q.hash64), null,
    `${name}: another account cannot see a new private drop`);
  // Exercise the complete native reveal interval, not a shortened wait.
  for (let tick = 0; tick < Obj.REVEAL; tick++) {
    World.currentTick++;
    World.processZones();
  }
  assert(ground.isActive, `${name}: the object survives until its native reveal boundary`);
  const otherCanSee = World.getObj(p.x, p.z, p.level, obj(name), q.hash64) === ground;
  assert.equal(otherCanSee, tradeable, `${name}: untradeable drops never become public`);
  q.x = p.x; q.z = p.z; q.originX = q.x; q.originZ = q.z;
  const pickedUp = groundAction.handle(new OpObj(3, p.x, p.z, obj(name)), q);
  assert.equal(pickedUp, tradeable, `${name}: actual Take packet respects ground ownership`);
  if (pickedUp) q.processInteraction();
  assert.equal(count(q, name), otherBeforePickup + (tradeable ? dropped : 0));
  if (!pickedUp) {
    assert(groundAction.handle(new OpObj(3, p.x, p.z, obj(name)), p), `${name}: owner can recover the private drop`);
    p.processInteraction();
    assert.equal(count(p, name), beforeDrop);
  }
  return { name, tradeable, offered, transferred: count(q, name) - beforeOther,
    otherVisibleInitially: false, otherVisibleAtReveal: otherCanSee, otherPickup: pickedUp };
}

export function observeItem(name) {
  const [p, q] = transferPair();
  try {
    // Only the owner's inventory is seeded; the recipient must acquire through production transfer routes.
    assert.equal(p.invAdd(inv, obj(name), 2), 2);
    return tradeAndDrop(p, q, name);
  } finally {
    for (const who of [p, q]) {
      World.removePlayer(who);
      World.logoutRequests.delete(who.username);
    }
  }
}
