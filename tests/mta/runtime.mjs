import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const fail=error=>{console.error(error);process.exit(1);};
process.on('uncaughtException',fail);
process.on('unhandledRejection',fail);
export {assert};
export const contentRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const engineRoot=path.resolve(process.env.HARNESS_ENGINE_DIR??path.join(contentRoot,'../engine'));
export const packDir=path.resolve(process.env.HARNESS_PACK_DIR??path.join(engineRoot,'data/pack'));
export const load=relative=>import(pathToFileURL(path.join(engineRoot,'src',relative)).href);
export const World=(await load('engine/World.ts')).default;
export const Player=(await load('engine/entity/Player.ts')).default;
export const Npc=(await load('engine/entity/Npc.ts')).default;
export const Loc=(await load('engine/entity/Loc.ts')).default;
export const Obj=(await load('engine/entity/Obj.ts')).default;
export const {EntityLifeCycle} = await load('engine/entity/EntityLifeCycle.ts');
export const {PlayerTimerType}=await load('engine/entity/EntityTimer.ts');
export const ScriptProvider=(await load('engine/script/ScriptProvider.ts')).default;
export const ScriptRunner=(await load('engine/script/ScriptRunner.ts')).default;
export const ScriptState=(await load('engine/script/ScriptState.ts')).default;
export const ServerTriggerType=(await load('engine/script/ServerTriggerType.ts')).default;
export const Packet=(await load('io/Packet.ts')).default;
export const {PlayerLoading}=await load('engine/entity/PlayerLoading.ts');
export const configs={};
for(const name of ['VarPlayerType','VarBitType','VarNpcType','VarSharedType','ParamType','ObjType','LocType','NpcType','InvType','CategoryType','EnumType','StructType','SeqType','SpotanimType','MesanimType','DbTableType','DbRowType','HuntType','IdkType','Component','FontType']){
  configs[name]=(await load(`cache/config/${name}.ts`)).default;
  configs[name].load(packDir);
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(packDir)>0,'compiled MTA pack required');
World.vars=new Int32Array(configs.VarSharedType.count);
const {unzipSync}=createRequire(path.join(engineRoot,'package.json'))('fflate');
const maps=unzipSync(readFileSync(path.join(packDir,'.cache/maps-server.zip')));
World.gameMap.zonemap.beginInitialization();
for(const [mx,mz] of [[52,51],[52,150],[52,151]]){
  const square=Object.fromEntries(['m','l','n','o'].map(kind=>[kind,maps[`${kind}${mx}_${mz}`]??new Uint8Array()]));
  assert(square.m.length,`packed MTA mapsquare ${mx},${mz}`);
  World.gameMap.packed.set((mx<<8)|mz,square);
  World.gameMap.loadPackedMapsquare(square,mx<<6,mz<<6);
}
World.gameMap.zonemap.endInitialization();
World.currentTick=100;
export const id=(type,name)=>{const value=configs[type].getId(name);assert.notEqual(value,-1,`${type} ${name} missing`);return value;};
export const obj=name=>id('ObjType',name);
export const inv=id('InvType','inv');
export const worn=id('InvType','worn');
let serial=0;
export function player({x=3363,z=3314,level=0}={}){
  const n=++serial;
  const p=new Player(`mtatest${n}`,BigInt(70000+n),BigInt(80000+n));
  p.slot=n;p.pid=n;p.uid=((Number(BigInt(70000+n)&0x1fffffn)<<11)|n)>>>0;
  p.vars.fill(0);p.stats.fill(12345678);p.baseLevels.fill(99);p.levels.fill(99);
  p.x=x;p.z=z;p.level=level;p.originX=x;p.originZ=z;p.isActive=true;
  p.messages=[];p.packets=[];p.write=value=>p.packets.push(value);
  p.messageGame=text=>p.messages.push(String(text));p.wrappedMessageGame=p.messageGame;
  p.getInventory(inv);p.getInventory(worn);
  p.setVar(id('VarPlayerType','tutorial'),1000);
  World.players[n]=p;World.playerLoop.add(p.hash64,p);
  return p;
}
export function give(p,name,amount=1,inventory=inv){assert.equal(p.invAdd(inventory,typeof name==='number'?name:obj(name),amount),amount,`give ${name}`);}
export const count=(p,name,inventory=inv)=>p.invTotal(inventory,typeof name==='number'?name:obj(name));
export function run(p,name,args=[],target=null){
  const script=typeof name==='string'?ScriptProvider.getByName(name):name;
  assert(script,`compiled script missing: ${name}`);
  const state=ScriptRunner.init(script,p,target,args);
  p.executeScript(state,true,true);
  assert.notEqual(state.execution,ScriptState.ABORTED,`${script.name} aborted`);
  return state;
}
export function trigger(p,type,target,configType){
  const cfg=configType??(target instanceof Npc?'NpcType':target instanceof Loc?'LocType':'ObjType');
  const script=ScriptProvider.getByTrigger(typeof type==='string'?ServerTriggerType[type]:type,target.type,configs[cfg].get(target.type).category);
  assert(script,`missing ${type} for ${configs[cfg].get(target.type).debugname}`);
  return run(p,script,[],target);
}
export function tick(p,n=1){for(let i=0;i<n;i++){World.currentTick++;if(World.currentTick>=p.delayedUntil)p.delayed=false;p.processQueues();p.processTimers(PlayerTimerType.NORMAL);p.processTimers(PlayerTimerType.SOFT);p.processEngineQueue();}}
export function loc(name,x,z,level=0,shape=10,angle=0){return new Loc(level,x,z,1,1,EntityLifeCycle.RESPAWN,id('LocType',name),shape,angle);}
export function npc(name,x,z,level=0){const type=configs.NpcType.get(id('NpcType',name));const n=new Npc(level,x,z,type.size,type.size,EntityLifeCycle.RESPAWN,World.npcs.next(),type.id,type.blockwalk);World.addNpc(n,-1);return n;}
