#!/usr/bin/env node
/** SC-07: production packets, scripts, saves, collision and personal rope state. */
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, ScriptProvider, ServerTriggerType, PlayerStat,
  PlayerTimerType, types, map, CollisionType, engineModule, id, obj, invCom, player, seed,
  inventory, count, held, use, useLoc, beginLocUse, dragInventory, execute, tile, environmentTick } from './runtime.mjs';
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const locUseHandler = new ((await engineModule('network/game/client/handler/OpLocUHandler.ts')).default)();
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
test('original identities/options, SC-07 dispatch, adjacent collision-safe arrivals and native operation reach',()=>{
  assert.equal(entrance.type,5947); assert.equal(exit.type,5946);
  assert.deepEqual(types.LocType.get(entrance.type).op,['Climb-down',null,null,null,null]);
  assert.deepEqual(types.LocType.get(exit.type).op,['Climb',null,null,null,null]);
  const dispatch=(loc,trigger)=>ScriptProvider.getByTrigger(trigger,loc.type,types.LocType.get(loc.type).category)?.name;
  assert.equal(dispatch(entrance,ServerTriggerType.OPLOC1),'[oploc1,goblin_cave_entrance]');
  assert.equal(dispatch(entrance,ServerTriggerType.OPLOCU),'[oplocu,goblin_cave_entrance]');
  assert.equal(dispatch(exit,ServerTriggerType.OPLOC1),'[oploc1,swamp_cave_climbing_rope]');
  for(const trigger of [ServerTriggerType.APLOC1,ServerTriggerType.APLOCU]) for(const loc of [entrance,exit]) assert.equal(dispatch(loc,trigger),undefined);
  assert.equal(dispatch(exit,ServerTriggerType.OPLOCU),undefined,'the cave rope keeps the engine default for items');
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
for(const item of ['hammer','tinderbox']) test(`wrong item ${item} keeps the published default response and is conserved`,()=>{
  const p=fixture([item,'rope']),vars=[...p.vars],bag=inventory(p); assert(useLoc(p,item,entrance)); ticks(p,3);
  assert.deepEqual(tile(p),top); assert.deepEqual([...p.vars],vars); assert.deepEqual(inventory(p),bag); ownership(p,false);
  assert.deepEqual(p.messages,['Nothing interesting happens.']); finish(p);
});
test('installation consumes the used rope slot, never another carried rope',()=>{
  const p=fixture(['rope','hammer','hammer','rope']); p.originX=p.x; p.originZ=p.z;
  assert(locUseHandler.handle(new OpLocU(entrance.x,entrance.z,entrance.type,obj('rope'),3,invCom),p)); p.processInteraction();
  assert.deepEqual(tile(p),bottom); assert.equal(p.getVarBit(rope),1);
  assert.deepEqual(inventory(p).slice(0,4).map(item=>item?.name??null),['rope','hammer','hammer',null]); finish(p);
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
test('a rope moved away from its used slot during the real approach walk is neither consumed nor installed',()=>{
  const p=fixture(['rope','hammer'],[0,3161,3172]); assert(beginLocUse(p,'rope',entrance,{x:3168,z:3172}));
  ticks(p,1); assert(dragInventory(p,0,1)); assert.deepEqual(inventory(p).slice(0,2).map(item=>item?.name),['hammer','rope']);
  for(let i=0;i<15&&(p.x!==3168||p.z!==3172);i++) ticks(p,1);
  ticks(p,2); assert.deepEqual(tile(p),top);
  assert.equal(p.getVarBit(rope),0); assert.equal(p.getVarBit(entered),0); assert.equal(count(p,'rope'),1); ownership(p,false); silent(p); finish(p);
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
test('synchronous rope release clears a pending gas count (compiled own-position move without a pass)',()=>{
  const p=fixture(['lit_candle'],[0,3168,9584]); execute('[proc,swamp_cave_start]',p); ticks(p,2); assert.equal(p.getVarBit(gas),2);
  // Unreachable by walking: the next pass outside the gas rectangle would clear it first.
  p.x=bottom[1];p.z=bottom[2];
  out(p); const before=hp(p); ticks(p,40); assert.equal(hp(p),before); assert.equal(count(p,'lit_candle'),1); ownership(p,false); finish(p);
});
// The only operable stands: each parent's own tile (cellar 3219,9618; maze 3221,9618).
for(const [name,x] of [['lost_tribe_cellar_wall',3219],['lost_tribe_cellar_wall_back',3221]]) for(let stage=0;stage<=11;stage++) test(`${name} stage ${stage}: original morph gates native passage without changing inventory or quest state`,()=>{
  const loc=World.getLoc(x,9618,0,id('LocType',name)),type=types.LocType.get(loc.type);
  const p=fixture(['bullseye_lantern_lit','tinderbox'], [0,x,9618]); p.setVarBit(quest,stage); const child=types.LocType.get(type.multiloc[stage]);
  assert.equal(child.id,stage>=4?6905:name==='lost_tribe_cellar_wall'?(stage===0?6904:6903):6909);
  if(stage>=4) assert.deepEqual(child.op,['Squeeze-through',null,null,null,null],'the visible original op stays');
  const before={vars:[...p.vars],quest:p.getVar(id('VarPlayerType','lost_tribe')),rope:p.getVarBit(rope),bag:inventory(p),tile:tile(p)};
  assert.equal(click(p,loc),stage>=4); ticks(p,4);
  const arrival=stage>=4?[0,x===3219?3222:3218,9618]:before.tile;
  assert.deepEqual(tile(p),arrival); assert(!map.isMapBlocked(arrival[1],arrival[2],arrival[0]),'packed arrival is walkable');
  assert.equal(p.getVar(id('VarPlayerType','lost_tribe')),before.quest); assert.equal(p.getVarBit(rope),before.rope);
  assert.deepEqual(inventory(p),before.bag);
  if(stage>=4) ownership(p,x===3219); else assert.deepEqual([...p.vars],before.vars);
  assert.deepEqual(p.messages,[]); finish(p);
});
// Hole 6912 (1x3 at 3224,9601-9603) is operable only from main-cave 3224,9600 and maze 3224,9604.
for(const stand of [[0,3224,9600],[0,3224,9604]]) for(const cleared of [false,true]) test(`southern hole6912 ${cleared?'cleared passage':'rubble gate'} from ${stand}`,()=>{
  const loc=World.getLoc(3224,9601,0,6912); assert(loc);
  const p=fixture(cleared?['bullseye_lantern_lit','tinderbox']:[],stand),dug=id('VarBitType','lost_tribe_hole_2_dug');
  p.setVarBit(quest,4); p.setVarBit(dug,Number(cleared));
  const fromCave=stand[2]<9602;
  if(cleared&&fromCave) execute('[proc,swamp_cave_start]',p);
  const before={vars:[...p.vars],bag:inventory(p),quest:p.getVar(id('VarPlayerType','lost_tribe')),rope:p.getVarBit(rope)};
  const type=types.LocType.get(loc.type); assert(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,type.id,type.category));
  assert(!map.isMapBlocked(stand[1],stand[2],0)); assert(p.inOperableDistance(loc));
  assert(click(p,loc)); ticks(p,4);
  assert.deepEqual(inventory(p),before.bag);
  assert.equal(p.getVar(id('VarPlayerType','lost_tribe')),before.quest); assert.equal(p.getVarBit(rope),before.rope);
  if(cleared) {
    const arrival=fromCave?[0,3224,9604]:[0,3224,9599];
    assert.deepEqual(tile(p),arrival); assert(!map.isMapBlocked(arrival[1],arrival[2],arrival[0]),'packed arrival is walkable');
    // Both sides lie in the existing main/mine cave-environment regions.
    ownership(p,true);
    assert.deepEqual(p.messages,[]);
  } else {
    assert.deepEqual(tile(p),stand); assert.deepEqual([...p.vars],before.vars);
    assert.equal(p.messages.length,1,'uncleared rubble explains the refusal');
  }
  finish(p);
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
// Real stands only: the ruin 2458 footprint (2407-2409,4376-4378) is blocked.
for(const [position,messages] of [
  [[0,2452,4471],['The talisman pulls towards the south-west.']],
  [[0,2406,4378],['The talisman pulls towards the south-east.']],
  [[0,2408,4380],['The talisman pulls towards the south.']],
  [[0,2410,4377],['The talisman pulls towards the west.']],
  [[0,3203,3169],['You can feel the power flowing through the talisman.','There must be something special about this place.']],
  [bottom,["The talisman doesn't seem to work here..."]],
  [[0,3150,9580],["The talisman doesn't seem to work here..."]],
  [[0,3225,9545],["The talisman doesn't seem to work here..."]],
  [[0,3318,9615],["The talisman doesn't seem to work here..."]],
  [[2,3218,9532],["The talisman doesn't seem to work here..."]],
  [[0,3210,9617],["The talisman doesn't seem to work here..."]]
]) test(`cosmic Locate at ${position} uses actual Zanaris, never the underground epoch`,()=>{
  assert(!map.isMapBlocked(position[1],position[2],position[0]),'a real stand');
  const p=fixture(['cosmic_talisman'],position),before=inventory(p); assert(held(p,'cosmic_talisman',4));
  assert.deepEqual(p.messages,messages); assert.deepEqual(inventory(p),before); assert.deepEqual(tile(p),position); finish(p);
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
test('retained dead-coordinate paths have no placement or dispatch reach from either rope component',()=>{
  const main=component(bottom),frog=component([0,3225,9542]),reach=new Set([...main,...frog]);
  assert.equal(main.size,2016); assert.equal(frog.size,159);
  for(const [x,z] of [[3219,9618],[3220,9618],[3221,9618],[3224,9604],[3318,9615],[3254,9590]]) assert(!reach.has(`${x},${z}`),`${x},${z} unreachable`);
  // ladders.rs2 ladder_1755 special case 0_50_149_22_52; doorman.rs2 market doors 0_50_149_38_22 and 0_50_149_33_18;
  // ladder_fairy.rs2 attendant search 0_50_149_54_54. Each script is retained; none of its locs/NPCs stands in reach.
  for(const name of ['[oploc1,ladder_1755]','[oploc1,zanarismarketdoor]','[oploc1,zanarisladderout]','[opnpc1,fairy_ladder_attendant]']) assert(ScriptProvider.getByName(name),`retained ${name}`);
  const locs=['ladder_1755','zanarismarketdoor','zanarisladderout'].map(name=>id('LocType',name));
  for(const [x,z] of [[3222,9588],[3238,9558],[3233,9554],[3254,9590]]) for(const typeId of locs) assert.equal(World.getLoc(x,z,0,typeId),null);
  for(const key of reach) { const [x,z]=key.split(',').map(Number);
    for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) for(const typeId of locs) assert.equal(World.getLoc(x+dx,z+dz,0,typeId),null,`no ${typeId} beside ${x},${z}`);
  }
  const people=['fairy_ladder_attendant','doorman'].map(name=>id('NpcType',name));
  assert(![...World.npcs].some(n=>people.includes(n.type)&&n.level===0&&n.x>=3136&&n.x<=3327&&n.z>=9536&&n.z<=9663),'no attendant or doorman in the cave squares');
});
test('reachable attackable NPC census from the rope components (record)',()=>{
  const main=component(bottom),frog=component([0,3225,9542]),census=new Map();
  for(const n of World.npcs) { const t=types.NpcType.get(n.baseType); if(n.level!==0 || !t.op?.includes('Attack'))continue;
    const area=main.has(`${n.x},${n.z}`)?'ordinary-walk':frog.has(`${n.x},${n.z}`)?'SE-stone-pocket':null; if(!area)continue;
    const key=`${area}:${t.id}`;const row=census.get(key)??{area,id:t.id,name:t.debugname,vislevel:t.vislevel,count:0,stats:t.stats};row.count++;census.set(key,row);
  }
  assert(census.size>0);
  console.log('REACHABLE_NPCS',JSON.stringify([...census.values()]));
});
console.log(`SC07 entrance: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
