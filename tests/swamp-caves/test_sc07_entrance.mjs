#!/usr/bin/env node
/** SC-07: production packets, scripts, saves, collision and personal rope state. */
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, ScriptProvider, ServerTriggerType, PlayerStat,
  PlayerTimerType, types, map, CollisionType, engineModule, id, player, seed,
  inventory, count, held, use, useLoc, beginLocUse, execute, tile, environmentTick } from './runtime.mjs';
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
const parent = id('VarPlayerType', 'goblin_caves'), rope = id('VarBitType', 'swamp_caves_roped_entrance');
const entered = id('VarBitType', 'entered_goblin_caves'), flag = id('VarBitType', 'darkness_level');
const gas = id('VarBitType', 'swamp_gas_turns'), quest = id('VarBitType', 'lost_tribe_quest');
const top = [0,3168,3172], bottom = [0,3168,9572];
const entrance = World.getLoc(3169,3172,0,id('LocType','goblin_cave_entrance'));
const exit = World.getLoc(3169,9572,0,id('LocType','swamp_cave_climbing_rope'));
assert(entrance && exit, 'both original natural placements');
let cases = 0, failures = 0;
function test(name, run) {
  cases++;
  try { JavaRandom.setSeed(0); run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
const timer = p => p.timers.get(controller.id);
const hp = p => p.levels[PlayerStat.HITPOINTS];
function fixture(items = [], position = top) {
  const p = seed(player(), items); [p.level,p.x,p.z] = position;
  execute('[proc,update_bas]',p); p.hits = [];
  const damage = p.applyDamage;
  p.applyDamage = function(amount,type) { p.hits.push({tick:World.currentTick,amount,type}); return damage.call(this,amount,type); };
  return p;
}
function finish(p) {
  p.delayed = false; p.activeScript = null; p.closeModal(); execute('[proc,swamp_cave_release]',p);
  p.clearInteraction(); p.isActive = false; World.players[p.pid] = null; p.unlink();
}
function ticks(p,n) { for (let i=0;i<n;i++) environmentTick(p); }
function click(p,loc,option=1) {
  p.originX=p.x; p.originZ=p.z;
  const accepted=locHandler.handle(new OpLoc(option,loc.x,loc.z,loc.type),p);
  if (accepted) p.processInteraction();
  return accepted;
}
function ownership(p,expected=true) {
  assert.equal(p.getVarBit(flag),Number(expected));
  assert.equal(Boolean(timer(p)),expected);
  if(expected) { assert.equal(timer(p).type,PlayerTimerType.SOFT); assert.equal(timer(p).args.length,5); }
}
function enter(p) { assert(useLoc(p,'rope',entrance)); assert.deepEqual(tile(p),bottom); ownership(p); }
function out(p) { assert(click(p,exit)); assert.deepEqual(tile(p),top); ownership(p,false); assert.equal(p.overlay,-1); assert.equal(p.getVarBit(gas),0); }
function silent(p) {
  assert.deepEqual(p.messages,[]);
  assert(!p.packets.some(packet=>/Synth|Spotanim/.test(packet.constructor.name)));
  assert.equal(p.delayed,false); assert.equal(p.activeScript,null);
}
function reload(p) {
  const bytes=p.save(); assert(PlayerLoading.verify(new Packet(bytes)));
  const q=PlayerLoading.load(p.username,new Packet(bytes),null);
  q.pid=p.pid; q.slot=p.slot; q.uid=p.uid; q.isActive=true; q.messages=[]; q.packets=[];
  q.write=packet=>q.packets.push(packet); q.messageGame=text=>q.messages.push(String(text)); q.wrappedMessageGame=q.messageGame;
  World.players[q.pid]=q; World.playerLoop.add(q.username37,q); return q;
}
test('original identities/options, adjacent collision-safe arrivals and native operation reach',()=>{
  assert.equal(entrance.type,5947); assert.equal(exit.type,5946);
  assert.deepEqual(types.LocType.get(entrance.type).op,['Climb-down',null,null,null,null]);
  assert.deepEqual(types.LocType.get(exit.type).op,['Climb',null,null,null,null]);
  for(const [loc,position] of [[entrance,top],[exit,bottom]]) {
    const p=fixture([],position); assert(p.inOperableDistance(loc)); assert(!map.isMapBlocked(p.x,p.z,p.level));
    assert(map.isMapBlocked(exit.x,exit.z,0),'the original rope footprint is not the arrival');
    for(let op=1;op<5;op++) for(const trigger of [ServerTriggerType.APLOC1+op,ServerTriggerType.OPLOC1+op]) assert(!ScriptProvider.getByTrigger(trigger,loc.type,types.LocType.get(loc.type).category));
    finish(p);
  }
});
for(const items of [[],['rope'],['slayer_buglan_on']]) test(`fresh Climb-down does not install a carried rope: ${items.join(',')||'empty'}`,()=>{
  const p=fixture(items),before=[...p.vars],bag=inventory(p); assert(click(p,entrance));
  assert.deepEqual(tile(p),top); assert.deepEqual([...p.vars],before); assert.deepEqual(inventory(p),bag); ownership(p,false); silent(p); finish(p);
});
for(const items of [[],['bullseye_lantern_lit'],['slayer_buglan_on']]) test(`first own rope descends without a light gate: ${items.join(',')||'no light'}`,()=>{
  const p=fixture(['rope',...items]); const before=[...p.stats]; enter(p);
  assert.equal(count(p,'rope'),0); assert.equal(p.getVarBit(rope),1); assert.equal(p.getVarBit(entered),1);
  assert.equal(p.getVarBit(quest),0); assert.deepEqual([...p.stats],before); silent(p);
  assert.equal(p.overlay,id('Component',items.includes('bullseye_lantern_lit')?'inter_249':'inter_387'));
  if(!items.includes('bullseye_lantern_lit')) { ticks(p,30); assert.equal(hp(p),98); assert.equal(p.messages.at(-1),'Tiny biting insects swarm all over you!'); }
  finish(p);
});
test('two players never share rope, history, light or permission',()=>{
  const p=fixture(['rope','bullseye_lantern_lit']),q=fixture(); enter(p); assert(click(q,entrance));
  assert.deepEqual(tile(q),top); assert.equal(q.getVarBit(rope),0); assert.equal(q.getVarBit(entered),0); silent(q);
  seed(q,['rope']); enter(q); assert.equal(q.overlay,id('Component','inter_387')); assert.equal(count(q,'rope'),0);
  assert.equal(p.overlay,id('Component','inter_249')); finish(p); finish(q);
});
for(const full of [false,true]) test(`installation consumes exactly one own rope, repeat descent consumes none${full?' with a full bag':''}`,()=>{
  const p=fixture(['rope','rope',...(full?Array(26).fill('hammer'):[])]); enter(p); assert.equal(count(p,'rope'),1); out(p);
  assert(click(p,entrance)); assert.deepEqual(tile(p),bottom); assert.equal(count(p,'rope'),1); out(p);
  assert(useLoc(p,'rope',entrance)); assert.equal(count(p,'rope'),1); assert.deepEqual(tile(p),bottom); silent(p); finish(p);
});
test('re-entry with no remaining rope retains one own installed flag',()=>{
  const p=fixture(['rope']); enter(p); out(p); assert(click(p,entrance)); assert.deepEqual(tile(p),bottom);
  assert.equal(count(p,'rope'),0); assert.equal(p.getVarBit(rope),1); ownership(p); finish(p);
});
for(const item of ['hammer','tinderbox']) test(`wrong item ${item} is silently inert and conserved`,()=>{
  const p=fixture([item]),vars=[...p.vars],bag=inventory(p); assert(useLoc(p,item,entrance));
  assert.deepEqual(tile(p),top); assert.deepEqual([...p.vars],vars); assert.deepEqual(inventory(p),bag); silent(p); finish(p);
});
for(const action of ['use','repeat','exit']) test(`native destination collision cancels ${action} before consumption, state or release`,()=>{
  const p=fixture(['rope']);
  if(action!=='use') { enter(p); if(action==='repeat') out(p); }
  const destination=action==='exit'?top:bottom,prior={vars:[...p.vars],bag:inventory(p),tile:tile(p),overlay:p.overlay,timer:timer(p)};
  map.changeLandCollision(destination[1],destination[2],destination[0],true);
  try { assert(map.isMapBlocked(destination[1],destination[2],destination[0])); if(action==='use') assert(useLoc(p,'rope',entrance)); else assert(click(p,action==='exit'?exit:entrance));
    assert.deepEqual(tile(p),prior.tile); assert.deepEqual([...p.vars],prior.vars); assert.deepEqual(inventory(p),prior.bag); assert.equal(p.overlay,prior.overlay); assert.equal(timer(p),prior.timer);
  } finally { map.changeLandCollision(destination[1],destination[2],destination[0],false); finish(p); }
});
test('duplicate item-use input settles one installation only',()=>{
  const p=fixture(['rope','rope']); assert(beginLocUse(p,'rope',entrance,{x:p.x,z:p.z}));
  assert(beginLocUse(p,'rope',entrance,{x:p.x,z:p.z})); p.processInteraction();
  assert.deepEqual(tile(p),bottom); assert.equal(count(p,'rope'),1); assert.equal(p.getVarBit(rope),1); finish(p);
});
test('ordinary movement cancels an armed distant rope approach before consumption',()=>{
  const p=fixture(['rope'],[0,3161,3172]); assert(beginLocUse(p,'rope',entrance,{x:3168,z:3172}));
  assert(moveHandler.handle(new MoveClick([{x:3160,z:3172}],0,false),p)); ticks(p,15);
  assert.equal(p.getVarBit(rope),0); assert.equal(p.getVarBit(entered),0); assert.equal(count(p,'rope'),1); assert.equal(p.z<4800,true); finish(p);
});
test('real save/load and login preserve installed rope and history while clearing/reconstructing only transient fields',()=>{
  const p=fixture(['rope','bullseye_lantern_lit']); enter(p); const durable=p.getVar(parent)&~((3<<1)|(7<<6));
  execute('[logout,_]',p); const q=reload(p); execute('[login,_]',q); assert.equal(q.getVar(parent)&~((3<<1)|(7<<6)),durable);
  assert.equal(q.getVarBit(rope),1); assert.equal(q.getVarBit(entered),1); assert.equal(q.getVarBit(gas),0); ownership(q); assert.equal(timer(q).args[0],0);
  out(q); const r=reload(q); execute('[login,_]',r); ownership(r,false); assert.equal(r.getVarBit(rope),1);
  assert(click(r,entrance)); assert.deepEqual(tile(r),bottom); assert.equal(count(r,'rope'),0); finish(p); finish(q); finish(r);
});
for(const light of [false,true]) for(const elapsed of [14,29,31]) test(`real rope exit releases ${light?'lit':'dark'} cave at elapsed ${elapsed}, no later bite`,()=>{
  const p=fixture(['rope',...(light?['bullseye_lantern_lit']:[])]); enter(p); ticks(p,elapsed); const before=hp(p); out(p);
  const messages=[...p.messages]; ticks(p,40); assert.equal(hp(p),before); assert.deepEqual(p.messages,messages); ownership(p,false);
  assert(click(p,entrance)); assert.deepEqual(tile(p),bottom); assert.equal(timer(p).args[0],0); assert.deepEqual(timer(p).args.slice(2),[-1,-1,0]); finish(p);
});
test('real pending gas exposure is cancelled by walking to the rope and ascending',()=>{
  const p=fixture(['lit_candle'],[0,3168,9584]); execute('[proc,swamp_cave_start]',p); ticks(p,2); assert.equal(p.getVarBit(gas),2);
  p.x=bottom[1];p.z=bottom[2]; // Compiled own-position fixture at the real exit with a genuinely pending gas action.
  out(p); const before=hp(p); ticks(p,40); assert.equal(hp(p),before); assert.equal(count(p,'lit_candle'),1); ownership(p,false); finish(p);
});
for(const [name,x] of [['lost_tribe_cellar_wall',3219],['lost_tribe_cellar_wall_back',3221]]) for(let stage=0;stage<=11;stage++) test(`${name} stage ${stage}: original morph and real packet never grants mine travel, progress or scripted text`,()=>{
  const loc=World.getLoc(x,9618,0,id('LocType',name)),type=types.LocType.get(loc.type);
  const p=fixture([], [0,x,9618]); p.setVarBit(quest,stage); const child=types.LocType.get(type.multiloc[stage]);
  assert.equal(child.id,stage>=4?6905:name==='lost_tribe_cellar_wall'?(stage===0?6904:6903):6909);
  const before={vars:[...p.vars],bag:inventory(p),tile:tile(p)}; assert.equal(click(p,loc),stage>=4);
  assert.deepEqual(tile(p),before.tile); assert.deepEqual([...p.vars],before.vars); assert.deepEqual(inventory(p),before.bag);
  assert.deepEqual(p.messages,[]); finish(p);
});
for(const stand of [[0,3224,9600],[0,3224,9602]]) test(`southern hole6912 remains closed from ${stand}`,()=>{
  const loc=World.getLoc(3224,9601,0,6912);assert(loc);const p=fixture([],stand),before=[...p.vars];
  const type=types.LocType.get(loc.type); assert(!ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,type.id,type.category));
  assert(click(p,loc)); ticks(p,4); assert.deepEqual(tile(p),stand); assert.deepEqual([...p.vars],before); finish(p);
});
for(const typeId of [6919,6920]) test(`city door ${typeId} has no visible operation or native dispatch`,()=>{
  const type=types.LocType.get(typeId); assert(!type.op || type.op.every(value=>value===null));
  for(const trigger of [ServerTriggerType.APLOC1,ServerTriggerType.OPLOC1]) assert(!ScriptProvider.getByTrigger(trigger,typeId,type.category));
});
let bankTiles=0;
for(let x=3148;x<=3155;x++) for(let z=9573;z<=9582;z++) if(!map.isMapBlocked(x,z,0)) {
  bankTiles++; test(`former cave-bank cell ${x},${z}: fire/cannon are not refused by a bank rule`,()=>{
    const p=fixture(['tinderbox','logs','twpart1'],[0,x,z]); const coord=CoordGrid.packCoord(0,x,z);
    assert.equal(execute('[proc,inzone_coord_pair_table]',p,[id('DbRowType','bank_zones'),coord]).popInt(),0);
    assert(use(p,'tinderbox','logs')); assert(!p.messages.includes("You can't light a fire here."));
    p.clearInteraction();p.activeScript=null;p.delayed=false;p.setVar(id('VarPlayerType','mcannon'),100);p.setVar(id('VarPlayerType','ownedmcannon'),-1);
    assert(held(p,'twpart1',1)); assert(!p.messages.includes("You can't set up a cannon here.")); finish(p);
  });
}
test('all 57 walkable former bank cells were exercised',()=>assert.equal(bankTiles,57));
test('real Draynor bank still refuses fire and cannon with their published text',()=>{
  const p=fixture(['tinderbox','logs','twpart1'],[0,3093,3244]); assert(use(p,'tinderbox','logs')); assert.deepEqual(p.messages,["You can't light a fire here."]);
  p.setVar(id('VarPlayerType','mcannon'),100);p.setVar(id('VarPlayerType','ownedmcannon'),-1);assert(held(p,'twpart1',1)); assert.equal(p.messages.at(-1),"You can't set up a cannon here."); finish(p);
});
for(const [position,message] of [
  [[0,2452,4471],'The talisman pulls towards the south-west.'],
  [[0,2406,4378],'The talisman pulls towards the south-east.'],
  [[0,2408,4377],null],
  [bottom,"The talisman doesn't seem to work here..."],
  [[0,3150,9580],"The talisman doesn't seem to work here..."],
  [[0,3318,9615],"The talisman doesn't seem to work here..."],
  [[2,3218,9532],"The talisman doesn't seem to work here..."]
]) test(`cosmic Locate at ${position} uses actual Zanaris, never the underground epoch`,()=>{
  const p=fixture(['cosmic_talisman'],position),before=inventory(p); assert(held(p,'cosmic_talisman',4));
  assert.deepEqual(p.messages,message?[message]:[]); assert.deepEqual(inventory(p),before); assert.deepEqual(tile(p),position); finish(p);
});
// Enumerate static native collision components, not a guessed rectangular NPC list.
function component(start) {
  const queue=[start],seen=new Set([`${start[1]},${start[2]}`]);
  for(let i=0;i<queue.length;i++) { const [level,x,z]=queue[i];
    for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) if((dx||dz)&&map.canTravel(level,x,z,dx,dz,1,0,CollisionType.NORMAL)) {
      const key=`${x+dx},${z+dz}`; if(!seen.has(key)) {seen.add(key);queue.push([level,x+dx,z+dz]);}
    }
    assert(queue.length<10000,'bounded original underground component');
  } return seen;
}
test('ordinary rope component has no closed-mine/cellar/city shortcut or old ladder/market route',()=>{
  const main=component(bottom),frog=component([0,3225,9542]); assert.equal(main.size,2016); assert.equal(frog.size,159);
  for(const [x,z] of [[3220,9618],[3318,9615],[3254,9590]]) assert(!main.has(`${x},${z}`));
  for(const name of ['zanarisladderout','zanarismarketdoor']) {
    const typeId=types.LocType.getId(name); if(typeId<0) continue;
    for(const key of main) {const [x,z]=key.split(',').map(Number);assert.equal(World.getLoc(x,z,0,typeId),null);}
  }
  assert(![...World.npcs].some(n=>n.type===id('NpcType','fairy_ladder_attendant')&&main.has(`${n.x},${n.z}`)));
  const census=new Map();
  for(const n of World.npcs) { const t=types.NpcType.get(n.baseType); if(n.level!==0 || !t.op?.includes('Attack'))continue;
    const area=main.has(`${n.x},${n.z}`)?'ordinary-walk':frog.has(`${n.x},${n.z}`)?'SE-stone-pocket':null; if(!area)continue;
    const key=`${area}:${t.id}`;const row=census.get(key)??{area,id:t.id,name:t.debugname,count:0,stats:t.stats};row.count++;census.set(key,row);
  }
  console.log('REACHABLE_NPCS',JSON.stringify([...census.values()]));
});
console.log(`SC07 entrance: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
