#!/usr/bin/env node
/** SC-06F: compiled scripts, native RNG, real banks and optional published-pack comparison. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, PlayerTimerType,
  types, map, CollisionType, engineModule, id, obj, inv, worn, player, seed, inventory,
  count, held, execute, tile } from './runtime.mjs';
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const spots = [
  {name:'0_49_149_cavefish',number:2067,water:[0,3154,9544],bank:[0,3155,9544]},
  {name:'0_50_149_cavefish',number:2068,water:[0,3245,9570],bank:[0,3244,9570]}
];
const fronts = [[3161,9546],[3162,9573],[3164,9555],[3198,9553],[3198,9571],[3215,9559],[3216,9587]];
const holes = [...World.npcs].filter(n=>n.baseType===id('NpcType','swamp_wallbeast'));
const actionDelay = id('VarPlayerType','action_delay');
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
const xp = p=>p.stats[PlayerStat.FISHING];
const hp = p=>p.levels[PlayerStat.HITPOINTS];
const inGas = (x,z)=>(x>=3145&&x<=3176&&z>=9584&&z<=9600)||(x>=3199&&x<=3214&&z>=9540&&z<=9560);
const natural = spot=>{const n=[...World.npcs].find(n=>n.baseType===id('NpcType',spot.name));assert(n,spot.name);return n;};
let cases=0,failures=0;
function test(name,body){cases++;try{JavaRandom.setSeed(0);body();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}: ${error.stack??error}`);}}
function fixture(spot=spots[0],level=99,items=['net','fishing_rod','fishing_bait']){
  const p=seed(player(),items);[p.level,p.x,p.z]=spot.bank;
  p.baseLevels[PlayerStat.FISHING]=level;p.levels[PlayerStat.FISHING]=level;p.stats[PlayerStat.FISHING]=getExpByLevel(level);
  p.animations=[];p.damageRequests=[];p.fishRolls=[];
  const animation=p.playAnimation,damage=p.applyDamage;
  p.playAnimation=function(seq,delay){p.animations.push({tick:World.currentTick,seq:seq<0?null:types.SeqType.get(seq).debugname,delay});return animation.call(this,seq,delay);};
  p.applyDamage=function(amount,type){p.damageRequests.push({tick:World.currentTick,amount,type});return damage.call(this,amount,type);};
  return p;
}
function finish(p){p.delayed=false;p.activeScript=null;execute('[proc,swamp_cave_release]',p);p.clearInteraction();p.isActive=false;World.players[p.pid]=null;p.unlink();}
function frame(p,environment=false){
  p.resetEntity(false);World.currentTick++;
  if(environment){for(const n of holes){n.resetEntity(false);n.turn();}}
  if(p.delayed&&World.currentTick>=p.delayedUntil)p.delayed=false;
  if(!p.delayed&&p.activeScript?.execution===ScriptState.SUSPENDED)p.executeScript(p.activeScript,true,true);
  p.processQueues();
  if(environment&&!p.loggingOut){p.processTimers(PlayerTimerType.NORMAL);p.processTimers(PlayerTimerType.SOFT);}
  p.processEngineQueue();p.processInteraction();
}
function ticks(p,n,environment=false){for(let i=0;i<n;i++)frame(p,environment);}
function begin(p,n,option){p.clearPendingAction();p.originX=p.x;p.originZ=p.z;p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC1+option-1);p.opcalled=true;p.processInteraction();}
function texts(p){return [...p.messages,...p.packets.filter(packet=>packet.constructor.name==='IfSetText').map(packet=>packet.text)];}
function fill(p){while(p.invFreeSpace(inv)>0)p.invAdd(inv,obj('logs'),1);}
function walk(p,to){
  const [level,x,z]=to;assert.equal(p.level,level);
  const route=Array.from(map.findPath(level,p.x,p.z,x,z),value=>{const c=CoordGrid.unpackCoord(value);return{x:c.x,z:c.z};});
  assert(route.length,'native route exists');p.originX=p.x;p.originZ=p.z;
  assert(moveHandler.handle(new MoveClick(route,0,false),p));
}
function arrive(p,to,environment=false){walk(p,to);for(let i=0;i<100&&tile(p).some((v,j)=>v!==to[j]);i++)frame(p,environment);assert.deepEqual(tile(p),to);}

// Only pin the native source. STAT_RANDOM itself, including interpolation and
// settlement, always executes in the engine. No assertion depends on draw count.
let outcome='success',rollIndex=0,watch=null;
const originals=new Map();
function wrap(opcode,observe){const original=Runner.HANDLERS[opcode];originals.set(opcode,original);Runner.HANDLERS[opcode]=state=>{observe(state);return original(state);};}
for(const opcode of [ScriptOpcode.GOSUB,ScriptOpcode.GOSUB_WITH_PARAMS])wrap(opcode,state=>{
  const called=ScriptProvider.get(opcode===ScriptOpcode.GOSUB?state.intStack[state.isp-1]:state.intOperand);
  if(called?.name==='[proc,fish_roll]'){rollIndex=0;if(state._activePlayer?.fishRolls)state._activePlayer.fishRolls.push(World.currentTick);}
});
const nativeStatRandom=Runner.HANDLERS[ScriptOpcode.STAT_RANDOM];
originals.set(ScriptOpcode.STAT_RANDOM,nativeStatRandom);
Runner.HANDLERS[ScriptOpcode.STAT_RANDOM]=state=>{
  if(!watch||state._activePlayer!==watch||state.script.name!=='[proc,fish_roll]')return nativeStatRandom(state);
  const original=JavaRandom.nextDouble;
  const draw=outcome==='failure'||(outcome==='fallback'&&rollIndex++===0)?255/256:0;
  JavaRandom.nextDouble=()=>draw;
  try{return nativeStatRandom(state);}finally{JavaRandom.nextDouble=original;}
};
function force(p,mode,body){const old=watch,previous=outcome;watch=p;outcome=mode;rollIndex=0;try{return body();}finally{watch=old;outcome=previous;}}
function run(p,n,option,nTicks=16,mode='success',environment=false){begin(p,n,option);force(p,mode,()=>ticks(p,nTicks,environment));}
function packedParams(kind,name){const t=types[kind].get(id(kind,name));return Object.fromEntries([...(t.params??[])].map(([key,value])=>[types.ParamType.get(key).debugname,value]));}
function product(name){const o=types.ObjType.get(obj(name));const struct=o.params?.get(id('ParamType','fishing_struct'));assert.notEqual(struct,undefined,`${name} fishing_struct`);return packedParams('StructType',types.StructType.get(struct).debugname);}

for(const spot of spots)test(`${spot.number}: original direct dispatch, sole bank and stationary natural source`,()=>{
  const n=natural(spot),t=types.NpcType.get(n.type);assert.equal(t.id,spot.number);assert.deepEqual(tile(n),spot.water);
  assert.deepEqual(t.op,['Net',null,'Bait','hidden','hidden']);assert.equal(t.category,-1);assert.equal(t.timer,-1);assert.equal(t.wanderrange,0);assert.equal(t.moverestrict,5);assert.equal(t.defaultmode,0);
  assert(!t.params?.has(id('ParamType','fishing_movement_enum')));
  for(const option of [1,3,4,5])assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1+option-1,n.type,t.category)?.name,`[opnpc${option},${spot.name}]`);
  assert(ScriptProvider.getByTrigger(ServerTriggerType.OPNPCU,n.type,t.category));
  const banks=[[n.x-1,n.z],[n.x+1,n.z],[n.x,n.z-1],[n.x,n.z+1]].filter(([x,z])=>!map.isMapBlocked(x,z,0));assert.deepEqual(banks,[spot.bank.slice(1)]);
  assert(!inGas(...banks[0]));assert(!fronts.some(f=>f[0]===banks[0][0]&&f[1]===banks[0][1]));
  const p=fixture(spot);try{assert(p.inOperableDistance(n));run(p,n,1,80);assert.deepEqual(tile(n),spot.water);assert.equal(n.timerInterval,-1);}finally{finish(p);}
});
test('packed product rates, tenths XP and deliberate absent frog wording',()=>{
  assert.deepEqual(product('giant_frogspawn'),{productexp:750,success_low:16,success_high:96});
  assert.deepEqual(product('raw_cave_eel'),{productexp:800,productmessage:'You catch a cave eel.',success_low:10,success_high:80});
  assert.deepEqual(product('mort_slimey_eel'),{productmessage:'You catch a slimy swamp eel.',productexp:650,success_low:10,success_high:80});
});
for(const spot of spots){
  for(const [option,level,message]of [[1,32,'You need at least 33 Fishing to catch these fish.'],[3,27,'You need at least 28 Fishing to catch these fish.']])test(`${spot.number} option ${option}: level ${level} refuses without settlement`,()=>{
    const p=fixture(spot,level),before=inventory(p),beforeXp=xp(p);try{run(p,natural(spot),option,8);assert(texts(p).includes(message));assert.deepEqual(inventory(p),before);assert.equal(xp(p),beforeXp);assert.equal(p.target,null);}finally{finish(p);}
  });
  for(const [option,items,message]of [[1,[],'You need a net to catch these fish.'],[1,['fishing_rod','fishing_bait'],'You need a net to catch these fish.'],[3,[],'You need a Fishing Rod to bait these fish.'],[3,['net','fishing_bait'],'You need a Fishing Rod to bait these fish.'],[3,['fishing_rod'],"You don't have any fishing bait left."]])test(`${spot.number} option ${option}: missing equipment ${items.join('+')||'none'}`,()=>{
    const p=fixture(spot,99,items),before=inventory(p),beforeXp=xp(p);try{run(p,natural(spot),option,8);assert(texts(p).includes(message),JSON.stringify(texts(p)));assert.deepEqual(inventory(p),before);assert.equal(xp(p),beforeXp);}finally{finish(p);}
  });
  for(const [item,option]of [['net',1],['fishing_rod',3],['harpoon',null]])test(`${spot.number}: item use ${item} follows the real dispatch`,()=>{
    const p=fixture(spot,99,['net','fishing_rod','fishing_bait',item]);try{p.lastUseItem=obj(item);p.setInteraction(Interaction.ENGINE,natural(spot),ServerTriggerType.APNPCU);force(p,'success',()=>ticks(p,12));if(option){assert(p.fishRolls.length>0);assert(count(p,option===1?'giant_frogspawn':'raw_cave_eel')>0);}else{assert.equal(p.fishRolls.length,0);assert(texts(p).includes("There aren't any fish suitable for Harpooning here."));}}finally{finish(p);}
  });
  test(`${spot.number}: Net 33 succeeds silently for exactly 75 XP and no bait`,()=>{
    const p=fixture(spot,33),before=xp(p),bait=count(p,'fishing_bait');try{run(p,natural(spot),1,4);assert.equal(count(p,'giant_frogspawn'),1);assert.equal(xp(p)-before,750);assert.equal(count(p,'fishing_bait'),bait);assert.deepEqual(p.messages,['You cast out your net...']);assert(!texts(p).includes('null'));}finally{finish(p);}
  });
  for(const level of [28,36,37])test(`${spot.number}: Bait ${level} can only award slimy eel, 65 XP and one bait`,()=>{
    const p=fixture(spot,level);p.invAdd(inv,obj('fishing_bait'),4);const before=xp(p),bait=count(p,'fishing_bait');try{run(p,natural(spot),3,5);assert.equal(count(p,'mort_slimey_eel'),1);assert.equal(count(p,'raw_cave_eel'),0);assert.equal(xp(p)-before,650);assert.equal(count(p,'fishing_bait'),bait-1);assert(p.messages.includes('You catch a slimy swamp eel.'));}finally{finish(p);}
  });
  for(const [mode,expected,exp]of [['success','raw_cave_eel',800],['fallback','mort_slimey_eel',650],['failure',null,0]])test(`${spot.number}: Bait 38 secondary first, ${mode}`,()=>{
    const p=fixture(spot,38);p.invAdd(inv,obj('fishing_bait'),4);const before=xp(p),bait=count(p,'fishing_bait');try{run(p,natural(spot),3,5,mode);assert.equal(count(p,'raw_cave_eel'),expected==='raw_cave_eel'?1:0);assert.equal(count(p,'mort_slimey_eel'),expected==='mort_slimey_eel'?1:0);assert.equal(xp(p)-before,exp);assert.equal(count(p,'fishing_bait'),bait-(expected?1:0));if(expected)assert(p.messages.includes(product(expected).productmessage));else assert(!p.messages.some(m=>m.startsWith('You catch')));}finally{finish(p);}
  });
  for(const option of [1,3])test(`${spot.number} option ${option}: published clock and continuation`,()=>{
    const p=fixture(spot);p.invAdd(inv,obj('fishing_bait'),20);const start=World.currentTick;try{run(p,natural(spot),option,18);const catches=p.fishRolls.map(t=>t-start);assert.deepEqual(catches,option===1?[4,10,16]:[5,10,15]);assert.equal(p.target,natural(spot));assert.equal(p.targetOp,ServerTriggerType.APNPC1+(option===1?3:4));assert(p.animations.some(a=>a.seq===(option===1?'human_smallnet':'human_fishing_casting')));assert.equal(count(p,option===1?'giant_frogspawn':'raw_cave_eel'),3);}finally{finish(p);}
  });
  for(const bait of [1,2])test(`${spot.number}: full bag with ${bait} bait preserves the published exception`,()=>{
    const p=fixture(spot,38,['fishing_rod']);p.invAdd(inv,obj('fishing_bait'),bait);fill(p);const before=xp(p);try{run(p,natural(spot),3,5);assert.equal(count(p,'raw_cave_eel'),bait===1?1:0);assert.equal(count(p,'fishing_bait'),bait===1?0:2);assert.equal(xp(p)-before,bait===1?800:0);assert.equal(texts(p).includes("You can't carry any more fish."),bait!==1);}finally{finish(p);}
  });
  test(`${spot.number}: full net bag refuses and a failed last-bait roll consumes nothing`,()=>{
    const p=fixture(spot,38);fill(p);try{run(p,natural(spot),1,4);assert(texts(p).includes("You can't carry any more fish."));assert.equal(count(p,'giant_frogspawn'),0);p.clearPendingAction();p.closeModal();p.messages.length=0;const before=inventory(p),beforeXp=xp(p);run(p,natural(spot),3,5,'failure');assert.deepEqual(inventory(p),before);assert.equal(xp(p),beforeXp);assert.equal(count(p,'fishing_bait'),1);}finally{finish(p);}
  });
  test(`${spot.number}: native walk cancels repeated fishing; re-click resumes`,()=>{
    const p=fixture(spot);try{run(p,natural(spot),1,10);const before=count(p,'giant_frogspawn');const to=[0,p.x+(spot===spots[0]?1:-1),p.z];arrive(p,to);ticks(p,12);assert.equal(count(p,'giant_frogspawn'),before);assert.equal(p.target,null);arrive(p,spot.bank);run(p,natural(spot),1,10);assert(count(p,'giant_frogspawn')>before);}finally{finish(p);}
  });
  for(const option of [1,3])test(`${spot.number} option ${option}: controller insects do not cancel an ordinary fishing interaction`,()=>{
    const p=fixture(spot);p.invAdd(inv,obj('fishing_bait'),20);execute('[proc,swamp_cave_start]',p);const before=hp(p);try{run(p,natural(spot),option,36,'success',true);assert(hp(p)<before);assert(p.messages.includes('Tiny biting insects swarm all over you!'));assert.equal(p.target,natural(spot));assert(p.fishRolls.some(t=>t>World.currentTick-6));assert.equal([...p.timers.values()].filter(t=>t.script.id===controller.id).length,1);}finally{finish(p);}
  });
  test(`${spot.number}: real held Extinguish cancels fishing; darkness remains active`,()=>{
    const p=fixture(spot,99,['net','bullseye_lantern_lit']);execute('[proc,swamp_cave_start]',p);try{run(p,natural(spot),1,10,'success',true);const before=count(p,'giant_frogspawn');assert(held(p,'bullseye_lantern_lit',2));ticks(p,32,true);assert.equal(count(p,'giant_frogspawn'),before);assert.equal(p.target,null);assert.equal(count(p,'bullseye_lantern_unlit'),1);assert(p.damageRequests.some(d=>d.amount===1));}finally{finish(p);}
  });
}
function ordinaryRoute(){
  const start=spots[0].bank.slice(1),end=spots[1].bank.slice(1),queue=[start],parents=new Map([[start.join(','),null]]);
  const steps=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for(let h=0;h<queue.length;h++){const [x,z]=queue[h];if(x===end[0]&&z===end[1])break;for(const [dx,dz]of steps){const next=[x+dx,z+dz],key=next.join(',');if(next[0]<3145||next[0]>3258||next[1]<9540||next[1]>9600||parents.has(key)||!map.canTravel(0,x,z,dx,dz,1,0,CollisionType.NORMAL))continue;parents.set(key,[x,z]);queue.push(next);}}
  assert(parents.has(end.join(',')),'both banks in the ordinary main-cave component');const route=[];for(let at=end;at;at=parents.get(at.join(',')))route.push(at);return route.reverse();
}
test('both natural banks are joined by native ordinary walking, without stones or position writes',()=>{
  const route=ordinaryRoute(),p=fixture(spots[0],99,['bullseye_lantern_lit','wallbeast_spike_helmet']);assert(held(p,'wallbeast_spike_helmet',2));execute('[proc,swamp_cave_start]',p);
  const visited=[tile(p)],teleport=p.teleport;let teleports=0;p.teleport=function(...args){teleports++;return teleport.apply(this,args);};
  try{for(let i=16;i<route.length+16;i+=16){const [x,z]=route[Math.min(i,route.length-1)],to=[0,x,z];walk(p,to);for(let t=0;t<100&&tile(p).some((v,j)=>v!==to[j]);t++){frame(p,true);visited.push(tile(p));}assert.deepEqual(tile(p),to);}assert.deepEqual(tile(p),spots[1].bank);assert.equal(teleports,0);assert.equal(hp(p),99);assert(visited.some(([,x,z])=>fronts.some(f=>f[0]===x&&f[1]===z)));assert(route.some(([x,z])=>inGas(x,z)));assert.equal(count(p,'wallbeast_spike_helmet',worn),1);console.log(`ORDINARY_ROUTE ${JSON.stringify({route,visited,fronts:route.filter(([x,z])=>fronts.some(f=>f[0]===x&&f[1]===z)),gas:route.filter(([x,z])=>inGas(x,z))})}`);}finally{finish(p);}
});
test('gas on the actual east-spot approach extinguishes its open light but damage does not clear the queued fishing target',()=>{
  const p=fixture(spots[0],99,['net','lit_candle','wallbeast_spike_helmet']);[p.x,p.z]=[3203,9553];assert(held(p,'wallbeast_spike_helmet',2));execute('[proc,swamp_cave_start]',p);
  try{begin(p,natural(spots[1]),1);const before=hp(p);for(let i=0;i<8;i++)frame(p,true);assert(hp(p)<before);assert.equal(count(p,'unlit_candle'),1);assert.equal(p.target,natural(spots[1]));assert(p.messages.some(m=>m.includes('flares brightly!')));console.log(`GAS_APPROACH ${JSON.stringify({tile:tile(p),hits:p.damageRequests,target:p.target.type})}`);}finally{finish(p);}
});
test('a natural front on the west-bank approach grabs and clears fishing intent by ordinary p_stopaction',()=>{
  const p=fixture(spots[0],99,['net','bullseye_lantern_lit']);[p.x,p.z]=fronts[0];execute('[proc,swamp_cave_start]',p);
  try{begin(p,natural(spots[0]),1);execute('[proc,swamp_wallbeast_poll]',p);for(let i=0;i<8;i++)frame(p,true);assert(p.damageRequests.some(d=>d.amount>=11));assert.equal(p.target,null);assert.equal(count(p,'giant_frogspawn'),0);}finally{finish(p);}
});

// Enumeration is over the currently loaded pack, not a saved list or hash.
// Each method exercises initiation, hidden continuation and every product, both
// outside Miscellania and inside Frodi's interception area. Whirlpool types are
// included: their unchanged equipment interception is not misreported as a catch.
const methods=[
  {category:'freshfish',option:1,products:['raw_trout','raw_salmon'],tool:'fly_fishing_rod',bait:'feather'},
  {category:'freshfish',option:3,products:['raw_pike'],tool:'fishing_rod',bait:'fishing_bait'},
  {category:'saltfish',option:1,products:['raw_shrimp','raw_anchovies'],tool:'net'},
  {category:'saltfish',option:3,products:['raw_sardine','raw_herring'],tool:'fishing_rod',bait:'fishing_bait'},
  {category:'rarefish',option:1,products:['raw_lobster'],tool:'lobster_pot'},
  {category:'rarefish',option:3,products:['raw_tuna','raw_swordfish'],tool:'harpoon'},
  {category:'memberfish',option:3,products:['raw_shark'],tool:'harpoon'},
  {category:'slimeyfish',option:1,products:['mort_slimey_eel'],tool:'fishing_rod',bait:'fishing_bait'},
  {type:'0_45_152_lavafish',option:1,products:['raw_lava_eel'],tool:'oily_fishing_rod',bait:'fishing_bait'}
];
const messages={raw_trout:'You catch a trout.',raw_salmon:'You catch a salmon.',raw_pike:'You catch a pike.',raw_shrimp:'You catch some shrimps.',raw_anchovies:'You catch some anchovies.',raw_sardine:'You catch a sardine.',raw_herring:'You catch a herring.',raw_lobster:'You catch a lobster.',raw_tuna:'You catch a tuna.',raw_swordfish:'You catch a swordfish.',raw_shark:'You catch a shark!',mort_slimey_eel:'You catch a slimy swamp eel.',raw_lava_eel:'You catch a lava eel.'};
function matrix(){
  const rows=[];
  for(const method of methods){
    const selected=method.type?[types.NpcType.get(id('NpcType',method.type))]:types.NpcType.configs.filter(t=>t?.category===id('CategoryType',method.category));assert(selected.length);
    for(const t of selected)for(const caught of method.products)for(const frodi of [false,true]){
      const where=frodi?{bank:[0,2576,3852]}:spots[0],p=fixture(where,99,[method.tool]);if(method.bait)p.invAdd(inv,obj(method.bait),100);
      const n=new Npc(0,p.x-1,p.z,t.size,t.size,EntityLifeCycle.DESPAWN,World.npcs.next(),t.id,t.blockwalk);World.addNpc(n,-1);
      const mode=method.products.length===2&&caught===method.products[0]?'fallback':'success';const before=xp(p);const frames=[];
      try{
        begin(p,n,method.option);force(p,mode,()=>{for(let tick=1;tick<=16;tick++){const m=p.messages.length,a=p.animations.length,s=p.packets.length;frame(p);frames.push({tick,messages:p.messages.slice(m),animations:p.animations.slice(a).map(({seq,delay})=>({seq,delay})),sounds:p.packets.slice(s).filter(packet=>packet.constructor.name==='SynthSound').map(({synth,loops,delay})=>({synth,loops,delay})),xp:xp(p)-before,inventory:inventory(p),targetOp:p.target?p.targetOp:null,actionDelay:p.getVar(actionDelay)-World.currentTick,active:p.activeScript?.script.name??null,approval:p.getVarBit(id('VarBitType','misc_approval'))});}});
        const whirlpool=t.params?.get(id('ParamType','is_whirlpool'))===1;
        if(!whirlpool){const expected=frodi?`${messages[caught].slice(0,-1)} and give it to Fisherman Frodi.`:messages[caught];assert(p.messages.includes(expected),`${t.debugname} ${caught} Frodi=${frodi}: ${JSON.stringify(p.messages)}`);assert(xp(p)>before);assert.equal(count(p,caught)>0,!frodi);}
        rows.push({type:t.debugname,option:method.option,product:caught,frodi,frames});
      }finally{World.removeNpc(n,-1);finish(p);}
    }
  }
  const trawler=['raw_mantaray','raw_seaturtle'].map(name=>({name,params:product(name)}));
  assert.deepEqual(trawler,[{name:'raw_mantaray',params:{productexp:690}},{name:'raw_seaturtle',params:{productexp:570}}]);
  return {rows,trawler};
}
let current;
test('every published fish_roll type/method/product retains its sentence, effects and Frodi eligibility',()=>{
  for(const [name,message]of Object.entries(messages))assert.equal(product(name).productmessage,message);
  current=matrix();console.log(`PUBLISHED_MATRIX ${JSON.stringify({rows:current.rows.map(({type,option,product,frodi})=>({type,option,product,frodi})),trawler:current.trawler})}`);
});
const flagIndex=process.argv.indexOf('--published-pack');
if(flagIndex!==-1)test('published pack versus slice pack: every full behavioral row and both trawler controls are identical',()=>{
  assert(current,'slice matrix must pass');const selected=process.argv[flagIndex+1];assert(selected&&!selected.startsWith('--'),'--published-pack requires a directory');
  const pack=path.resolve(selected);for(const type of Object.values(types))type.load(pack);assert(ScriptProvider.load(pack)>0);
  const published=matrix();assert.deepEqual(current,published);console.log(`PUBLISHED_COMPARISON ${JSON.stringify({rows:published.rows.length,products:Object.keys(messages),effects:['messages','XP','bait','products','animation','sounds','continuation','action delay','Frodi approval'],trawler:published.trawler,result:'identical'})}`);
});
for(const [opcode,original]of originals)Runner.HANDLERS[opcode]=original;
console.log(`SC06F ${cases-failures}/${cases} cases passed`);
process.exit(failures?1:0);
