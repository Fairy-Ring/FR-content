#!/usr/bin/env node
/** SC-05: original placed NPCs, real queues/timers, damage, wear and respawn. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, PlayerStat, PlayerTimerType, ScriptProvider, ScriptState, ServerTriggerType,
  types, engineModule, id, obj, inv, worn, player, seed, count, held, remove, execute,
  tile, contentRoot, map, CollisionType, button } from './runtime.mjs';
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Pointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { ParamHelper } = await engineModule('cache/config/ParamHelper.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { MoveRestrict } = await engineModule('engine/entity/MoveRestrict.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const spawns = [[3161,9547],[3162,9574],[3164,9556],[3198,9554],[3198,9572],[3215,9560],[3216,9588]];
const anchors = spawns.map(([x,z])=>[x,z-1]);
const dormant = id('NpcType','swamp_wallbeast'), exposed = id('NpcType','swamp_wallbeast_combat');
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
const own = id('VarNpcType','npc_attacking_uid'), cooldown = id('VarNpcType','npc_int');
const hp = p => p.levels[PlayerStat.HITPOINTS];
const timer = p => p.timers.get(controller.id);
const names = ['wall_beast_specialattack_start','wall_beast_specialattack_ready','wall_beast_specialattack_end'];
const playerAnims = ['human_wall_beast_specialattack_start','human_wall_beast_specialattack_ready','human_wall_beast_specialattack_end'].map(n=>id('SeqType',n));
const holes = [...World.npcs].filter(n=>n.baseType===dormant);
let cases=0, failures=0;
function test(name, run) { cases++; try { JavaRandom.setSeed(0); run(); console.log(`PASS ${name}`); } catch(e) { failures++; console.error(`FAIL ${name}: ${e.stack??e}`); } }
function reset() {
  for(const n of holes) {
    if(n.isActive)World.removeNpc(n,-1);World.addNpc(n,-1,false);n.timerInterval=0;n.timerClock=0;
    const spawn=ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN,n.type,types.NpcType.get(n.type).category);if(spawn)n.executeScript(Runner.init(spawn,n));
  }
}
function fixture(index=0, items=['bullseye_lantern_lit']) {
  const p=seed(player(),items); [p.x,p.z]=anchors[index]; p.baseLevels[PlayerStat.HITPOINTS]=100;p.levels[PlayerStat.HITPOINTS]=100;
  execute('[proc,update_bas]',p);
  p.damageRequests=[];p.animations=[];
  const damage=p.applyDamage, animation=p.playAnimation;
  p.applyDamage=function(amount,type){p.damageRequests.push({tick:World.currentTick,amount,type});return damage.call(this,amount,type);};
  p.playAnimation=function(seq,delay){p.animations.push({tick:World.currentTick,seq,delay});return animation.call(this,seq,delay);};
  return p;
}
function finish(p) { if(p.timers.has(controller.id)) execute('[proc,swamp_cave_release]',p); p.clearInteraction();p.isActive=false;World.players[p.pid]=null;p.unlink(); }
function frame(players, npcs=holes) {
  for(const p of players) p.resetEntity(false);
  for(const n of npcs) n.resetEntity(false);
  World.currentTick++;
  for(const n of npcs) n.turn();
  for(const p of players) {
    if(p.delayed&&World.currentTick>=p.delayedUntil)p.delayed=false;
    if(!p.delayed&&p.activeScript?.execution===ScriptState.SUSPENDED)p.executeScript(p.activeScript,true,true);
    p.processQueues();
    if(!p.loggingOut){p.processTimers(PlayerTimerType.NORMAL);p.processTimers(PlayerTimerType.SOFT);}
    p.processEngineQueue();p.processInteraction();
  }
}
function ticks(p,n,npcs=holes){for(let i=0;i<n;i++)frame(Array.isArray(p)?p:[p],npcs);}
function start(p){execute('[proc,swamp_cave_start]',p);assert.equal(timer(p).args.length,5);return p;}
function poll(p){execute('[proc,swamp_wallbeast_poll]',p);}
function npcRun(name,n,p=null,args=[]) {
  const script=ScriptProvider.getByName(name);assert(script,name);
  const s=Runner.init(script,n,p,args);if(p)s.pointerAdd(Pointer.ProtectedActivePlayer);n.executeScript(s);assert.notEqual(s.execution,ScriptState.ABORTED,name);return s;
}
function param(n,name){const t=types.ParamType.getByName(name);assert(t,name);return ParamHelper.getIntParam(t.id,types.NpcType.get(n.type),t.defaultInt);}
function natural(index){return holes.find(n=>n.startX===spawns[index][0]&&n.startZ===spawns[index][1]);}
function grab(p,n){poll(p);ticks(p,1);assert(p.delayed,'NPC queue holds the actual player');return World.currentTick;}
function noExtra(p){assert.equal(p.getVar(id('VarPlayerType','poison')),0);assert(!p.packets.some(x=>/Synth|Spotanim/.test(x.constructor.name)));}
function walk(p,x,z,run=false) {
  p.run=run?1:0;
  return moveHandler.handle(new MoveClick([{x:p.x,z:p.z},{x,z}],0,false),p);
}
function reachable(p,x,z) {
  assert(!map.isMapBlocked(x,z,0),`walkable account tile ${x},${z}`);
  assert(walk(p,x,z));
  for(let elapsed=0;(p.x!==x||p.z!==z)&&elapsed<30;elapsed++)ticks(p,1);
  assert.deepEqual([p.level,p.x,p.z],[0,x,z],'real MoveClick reaches the combat tile');
}
function logouts() {
  // These are real World phases, including the actual logout trigger/removal/save.
  // No login/server loop is started, so the native save stays in logoutRequests.
  World.processLogouts();
}

test('seven original notches have distinct front triggers on their sole walkable exit',()=>{
  assert.equal(holes.length,7);assert.deepEqual(holes.map(n=>[n.startX,n.startZ]).sort(),spawns.slice().sort());assert(holes.every(n=>n.startLevel===0&&n.type===dormant));
  for(const [x,z]of spawns) {
    assert(!map.isMapBlocked(x,z,0));assert(!map.isMapBlocked(x,z-1,0));
    for(const [dx,dz]of [[-1,0],[1,0],[0,1]])assert(map.isMapBlocked(x+dx,z+dz,0));
    const exits=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]].filter(([dx,dz])=>map.canTravel(0,x,z,dx,dz,1,0,CollisionType.NORMAL));
    assert.deepEqual(exits,[[0,-1]]);
    for(const [dx,dz]of [[-1,0],[1,0]])assert(map.canTravel(0,x,z-1,dx,dz,1,0,CollisionType.NORMAL));
    for(const [dx,dz]of [[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]])assert(map.isMapBlocked(x+dx,z-1+dz,0));
  }
});
for(const type of [dormant,exposed])test(`${types.NpcType.get(type).debugname}: stationary fields and unchanged 100-tick respawn`,()=>{
  const t=types.NpcType.get(type);assert.equal(t.wanderrange,0);assert.equal(t.maxrange,2,'absent maxrange derives wanderrange + 2');assert.equal(t.moverestrict,MoveRestrict.NOMOVE);assert.equal(t.defaultmode,NpcMode.NONE);assert.equal(t.givechase,false);assert.equal(t.respawnrate,100);assert.equal(t.timer,type===exposed?1:-1);
});
for(let index=0;index<7;index++)test(`anchor ${anchors[index]}: single grab hits at five, releases at six, then ten-tick cooldown`,()=>{
  reset();const p=fixture(index),n=natural(index),begin=grab(p,n);
  assert.deepEqual([p.x,p.z],anchors[index]);assert.deepEqual([n.x,n.z],spawns[index]);
  assert.deepEqual([p.faceSquareX,p.faceSquareZ],spawns[index].map(v=>v*2+1),'held player faces the hole, not their own tile');
  assert.equal(p.animId,playerAnims[0]);assert.equal(n.animId,id('SeqType',names[0]));
  ticks(p,1);assert.equal(p.animId,playerAnims[1]);assert.equal(n.animId,id('SeqType',names[1]));
  ticks(p,3);assert.equal(hp(p),100);assert(p.delayed);
  ticks(p,1);assert.equal(World.currentTick-begin,5);assert.equal(p.damageRequests.length,1);assert.equal(hp(p),87);assert(p.delayed);
  ticks(p,1);assert.equal(World.currentTick-begin,6);assert.equal(p.animId,playerAnims[2]);assert.equal(n.animId,id('SeqType',names[2]));assert(!p.delayed);assert.equal(n.getVar(own),-1);
  assert.equal(n.getVar(cooldown),World.currentTick+10);for(let i=0;i<9;i++){poll(p);ticks(p,1);assert.equal(p.damageRequests.length,1);}
  assert.deepEqual(p.messages,[]);noExtra(p);finish(p);
});
for(let index=0;index<7;index++)test(`anchor ${anchors[index]}: adjacent and other-plane observations never trigger`,()=>{
  reset();const p=fixture(index),n=natural(index);
  for(const [dx,dz]of [[-1,0],[1,0],[0,-1],[0,1]]){p.x=anchors[index][0]+dx;p.z=anchors[index][1]+dz;poll(p);ticks(p,1);assert(!p.delayed);assert.equal(n.getVar(own),-1);}
  [p.x,p.z]=anchors[index];for(const plane of [1,2,3]){p.level=plane;poll(p);ticks(p,1);assert(!p.delayed);assert.equal(n.type,dormant);}
  finish(p);
});
for(let index=0;index<7;index++)for(const headwear of ['bare','bag','worn'])for(const journey of ['walk-east','walk-west','run-hit-east','run-hit-west','run-skip-east','run-skip-west','stop','notch'])test(`front ${anchors[index]}: real ${journey}, ${headwear}`,()=>{
  reset();const p=fixture(index,headwear==='bare'?['bullseye_lantern_lit']:['bullseye_lantern_lit','wallbeast_spike_helmet']),n=natural(index);
  if(headwear==='worn')assert(held(p,'wallbeast_spike_helmet',2));
  const [x,z]=anchors[index],run=journey.startsWith('run')||journey==='notch',direction=journey.endsWith('west')?-1:1;
  const skips=journey.startsWith('run-skip')||journey==='notch';
  p.x=x-direction*(skips?1:2);p.z=z;start(p);
  const destination=journey==='stop'?[x,z]:journey==='notch'?[x,z+1]:[x+direction*(skips?1:2),z];
  assert(walk(p,...destination,run));const samples=[];
  for(let elapsed=0;elapsed<12;elapsed++){ticks(p,1);samples.push({tile:[p.x,p.z],owner:n.getVar(own),delayed:p.delayed,type:n.type});}
  const grabbed=p.animations.some(a=>a.seq===playerAnims[0]),eligible=!skips;
  assert.equal(samples.some(s=>s.tile[0]===x&&s.tile[1]===z),eligible,'only a tick-ending front tile is observed');
  assert.equal(grabbed,eligible&&headwear!=='worn');
  assert.deepEqual([p.x,p.z],eligible&&headwear!=='worn'?[x,z]:destination,'only an unprotected eligible passer is stopped');
  assert.equal(n.type,eligible&&headwear==='worn'?exposed:dormant);
  if(eligible&&headwear!=='worn')assert.deepEqual(p.damageRequests.map(d=>d.amount),[13]);
  if(skips)assert.deepEqual(p.damageRequests,[]);
  assert.deepEqual([n.x,n.z],spawns[index]);
  console.log(`MOVEMENT ${JSON.stringify({index,headwear,journey,samples})}`);finish(p);
});
test('the unchanged SC03 westward walk grabs a bare passer; a worn helmet preserves the walk and the beast resets',()=>{
  const route=[[3167,9572],[3166,9572],[3166,9573],[3165,9573],[3164,9573],[3163,9573],[3162,9573],[3161,9573],[3160,9573],[3159,9573],[3158,9573],[3157,9573],[3156,9573],[3155,9573],[3154,9573],[3153,9573],[3152,9573],[3151,9573]];
  for(const headwear of ['bare','worn']){
    reset();const p=fixture(1,headwear==='worn'?['wallbeast_spike_helmet']:[]),n=natural(1);
    [p.x,p.z]=[3168,9572];if(headwear==='worn')assert(held(p,'wallbeast_spike_helmet',2));start(p);ticks(p,14);
    const before=hp(p),shade=p.overlay,samples=[];
    assert.equal(shade,id('Component','inter_387'));
    assert(moveHandler.handle(new MoveClick([{x:p.x,z:p.z},...route.map(([x,z])=>({x,z}))],0,false),p));
    for(let elapsed=0;elapsed<route.length+1&&!p.delayed;elapsed++){ticks(p,1);samples.push({tile:[p.x,p.z],type:n.type,delayed:p.delayed});}
    if(headwear==='bare'){
      assert(p.delayed);assert.deepEqual([p.x,p.z],[3162,9573]);assert.equal(n.getVar(own),p.uid);
      ticks(p,6);assert.deepEqual(p.damageRequests.map(hit=>hit.amount),[13]);assert.deepEqual([p.x,p.z],[3162,9573]);assert(!p.delayed);
    }else{
      assert(samples.some(sample=>sample.type===exposed),'the worn passer really exposes the natural beast');
      assert.deepEqual([p.x,p.z],route.at(-1));assert(!p.delayed);assert.equal(hp(p),before-Math.max(0,14+route.length+1-29));
      assert(p.damageRequests.every(hit=>hit.amount===1),'only the unchanged insect bites, no wall-beast hit');
      assert.equal(p.overlay,shade);assert.equal(n.target,null);
      const resetClock=n.getVar(id('VarNpcType','npc_int2'));assert(resetClock>0&&resetClock<10);
      ticks(p,9-resetClock);assert.equal(n.type,exposed);ticks(p,1);
      assert.equal(n.type,dormant,'the departed walker leaves an ordinary ten-tick reset');assert.equal(n.timerInterval,0);assert.deepEqual([n.x,n.z],spawns[1]);
    }
    console.log(`LEGACY_WALK ${JSON.stringify({headwear,hits:p.damageRequests,shade,samples})}`);finish(p);
  }
});
for(const [label,item,equip]of [['bag','wallbeast_spike_helmet',false],['wrong helm','steel_med_helm',true]])test(`${label}: not protected by a carried or wrong item`,()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit',item]),n=natural(0);if(equip)assert(held(p,item,2));grab(p,n);ticks(p,6);assert.equal(p.damageRequests.length,1);assert.equal(n.type,dormant);finish(p);
});
test('Defence four receives the two exact refusals; five equips even with Slayer one',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet']);p.levels[PlayerStat.DEFENCE]=4;p.baseLevels[PlayerStat.DEFENCE]=4;p.levels[PlayerStat.SLAYER]=1;p.baseLevels[PlayerStat.SLAYER]=1;
  assert(held(p,'wallbeast_spike_helmet',2));assert.equal(count(p,'wallbeast_spike_helmet',worn),0);
  assert.deepEqual(p.messages,['You are not a high enough level to use this item.','You need to have a defence level of 5.']);
  p.levels[PlayerStat.DEFENCE]=5;p.baseLevels[PlayerStat.DEFENCE]=5;assert(held(p,'wallbeast_spike_helmet',2));assert.equal(count(p,'wallbeast_spike_helmet',worn),1);finish(p);
});
for(const [seedValue,expected]of [[4096,11],[1024,12],[0,13]])test(`native RNG seed ${seedValue}: one uniform grab delivers ${expected}`,()=>{
  reset();const p=fixture(),n=natural(0);JavaRandom.setSeed(seedValue);grab(p,n);ticks(p,6);assert.deepEqual(p.damageRequests.map(x=>x.amount),[expected]);noExtra(p);finish(p);
});
test('current headwear is read at activation, not when the controller started',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet'])),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,1);assert.equal(n.type,exposed);assert.equal(n.levels[3],105);assert.equal(p.animations.filter(x=>playerAnims.includes(x.seq)).length,0);
  assert.deepEqual([p.faceSquareX,p.faceSquareZ],spawns[0].map(v=>v*2+1),'protected player faces the hole, not their own tile');finish(p);
});
for(const keep of [true,false])test(`exposed form: ${keep?'keeping':'removing'} the helmet never causes another grab or exposure`,()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet'])),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,1);assert.equal(n.type,exposed);const uid=n.uid;
  if(!keep)assert(remove(p,'wallbeast_spike_helmet'));ticks(p,60);assert.equal(n.type,exposed);assert.equal(n.uid,uid);assert.equal(n.target,p);assert.equal(p.animations.filter(x=>playerAnims.includes(x.seq)).length,0);assert(p.damageRequests.length>0,'exposed beast attacks the stationary front-tile player');assert(p.damageRequests.every(x=>x.amount<=4));assert.equal(p.getVar(id('VarPlayerType','poison')),0);assert.deepEqual([p.x,p.z],anchors[0]);assert.deepEqual([n.x,n.z],spawns[0]);finish(p);
});
test('stationary bare-headed player is grabbed again after release plus ten cooldown ticks',()=>{
  reset();const p=start(fixture()),n=natural(0);ticks(p,2);assert(p.delayed);ticks(p,6);assert(!p.delayed);const release=World.currentTick;assert.equal(n.getVar(cooldown),release+10);
  ticks(p,9);assert.equal(p.damageRequests.length,1);ticks(p,1);assert.equal(n.getVar(own),p.uid);ticks(p,1);assert(p.delayed);ticks(p,6);assert.equal(p.damageRequests.length,2);finish(p);
});
test('one NPC reserves one victim even with two eligible players on the anchor in one pass',()=>{
  reset();const a=start(fixture()),b=start(fixture()),n=natural(0);frame([a,b]);assert.equal(n.getVar(own),a.uid);frame([a,b]);assert(a.delayed);assert(!b.delayed);ticks([a,b],6);assert.equal(a.damageRequests.length,1);assert.equal(b.damageRequests.length,0);finish(a);finish(b);
});
for(const phase of ['hold','cooldown'])test(`a second bare-headed passer walks through the front tile during another victim's ${phase}`,()=>{
  reset();const a=start(fixture(4)),b=fixture(4),n=natural(4),[x,z]=anchors[4];
  ticks(a,phase==='hold'?2:8);
  assert.equal(a.delayed,phase==='hold');assert.equal(n.getVar(own),phase==='hold'?a.uid:-1);
  const lock=n.getVar(cooldown);assert(lock>World.currentTick);
  b.x=x-1;start(b);assert(walk(b,x+2,z));const samples=[];
  for(let elapsed=0;elapsed<4;elapsed++){
    ticks([a,b],1);samples.push([b.x,b.z]);
    assert(!b.delayed,'the passer is never held');assert.equal(n.getVar(own),phase==='hold'?a.uid:-1);
    assert.equal(n.getVar(cooldown),lock,'the passer does not reserve or extend the lock');
    assert.deepEqual(b.damageRequests,[]);assert.equal(hp(b),100);
    assert(!b.animations.some(animation=>playerAnims.includes(animation.seq)),'the passer is never grabbed');
  }
  assert.deepEqual(samples,[[x-1,z],[x,z],[x+1,z],[x+2,z]],'real walking enters and leaves the front without stopping');
  assert.deepEqual([b.x,b.z],[x+2,z],'the destination is beyond the front tile');
  console.log(`SECOND_PASSER ${JSON.stringify({phase,samples,hits:b.damageRequests})}`);
  if(phase==='hold')ticks([a,b],2);
  assert.equal(a.damageRequests.length,1);assert.equal(n.getVar(own),-1);finish(a);finish(b);
});
test('native engagement inside three tiles pauses reset; leaving seven tiles starts ten ticks',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));poll(p);assert.equal(n.type,exposed);
  reachable(p,n.x+2,n.z-1);ticks(p,12);assert.equal(n.type,exposed);assert.equal(n.target,p);reachable(p,n.x+7,n.z-1);assert.equal(n.target,null);const clock=id('VarNpcType','npc_int2');assert(n.getVar(clock)>0);ticks(p,9-n.getVar(clock));assert.equal(n.type,exposed);ticks(p,1);assert.equal(n.type,dormant);assert.equal(n.timerInterval,0);assert.equal(n.targetOp,NpcMode.NONE);
  [p.x,p.z]=anchors[0];poll(p);assert.equal(n.type,exposed);assert(!p.delayed);finish(p);
});
test('complete ordinary row: six skills, crush, zero native bonuses, max four and unchanged Slayer 35 enum',()=>{
  reset();const n=natural(0);n.changeType(exposed,1000);assert.deepEqual([...n.levels],[30,16,30,105,1,1]);
  assert.equal(param(n,'attackrate'),6);assert.equal(param(n,'damagetype'),2);for(const key of ['attackbonus','strengthbonus','magicattack','rangeattack','rangebonus','stabdefence','slashdefence','crushdefence','magicdefence','rangedefence'])assert.equal(param(n,key),0,key);
  for(const [key,seq]of [['attack_anim','wall_beast_specialattack_attack'],['defend_anim','wall_beast_specialattack_defend'],['death_anim','wall_beast_specialattack_death']])assert.equal(param(n,key),id('SeqType',seq));
  assert.equal(npcRun('[proc,npc_melee_maxhit]',n).popInt(),4);assert(param(n,'slayer_category')>=0);
  const req=types.EnumType.getByName('slayer_req');assert(req);assert.equal(req.values.get(param(n,'slayer_category')),35);
});
test('exposed guaranteed drop is null; dormant and all shared sound/special defaults stay unchanged',()=>{
  const synth=new Map(readFileSync(new URL('../../pack/synth.pack',import.meta.url),'utf8').split(/\r?\n/).filter(line=>/^\d+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(at+1),Number(line.slice(0,at))];}));
  reset();const n=natural(0);
  for(const type of [dormant,exposed]){
    n.changeType(type,1000);assert.equal(param(n,'death_drop'),type===exposed?-1:obj('bones'));
    for(const [name,sound]of [['attack_sound','unarmed_punch'],['defend_sound','human_hit4'],['death_sound','human_death']])assert.equal(param(n,name),synth.get(sound),name);
    for(const [name,value]of [['poison_severity',0],['npc_forcemulti',0],['demonbane_vulnerable',0],['retreat',-1],['max_dealt',1000],['combat_xp_multiplier',1000]])assert.equal(param(n,name),value,name);
  }
});
test('gas pending at an adjacent source is cancelled at the real anchor before the held pause',()=>{
  reset();const p=start(fixture(0,['lit_candle']));p.x=3168;p.z=9585;ticks(p,6);assert.equal(timer(p).args[4],6);
  [p.x,p.z]=anchors[0];ticks(p,2);assert(p.delayed);assert.deepEqual(timer(p).args.slice(2),[-1,-1,0]);ticks(p,6);assert.equal(count(p,'lit_candle'),1);assert.equal(p.damageRequests.length,1);finish(p);
});
test('a due insect bite settles before grab ownership, and its clock pauses throughout the hold',()=>{
  reset();const p=start(fixture(0,[]));timer(p).args[0]=29;ticks(p,1);assert.equal(hp(p),99);assert.equal(timer(p).args[0],30);ticks(p,1);assert(p.delayed);const dark=timer(p).args[0];ticks(p,5);assert.equal(timer(p).args[0],dark);assert.deepEqual(p.damageRequests.map(x=>x.amount),[1,13]);ticks(p,1);assert.equal(hp(p),85);assert.equal(timer(p).args[0],dark);finish(p);
});
test('real walk, eat, teleport and logout buttons cannot interrupt the held player',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','shark','lawrune','airrune','airrune','airrune','firerune'])),n=natural(0);
  p.tabs[6]=types.Component.get(id('Component','magic:varrock_teleport')).rootLayer;
  p.tabs[10]=types.Component.get(id('Component','logout:try_logout')).rootLayer;
  p.levels[PlayerStat.HITPOINTS]=90;ticks(p,2);assert(p.delayed);const continuation=p.activeScript;
  assert.equal(walk(p,p.x+1,p.z),false);assert.equal(held(p,'shark',1),false);assert.equal(count(p,'shark'),1);
  assert.equal(button(p,'magic:varrock_teleport'),true);assert.equal(count(p,'lawrune'),1);
  assert.equal(button(p,'logout:try_logout'),true);assert.equal(p.requestLogout,false);assert.equal(p.activeScript,continuation);
  for(let elapsed=0;elapsed<6;elapsed++){p.lastResponse=World.currentTick;p.lastConnected=World.currentTick;ticks(p,1);logouts();assert.deepEqual([p.x,p.z],anchors[0]);}
  assert.equal(p.delayed,false);assert.deepEqual(p.damageRequests.map(d=>d.amount),[13]);assert.equal(hp(p),77);assert.deepEqual(p.messages,[]);
  assert.equal(button(p,'logout:try_logout'),true);assert.equal(p.requestLogout,true);logouts();assert.equal(World.getPlayerByUid(p.uid),null);assert(!p.timers.has(controller.id));assert.equal(n.getVar(own),-1);World.logoutRequests.delete(p.username);
});
test('real forced x-log stays connected to the hold until the hit and release, then logs out',()=>{
  reset();const p=start(fixture()),n=natural(0);ticks(p,2);assert(p.delayed);
  p.lastResponse=World.currentTick-World.TIMEOUT_NO_RESPONSE;
  for(let elapsed=0;elapsed<5;elapsed++){logouts();assert.equal(World.getPlayerByUid(p.uid),p);assert(p.loggingOut);ticks(p,1);}
  assert.deepEqual(p.damageRequests.map(d=>d.amount),[13]);assert(p.delayed);logouts();assert.equal(World.getPlayerByUid(p.uid),p);
  ticks(p,1);assert(!p.delayed);logouts();assert.equal(World.getPlayerByUid(p.uid),null);assert(!p.timers.has(controller.id));assert.equal(n.getVar(own),-1);World.logoutRequests.delete(p.username);
});
for(const departure of ['walk-away','logout','death','teleport'])test(`exposed ${departure}: native disengagement retains the timer and returns after ten reset ticks`,()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));poll(p);ticks(p,1);assert.equal(n.type,exposed);
  if(departure==='walk-away')p.teleport(n.x+7,n.z,0);
  if(departure==='logout'){execute('[logout,_]',p);p.loggingOut=true;p.isActive=false;World.players[p.pid]=null;}
  if(departure==='death'){p.applyDamage(hp(p),1);execute('[proc,player_die]',p);}
  if(departure==='teleport')execute('[proc,player_teleport_normal]',p,[CoordGrid.packCoord(0,3220,3220)]);
  const resetStart=World.currentTick;ticks(p,9);assert.equal(n.type,exposed);ticks(p,1);assert.equal(World.currentTick-resetStart,10);assert.equal(n.type,dormant);assert.deepEqual([n.level,n.x,n.z],[0,...spawns[0]]);finish(p);
});
test('a real spell from four tiles spends a rune but the stationary beast drops that target and resets',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','staff_of_air','mindrune']),n=natural(0);
  assert(held(p,'staff_of_air',2));assert(held(p,'wallbeast_spike_helmet',2));poll(p);reachable(p,3165,9544);assert(p.inApproachDistance(10,n),'real natural-map casting line at distance four');
  const before=p.stats[PlayerStat.MAGIC];execute('[apnpct,magic:wind_strike]',p,[],{target:n});
  assert.equal(count(p,'mindrune'),0);assert(p.stats[PlayerStat.MAGIC]>before);p.clearInteraction();
  const clock=id('VarNpcType','npc_int2'),transitions=[];for(let i=0;i<20;i++){ticks(p,1);transitions.push({tick:World.currentTick,mode:n.targetOp,target:n.target?.uid??null,clock:n.getVar(clock)});assert.deepEqual([n.x,n.z],spawns[0]);if(!n.target&&[...n.queue.all()].length===0&&n.getVar(clock)>0)break;}
  assert.equal(n.target,null);assert.equal(n.targetOp,NpcMode.NONE);assert(n.getVar(clock)>0);console.log(`RANGE four-tile native spell ${JSON.stringify(transitions)}`);
  const remaining=10-n.getVar(clock);ticks(p,remaining-1);assert.equal(n.type,exposed);ticks(p,1);assert.equal(n.type,dormant);assert.deepEqual([n.x,n.z],spawns[0]);finish(p);
});
for(const distance of [3,4,5,6])for(const style of ['ranged','magic'])test(`${style} at ${distance} reachable tiles: continued fire kills without retaliation or reset`,()=>{
  reset();const gear=style==='ranged'?['magic_shortbow','rune_arrow']:['staff_of_air','mindrune'];
  const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet',...gear]),n=natural(0);
  p.invAdd(inv,obj(gear[1]),499);assert(held(p,'wallbeast_spike_helmet',2));assert(held(p,gear[0],2));if(style==='ranged')assert(held(p,'rune_arrow',2));
  const firingTile={3:[3164,9545],4:[3165,9544],5:[3166,9544],6:[3167,9543]}[distance];
  poll(p);reachable(p,...firingTile);assert.equal(CoordGrid.distanceToSW(p,n),distance);assert(p.inApproachDistance(10,n));
  const spot=[p.x,p.z],before=p.stats[style==='ranged'?PlayerStat.RANGED:PlayerStat.MAGIC];p.damageRequests=[];
  if(style==='ranged')p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC2);
  for(let elapsed=0;n.isActive&&elapsed<1000;elapsed++){
    if(style==='magic'&&elapsed%5===0)execute('[apnpct,magic:wind_strike]',p,[],{target:n});
    ticks(p,1);if(n.isActive)assert.equal(n.type,exposed,'continuous attacks retain exposure');assert.deepEqual([p.x,p.z],spot);assert.deepEqual([n.x,n.z],spawns[0]);
  }
  assert(!n.isActive,'real outgoing damage kills');assert(p.stats[style==='ranged'?PlayerStat.RANGED:PlayerStat.MAGIC]>before);assert.deepEqual(p.damageRequests,[],'stationary melee cannot retaliate at3-6');console.log(`SAFESPOT ${JSON.stringify({style,distance,spot,hp:hp(p),killed:!n.isActive})}`);finish(p);
});
test('a real teleport begun between observation and the NPC queue prevents access and leaves no remote hit',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','lawrune','airrune','airrune','airrune','firerune']),n=natural(0);
  p.tabs[6]=types.Component.get(id('Component','magic:varrock_teleport')).rootLayer;poll(p);assert.equal(n.getVar(own),p.uid);
  assert(button(p,'magic:varrock_teleport'));assert(p.delayed);ticks(p,12);assert.equal(p.damageRequests.length,0);assert.equal(count(p,'lawrune'),0);assert.notDeepEqual([p.x,p.z],anchors[0]);assert.equal(n.type,dormant);finish(p);
});
test('a new real walk click after reservation is cleared when the NPC begins the hold',()=>{
  reset();const p=fixture(),n=natural(0);poll(p);assert.equal(n.getVar(own),p.uid);
  assert(walk(p,p.x+1,p.z));ticks(p,1);assert(p.delayed);assert.deepEqual([p.x,p.z],anchors[0]);
  ticks(p,6);assert.deepEqual(p.damageRequests.map(d=>d.amount),[13]);assert.deepEqual([p.x,p.z],anchors[0]);finish(p);
});
test('a real logout between reservation and the queue reaches the missing-player guard',()=>{
  reset();const p=fixture(),n=natural(0);p.tabs[10]=types.Component.get(id('Component','logout:try_logout')).rootLayer;
  poll(p);assert.equal(n.getVar(own),p.uid);assert(button(p,'logout:try_logout'));assert(p.requestLogout);
  logouts();assert.equal(World.getPlayerByUid(p.uid),null);ticks([],1);assert.deepEqual(p.damageRequests,[]);assert.equal(n.type,dormant);World.logoutRequests.delete(p.username);
});
for(const level of [34,35])test(`Slayer ${level}: real outgoing attack ${level===34?'is refused':'is admitted'} by the existing category gate`,()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','rune_scimitar']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));assert(held(p,'rune_scimitar',2));poll(p);assert(!map.isMapBlocked(p.x,p.z,p.level));assert(p.inOperableDistance(n));
  p.levels[PlayerStat.SLAYER]=level;p.baseLevels[PlayerStat.SLAYER]=level;
  const before=p.stats[PlayerStat.ATTACK];p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC2);ticks(p,3);
  assert.equal(p.messages.includes('You need a higher Slayer level to know how to wound this monster.'),level===34);assert.equal(p.stats[PlayerStat.ATTACK]>before,level===35);finish(p);
});
test('ordinary packed combat repeatedly uses authored 100 and the engine-scaled respawn schedule without an eighth hole',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','rune_scimitar']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));assert(held(p,'rune_scimitar',2));
  const drops=[],deletes=[],add=World.addObj,del=World.removeNpc;World.addObj=function(...args){drops.push(args);return add.apply(this,args);};World.removeNpc=function(npc,duration){if(npc===n)deletes.push({tick:World.currentTick,duration,scaled:this.scaleByPlayerCount(duration)});return del.call(this,npc,duration);};
  try{for(let kill=0;kill<3;kill++){
    [p.x,p.z]=anchors[0];poll(p);assert.equal(n.type,exposed);assert(!map.isMapBlocked(p.x,p.z,p.level));assert(p.inOperableDistance(n));p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC2);
    let elapsed=0;while(n.isActive&&elapsed++<400)ticks(p,1);assert(!n.isActive,'actual weapon damage reaches the real death/delete queue');p.clearInteraction();
    const deletion=deletes.at(-1);assert.equal(deletion.duration,100);assert.equal(n.lifecycleTick,deletion.scaled-1,'native population scaling and removal-turn decrement');assert.deepEqual(drops,[],'actual kills leave no ground object; no optional loot table is built');const remaining=n.lifecycleTick;ticks(p,remaining-1);assert(!n.isActive);ticks(p,1);assert(n.isActive);assert.equal(n.type,dormant);assert.equal(n.levels[3],1);assert.deepEqual([n.x,n.z],spawns[0]);
    assert.equal([...World.npcs].filter(other=>other.baseType===dormant).length,7);
  }}finally{World.addObj=add;World.removeNpc=del;finish(p);}
});
test('an unchanged natural default-respawn NPC receives the same scaled native lifecycle value',()=>{
  reset();const n=natural(0),control=[...World.npcs].find(other=>other.baseType!==dormant&&types.NpcType.get(other.baseType).respawnrate===100);assert(control);
  const duration=types.NpcType.get(control.baseType).respawnrate;assert.equal(duration,types.NpcType.get(dormant).respawnrate);
  World.removeNpc(control,duration);control.turn();const expected=control.lifecycleTick;World.addNpc(control,-1,false);
  World.removeNpc(n,duration);n.turn();assert.equal(n.lifecycleTick,expected);World.addNpc(n,-1,false);console.log(`RESPAWN native default control ${control.baseType}: authored=${duration}, observed=${expected}`);
});
test('one grab draws only one native random magnitude and never an accuracy roll',()=>{
  reset();const p=fixture(),n=natural(0),original=Runner.HANDLERS[ScriptOpcode.RANDOMINC];let draws=0;
  Runner.HANDLERS[ScriptOpcode.RANDOMINC]=state=>{draws++;return original(state);};
  try{grab(p,n);ticks(p,6);assert.equal(draws,1);assert.deepEqual(p.damageRequests.map(row=>row.amount),[13]);}finally{Runner.HANDLERS[ScriptOpcode.RANDOMINC]=original;finish(p);}
});
test('a real inventory book modal prevents a front-tile grab until its real close button',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','baxtorian_book_waterfall_quest'])),n=natural(0);
  assert(held(p,'baxtorian_book_waterfall_quest',1));assert(p.busy());ticks(p,10);
  assert.equal(n.type,dormant);assert.equal(n.getVar(own),-1);assert(!p.delayed);assert.deepEqual([p.x,p.z],anchors[0]);
  assert(button(p,'book:close'));ticks(p,1);assert.equal(n.getVar(own),p.uid);
  ticks(p,1);assert(p.delayed);ticks(p,6);assert.deepEqual(p.damageRequests.map(d=>d.amount),[13]);finish(p);
});
test('lethal grab uses actual player death and cannot rearm the released cave controller',()=>{
  reset();const p=start(fixture()),n=natural(0);p.levels[PlayerStat.HITPOINTS]=5;ticks(p,2);assert(p.delayed);ticks(p,5);assert.equal(hp(p),0);assert.deepEqual(p.damageRequests.map(row=>row.amount),[13]);
  ticks(p,20);assert(hp(p)>0);assert.equal(execute('[proc,swamp_cave_inside]',p,[CoordGrid.packCoord(...tile(p))]).popInt(),0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);finish(p);
});
test('ring-of-life rescue after release cannot replay the grab or rearm the released controller',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','ring_of_life'])),n=natural(0);p.levels[PlayerStat.HITPOINTS]=20;assert(held(p,'ring_of_life',2));
  ticks(p,8);assert.equal(hp(p),7);assert.equal(n.getVar(own),-1);assert.equal(count(p,'ring_of_life',worn),0);
  ticks(p,20);assert.equal(p.damageRequests.length,1);assert.equal(execute('[proc,swamp_cave_inside]',p,[CoordGrid.packCoord(...tile(p))]).popInt(),0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);finish(p);
});
test('compiled poll cost is fixed away from the seven front tiles, with no NPC search',()=>{
  reset();const p=fixture(),original=Runner.HANDLERS[ScriptOpcode.NPC_FINDEXACT],rows=[];let searches=0;
  Runner.HANDLERS[ScriptOpcode.NPC_FINDEXACT]=state=>{searches++;return original(state);};
  try{
    for(const [level,x,z]of [[0,3160,9546],[0,3162,9546],[0,3161,9547],[1,3161,9546]]){
      p.level=level;p.x=x;p.z=z;searches=0;const state=execute('[proc,swamp_wallbeast_poll]',p);
      rows.push({tile:[level,x,z],opcodes:state.opcount,npcSearches:searches});assert.equal(searches,0);
    }
    assert(rows.slice(0,3).every(row=>row.opcodes===rows[0].opcodes));
    p.level=0;[p.x,p.z]=anchors[0];searches=0;const state=execute('[proc,swamp_wallbeast_poll]',p);
    rows.push({tile:[0,p.x,p.z],opcodes:state.opcount,npcSearches:searches});assert.equal(searches,1);
    console.log(`POLL_COST ${JSON.stringify(rows)}`);
  }finally{Runner.HANDLERS[ScriptOpcode.NPC_FINDEXACT]=original;finish(p);}
});
console.log(`SC05 wall beast: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
