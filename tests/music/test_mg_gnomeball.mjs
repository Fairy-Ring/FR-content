#!/usr/bin/env node
/** MG: packed-map boundaries, native DB indices and compiled music dispatch. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, map, engineModule, contentRoot, id, player, environmentTick,
  execute, tile, ScriptProvider, musicMark, musicPackets, expectMusic, musicBits, musicText } from './runtime.mjs';

const { MoveSpeed } = await engineModule('engine/entity/MoveSpeed.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const DbTableIndex = (await engineModule('cache/config/DbTableIndex.ts')).default;
const regions = types.DbTableType.get(id('DbTableType', 'musicregion'));
const songs = types.DbTableType.get(id('DbTableType', 'music'));
const varp = name => id('VarPlayerType', name);
const current = p => p.vars[varp('currentsong')];
// Original 377 MIDI 112 and component 4342 CS1 [13,21,24,0], independently decoded.
// These identify the retained song/unlock, not a historical tile-allocation claim.
const targetVarp = 21, targetBit = 24;
const unlocked = p => (p.vars[targetVarp] >>> targetBit) & 1;
const targetHash = '287b79a65b1f634207c2219621fbba0d90c37458d35cf11178f6c3d19dae9298';
const removed = [[36,54], [36,55], [37,55]];
const directions = [['west',-1,0], ['east',1,0], ['south',0,-1], ['north',0,1]];
let cases = 0, failures = 0;
function test(name, run) {
  cases++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
function fresh(position, { login = true, lowMemory = false } = {}) {
  const p = player();
  [p.level,p.x,p.z] = position;
  p.lowMemory = lowMemory;
  if (login) { p.onLogin(); p.processEngineQueue(); }
  p.vars[varp('musicplay')] = 1;
  p.vars[varp('musicloop')] = 0;
  return p;
}
function finish(p) {
  p.delayed = false; p.activeScript = null; p.closeModal(); p.clearInteraction();
  p.isActive = false; World.players[p.pid] = null; p.unlink();
}
function withPlayer(position, run, options) {
  const p = fresh(position, options);
  try { run(p); } finally { finish(p); }
}
function walkStep(p, destination) {
  p.resetEntity(false); p.moveSpeed = MoveSpeed.WALK;
  p.queueWaypoint(destination[1],destination[2]); p.updateMovement();
  for (let i=0;i<3;i++) environmentTick(p);
  assert.deepEqual(tile(p), destination, 'native movement reaches the adjacent boundary tile');
}
function indexed(position) {
  const key = CoordGrid.packCoord(0,position[1]>>6<<6,position[2]>>6<<6);
  return DbTableIndex.find(key,(regions.id<<12)|(regions.columnNames.indexOf('mapsquare')<<4));
}
const field = (row,table,name) => row.columnValues[table.columnNames.indexOf(name)];
function border(mx,mz,dx,dz) {
  const pairs = [];
  for (let offset=0;offset<64;offset++) {
    const x = dx<0 ? mx*64 : dx>0 ? (mx+1)*64-1 : mx*64+offset;
    const z = dz<0 ? mz*64 : dz>0 ? (mz+1)*64-1 : mz*64+offset;
    const nx=x+dx, nz=z+dz;
    if (!map.isMapBlocked(x,z,0) && !map.isMapBlocked(nx,nz,0)
      && map.isLineOfWalk(0,x,z,nx,nz) && map.isLineOfWalk(0,nx,nz,x,z)) {
      pairs.push({ inside:[0,x,z], outside:[0,nx,nz] });
    }
  }
  return pairs;
}
function noSelection(p, destination) {
  const before = musicBits(p), song = current(p), mark = musicMark(p);
  walkStep(p,destination);
  assert.deepEqual(musicPackets(p,mark), [], 'missing allocation sends no fresh song packet');
  assert.deepEqual(musicText(p,mark), [], 'missing allocation does not replace the displayed track');
  assert.equal(current(p), song, 'previous selected song continues');
  assert.deepEqual(musicBits(p), before, 'all music unlock words are unchanged');
}
function firstEntry(p, destination, { manual = false, lowMemory = false } = {}) {
  assert.equal(unlocked(p),0,'original Gnomeball bit starts clear');
  const before=musicBits(p), mark=musicMark(p), song=current(p);
  p.vars[varp('musicplay')] = manual ? 0 : 1;
  walkStep(p,destination);
  assert.equal(unlocked(p),1,'compiled arrival sets original varp21 bit24');
  assert.deepEqual(musicBits(p).map((value,i)=>value^before[i]),
    Array.from({length:14},(_,i)=>i===1 ? 1<<24 : 0),'only the original unlock bit changes');
  if (manual || lowMemory) assert.deepEqual(musicPackets(p,mark),[],'Manual/low-memory sends no song packet');
  else expectMusic(p,mark,112,[240,0]);
  assert.equal(current(p),manual ? song : 112,'Manual retains selection; Auto selects Gnomeball');
  assert.deepEqual(musicText(p,mark),manual ? [] : ['Gnomeball'],'Auto updates the track display');
}

test('retained Gnomeball source MIDI, native row, player-list binding and unlock',()=>{
  assert.equal(createHash('sha256').update(readFileSync(path.join(contentRoot,'songs/gnomeball.mid'))).digest('hex'),targetHash);
  const row = types.DbRowType.get(id('DbRowType','music_Gnomeball'));
  assert.deepEqual(field(row,songs,'name'),['Gnomeball']);
  assert.deepEqual(field(row,songs,'track'),[112]);
  assert.deepEqual(field(row,songs,'unlock'),[2,24]);
  assert.deepEqual(field(row,songs,'playbutton'),[4342]);
  assert.equal(id('Component','music:gnomeball'),4342,'original player-list component retained');
  const regionId=id('DbRowType','musicregion_37_54');
  assert.deepEqual(indexed([0,2399,3488]),[regionId],'native index retains the pitch square');
  const region=types.DbRowType.get(regionId);
  assert.deepEqual(field(region,regions,'musicdata'),[row.id]);
  assert.deepEqual(field(region,regions,'name'),['Gnomeball']);
  assert(ScriptProvider.getByName('[mapzone,0_37_54]'),'compiled pitch arrival remains');
  assert(ScriptProvider.getByName('[if_button,music:gnomeball]'),'compiled player-list action remains');
});
for (const [mx,mz] of removed) {
  test(`removed square ${mx}_${mz}: no native indexed allocation`,()=>{
    assert.deepEqual(indexed([0,mx*64,mz*64]),[],'removed server allocation is absent, including unwalkable square');
  });
  test(`removed square ${mx}_${mz}: no compiled mapzone trigger left behind`,()=>{
    // A leftover music-only trigger would currently return at the missing DB row;
    // inspect the same compiled name that Player.triggerMapzone resolves.
    assert.equal(ScriptProvider.getByName(`[mapzone,0_${mx}_${mz}]`),undefined);
  });
}
test('packed m36_55 has no walkable surface tile',()=>{
  let walkable=0;
  for(let x=36*64;x<37*64;x++) for(let z=55*64;z<56*64;z++) {
    if(!map.isMapBlocked(x,z,0)) walkable++;
  }
  assert.equal(walkable,0,'all 4096 surface tiles are blocked in the actual packed map');
});

for (const [side,dx,dz] of directions) {
  const pairs=border(37,54,dx,dz);
  test(`packed pitch ${side} side has a bidirectional walkable crossing`,()=>assert(pairs.length>0));
  if (!pairs.length) continue;
  const {inside,outside}=pairs[Math.floor(pairs.length/2)];
  test(`pitch entry from ${side}: one fresh Gnomeball and first unlock`,()=>
    withPlayer(outside,p=>firstEntry(p,inside)));
  test(`pitch re-entry from ${side}: fresh packet even when already selected`,()=>
    withPlayer(inside,p=>{
      expectMusic(p,0,112,[240,0]);
      walkStep(p,outside);
      const before=musicBits(p), mark=musicMark(p);
      walkStep(p,inside);
      expectMusic(p,mark,112,[240,0]);
      assert.deepEqual(musicBits(p),before,'re-entry changes no already-set unlock bit');
    }));
}
for(const [mx,mz] of [[36,54],[37,55]]) {
  for(const [side,dx,dz] of directions) {
    const pairs=border(mx,mz,dx,dz);
    if(!pairs.length) continue;
    const {inside,outside}=pairs[Math.floor(pairs.length/2)];
    test(`removed square ${mx}_${mz} entered from ${mx+dx}_${mz+dz} (${side}): carry previous track`,()=>
      withPlayer(outside,p=>noSelection(p,inside)));
  }
  const loginPosition=border(mx,mz,1,0)[0].inside;
  test(`removed square ${mx}_${mz}: login sends no song or unlock`,()=>withPlayer(loginPosition,p=>{
    assert.deepEqual(musicPackets(p),[]);
    assert.equal(unlocked(p),0);
    assert.deepEqual(musicBits(p),Array(14).fill(0));
  }));
}
const north=border(37,54,0,1)[0];
if(north) {
  test('Manual first pitch entry unlocks without selecting or sending',()=>
    withPlayer(north.outside,p=>firstEntry(p,north.inside,{manual:true})));
  test('low-memory first pitch entry unlocks/selects without a song packet',()=>
    withPlayer(north.outside,p=>firstEntry(p,north.inside,{lowMemory:true}),{lowMemory:true}));
  test('independent pitch login selects Gnomeball once',()=>
    withPlayer(north.inside,p=>expectMusic(p,0,112,[240,0])));
  test('retained unlocked player-list button selects Gnomeball',()=>withPlayer(north.inside,p=>{
    const mark=musicMark(p), before=musicBits(p);
    execute('[if_button,music:gnomeball]',p);
    expectMusic(p,mark,112,[240,0]);
    assert.deepEqual(musicBits(p),before);
  }));
}
console.log(`MG Gnomeball music: ${cases-failures}/${cases} passed`);
process.exit(failures?1:0);
