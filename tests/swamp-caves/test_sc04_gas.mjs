#!/usr/bin/env node
/** SC-04: real packed gas, inventory writes, timers, rescue and death. */
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, PlayerStat, PlayerTimerType, ScriptProvider, ScriptState,
  types, map, CollisionType, engineModule, id, obj, inv, worn, player, seed, inventory, count,
  slotOf, use, held, execute, tile, environmentTick, dragInventory, resumeDialogue } from './runtime.mjs';
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { NetworkPlayer } = await engineModule('engine/entity/NetworkPlayer.ts');
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const ClientSocket = (await engineModule('server/ClientSocket.ts')).default;
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
let serial = 1099;
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
assert(controller, 'build the real pack first');
const flag = id('VarBitType', 'darkness_level'), gas = id('VarBitType', 'swamp_gas_turns');
const parent = id('VarPlayerType', 'goblin_caves'), poison = id('VarPlayerType', 'poison');
const roots = ['inter_387', 'inter_248', 'inter_250', 'inter_249'].map(n => id('Component', n));
const open = [['lit_candle', 'unlit_candle', 'candle'], ['lit_black_candle', 'unlit_black_candle', 'black candle'],
  ['torch_lit', 'torch_unlit', 'torch'], ['oil_lamp_lit', 'oil_lamp_unlit', 'oil lamp']];
const safe = ['candle_lantern_lit', 'candle_lantern_black_lit', 'oil_lantern_lit', 'bullseye_lantern_lit', 'tog_sapphire_lantern_lit', 'cave_goblin_mining_helmet_lit'];
const inert = ['unlit_candle', 'unlit_black_candle', 'torch_unlit', 'oil_lamp_empty', 'oil_lamp_unlit',
  'candle_lantern_empty', 'candle_lantern_unlit', 'candle_lantern_black_unlit', 'oil_lantern_empty', 'oil_lantern_unlit',
  'bullseye_lantern_empty', 'bullseye_lantern_unlit', 'bullseye_lantern_nolens', 'tog_sapphire_lantern_empty',
  'tog_sapphire_lantern_unlit', 'cave_goblin_mining_helmet_unlit', 'slayer_buglan_off', 'slayer_buglan_on', 'hammer'];
const rects = [[3145,3176,9584,9600], [3199,3214,9540,9560]];
const timer = p => p.timers.get(controller.id), hp = p => p.levels[PlayerStat.HITPOINTS];
const pending = p => timer(p).args.slice(2);
const overlays = p => p.packets.filter(packet => packet.constructor.name === 'IfOpenOverlay');
const gasPackets = p => p.packets.filter(packet => /^Varp(Small|Large)$/.test(packet.constructor.name) && packet.varp === parent);
const warning = name => `Your ${name} flares brightly!`;
let cases = 0, failures = 0;
function test(name, action) { cases++; try { action(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${e.stack ?? e}`); } }
function ticks(p,n) { for(let i=0;i<n;i++) { environmentTick(p); p.encodeOut?.(); } }
function fixture(items=[], position=[0,3152,9584], maximum=100, current=maximum) {
  const slot=++serial,hash=BigInt(slot);
  const p=new NetworkPlayer(`sc04wire${slot}`,hash,hash,new ClientSocket());
  p.pid=slot;p.slot=slot;p.uid=((slot<<11)|slot)>>>0;p.isActive=true;
  [p.level,p.x,p.z]=position;p.vars.fill(0);p.baseLevels.fill(99);p.levels.fill(99);p.stats.fill(getExpByLevel(99));
  p.setVar(id('VarPlayerType','tutorial'),1000);
  p.messages=[];p.packets=[];p.damageRequests=[];
  p.write=packet=>p.packets.push(packet);p.messageGame=m=>p.messages.push(String(m));p.wrappedMessageGame=p.messageGame;
  const applyDamage=p.applyDamage;
  p.applyDamage=function(amount,type){p.damageRequests.push({amount,type});return applyDamage.call(this,amount,type);};
  World.players[slot]=p;World.playerLoop.add(hash,p);
  for(const [tab,which,component] of [[3,inv,'inventory:inv'],[4,worn,'wornitems:worn']]){
    const com=id('Component',component);p.tabs[tab]=types.Component.get(com).rootLayer;p.invListenOnCom(which,com,p.uid);
  }
  seed(p,items);
  p.baseLevels[PlayerStat.HITPOINTS]=maximum; p.levels[PlayerStat.HITPOINTS]=current;
  p.stats[PlayerStat.HITPOINTS]=getExpByLevel(maximum);
  return p;
}
function ownership(p, expected=true) {
  assert.equal(p.getVarBit(flag),Number(expected)); assert.equal(p.timers.has(controller.id),expected,'actual timer matches ownership');
  if(expected) assert.equal(timer(p).type,PlayerTimerType.SOFT);
}
function start(p) { execute('[proc,swamp_cave_start]',p); ownership(p); p.encodeOut?.(); return p; }
function release(p) { execute('[proc,swamp_cave_release]',p); ownership(p,false); }
function clear(p) { assert.deepEqual(pending(p),[-1,-1,0]); assert.equal(p.getVarBit(gas),0); }
function noExtras(p) {
  assert.equal(p.getVar(poison),0,'gas adds no poison');
  assert(!p.packets.some(packet=>/Synth|Spotanim/.test(packet.constructor.name)),'no invented gas sound or spotanim');
}
function finishDeath(p) {
  assert.equal(hp(p),0,'raw lethal hit has no survival clamp'); ticks(p,1); ownership(p,false);
  assert.equal(p.overlay,-1,'real death releases before delay');
  for(let i=0;i<40&&hp(p)===0;i++) ticks(p,1);
  assert(hp(p)>0,'ordinary death really respawns');
  assert.equal(execute('[proc,swamp_cave_inside]',p,[CoordGrid.packCoord(...tile(p))]).popInt(),0);
  const after=hp(p); ticks(p,40); assert.equal(hp(p),after); ownership(p,false);
}
for(const [a,b,c,d] of rects) test(`inclusive gas rectangle ${a},${c}: every tile, edges and all four planes`,()=>{
  const p=player();
  for(let level=0;level<4;level++) for(let x=a-1;x<=b+1;x++) for(let z=c-1;z<=d+1;z++) {
    const expected=level===0&&rects.some(([x1,x2,z1,z2])=>x>=x1&&x<=x2&&z>=z1&&z<=z2);
    assert.equal(execute('[proc,swamp_cave_gas_inside]',p,[CoordGrid.packCoord(level,x,z)]).popInt(),Number(expected),`${level},${x},${z}`);
  }
});
for(const [lit,unlit,name] of open) for(const position of [[0,3168,9585],[0,3205,9552]]) test(`${lit} at ${position}: warning, exactly seven eligible ticks, one extinction/hit`,()=>{
  const p=start(fixture([lit],position)), slot=slotOf(p,lit), before=inventory(p);
  ticks(p,1); assert.deepEqual(p.messages,[warning(name)]); assert.deepEqual(pending(p),[slot,obj(lit),1]);
  for(let n=2;n<=6;n++){ticks(p,1);assert.equal(hp(p),100);assert.equal(timer(p).args[4],n);assert.equal(count(p,lit),1);}
  ticks(p,1);assert.equal(hp(p),75);assert.equal(p.hitmarkDamage,25);assert.equal(count(p,lit),0);assert.equal(count(p,unlit),1);clear(p);
  assert.equal(p.overlay,roots[0]);assert.equal(overlays(p).length,2,'one root transition after final light loss');
  assert.equal(timer(p).args[0],1,'fresh darkness starts in explosion pass');
  assert.equal(inventory(p).filter(Boolean).length,before.filter(Boolean).length);noExtras(p);
  ticks(p,12);assert.equal(hp(p),75,'one exposure cannot hit again');assert.deepEqual(p.messages,[warning(name)]);release(p);
});
for(const name of [...safe,...inert]) test(`${name}: never provokes gas`,()=>{
  const p=start(fixture([name]));ticks(p,10);clear(p);assert.equal(hp(p),100);assert.deepEqual(p.messages,[]);assert.equal(count(p,name),1);noExtras(p);release(p);
});
for(const cover of safe) test(`mixed ${cover}+candle: unsafe source still explodes, covered source remains`,()=>{
  const p=start(fixture([cover,'lit_candle']));ticks(p,7);assert.equal(hp(p),75);assert.equal(count(p,'unlit_candle'),1);assert.equal(count(p,cover),1);
  assert.equal(timer(p).args[0],0);assert.notEqual(p.overlay,roots[0]);clear(p);ticks(p,35);assert.equal(hp(p),75);assert.equal(p.messages.length,1);release(p);
});
for(const name of safe) test(`covered-only ${name} remains safe past all hazard thresholds`,()=>{
  const p=start(fixture([name]));ticks(p,40);assert.equal(hp(p),100);assert.deepEqual(p.messages,[]);clear(p);release(p);
});
for(const position of [[0,3168,9583],[0,3177,9585],[0,3198,9552],[0,3215,9552],[0,3151,9555],[0,3168,9572],[2,3218,9532]]) test(`outside gas ${position}: open flame has no gas consequence`,()=>{
  const p=start(fixture(['lit_candle'],position));ticks(p,40);assert.equal(hp(p),100);assert.deepEqual(p.messages,[]);assert.equal(count(p,'lit_candle'),1);clear(p);release(p);
});
for(const [maximum,current,damage] of [[100,100,25],[100,40,25],[99,99,24],[10,10,2],[7,7,1],[3,3,1],[1,1,1],[100,5,25]]) test(`maximum ${maximum}, current ${current}: gas raw damage ${damage}`,()=>{
  const p=start(fixture(['lit_candle'],undefined,maximum,current));ticks(p,7);
  assert.deepEqual(p.damageRequests,[{amount:damage,type:1}],'observe raw request before production clamps the displayed overkill to remaining HP');
  assert.equal(p.hitmarkDamage,Math.min(current,damage));assert.equal(hp(p),Math.max(0,current-damage));assert.equal(count(p,'unlit_candle'),1);
  if(current<=damage) finishDeath(p); else release(p);
});
test('lowest initial slot wins, duplicate sources receive separate full exposures',()=>{
  const p=start(fixture(['hammer','torch_lit','lit_candle','lit_candle']));
  ticks(p,1);assert.deepEqual(pending(p),[1,obj('torch_lit'),1]);ticks(p,6);assert.equal(hp(p),75);assert.equal(count(p,'lit_candle'),2);
  ticks(p,1);assert.deepEqual(pending(p),[2,obj('lit_candle'),1]);ticks(p,5);assert.equal(hp(p),75);ticks(p,1);assert.equal(hp(p),50);assert.equal(count(p,'lit_candle'),1);
  ticks(p,7);assert.equal(hp(p),25);assert.equal(count(p,'unlit_candle'),2);release(p);
});
test('a newly earlier source does not steal the already captured source',()=>{
  const p=start(fixture(['hammer','torch_lit']));ticks(p,3);p.invSet(inv,obj('lit_candle'),1,0);ticks(p,4);
  assert.equal(count(p,'torch_unlit'),1);assert.equal(count(p,'lit_candle'),1);assert.equal(hp(p),75);release(p);
});
for(const replacement of ['hammer','candle_lantern_lit','torch_lit',null]) test(`source loss/replacement by ${replacement}: old exposure cannot write stale slot`,()=>{
  const p=start(fixture(['lit_candle']));ticks(p,6);
  if(replacement===null) assert(held(p,'lit_candle',5)); else p.invSet(inv,obj(replacement),1,0);
  ticks(p,1);assert.equal(hp(p),100);assert.equal(count(p,'unlit_candle'),0);
  if(replacement==='torch_lit'){assert.deepEqual(pending(p),[0,obj('torch_lit'),1]);ticks(p,6);assert.equal(hp(p),75);}
  else {clear(p);ticks(p,6);assert.equal(hp(p),100);}
  release(p);
});
test('real backpack drag preserves the captured exposure and its single warning through pass seven',()=>{
  const p=start(fixture(['lit_candle','hammer']));ticks(p,3);
  assert(dragInventory(p,0,20));assert.equal(p.invGetSlot(inv,0),null);
  ticks(p,1);assert.deepEqual(pending(p),[20,obj('lit_candle'),4]);
  assert.deepEqual(p.messages,[warning('candle')]);ticks(p,2);assert.equal(hp(p),100);
  ticks(p,1);assert.equal(hp(p),75);assert.equal(p.invGetSlot(inv,20).id,obj('unlit_candle'));
  assert.equal(count(p,'hammer'),1);assert.deepEqual(p.messages,[warning('candle')]);clear(p);release(p);
});
test('six real backpack moves over 42 eligible passes cannot postpone the six scheduled explosions',()=>{
  const p=start(fixture(['lit_candle','hammer','tinderbox','candle_lantern_lit'],undefined,7));
  let moves=0;
  for(let pass=1;pass<=42;pass++){
    ticks(p,1);
    assert.equal(p.damageRequests.length,Math.floor(pass/7),`scheduled hits at pass ${pass}`);
    assert.equal(hp(p),7-Math.floor(pass/7));
    assert.equal(p.messages.filter(m=>m===warning('candle')).length,Math.ceil(pass/7),`one warning per exposure at pass ${pass}`);
    if(pass%7===0&&pass<42)assert(use(p,'tinderbox','unlit_candle'),'real relight after each spent exposure');
    if(pass%6===0&&pass<42){
      const from=slotOf(p,'lit_candle');assert(dragInventory(p,from,from===0?1:0));moves++;
    }
  }
  assert.equal(moves,6);assert.deepEqual(p.damageRequests.map(d=>d.amount),Array(6).fill(1));clear(p);release(p);
});
test('real swap with an identical lit candle keeps the captured slot, count and warning',()=>{
  const p=start(fixture(['lit_candle','lit_candle']));ticks(p,3);assert(dragInventory(p,0,1));ticks(p,3);
  assert.deepEqual(pending(p),[0,obj('lit_candle'),6]);assert.equal(hp(p),100);assert.deepEqual(p.messages,[warning('candle')]);
  ticks(p,1);assert.equal(hp(p),75);assert.equal(p.invGetSlot(inv,0).id,obj('unlit_candle'));
  assert.equal(p.invGetSlot(inv,1).id,obj('lit_candle'));release(p);
});
test('real swap with another open type follows the candle instead of extinguishing the replacement',()=>{
  const p=start(fixture(['lit_candle','torch_lit']));ticks(p,6);assert(dragInventory(p,0,1));ticks(p,1);
  assert.equal(hp(p),75);assert.equal(p.invGetSlot(inv,0).id,obj('torch_lit'));
  assert.equal(p.invGetSlot(inv,1).id,obj('unlit_candle'));assert.deepEqual(p.messages,[warning('candle')]);release(p);
});
test('real drop then different-open swap with no captured type left starts a fresh warned seven',()=>{
  const p=start(fixture(['lit_candle','torch_lit','hammer']));ticks(p,6);
  assert(held(p,'lit_candle',5));assert(dragInventory(p,1,0));ticks(p,1);
  assert.deepEqual(pending(p),[0,obj('torch_lit'),1]);assert.equal(hp(p),100);
  assert.deepEqual(p.messages,[warning('candle'),warning('torch')]);ticks(p,5);assert.equal(hp(p),100);
  ticks(p,1);assert.equal(hp(p),75);assert.equal(count(p,'torch_unlit'),1);assert.equal(count(p,'unlit_candle'),0);release(p);
});
test('real drop of the captured candle follows the lowest remaining identical type without a new warning',()=>{
  const p=start(fixture(['lit_candle','hammer','lit_candle','lit_candle']));ticks(p,6);
  assert(held(p,'lit_candle',5,0));ticks(p,1);assert.equal(hp(p),75);
  assert.equal(p.invGetSlot(inv,0),null);assert.equal(p.invGetSlot(inv,2).id,obj('unlit_candle'));
  assert.equal(p.invGetSlot(inv,3).id,obj('lit_candle'));assert.deepEqual(p.messages,[warning('candle')]);release(p);
});
test('real drag re-points to the lowest identical source rather than its moved destination',()=>{
  const p=start(fixture(['lit_candle','lit_candle']));ticks(p,3);assert(dragInventory(p,0,20));ticks(p,1);
  assert.deepEqual(pending(p),[1,obj('lit_candle'),4]);ticks(p,3);
  assert.equal(p.invGetSlot(inv,1).id,obj('unlit_candle'));assert.equal(p.invGetSlot(inv,20).id,obj('lit_candle'));
  assert.equal(hp(p),75);assert.deepEqual(p.messages,[warning('candle')]);release(p);
});
test('real drop with no captured candle remaining cancels without a stale write or hit',()=>{
  const p=start(fixture(['lit_candle','hammer']));ticks(p,6);assert(held(p,'lit_candle',5));ticks(p,7);
  clear(p);assert.equal(hp(p),100);assert.equal(count(p,'unlit_candle'),0);assert.equal(count(p,'hammer'),1);
  assert.deepEqual(p.messages,[warning('candle')]);release(p);
});
test('captured-slot transformation refuses invalid or replaced slots and conserves count',()=>{
  const p=fixture(['hammer','lit_candle']);const before=inventory(p);
  for(const slot of [-1,0,28]) assert.equal(execute('[proc,extinguish_light_source_slot]',p,[slot,obj('lit_candle')]).popInt(),0);
  assert.deepEqual(inventory(p),before);assert.equal(execute('[proc,extinguish_light_source_slot]',p,[1,obj('lit_candle')]).popInt(),1);
  assert.equal(count(p,'unlit_candle'),1);assert.equal(count(p,'hammer'),1);
});
for(const mode of ['modal','delay','protected']) test(`${mode} pauses gas at six with no catch-up`,()=>{
  const p=start(fixture(['lit_candle']));ticks(p,6);const args=[...timer(p).args], packets=gasPackets(p).length;
  if(mode==='modal')p.openMainModal(id('Component','trademain'));
  if(mode==='delay'){p.delayed=true;p.delayedUntil=World.currentTick+20;}
  for(let n=0;n<10;n++) {if(mode==='protected'){p.protect=true;World.currentTick++;p.processTimers(PlayerTimerType.SOFT);}else ticks(p,1);}
  assert.deepEqual(timer(p).args,args);assert.equal(gasPackets(p).length,packets);assert.equal(hp(p),100);
  p.protect=false;if(mode==='modal')p.closeModal();if(mode==='delay'){p.delayed=false;p.delayedUntil=0;}
  ticks(p,1);assert.equal(hp(p),75);clear(p);release(p);
});
for(const busy of [false,true]) test(`leave gas and reenter${busy?' while modal':''}: cancellation, fresh seven ticks`,()=>{
  const p=start(fixture(['lit_candle']));ticks(p,6);if(busy)p.openMainModal(id('Component','trademain'));
  p.z=9583;ticks(p,1);assert.deepEqual(pending(p),[-1,-1,0]);assert.equal(hp(p),100);
  p.z=9585;if(busy)p.closeModal();ticks(p,1);assert.deepEqual(pending(p),[0,obj('lit_candle'),1]);
  ticks(p,5);assert.equal(hp(p),100);ticks(p,1);assert.equal(hp(p),75);assert.equal(p.messages.filter(m=>m===warning('candle')).length,2);release(p);
});
test('real pending identity survives an ordinary pass, busy pause and actual move within gas',()=>{
  const p=start(fixture(['lit_candle']));ticks(p,1);assert.deepEqual(pending(p),[0,obj('lit_candle'),1]);
  ticks(p,1);assert.deepEqual(pending(p),[0,obj('lit_candle'),2]);
  p.openMainModal(id('Component','trademain'));const args=[...pending(p)];ticks(p,8);assert.deepEqual(pending(p),args);p.closeModal();
  const directions=[[1,0],[-1,0],[0,1],[0,-1]];const delta=directions.find(([dx,dz])=>map.canTravel(p.level,p.x,p.z,dx,dz,1,0,CollisionType.NORMAL));assert(delta,'walkable gas fixture');
  const to=[p.x+delta[0],p.z+delta[1]];p.queueWaypoint(...to);ticks(p,1);assert.deepEqual(tile(p),[0,...to]);
  assert.deepEqual(pending(p),[0,obj('lit_candle'),3]);ownership(p);assert.equal(p.messages.length,1);release(p);
});
test('real relighting in gas starts a fresh exposure and consumes no fuel/items/XP',()=>{
  const p=start(fixture(['tinderbox','lit_candle']));const stats=[...p.stats];ticks(p,7);assert.equal(hp(p),75);
  assert(use(p,'tinderbox','unlit_candle'));ticks(p,1);assert.equal(timer(p).args[4],1);ticks(p,5);assert.equal(hp(p),75);ticks(p,1);assert.equal(hp(p),50);
  assert.equal(count(p,'tinderbox'),1);assert.equal(count(p,'unlit_candle'),1);assert.deepEqual([...p.stats],stats);release(p);
});
for(const mode of ['modal','delay']) test(`real safe teleport out while ${mode}: no pending explosion at destination`,()=>{
  const p=start(fixture(['lit_candle']));ticks(p,6);
  if(mode==='modal')p.openMainModal(id('Component','trademain'));else{p.delayed=true;p.delayedUntil=World.currentTick+5;}
  execute('[proc,p_telejump_safe]',p,[CoordGrid.packCoord(0,3220,3220)]);ownership(p,false);assert.equal(p.getVarBit(gas),0);ticks(p,40);assert.equal(hp(p),100);assert.equal(count(p,'lit_candle'),1);
});
test('logout discards pending source; real save/load/login starts a fresh exposure',()=>{
  const p=start(fixture(['lit_candle'],undefined,99));ticks(p,6);execute('[logout,_]',p);ownership(p,false);assert.equal(p.getVarBit(gas),0);
  const bytes=p.save();assert(PlayerLoading.verify(new Packet(bytes)));const q=PlayerLoading.load(p.username,new Packet(bytes),null);
  q.pid=p.pid;q.slot=p.slot;q.uid=((Number(q.username37&0x1fffffn)<<11)|q.slot)>>>0;q.isActive=true;q.messages=[];q.packets=[];q.write=packet=>q.packets.push(packet);q.messageGame=m=>q.messages.push(String(m));q.wrappedMessageGame=q.messageGame;
  World.players[q.pid]=q;World.playerLoop.add(q.hash64,q);execute('[login,_]',q);ownership(q);clear(q);
  assert.equal(count(q,'lit_candle'),1);assert.deepEqual(tile(q),[0,3152,9584]);
  ticks(q,1);assert.deepEqual(pending(q),[0,obj('lit_candle'),1],'saved player uses its real username-derived UID for protected acquisition');
  ticks(q,5);assert.equal(hp(q),99);ticks(q,1);assert.equal(hp(q),75);release(q);
});
test('external real death releases a six-tick pending explosion before respawn',()=>{
  const p=start(fixture(['lit_candle']));ticks(p,6);execute('[proc,player_die]',p);ticks(p,1);ownership(p,false);assert.equal(p.getVarBit(gas),0);
  ticks(p,50);ownership(p,false);assert.notDeepEqual(tile(p),[0,3152,9584]);
});
test('a real preceding bite leaves one HP; later gas still kills rather than clamps',()=>{
  const p=start(fixture(['tinderbox','unlit_candle'],[0,3168,9583],3,2));ticks(p,30);assert.equal(hp(p),1);assert(use(p,'tinderbox','unlit_candle'));p.z=9585;ticks(p,7);assert.equal(p.hitmarkDamage,1);finishDeath(p);
});
test('lethal gas precedes due insects; no second bite or ring check after zero HP',()=>{
  const p=start(fixture(['lit_candle'],undefined,100,5));ticks(p,6);timer(p).args[0]=29;
  ticks(p,1);assert.deepEqual(p.damageRequests,[{amount:25,type:1}],'no second bite after lethal gas');assert.equal(hp(p),0);finishDeath(p);
});
test('gas rescue suspends, releases and cannot recreate the controller on return',()=>{
  const random=Math.random;Math.random=()=>0.5;
  try {const p=start(fixture(['lit_candle','ring_of_life'],undefined,100,30));assert(held(p,'ring_of_life',2));ticks(p,7);
    assert.equal(hp(p),5);assert.equal(count(p,'unlit_candle'),1);assert.equal(count(p,'ring_of_life',worn),0);assert(p.delayed);ownership(p);
    for(let i=0;i<12&&p.z>9000;i++){ticks(p,1);ownership(p,p.z>9000);assert.equal(hp(p),5);}
    ownership(p,false);assert.equal(p.overlay,-1);ticks(p,40);ownership(p,false);assert.equal(hp(p),5);
  } finally {Math.random=random;}
});
test('Ana page after gas may be dismissed without resurrecting a spent exposure',()=>{
  const p=start(fixture(['lit_candle','ring_of_life','thanainabarrel'],undefined,100,30));assert(held(p,'ring_of_life',2));ticks(p,7);
  assert.equal(hp(p),5);assert.equal(p.activeScript?.execution,ScriptState.PAUSEBUTTON);assert.equal(count(p,'unlit_candle'),1);
  p.closeModal();ticks(p,1);ownership(p);clear(p);assert.equal(hp(p),5);release(p);
});
for(const dismissal of ['relight','drag'])test(`Ana gas page dismissed by real ${dismissal}: spent exposure cannot replay before a fresh warned seven`,()=>{
  const items=dismissal==='relight'?['tinderbox','lit_candle','ring_of_life','thanainabarrel']:['lit_candle','ring_of_life','thanainabarrel','lit_candle'];
  const p=start(fixture(items,undefined,100,30));assert(held(p,'ring_of_life',2));ticks(p,7);
  assert.equal(hp(p),5);assert.equal(p.activeScript?.execution,ScriptState.PAUSEBUTTON);
  assert.equal(count(p,'unlit_candle'),1);ownership(p);
  if(dismissal==='relight')assert(use(p,'tinderbox','unlit_candle'));else assert(dragInventory(p,3,0));
  assert.equal(p.activeScript,null,'production input discards the paused page');ticks(p,1);
  assert.equal(hp(p),5,'no immediate unwarned second hit');assert.equal(p.damageRequests.length,1);
  assert.equal(timer(p).args[4],1);assert.deepEqual(p.messages.filter(m=>m===warning('candle')),[warning('candle'),warning('candle')]);
  ticks(p,5);assert.equal(hp(p),5);assert.equal(p.damageRequests.length,1);
  ticks(p,1);assert.equal(hp(p),0);assert.deepEqual(p.damageRequests.map(d=>d.amount),[25,25]);finishDeath(p);
});
test('Ana gas page Continue completes the real ring rescue and releases the early saved timer',()=>{
  const p=start(fixture(['lit_candle','ring_of_life','thanainabarrel'],undefined,100,30));
  assert(held(p,'ring_of_life',2));ticks(p,7);assert.equal(p.activeScript?.execution,ScriptState.PAUSEBUTTON);
  clear(p);ownership(p);assert.equal(timer(p).args[0],1);assert.equal(timer(p).args[1],roots[0]);
  resumeDialogue(p);assert(p.delayed,'ordinary ring teleport really suspends');
  for(let i=0;i<12&&p.z>9000;i++){ticks(p,1);ownership(p,p.z>9000);}
  ownership(p,false);assert.equal(p.overlay,-1);assert.equal(count(p,'ring_of_life',worn),0);
  assert.equal(count(p,'thanainabarrel'),0);ticks(p,40);ownership(p,false);assert.equal(hp(p),5);
  assert.deepEqual(p.damageRequests.map(d=>d.amount),[25]);
});
test('Ana gas page real walking dismissal cancels spent state and a later relight still gets warned seven',()=>{
  const p=start(fixture(['tinderbox','lit_candle','ring_of_life','thanainabarrel'],[0,3152,9585],100,30));
  assert(held(p,'ring_of_life',2));ticks(p,7);assert.equal(p.activeScript?.execution,ScriptState.PAUSEBUTTON);
  assert(moveHandler.handle(new MoveClick([{x:3152,z:9586}],0,false),p));assert.equal(p.activeScript,null);
  ticks(p,2);assert.deepEqual(tile(p),[0,3152,9586]);clear(p);assert.equal(hp(p),5);
  assert(use(p,'tinderbox','unlit_candle'));ticks(p,6);assert.equal(hp(p),5);
  assert.equal(p.messages.filter(m=>m===warning('candle')).length,2);
  ticks(p,1);assert.equal(hp(p),0);finishDeath(p);
});
test('Ana gas page Continue after ownership release cannot recreate even an early saved controller',()=>{
  const p=start(fixture(['lit_candle','ring_of_life','thanainabarrel'],undefined,100,30));
  assert(held(p,'ring_of_life',2));ticks(p,7);assert.equal(p.activeScript?.execution,ScriptState.PAUSEBUTTON);
  const paused=p.activeScript;release(p);assert.equal(p.activeScript,paused);
  resumeDialogue(p);for(let i=0;i<12&&p.z>9000;i++)ticks(p,1);
  ticks(p,40);ownership(p,false);assert.equal(hp(p),5);assert.equal(p.overlay,-1);
});
test('gas varbit transmits only changed countdown values, including one clear',()=>{
  const p=start(fixture(['lit_candle']));const durable=2;
  ticks(p,7);
  assert.deepEqual(gasPackets(p).map(packet=>packet.value),[durable,...[1,2,3,4,5,6].map(n=>durable|(n<<6)),durable]);
  const packets=gasPackets(p).length;ticks(p,10);assert.equal(gasPackets(p).length,packets);release(p);
});
test('full backpack replaces only the provoking source without destruction or fuel loss',()=>{
  const p=start(fixture([...Array(27).fill('hammer'),'oil_lamp_lit']));ticks(p,7);
  assert.equal(inventory(p).filter(Boolean).length,28);assert.equal(count(p,'hammer'),27);assert.equal(count(p,'oil_lamp_unlit'),1);
  assert.equal(hp(p),75);noExtras(p);release(p);
});
test('legally worn mining helmet is covered-only safety with actual equip',()=>{
  const p=start(fixture(['cave_goblin_mining_helmet_lit']));assert(held(p,'cave_goblin_mining_helmet_lit',2));
  assert.equal(count(p,'cave_goblin_mining_helmet_lit',worn),1);ticks(p,40);clear(p);assert.equal(hp(p),100);assert.deepEqual(p.messages,[]);release(p);
});
console.log(`SC04 gas: ${cases-failures}/${cases} passed`);process.exit(failures?1:0);
