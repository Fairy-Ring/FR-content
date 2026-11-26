import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { World, Player, ScriptRunner, ScriptState, ScriptProvider, requiredId, types, engine, packed } from '../regicide-travel/runtime.mjs';
const load = rel => import(pathToFileURL(`${engine}/src/${rel}`).href);
const Environment = (await load('util/Environment.ts')).default;
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const Packet = (await load('io/Packet.ts')).default;
const map = await load('engine/GameMap.ts');
const { ScriptOpcode: op } = await load('engine/script/ScriptOpcode.ts');
assert.equal(Environment.NODE_MEMBERS, false, 'this process loads its real world as F2P, not a members-world mock');
const v = name => requiredId(types.VarPlayerType,name);
const O = [0,3222,3218], tile = p => [p.level,p.x,p.z];
let serial = 0;
function bind(p) {
  const slot = ++serial; p.slot=slot; p.pid=slot;
  p.uid=((Number(p.username37 & 0x1fffffn)<<11)|slot)>>>0;
  p.isActive=true; p.packets=[]; p.write=packet=>p.packets.push(packet);
  p.buildArea.originX=Math.floor(p.x/8)*8; p.buildArea.originZ=Math.floor(p.z/8)*8;
  World.players[slot]=p;
  return p;
}
function player() {
  const p=bind(new Player(`arena${serial+1}`,BigInt(serial+1),0n));
  p.vars.fill(0); p.levels.fill(99); p.baseLevels.fill(99);
  p.setVar(v('tutorial'),1000); [p.level,p.x,p.z]=O;
  run(p,'[proc,initalltabs]'); return p;
}
function run(p,name,args=[]) {
  const state=ScriptRunner.init(packed(name),p,null,args);
  p.runScript(state,true);
  for(let n=0;state.execution===ScriptState.SUSPENDED&&n<80;n++) {
    World.currentTick=Math.max(World.currentTick+1,p.delayedUntil); p.delayed=false;
    state.execution=ScriptState.RUNNING; p.runScript(state,true,true);
  }
  assert.notEqual(state.execution,ScriptState.ABORTED,name);
  assert.equal(state.execution,ScriptState.FINISHED,name);
  return state;
}
const inv=requiredId(types.InvType,'inv');
const actors=()=>[...World.npcs].filter(n=>n.isActive).map(n=>n.uid).sort((a,b)=>a-b);
for(const [event,mx,mz] of [[20,45,71],[21,31,74],[23,32,69],[24,30,74]]) {
  assert(!World.gameMap.isFreeToPlay(mx*64+32,mz*64+32),'the known engine map-classification limit is not mocked away');
  const p=player(), vars=[...p.vars], beforeActors=actors(), beforeItems=p.getInventory(inv).items.map(i=>i?[i.id,i.count]:null);
  const originalBlocked=ScriptRunner.HANDLERS[op.MAP_BLOCKED]; let blockedQueries=0;
  ScriptRunner.HANDLERS[op.MAP_BLOCKED]=state=>{ blockedQueries++; originalBlocked(state); };
  try {
    run(p,'[proc,macro_event_general_spawn]',[event]);
    const destination=(mx*64+32)<<14 | (mz*64+32);
    const admission=run(p,'[proc,macro_arena_enter]',[event,destination,1]);
    assert.equal(admission.intStack[admission.isp-1],0,'direct arena admission explicitly refuses this unsupported world');
    assert.equal(blockedQueries,0,'F2P refusal precedes the unsafe private-map landing query');
  } finally { ScriptRunner.HANDLERS[op.MAP_BLOCKED]=originalBlocked; }
  assert.deepEqual([...p.vars],vars,'refusal changes no event or puzzle state');
  assert.deepEqual(actors(),beforeActors,'refusal creates no stranded arena actor');
  assert.deepEqual(p.getInventory(inv).items.map(i=>i?[i.id,i.count]:null),beforeItems);
  assert.deepEqual(tile(p),O,'refusal leaves the ordinary F2P player at departure');
  run(p,'[proc,macro_event_logout]');
  const saved=p.save(); p.isActive=false; World.players[p.slot]=null;
  const q=bind(PlayerLoading.load(p.username,new Packet(saved),null));
  run(q,'[queue,macro_event_login]');
  assert.deepEqual(tile(q),O); assert.equal(q.getVar(v('macro_event')),0,'ordinary native save-load relog cannot revive a refused arena');
  console.log(`PASS F2P arena ${event}: explicit refusal before MAP_BLOCKED, no mutation or stranding, native ordinary relog`);
}
const ordinary=player();
run(ordinary,'[proc,macro_event_general_spawn]',[2]);
assert.equal(ordinary.getVar(v('macro_event')),2,'a classified ordinary F2P Genie remains eligible');
const actor=ordinary.getVar(v('macro_event_uid'));
assert(World.getNpcByUid(actor)?.isActive,'the ordinary event creates its real native actor');
run(ordinary,'[proc,macro_event_cleanup]',[2,actor]);
assert.deepEqual(tile(ordinary),O);
console.log('PASS ordinary F2P event still spawns and cleans up');
console.log('Four clean F2P arena-refusal and native ordinary-relog proofs passed');
// Native World imports own workers; all synchronous assertions above are complete.
process.exit(0);
