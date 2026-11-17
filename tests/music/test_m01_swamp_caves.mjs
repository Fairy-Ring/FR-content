#!/usr/bin/env node
/** M01: native DB indices, compiled scripts/handlers and production MIDI encoding. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, map, engineModule, contentRoot, id, player, seed, useLoc,
  environmentTick, execute, tile, musicMark, musicPackets, expectMusic, musicBits, musicText } from './runtime.mjs';
const { MoveSpeed } = await engineModule('engine/entity/MoveSpeed.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const DbTableIndex = (await engineModule('cache/config/DbTableIndex.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const varp = name => id('VarPlayerType', name);
const current = p => p.vars[varp('currentsong')];
// Independent original cache oracle: root 962, component 12584, CS1 [13,414,16,0].
// MIDI 389 original decompressed payload, not a built gzip member or authored tuple.
const targetVarp = 414, targetBit = 16;
const target = p => (p.vars[targetVarp] >>> targetBit) & 1;
const targetHash = '28abea2a2334e9785f5a31ee8e83ddb8165ee3452f7b99d2a8bec714d6981db0';
const top = [0,3168,3172], bottom = [0,3168,9572];
let cases = 0, failures = 0;
function test(name, run) {
  cases++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function fresh(position = top, { login = true, lowMemory = false } = {}) {
  const p = seed(player(), ['rope','bullseye_lantern_lit']);
  [p.level,p.x,p.z] = position; p.lowMemory = lowMemory;
  if (login) { p.onLogin(); p.processEngineQueue(); }
  p.vars[varp('musicplay')] = 1; p.vars[varp('musicloop')] = 0;
  return p;
}
function finish(p) {
  p.delayed = false; p.activeScript = null; p.closeModal();
  execute('[proc,swamp_cave_release]',p); p.clearInteraction();
  p.isActive = false; World.players[p.pid] = null; p.unlink();
}
function withPlayer(position, run, options) { const p = fresh(position,options); try { run(p); } finally { finish(p); } }
function drain(p) { for (let i=0;i<3;i++) environmentTick(p); }
function walkStep(p, destination) {
  p.resetEntity(false); p.moveSpeed = MoveSpeed.WALK;
  p.queueWaypoint(destination[1],destination[2]); p.updateMovement(); drain(p);
  assert.deepEqual(tile(p),destination,'real movement reaches boundary destination');
}
function loc(name,x,z,level=0) { const value=World.getLoc(x,z,level,id('LocType',name)); assert(value,`natural ${name}`); return value; }
function click(p,l) {
  p.originX=p.x; p.originZ=p.z;
  assert(locHandler.handle(new OpLoc(1,l.x,l.z,l.type),p),'production loc handler accepts');
  p.processInteraction(); drain(p);
}
function row(name) { return types.DbRowType.get(id('DbRowType',name)); }
function field(r,table,name) { return r.columnValues[table.columnNames.indexOf(name)]; }
const regions = types.DbTableType.get(id('DbTableType','musicregion'));
const songs = types.DbTableType.get(id('DbTableType','music'));
function indexed(position) {
  const key=CoordGrid.packCoord(0,position[1]>>6<<6,position[2]>>6<<6);
  return DbTableIndex.find(key,(regions.id<<12)|(regions.columnNames.indexOf('mapsquare')<<4));
}
function selected(position,expectedRow) {
  assert.deepEqual(indexed(position),[id('DbRowType',expectedRow)],'native exact indexed region row');
  const r=row(expectedRow), linked=types.DbRowType.get(field(r,regions,'musicdata')[0]);
  return { name:field(linked,songs,'name')[0], midi:field(linked,songs,'track')[0] };
}
function firstUnlock(p, mode, lowMemory=false) {
  assert.equal(target(p),0,'original 414:16 must be zero before real rope descent');
  p.vars[varp('musicplay')]=mode;
  const before=musicBits(p), mark=musicMark(p);
  assert(useLoc(p,'rope',loc('goblin_cave_entrance',3169,3172)));
  drain(p); assert.deepEqual(tile(p),bottom,'scripted rope arrival');
  assert.equal(target(p),1,'original 414:16 changes 0 to 1');
  const expected=before.slice(); expected[9]|=1<<targetBit;
  assert.deepEqual(musicBits(p),expected,'only the original target music bit changes, never Faerie or Crystal Cave');
  if(mode && !lowMemory) {
    expectMusic(p,mark,389,[5,1]); assert.deepEqual(musicText(p,mark),['Cave of the Goblins']);
  } else assert.deepEqual(musicPackets(p,mark),[],'Manual/low-memory emits zero area packets');
  if(mode) assert.equal(current(p),389,'low memory still selects server song');
}

test('original source MIDI bytes and named native row links',()=>{
  assert.equal(createHash('sha256').update(readFileSync(path.join(contentRoot,'songs/cave of the goblins.mid'))).digest('hex'),targetHash);
  for(const [x,name] of [[3168,'musicregion_49_149'],[3200,'musicregion_50_149']]) {
    assert.deepEqual(selected([0,x,9571],name),{name:'Cave of the Goblins',midi:389});
    assert.deepEqual(field(row(name),regions,'name'),['Cave of the Goblins']);
  }
});
test('surface stand remains Book Of Spells 64',()=>withPlayer(top,p=>expectMusic(p,0,64,[192,0])));
test('Auto first own-rope entry: fresh 389, original bit and no unintended unlock',()=>withPlayer(top,p=>firstUnlock(p,1)));
test('Manual first own-rope entry: no packet and original bit 0 to 1',()=>withPlayer(top,p=>{
  const before=current(p); firstUnlock(p,0); assert.equal(current(p),before,'Manual retains current song');
}));
test('low-memory first own-rope entry: no packet and server song 389',()=>withPlayer(top,p=>firstUnlock(p,1,true),{lowMemory:true}));
for(const z of [9553,9571,9585]) for(const east of [true,false]) {
  const from=[0,east?3199:3200,z],to=[0,east?3200:3199,z];
  test(`same-song real boundary ${from.slice(1)} to ${to.slice(1)} sends exactly once`,()=>withPlayer(from,p=>{
    assert.equal(target(p),1,'source-square login already unlocked the track; this is a resend case');
    const mark=musicMark(p); walkStep(p,to); expectMusic(p,mark,389,[5,1]);
    assert.deepEqual(musicText(p,mark),['Cave of the Goblins']);
  }));
}
for(const position of [[0,3168,9572],[0,3200,9571]]) test(`independent cave login ${position}: 389 once`,()=>withPlayer(position,p=>expectMusic(p,0,389,[5,1])));
test('real rope exit selects surface 64 once',()=>withPlayer(top,p=>{
  firstUnlock(p,1); const mark=musicMark(p); click(p,loc('swamp_cave_climbing_rope',3169,9572));
  assert.deepEqual(tile(p),top); expectMusic(p,mark,64,[192,0]);
}));
test('northern Lost Tribe stub and return preserve Harmony 2 then 389',()=>withPlayer([0,3223,9599],p=>{
  let mark=musicMark(p); walkStep(p,[0,3223,9600]); expectMusic(p,mark,46,[174,0]);
  mark=musicMark(p); walkStep(p,[0,3223,9599]); expectMusic(p,mark,389,[5,1]);
}));
test('real Tears descent and return preserve 397 then 389 and darkness zones',()=>withPlayer([0,3225,9542],p=>{
  let mark=musicMark(p); click(p,loc('tog_cave_down',3225,9539));
  assert.deepEqual(tile(p),[2,3218,9532]); expectMusic(p,mark,397,[13,1]);
  assert.equal(p.getVarBit(id('VarBitType','darkness_level')),1,'existing Tears darkness remains active');
  mark=musicMark(p); click(p,loc('tog_cave_up',3218,9533,2));
  assert.deepEqual(tile(p),[0,3225,9542]); expectMusic(p,mark,389,[5,1]);
}));
// These are generic static lookup controls on supported remnants, NOT ordinary entrances.
// Supported/collision-open witnesses from the independent map census, not entry seeds.
for(const [mx,mz,midi,payload,positions] of [
  [49,149,389,[5,1],[[0,3136,9536],[1,3141,9570],[2,3139,9574]]],
  [50,149,389,[5,1],[[0,3200,9536],[1,3200,9574],[2,3200,9548]]],
  [51,150,407,[23,1],[[0,3264,9610],[1,3265,9621],[2,3264,9603]]]
]) for(const position of positions) {
  const level=position[0];
  test(`static generic supported-remnant control m${mx}_${mz} plane ${level}`,()=>withPlayer(position,p=>{
    const mark=musicMark(p); execute('[proc,music_playbycoord]',p,[CoordGrid.packCoord(level,p.x,p.z)]);
    expectMusic(p,mark,midi,payload);
  },{login:false}));
}
for(const [position,midi,payload] of [[[0,2400,4400],118,[246,0]],[[0,2460,4450],181,[53,0]]]) {
  test(`genuine relocated Zanaris remains ${midi} and retains a valid region writer`,()=>withPlayer(position,p=>{
    expectMusic(p,0,midi,payload);
    const writers=types.DbRowType.getInTable(regions.id).filter(r=>field(r,regions,'musicdata')?.[0]===id('DbRowType',midi===118?'music_Faerie':'music_Crystal_Cave'));
    assert(writers.length>0,'not the last Faerie/Crystal Cave writer');
  }));
}
test('missing row lookup carries prior song/display without packets',()=>withPlayer(top,p=>{
  const song=current(p), mark=musicMark(p);
  assert.deepEqual(indexed([0,1,1]),[],'no indexed row for control');
  execute('[proc,music_playbycoord]',p,[CoordGrid.packCoord(0,1,1)]);
  assert.equal(current(p),song); assert.deepEqual(musicPackets(p,mark),[]); assert.deepEqual(musicText(p,mark),[]);
}));
test('no mapzone cannot dispatch on login or native entry',()=>withPlayer([0,1860,4930],p=>{
  assert.deepEqual(musicPackets(p),[]); const song=current(p),mark=musicMark(p);
  // Static own-position fixture in existing Keldagrim squares, not an access proof.
  p.teleport(1925,4930,0); drain(p);
  assert.deepEqual(tile(p),[0,1925,4930]); assert.equal(current(p),song); assert.deepEqual(musicPackets(p,mark),[]);
}));
console.log(`M01 swamp music: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
