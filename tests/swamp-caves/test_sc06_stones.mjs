#!/usr/bin/env node
/** SC-06: real map, native loc packets, production motion, hazards and inventory. */
import assert from 'node:assert/strict';
import { World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, PlayerTimerType,
  types, map, CollisionType, engineModule, id, obj, inv, worn, player, seed, inventory,
  count, held, use, execute, tile, dragInventory, slotOf, invButton } from './runtime.mjs';
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const { NetworkPlayer } = await engineModule('engine/entity/NetworkPlayer.ts');
const ClientSocket = (await engineModule('server/ClientSocket.ts')).default;
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
const flag = id('VarBitType','darkness_level'), gas = id('VarBitType','swamp_gas_turns');
const hp = p => p.levels[PlayerStat.HITPOINTS], xp = p => p.stats[PlayerStat.AGILITY];
const timer = p => p.timers.get(controller.id);
const roots = p => p.packets.filter(packet => packet.constructor.name === 'IfOpenOverlay');
const stones = [
  {name:'swamp_cave_steppingstone_a',x:3206,z:9572,angle:1,banks:[[0,3204,9572],[0,3208,9572]]},
  {name:'swamp_cave_steppingstone_b',x:3221,z:9554,angle:0,banks:[[0,3221,9556],[0,3221,9552]]}
];
const holes = [...World.npcs].filter(n => n.baseType === id('NpcType','swamp_wallbeast'));
let cases=0, failures=0, wireSerial=1499;
function test(name,run){cases++;try{JavaRandom.setSeed(0);run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}: ${error.stack??error}`);}}
function frame(p){
  p.resetEntity(false); for(const n of holes)n.resetEntity(false); World.currentTick++;
  for(const n of holes)n.turn();
  if(p.delayed && World.currentTick>=p.delayedUntil)p.delayed=false;
  if(!p.delayed && p.activeScript?.execution===ScriptState.SUSPENDED)p.executeScript(p.activeScript,true,true);
  p.processQueues();
  if(!p.loggingOut){p.processTimers(PlayerTimerType.NORMAL);p.processTimers(PlayerTimerType.SOFT);}
  p.processEngineQueue();p.processInteraction();
}
function ticks(p,n){for(let i=0;i<n;i++)frame(p);}
function wirePlayer(){
  const slot=++wireSerial,hash=BigInt(slot),p=new NetworkPlayer(`sc06wire${slot}`,hash,hash,new ClientSocket());
  p.pid=slot;p.slot=slot;p.uid=((slot<<11)|slot)>>>0;p.isActive=true;
  p.vars.fill(0);p.baseLevels.fill(99);p.levels.fill(99);p.stats.fill(0);p.messages=[];p.packets=[];
  p.write=packet=>p.packets.push(packet);p.messageGame=text=>p.messages.push(String(text));p.wrappedMessageGame=p.messageGame;
  World.players[p.pid]=p;World.playerLoop.add(hash,p);
  const com=id('Component','inventory:inv');p.tabs[3]=types.Component.get(com).rootLayer;p.invListenOnCom(inv,com,p.uid);
  return p;
}
function fixture(position=stones[0].banks[0],items=['bullseye_lantern_lit'],actor=player()){
  const p=seed(actor,items);[p.level,p.x,p.z]=position;
  p.baseLevels[PlayerStat.AGILITY]=1;p.levels[PlayerStat.AGILITY]=1;
  p.stats[PlayerStat.AGILITY]=0;
  execute('[proc,update_bas]',p);p.damageRequests=[];p.animations=[];p.moves=[];
  const damage=p.applyDamage,animation=p.playAnimation,teleport=p.teleport;
  p.applyDamage=function(amount,type){p.damageRequests.push({tick:World.currentTick,amount,type});return damage.call(this,amount,type);};
  p.playAnimation=function(seq,delay){p.animations.push({tick:World.currentTick,seq,delay});return animation.call(this,seq,delay);};
  p.teleport=function(x,z,level){p.moves.push({tick:World.currentTick,tile:[level,x,z]});return teleport.call(this,x,z,level);};
  execute('[proc,swamp_cave_start]',p);return p;
}
function finish(p){p.delayed=false;p.activeScript=null;execute('[proc,swamp_cave_release]',p);p.clearInteraction();p.isActive=false;World.players[p.pid]=null;p.unlink();}
function ownership(p){assert.equal(p.getVarBit(flag),1);assert.equal(timer(p)?.type,PlayerTimerType.SOFT);assert.equal(timer(p).args.length,5);assert.equal([...p.timers.values()].filter(t=>t.script.id===controller.id).length,1);}
function loc(stone,level=0){const l=World.getLoc(stone.x,stone.z,level,id('LocType',stone.name));assert(l,stone.name);return l;}
function click(p,stone,option=1){const l=loc(stone,stone.name==='tog_cave_up'?2:0);p.originX=p.x;p.originZ=p.z;const accepted=locHandler.handle(new OpLoc(option,l.x,l.z,l.type),p);if(accepted)p.processInteraction();return accepted;}
function walk(p,to){
  const [level,x,z]=to;assert.equal(p.level,level);
  const route=Array.from(map.findPath(level,p.x,p.z,x,z),value=>{const c=CoordGrid.unpackCoord(value);return{x:c.x,z:c.z};});
  assert(route.length,'native client route exists');p.originX=p.x;p.originZ=p.z;
  return moveHandler.handle(new MoveClick(route,0,false),p);
}
function arrive(p,to,max=150){assert(walk(p,to));for(let i=0;i<max && tile(p).some((v,j)=>v!==to[j]);i++)ticks(p,1);assert.deepEqual(tile(p),to);}
function seedFor(level,success){
  const cutoff=Math.floor(51*(99-Math.min(level,99))/98)+Math.floor(252*(Math.min(level,99)-1)/98)+1;
  for(let seedValue=0;seedValue<200000;seedValue++){JavaRandom.setSeed(seedValue);if((Math.floor(JavaRandom.nextDouble()*256)<cutoff)===success)return seedValue;}
  assert.fail('native RNG outcome seed missing');
}
function begin(p,stone,success){JavaRandom.setSeed(seedFor(p.levels[PlayerStat.AGILITY],success));assert(click(p,stone));assert(p.delayed,'native APLOC owns the crossing delay');return World.currentTick;}
function cross(p,stone,success){const start=begin(p,stone,success);ticks(p,4);assert(!p.activeScript,`unexpected continuation ${p.activeScript?.script.name}`);assert.equal(p.delayed,false);return start;}
const water = [
  ['lit_candle','unlit_candle'],['lit_black_candle','unlit_black_candle'],['torch_lit','torch_unlit'],
  ['candle_lantern_lit','unlit_candle'],['candle_lantern_unlit','unlit_candle'],
  ['candle_lantern_black_lit','unlit_black_candle'],['candle_lantern_black_unlit','unlit_black_candle'],
  ['oil_lamp_lit','oil_lamp_unlit'],['oil_lantern_lit','oil_lantern_unlit']
];
const unchanged = ['unlit_candle','unlit_black_candle','torch_unlit','candle_lantern_empty',
  'oil_lamp_empty','oil_lamp_unlit','oil_lantern_empty','oil_lantern_unlit',
  'bullseye_lantern_nolens','bullseye_lantern_empty','bullseye_lantern_unlit','bullseye_lantern_lit',
  'tog_sapphire_lantern_empty','tog_sapphire_lantern_unlit','tog_sapphire_lantern_lit',
  'cave_goblin_mining_helmet_unlit','cave_goblin_mining_helmet_lit','slayer_buglan_off','slayer_buglan_on','hammer','tinderbox'];
for(const stone of stones)test(`${stone.name}: original map shape, collision and direct option dispatch`,()=>{
  const l=loc(stone),t=types.LocType.get(l.type);assert.equal(l.shape,22);assert.equal(l.angle,stone.angle);assert.deepEqual(t.op,['Jump-across',null,null,null,null]);
  assert(ScriptProvider.getByTrigger(ServerTriggerType.APLOC1,t.id,t.category));assert(map.isMapBlocked(l.x,l.z,0));
  for(const [level,x,z]of stone.banks){assert(!map.isMapBlocked(x,z,level));assert.equal(map.reachedLoc(level,x,z,l.x,l.z,t.width,t.length,1,l.angle,l.shape,t.forceapproach),false,'shape 22 needs APLOC, not impossible water contact');}
  for(const trigger of [ServerTriggerType.APLOC2,ServerTriggerType.APLOC3,ServerTriggerType.APLOC4,ServerTriggerType.APLOC5,ServerTriggerType.OPLOC2,ServerTriggerType.OPLOC3,ServerTriggerType.OPLOC4,ServerTriggerType.OPLOC5])assert(!ScriptProvider.getByTrigger(trigger,t.id,t.category));
});
for(const stone of stones)for(const bank of [0,1])for(const level of [1,50,99,120])for(const success of [false,true])test(`${stone.name} bank ${bank} level ${level}: ${success?'success 3':'failure 1'} XP, one owned draw, safe tick-two landing and tick-four unlock`,()=>{
  const p=fixture(stone.banks[bank]);p.baseLevels[PlayerStat.AGILITY]=Math.min(level,99);p.levels[PlayerStat.AGILITY]=level;p.stats[PlayerStat.AGILITY]=level===1?0:getExpByLevel(Math.min(level,99));
  const original=Runner.HANDLERS[ScriptOpcode.STAT_RANDOM];let draws=0;
  Runner.HANDLERS[ScriptOpcode.STAT_RANDOM]=state=>{if(state.script.name==='[proc,swamp_cave_stone]')draws++;return original(state);};
  const before=xp(p),health=hp(p),pack=inventory(p);
  try{
    const start=begin(p,stone,success);assert.equal(draws,1);assert.equal(p.animations[0].seq,id('SeqType','human_steppingstonejump'));
    ticks(p,1);assert.deepEqual(tile(p),stone.banks[bank]);assert.equal(xp(p),before);assert(p.delayed);
    ticks(p,1);assert.deepEqual(tile(p),stone.banks[success?1-bank:bank]);assert(p.delayed);assert.equal(xp(p),before);
    assert.equal(p.moves.at(-1).tick,start+2);assert(!map.isMapBlocked(p.x,p.z,p.level));
    ticks(p,1);assert(p.delayed);ticks(p,1);assert(!p.delayed);assert(!p.activeScript,`unexpected continuation ${p.activeScript?.script.name}`);
    assert.equal(xp(p)-before,success?30:10);assert.equal(draws,1);assert.equal(hp(p),health);assert.deepEqual(p.damageRequests,[]);assert.deepEqual(inventory(p),pack);
    assert.deepEqual(p.messages,[]);assert(!p.packets.some(packet=>/Synth|Spotanim/.test(packet.constructor.name)));ownership(p);
    assert.equal(p.animations.some(a=>a.seq===id('SeqType','human_climbing_fall')),!success);
  }finally{Runner.HANDLERS[ScriptOpcode.STAT_RANDOM]=original;finish(p);}
});
for(const [source,result]of [...water,...unchanged.map(name=>[name,name])])for(const success of [false,true])test(`${success?'success retains':'failure settles'} carried ${source}`,()=>{
  const p=fixture(stones[0].banks[0],[source]);const expected=success?source:result;
  cross(p,stones[0],success);assert.deepEqual(inventory(p).filter(Boolean),[{name:expected,count:1}]);assert.deepEqual(p.damageRequests,[]);ownership(p);finish(p);
});
for(const source of ['cave_goblin_mining_helmet_lit','cave_goblin_mining_helmet_unlit'])test(`worn ${source} resists water and retains brightness eligibility`,()=>{
  const p=fixture(stones[0].banks[0],[source]);assert(held(p,source,2));ticks(p,1);cross(p,stones[0],false);assert.equal(count(p,source,worn),1);assert.equal(count(p,source),0);assert.equal(execute('[proc,swamp_cave_light]',p).popInt(),source.endsWith('_lit')?2:0);finish(p);
});
for(const source of ['candle_lantern_lit','candle_lantern_black_lit'])test(`full backpack: ${source} loses glass, retains exactly its candle and all 27 other items`,()=>{
  const p=fixture(stones[0].banks[0],[source,...Array(27).fill('hammer')]);cross(p,stones[0],false);
  assert.equal(count(p,source),0);assert.equal(count(p,source.includes('black')?'unlit_black_candle':'unlit_candle'),1);assert.equal(count(p,'candle_lantern_empty'),0);assert.equal(count(p,'hammer'),27);assert.equal(inventory(p).filter(Boolean).length,28);finish(p);
});
test('mixed backpack: all vulnerable sources settle once, all resistant and unrelated forms remain',()=>{
  const names=[...water.map(([source])=>source),'bullseye_lantern_lit','tog_sapphire_lantern_lit','cave_goblin_mining_helmet_lit','tinderbox'];const p=fixture(stones[0].banks[0],names);
  cross(p,stones[0],false);const expected=names.map(name=>water.find(([source])=>source===name)?.[1]??name).sort();
  assert.deepEqual(inventory(p).filter(Boolean).flatMap(item=>Array(item.count).fill(item.name)).sort(),expected);assert.equal(execute('[proc,swamp_cave_light]',p).popInt(),3);finish(p);
});
test('a real inventory drag during the delay rolls back and settlement keeps both original slots',()=>{
  const p=fixture(stones[0].banks[0],['candle_lantern_lit','hammer']);begin(p,stones[0],false);const before=inventory(p),mark=p.packets.length;
  assert.equal(dragInventory(p,0,1),false);assert.deepEqual(inventory(p),before);assert.equal(p.packets.at(-1).constructor.name,'UpdateInvPartial');assert.equal(p.packets.length,mark+1);
  ticks(p,4);assert.equal(p.invGetSlot(inv,0)?.id,obj('unlit_candle'));assert.equal(p.invGetSlot(inv,1)?.id,obj('hammer'));assert.equal(count(p,'candle_lantern_empty'),0);finish(p);
});
test('a real drag during the cancellable approach moves the lantern and settlement uses its current slot',()=>{
  const p=fixture([0,3192,9571],['candle_lantern_lit','hammer','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));
  assert(walk(p,stones[0].banks[0]));assert(locHandler.handle(new OpLoc(1,stones[0].x,stones[0].z,id('LocType',stones[0].name)),p));ticks(p,1);
  assert(!p.delayed);assert(p.target);assert(dragInventory(p,0,1));assert.equal(slotOf(p,'candle_lantern_lit'),1);JavaRandom.setSeed(seedFor(1,false));
  const before=xp(p);for(let i=0;i<50 && xp(p)===before;i++)ticks(p,1);
  assert.equal(xp(p)-before,10);assert.equal(p.invGetSlot(inv,0)?.id,obj('hammer'));assert.equal(p.invGetSlot(inv,1)?.id,obj('unlit_candle'));assert.equal(count(p,'candle_lantern_empty'),0);finish(p);
});
for(const [item,option,result]of [['candle_lantern_lit',2,'candle_lantern_unlit'],['candle_lantern_lit',5,null],['wallbeast_spike_helmet',2,null],['shark',1,null]])test(`real ${item} operation ${option} during approach cancels crossing before changing the backpack`,()=>{
  const p=fixture([0,3192,9571],[item]);assert(walk(p,stones[0].banks[0]));assert(locHandler.handle(new OpLoc(1,stones[0].x,stones[0].z,id('LocType',stones[0].name)),p));ticks(p,1);
  assert(!p.delayed);assert(p.target);assert(held(p,item,option));assert.equal(p.target,null);assert.equal(count(p,item),0);if(result)assert.equal(count(p,result),1);
  ticks(p,30);assert.equal(xp(p),0);assert.equal(p.animations.some(a=>a.seq===id('SeqType','human_steppingstonejump')),false);finish(p);
});
test('a real trade closed by the stone click restores its offered lantern before water settlement',()=>{
  const p=fixture(stones[0].banks[0],['candle_lantern_lit']),q=fixture(stones[0].banks[0]);
  execute('[opplayer4,_]',p,[],{target:q});p.resetEntity(false);q.resetEntity(false);execute('[opplayer4,_]',q,[],{target:p});
  assert(invButton(p,'tradeside:inv','candle_lantern_lit',1,slotOf(p,'candle_lantern_lit')));assert.equal(count(p,'candle_lantern_lit'),0);
  begin(p,stones[0],false);assert.equal(p.modalMain,-1);assert.equal(q.modalMain,-1);assert.equal(count(p,'candle_lantern_lit'),1);
  ticks(p,4);assert.equal(count(p,'unlit_candle'),1);assert.equal(count(p,'candle_lantern_empty'),0);finish(p);finish(q);
});
test('a normal other-player cracker gift during approach is retained by current-inventory settlement',()=>{
  const p=fixture([0,3192,9571],['candle_lantern_lit','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));assert(walk(p,stones[0].banks[0]));
  assert(locHandler.handle(new OpLoc(1,stones[0].x,stones[0].z,id('LocType',stones[0].name)),p));ticks(p,1);assert(!p.delayed);assert(p.target);
  const q=fixture(tile(p),['christmas_cracker']);JavaRandom.setSeed(seedFor(1,true));q.executeScript(Runner.init(ScriptProvider.getByName('[opplayeru,christmas_cracker]'),q,p),true);
  const gifts=inventory(p).filter(Boolean).filter(item=>!['candle_lantern_lit'].includes(item.name));assert.equal(gifts.length,2);assert.equal(count(q,'christmas_cracker'),0);assert(p.target);
  JavaRandom.setSeed(seedFor(1,false));for(let i=0;i<50 && xp(p)===0;i++)ticks(p,1);assert.equal(xp(p),10);assert.equal(count(p,'unlit_candle'),1);
  for(const item of gifts)assert.equal(count(p,item.name),item.count);finish(p);finish(q);
});
test('another player cannot give a cracker prize or open trade while the crossing is delayed',()=>{
  const p=fixture(stones[0].banks[0],['candle_lantern_lit']),q=fixture(stones[0].banks[0],['christmas_cracker']);begin(p,stones[0],false);const before=inventory(p),continuation=p.activeScript;
  q.executeScript(Runner.init(ScriptProvider.getByName('[opplayeru,christmas_cracker]'),q,p),true);q.executeScript(Runner.init(ScriptProvider.getByName('[opplayer4,_]'),q,p),true);
  assert.deepEqual(inventory(p),before);assert.equal(count(q,'christmas_cracker'),1);assert.equal(p.modalMain,-1);assert.equal(p.activeScript,continuation);
  assert(q.messages.some(text=>/busy/.test(text)));ticks(p,4);assert.equal(count(p,'unlit_candle'),1);finish(p);finish(q);
});
test('a real gas explosion during the client approach changes the source before water reads the backpack',()=>{
  const p=fixture([0,3214,9560],['lit_candle','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,6);assert.equal(timer(p).args[4],6);
  assert(walk(p,stones[1].banks[0]));assert(locHandler.handle(new OpLoc(1,stones[1].x,stones[1].z,id('LocType',stones[1].name)),p));JavaRandom.setSeed(seedFor(1,false));ticks(p,1);
  assert.equal(count(p,'lit_candle'),0);assert.equal(count(p,'unlit_candle'),1);assert.equal(p.damageRequests.length,1);const health=hp(p);
  for(let i=0;i<60 && xp(p)===0;i++)ticks(p,1);assert.equal(xp(p),10);assert.equal(count(p,'unlit_candle'),1);assert.equal(hp(p),health);assert.equal(p.damageRequests.length,1);ownership(p);finish(p);
});
for(const approach of [true,false])test(`native firecracker long-queue transformation ${approach?'during cancellable approach':'waits through owned settlement'}`,()=>{
  const p=fixture(approach?[0,3192,9571]:stones[0].banks[0],['candle_lantern_lit','bullseye_lantern_lit','tinderbox','viking_firecracker','viking_firecracker','wallbeast_spike_helmet']);
  assert(held(p,'wallbeast_spike_helmet',2));assert(use(p,'tinderbox','viking_firecracker'));assert(use(p,'tinderbox','viking_firecracker'));
  assert.equal(count(p,'viking_firecracker_lit'),2);const fuses=[...p.queue.all()].filter(q=>q.script.name==='[queue,firecracker_explode]');assert.equal(fuses.length,2);
  ticks(p,Math.min(...fuses.map(q=>q.delay))-1);assert.equal(count(p,'viking_firecracker_lit'),2);
  if(approach){
    assert(walk(p,stones[0].banks[0]));assert(locHandler.handle(new OpLoc(1,stones[0].x,stones[0].z,id('LocType',stones[0].name)),p));ticks(p,2);
    assert(!p.delayed);assert(p.target);assert.equal(xp(p),0);assert.equal(count(p,'viking_firecracker_lit'),0);assert.equal(count(p,'viking_firecracker'),1);
    JavaRandom.setSeed(seedFor(1,false));for(let i=0;i<50 && xp(p)===0;i++)ticks(p,1);
  }else{
    begin(p,stones[0],false);ticks(p,2);assert.equal(count(p,'viking_firecracker_lit'),2);assert.equal(count(p,'viking_firecracker'),0);
    assert.equal(count(p,'unlit_candle'),1);assert.equal(p.damageRequests.length,0);ticks(p,2);
  }
  ticks(p,1);assert.equal(xp(p),10);assert.equal(count(p,'viking_firecracker_lit'),0);assert.equal(count(p,'viking_firecracker'),1);
  assert.equal(count(p,'unlit_candle'),1);assert.equal(count(p,'bullseye_lantern_lit'),1);assert.deepEqual(p.damageRequests.map(hit=>hit.amount),[3]);ownership(p);finish(p);
});
test('duplicate stone, walk and inventory operation cannot replace a held crossing or duplicate XP',()=>{
  const p=fixture(stones[0].banks[0],['bullseye_lantern_lit','shark']);const before=xp(p);begin(p,stones[0],true);const continuation=p.activeScript;
  assert.equal(click(p,stones[0]),false);assert.equal(held(p,'shark',1),false);assert.equal(walk(p,[0,3204,9573]),false);assert.equal(p.activeScript,continuation);
  ticks(p,4);assert.equal(xp(p)-before,30);assert.equal(count(p,'shark'),1);ticks(p,8);assert.equal(xp(p)-before,30);finish(p);
});
for(const [stone,position]of [[stones[0],[0,3206,9575]],[stones[1],[0,3218,9554]]])test(`${stone.name}: sideways wrong bank never jumps, rolls or awards`,()=>{
  const p=fixture(position);const before=xp(p);assert(click(p,stone));ticks(p,8);assert.equal(xp(p),before);assert.equal(p.animations.length,0);assert.equal(p.moves.length,0);finish(p);
});
test('opposite-bank clipped setup cannot jump through the water from the wrong start',()=>{
  const p=fixture(stones[1].banks[1]);const before=xp(p);execute('[proc,swamp_cave_stone]',p,stones[1].banks.map(c=>CoordGrid.packCoord(...c)));assert.equal(xp(p),before);assert.deepEqual(tile(p),stones[1].banks[1]);assert.equal(p.animations.length,0);finish(p);
});
test('native distant approach can be cancelled by another real walk without landing or XP',()=>{
  const p=fixture([0,3192,9571],['bullseye_lantern_lit','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));const before=xp(p);
  assert(walk(p,stones[0].banks[0]));assert(locHandler.handle(new OpLoc(1,stones[0].x,stones[0].z,id('LocType',stones[0].name)),p));
  assert(walk(p,[0,3191,9571]));ticks(p,8);assert.equal(xp(p),before);assert.equal(p.animations.length,0);finish(p);
});
for(const stone of stones)test(`${stone.name}: clipped native approach from the same bank settles at the bank before rolling`,()=>{
  const bank=stone.banks[0],position=stone.angle===1?[bank[0],bank[1]-1,bank[2]]:[bank[0],bank[1],bank[2]+1],p=fixture(position);assert(!map.isMapBlocked(p.x,p.z,p.level));const before=xp(p);JavaRandom.setSeed(seedFor(1,true));assert(click(p,stone));
  for(let i=0;i<20 && xp(p)===before;i++)ticks(p,1);assert.equal(xp(p)-before,30);assert.deepEqual(tile(p),stone.banks[1]);assert(p.moves.some(m=>m.tile.every((v,j)=>v===bank[j])));finish(p);
});
test('insect bite due during four-tick crossing waits until unlock with no catch-up or controller restart',()=>{
  const p=fixture(stones[0].banks[0],[]);ticks(p,29);assert.equal(timer(p).args[0],29);const health=hp(p);begin(p,stones[0],true);
  for(let i=0;i<3;i++){ticks(p,1);assert.equal(timer(p).args[0],29);assert.equal(hp(p),health);ownership(p);}
  ticks(p,1);assert.equal(timer(p).args[0],30);assert.deepEqual(p.damageRequests.map(d=>d.amount),[1]);assert.equal(p.messages.filter(m=>m==='Tiny biting insects swarm all over you!').length,1);finish(p);
});
test('water loss reaches one controller recomputation at unlock, with no brightness write or extra timer',()=>{
  const p=fixture(stones[0].banks[0],['candle_lantern_lit'],wirePlayer());p.encodeOut();const original=roots(p).length,root=p.overlay;assert.equal(original,1);begin(p,stones[0],false);ticks(p,2);p.encodeOut();
  assert.equal(count(p,'unlit_candle'),1);assert.equal(p.overlay,root);assert.equal(roots(p).length,original);assert.equal(timer(p).args[0],0);ownership(p);
  ticks(p,1);p.encodeOut();assert.equal(roots(p).length,original);ticks(p,1);p.encodeOut();assert.equal(p.overlay,id('Component','inter_387'));assert.equal(roots(p).length,original+1);assert.equal(timer(p).args[0],1);ownership(p);finish(p);
});
test('real walk from a running gas count into a stone crossing cancels gas without disabling either hazard',()=>{
  const p=fixture([0,3214,9560],['lit_candle','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,3);assert.equal(timer(p).args[4],3);assert.equal(p.getVarBit(gas),3);
  arrive(p,stones[1].banks[0]);assert.deepEqual(timer(p).args.slice(2),[-1,-1,0]);assert.equal(p.getVarBit(gas),0);assert.equal(count(p,'lit_candle'),1);
  cross(p,stones[1],false);assert.equal(count(p,'unlit_candle'),1);assert.equal(p.damageRequests.length,0);ownership(p);finish(p);
});
test('the gas clock pauses while busy and departure during the pause cancels the pending exposure',()=>{
  const p=fixture([0,3214,9560],['lit_candle']);ticks(p,6);assert.equal(timer(p).args[4],6);
  p.delayed=true;p.delayedUntil=World.currentTick+4;ticks(p,3);assert.equal(timer(p).args[4],6);assert.equal(p.damageRequests.length,0);
  p.teleport(...[3215,9560,0]);ticks(p,1);assert.deepEqual(timer(p).args.slice(2),[-1,-1,0]);assert.equal(p.damageRequests.length,0);finish(p);
});
test('a stone click during a natural wall-beast hold is refused and never replaces its continuation',()=>{
  const p=fixture([0,3198,9571]);execute('[proc,swamp_wallbeast_poll]',p);ticks(p,1);assert(p.delayed);const continuation=p.activeScript,before=xp(p);
  assert.equal(click(p,stones[0]),false);assert.equal(p.activeScript,continuation);ticks(p,6);assert.equal(xp(p),before);assert.deepEqual(tile(p),[0,3198,9571]);assert.equal(p.damageRequests.length,1);assert(p.damageRequests[0].amount>=11&&p.damageRequests[0].amount<=13);finish(p);
});
test('normal routes to both stones wear the real spiny helmet without suppressing the wall controller',()=>{
  for(const to of [stones[0].banks[0],stones[1].banks[0]]){
    const p=fixture([0,3168,9572],['bullseye_lantern_lit','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));arrive(p,to);assert.equal(count(p,'wallbeast_spike_helmet',worn),1);assert(!p.animations.some(a=>a.seq===id('SeqType','human_wall_beast_specialattack_start')));ownership(p);finish(p);
  }
});
test('both native tunnel options round-trip with one root, one controller and walkable northward escape',()=>{
  const p=fixture([0,3225,9542]);const before=roots(p).length;const down={name:'tog_cave_down',x:3225,z:9539},up={name:'tog_cave_up',x:3218,z:9533};
  for(const [stone,dest]of [[down,[2,3218,9532]],[up,[0,3225,9542]]]){
    assert(click(p,stone));for(let i=0;i<20 && tile(p).some((v,j)=>v!==dest[j]);i++)ticks(p,1);
    assert.deepEqual(tile(p),dest);assert(!map.isMapBlocked(p.x,p.z,p.level));ownership(p);assert.equal(roots(p).length,before);
  }
  assert.equal(map.canTravel(0,3225,9542,0,1,1,0,CollisionType.NORMAL),true);arrive(p,[0,3225,9543]);ownership(p);assert.equal(roots(p).length,before);finish(p);
});
test('dark-to-dark tunnel travel preserves a pending insect bite and never starts a replacement controller',()=>{
  const p=fixture([2,3218,9532],[]);ticks(p,29);const health=hp(p);assert(click(p,{name:'tog_cave_up',x:3218,z:9533}));assert.deepEqual(tile(p),[0,3225,9542]);assert.equal(timer(p).args[0],29);ownership(p);ticks(p,1);assert.equal(hp(p),health-1);assert.equal(timer(p).args[0],30);finish(p);
});
test('real ectophial leaves darkness synchronously before movement, holds no stale root and takes no outside bite',()=>{
  const p=fixture(stones[0].banks[0],['ectophial']);ticks(p,31);const health=hp(p),original=p.teleport;let observed=false;
  p.teleport=function(...args){observed=true;assert.equal(this.getVarBit(flag),0,'release precedes actual destination movement');assert.equal(this.timers.has(controller.id),false);assert.equal(this.overlay,-1);return original.apply(this,args);};
  assert(held(p,'ectophial',1));assert(observed);assert.deepEqual(tile(p),[0,3658,3517]);assert.equal(p.getVarBit(flag),0);ticks(p,40);assert.equal(hp(p),health);assert.equal(p.overlay,-1);finish(p);
});
console.log(`SC06 stepping stones: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
