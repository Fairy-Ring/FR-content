#!/usr/bin/env node
/** SC-05: original placed NPCs, real queues/timers, damage, wear and respawn. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, PlayerStat, PlayerTimerType, ScriptProvider, ScriptState, ServerTriggerType,
  types, engineModule, id, obj, inv, worn, player, seed, count, held, remove, execute,
  tile, contentRoot } from './runtime.mjs';
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Pointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { ParamHelper } = await engineModule('cache/config/ParamHelper.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { MoveRestrict } = await engineModule('engine/entity/MoveRestrict.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const anchors = [[3161,9547],[3162,9574],[3164,9556],[3198,9554],[3198,9572],[3215,9560],[3216,9588]];
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
function natural(index){return holes.find(n=>n.startX===anchors[index][0]&&n.startZ===anchors[index][1]);}
function grab(p,n){poll(p);ticks(p,1);assert(p.delayed,'NPC queue holds the actual player');return World.currentTick;}
function noExtra(p){assert.equal(p.getVar(id('VarPlayerType','poison')),0);assert(!p.packets.some(x=>/Synth|Spotanim/.test(x.constructor.name)));}

test('seven original dormant spawns occupy the seven plane-zero anchors',()=>{
  assert.equal(holes.length,7);assert.deepEqual(holes.map(n=>[n.startX,n.startZ]).sort(),anchors.slice().sort());assert(holes.every(n=>n.startLevel===0&&n.type===dormant));
});
for(const type of [dormant,exposed])test(`${types.NpcType.get(type).debugname}: stationary fields and unchanged 100-tick respawn`,()=>{
  const t=types.NpcType.get(type);assert.equal(t.wanderrange,0);assert.equal(t.maxrange,2,'absent maxrange derives wanderrange + 2');assert.equal(t.moverestrict,MoveRestrict.NOMOVE);assert.equal(t.defaultmode,NpcMode.NONE);assert.equal(t.givechase,false);assert.equal(t.respawnrate,100);assert.equal(t.timer,type===exposed?1:-1);
});
for(let index=0;index<7;index++)test(`anchor ${anchors[index]}: single grab hits at five, releases at six, then ten-tick cooldown`,()=>{
  reset();const p=fixture(index),n=natural(index),begin=grab(p,n);
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
  reset();const p=start(fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet'])),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,1);assert.equal(n.type,exposed);assert.equal(n.levels[3],105);assert.equal(p.animations.filter(x=>playerAnims.includes(x.seq)).length,0);finish(p);
});
for(const keep of [true,false])test(`exposed form: ${keep?'keeping':'removing'} the helmet never causes another grab or exposure`,()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet'])),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));ticks(p,1);assert.equal(n.type,exposed);const uid=n.uid;
  if(!keep)assert(remove(p,'wallbeast_spike_helmet'));ticks(p,20);assert.equal(n.type,exposed);assert.equal(n.uid,uid);assert.equal(p.animations.filter(x=>playerAnims.includes(x.seq)).length,0);assert(p.damageRequests.every(x=>x.amount<=4));noExtra(p);finish(p);
});
test('stationary bare-headed player is grabbed again after release plus ten cooldown ticks',()=>{
  reset();const p=start(fixture()),n=natural(0);ticks(p,2);assert(p.delayed);ticks(p,6);assert(!p.delayed);const release=World.currentTick;assert.equal(n.getVar(cooldown),release+10);
  ticks(p,9);assert.equal(p.damageRequests.length,1);ticks(p,1);assert.equal(n.getVar(own),p.uid);ticks(p,1);assert(p.delayed);ticks(p,6);assert.equal(p.damageRequests.length,2);finish(p);
});
test('one NPC reserves one victim even with two eligible players on the anchor in one pass',()=>{
  reset();const a=start(fixture()),b=start(fixture()),n=natural(0);frame([a,b]);assert.equal(n.getVar(own),a.uid);frame([a,b]);assert(a.delayed);assert(!b.delayed);ticks([a,b],6);assert.equal(a.damageRequests.length,1);assert.equal(b.damageRequests.length,0);finish(a);finish(b);
});
test('native engagement inside three tiles pauses reset; leaving seven tiles starts ten ticks',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));poll(p);assert.equal(n.type,exposed);
  p.x=n.x+3;ticks(p,12);assert.equal(n.type,exposed);assert.equal(n.target,p);p.x=n.x+7;ticks(p,1);assert.equal(n.target,null);ticks(p,8);assert.equal(n.type,exposed);ticks(p,1);assert.equal(n.type,dormant);assert.equal(n.timerInterval,0);assert.equal(n.targetOp,NpcMode.NONE);
  [p.x,p.z]=anchors[0];poll(p);assert.equal(n.type,exposed);assert(!p.delayed);finish(p);
});
test('complete ordinary row: six skills, crush, zero native bonuses, max four and unchanged Slayer 35 enum',()=>{
  reset();const n=natural(0);n.changeType(exposed,1000);assert.deepEqual([...n.levels],[30,16,30,105,1,1]);
  assert.equal(param(n,'attackrate'),6);assert.equal(param(n,'damagetype'),2);for(const key of ['attackbonus','strengthbonus','magicattack','rangeattack','rangebonus','stabdefence','slashdefence','crushdefence','magicdefence','rangedefence'])assert.equal(param(n,key),0,key);
  for(const [key,seq]of [['attack_anim','wall_beast_specialattack_attack'],['defend_anim','wall_beast_specialattack_defend'],['death_anim','wall_beast_specialattack_death']])assert.equal(param(n,key),id('SeqType',seq));
  assert.equal(npcRun('[proc,npc_melee_maxhit]',n).popInt(),4);assert(param(n,'slayer_category')>=0);
  const req=types.EnumType.getByName('slayer_req');assert(req);assert.equal(req.values.get(param(n,'slayer_category')),35);
});
test('shared drop, sounds and unsupported-special defaults remain the published effective values',()=>{
  const synth=new Map(readFileSync(new URL('../../pack/synth.pack',import.meta.url),'utf8').split(/\r?\n/).filter(line=>/^\d+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(at+1),Number(line.slice(0,at))];}));
  reset();const n=natural(0);
  for(const type of [dormant,exposed]){
    n.changeType(type,1000);assert.equal(param(n,'death_drop'),obj('bones'));
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
test('logout during a grab cancels the player-owned continuation and never hits a disconnected victim',()=>{
  reset();const p=start(fixture()),n=natural(0);ticks(p,2);assert(p.delayed);execute('[logout,_]',p);p.activeScript=null;p.loggingOut=true;p.isActive=false;World.players[p.pid]=null;
  ticks(p,20);assert.equal(p.damageRequests.length,0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);assert(n.getVar(cooldown)<=World.currentTick);p.unlink();
});
for(const departure of ['walk-away','logout','death','teleport'])test(`exposed ${departure}: native disengagement retains the timer and returns after ten reset ticks`,()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));poll(p);ticks(p,1);assert.equal(n.type,exposed);
  if(departure==='walk-away')p.teleport(n.x+7,n.z,0);
  if(departure==='logout'){execute('[logout,_]',p);p.loggingOut=true;p.isActive=false;World.players[p.pid]=null;}
  if(departure==='death'){p.applyDamage(hp(p),1);execute('[proc,player_die]',p);}
  if(departure==='teleport')execute('[proc,player_teleport_normal]',p,[CoordGrid.packCoord(0,3220,3220)]);
  const resetStart=World.currentTick;ticks(p,9);assert.equal(n.type,exposed);ticks(p,1);assert.equal(World.currentTick-resetStart,10);assert.equal(n.type,dormant);assert.deepEqual([n.level,n.x,n.z],[0,...anchors[0]]);finish(p);
});
test('a real spell from four tiles spends a rune but the stationary beast drops that target and resets',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','staff_of_air','mindrune']),n=natural(0);
  assert(held(p,'staff_of_air',2));assert(held(p,'wallbeast_spike_helmet',2));poll(p);p.teleport(3165,9544,0);assert(p.inApproachDistance(10,n),'real natural-map casting line at distance four');
  const before=p.stats[PlayerStat.MAGIC];execute('[apnpct,magic:wind_strike]',p,[],{target:n});
  assert.equal(count(p,'mindrune'),0);assert(p.stats[PlayerStat.MAGIC]>before);p.clearInteraction();
  const clock=id('VarNpcType','npc_int2'),transitions=[];for(let i=0;i<20;i++){ticks(p,1);transitions.push({tick:World.currentTick,mode:n.targetOp,target:n.target?.uid??null,clock:n.getVar(clock)});assert.deepEqual([n.x,n.z],anchors[0]);if(!n.target&&[...n.queue.all()].length===0&&n.getVar(clock)>0)break;}
  assert.equal(n.target,null);assert.equal(n.targetOp,NpcMode.NONE);assert(n.getVar(clock)>0);console.log(`RANGE four-tile native spell ${JSON.stringify(transitions)}`);
  const remaining=10-n.getVar(clock);ticks(p,remaining-1);assert.equal(n.type,exposed);ticks(p,1);assert.equal(n.type,dormant);assert.deepEqual([n.x,n.z],anchors[0]);finish(p);
});
for(const level of [34,35])test(`Slayer ${level}: real outgoing attack ${level===34?'is refused':'is admitted'} by the existing category gate`,()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','rune_scimitar']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));assert(held(p,'rune_scimitar',2));poll(p);p.z++;
  p.levels[PlayerStat.SLAYER]=level;p.baseLevels[PlayerStat.SLAYER]=level;
  const before=p.stats[PlayerStat.ATTACK];p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC2);ticks(p,3);
  assert.equal(p.messages.includes('You need a higher Slayer level to know how to wound this monster.'),level===34);assert.equal(p.stats[PlayerStat.ATTACK]>before,level===35);finish(p);
});
test('ordinary packed combat repeatedly uses authored 100 and the engine-scaled respawn schedule without an eighth hole',()=>{
  reset();const p=fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet','rune_scimitar']),n=natural(0);assert(held(p,'wallbeast_spike_helmet',2));assert(held(p,'rune_scimitar',2));
  const drops=[],deletes=[],add=World.addObj,del=World.removeNpc;World.addObj=function(...args){drops.push(args);return add.apply(this,args);};World.removeNpc=function(npc,duration){if(npc===n)deletes.push({tick:World.currentTick,duration,scaled:this.scaleByPlayerCount(duration)});return del.call(this,npc,duration);};
  try{for(let kill=0;kill<3;kill++){
    [p.x,p.z]=anchors[0];poll(p);assert.equal(n.type,exposed);p.z++;p.setInteraction(Interaction.ENGINE,n,ServerTriggerType.APNPC2);
    let elapsed=0;while(n.isActive&&elapsed++<400)ticks(p,1);assert(!n.isActive,'actual weapon damage reaches the real death/delete queue');p.clearInteraction();
    const deletion=deletes.at(-1);assert.equal(deletion.duration,100);assert.equal(n.lifecycleTick,deletion.scaled-1,'native population scaling and removal-turn decrement');assert.deepEqual(drops.map(args=>({type:args[0].type,count:args[0].count})),Array.from({length:kill+1},()=>({type:obj('bones'),count:1})),'one shared-default bones per kill; no type-specific table');const remaining=n.lifecycleTick;ticks(p,remaining-1);assert(!n.isActive);ticks(p,1);assert(n.isActive);assert.equal(n.type,dormant);assert.equal(n.levels[3],1);assert.deepEqual([n.x,n.z],anchors[0]);
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
test('a modal busy player pauses activation, then current headwear determines the first free pass',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','wallbeast_spike_helmet'])),n=natural(0);p.openMainModal(id('Component','trademain'));ticks(p,10);assert.equal(n.type,dormant);assert(!p.delayed);p.closeModal();assert(held(p,'wallbeast_spike_helmet',2));ticks(p,1);assert.equal(n.type,exposed);finish(p);
});
test('lethal grab uses actual player death and cannot rearm the released cave controller',()=>{
  reset();const p=start(fixture()),n=natural(0);p.levels[PlayerStat.HITPOINTS]=5;ticks(p,2);assert(p.delayed);ticks(p,5);assert.equal(hp(p),0);assert.deepEqual(p.damageRequests.map(row=>row.amount),[13]);
  ticks(p,20);assert(hp(p)>0);assert.equal(execute('[proc,swamp_cave_inside]',p,[CoordGrid.packCoord(...tile(p))]).popInt(),0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);finish(p);
});
test('normal teleport interrupts the held continuation instead of delivering a remote grab',()=>{
  reset();const p=start(fixture()),n=natural(0);ticks(p,2);assert(p.delayed);execute('[proc,player_teleport_normal]',p,[CoordGrid.packCoord(0,3220,3220)]);ticks(p,20);assert.equal(p.damageRequests.length,0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);finish(p);
});
test('ring-of-life rescue after release cannot replay the grab or rearm the released controller',()=>{
  reset();const p=start(fixture(0,['bullseye_lantern_lit','ring_of_life'])),n=natural(0);p.levels[PlayerStat.HITPOINTS]=20;assert(held(p,'ring_of_life',2));
  ticks(p,8);assert.equal(hp(p),7);assert.equal(n.getVar(own),-1);assert.equal(count(p,'ring_of_life',worn),0);
  ticks(p,20);assert.equal(p.damageRequests.length,1);assert.equal(execute('[proc,swamp_cave_inside]',p,[CoordGrid.packCoord(...tile(p))]).popInt(),0);assert(!p.timers.has(controller.id));assert.equal(n.type,dormant);finish(p);
});
console.log(`SC05 wall beast: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
