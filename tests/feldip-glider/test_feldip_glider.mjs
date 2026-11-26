// From the sibling engine after a full build:
// NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/feldip-glider/test_feldip_glider.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  World, types, id, player, execute, ScriptProvider, ServerTriggerType, ScriptState,
  map, tile, CollisionType, contentRoot, startDialogue, resumeDialogue, dialoguePage,
  button, settle, seed, count
} from '../swamp-caves/runtime.mjs';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const quest = id('VarPlayerType', 'onesmallfavour');
const grandtree = id('VarPlayerType', 'grandtree');
const journey = id('VarPlayerType', 'pilot_journey');
const complete = 276; // Existing registered completion, not a historical 377 stage claim.
const treeComplete = 160; // Existing Grand Tree completion constant.
const mapRoot = types.Component.get(id('Component', 'glidermap:com_31')).rootLayer;
const tree = [3, 2465, 3501];
const feldip = [0, 2544, 2970]; // Independent expected area beside native Gnormadium.
const destinations = [
  { button: 26, tile: [0, 2971, 2969], outward: 7, inward: 6 },
  { button: 27, tile: tree },
  { button: 28, tile: [0, 2850, 3497], outward: 1, inward: 2 },
  { button: 29, tile: [0, 3320, 3430], outward: 3 },
  { button: 30, tile: [0, 3284, 3211], outward: 4, inward: 5 },
  { button: 31, tile: feldip, outward: 8, inward: 9 }
];
function fixture(start = tree, stage = complete, gt = treeComplete) {
  const p = player();
  [p.level, p.x, p.z] = start;
  p.setVar(quest, stage); p.setVar(grandtree, gt);
  p.openMainModal(mapRoot); // Labelled already-open map fixture; pilot opening is tested below.
  return p;
}
function fly(p, component, expectedJourney = null) {
  p.openMainModal(mapRoot);
  assert(button(p, `glidermap:com_${component}`), 'native interface button accepted');
  if (expectedJourney !== null) {
    assert.equal(p.getVar(journey), expectedJourney, 'authentic flight animation starts before the teleport');
    assert.equal(p.modalMain, mapRoot, 'map remains open during the flight');
  }
  settle(p);
  if (expectedJourney !== null) {
    assert.equal(p.getVar(journey), -1, 'flight animation resets');
    assert.equal(p.modalMain, -1, 'map closes after the flight');
  }
}
function near(actual, expected, message) {
  assert.equal(actual[0], expected[0], `${message}: correct plane`);
  assert(Math.abs(actual[1] - expected[1]) <= 1 && Math.abs(actual[2] - expected[2]) <= 1,
    `${message}: ${actual} is within the original one-tile landing search of ${expected}`);
}
function pathTo(start, destination, message) {
  assert.equal(start[0], destination[0], `${message}: same plane`);
  const route = [...map.findPath(start[0], start[1], start[2], destination[1], destination[2])];
  assert(route.length > 0, `${message}: non-empty native findPath`);
  const end = route.at(-1);
  assert.deepEqual([(end >>> 14) & 0x3fff, end & 0x3fff], destination.slice(1), `${message}: reaches intended exit`);
  let [, x, z] = start;
  for (const coord of route) {
    const targetX = (coord >>> 14) & 0x3fff, targetZ = coord & 0x3fff;
    while (x !== targetX || z !== targetZ) {
      const dx = Math.sign(targetX - x), dz = Math.sign(targetZ - z);
      assert(map.canTravel(start[0], x, z, dx, dz, 1, 0, CollisionType.NORMAL), `${message}: each path step is collision-free`);
      x += dx; z += dz;
    }
  }
}
function pilot(name, expected) {
  const type = id('NpcType', name);
  const npcs = [...World.npcs].filter(n => n.type === type && n.level === expected[0]
    && Math.abs(n.x - expected[1]) <= 8 && Math.abs(n.z - expected[2]) <= 8);
  assert.equal(npcs.length, 1, `${name}: original packed pilot placement`);
  const n = npcs[0];
  assert.equal(map.isMapBlocked(n.x, n.z, n.level), false, `${name}: packed pilot tile is walkable`);
  const config = types.NpcType.get(n.type);
  const option = config.op.indexOf('Talk-to');
  assert.equal(option, 0, `${name}: original Talk-to option`);
  const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1, n.type, config.category);
  assert(handler, `${name}: native visible-type dispatch exists`);
  return { n, handler };
}
const grandPilot = pilot('pilot_grand_tree', tree);
const feldipPilot = pilot('gnormadium_avlafrim', [0, 2544, 2973]);
for (const [landing, exit, target] of [
  [tree, [3, 2464, 3501], grandPilot.n],
  [feldip, [0, 2544, 2968], feldipPilot.n]
]) {
  assert(map.isZoneAllocated(...landing), 'landing is on the real packed map');
  assert.equal(map.isMapBlocked(landing[1], landing[2], landing[0]), false, 'exact landing is walkable');
  pathTo(landing, exit, 'landing has a route out');
  pathTo(landing, [target.level, target.x, target.z], 'landing reaches its own native pilot');
}
// 377 interface data, not an invented animation or a new client-side gate.
const iface = readFileSync(path.join(contentRoot, 'scripts/interfaces/glidermap.if'), 'utf8');
for (const [component, value] of [[41, 8], [40, 9]]) {
  const block = iface.split(`[com_${component}]`)[1].split(/\n\[/)[0];
  assert(block.includes('script1op1=pushvar,pilot_journey'));
  assert(block.includes(`script1=eq,${value}`));
  assert(block.includes('activeanim=pilot_varrock'));
}
const feldipButton = iface.split('[com_31]')[1].split(/\n\[/)[0];
assert(!feldipButton.includes('script'), 'original Feldip button has no client-side quest predicate');
for (const stage of [0, 20, 21, 22, 42, 44, complete - 1]) {
  const p = fixture(tree, stage);
  fly(p, 31);
  assert.deepEqual(tile(p), tree, `stage ${stage}: no premature Feldip teleport`);
  assert(p.messages.includes("You can't go there at the moment."), 'locked route uses the labelled existing refusal');
}
{
  const p = fixture(tree, complete, treeComplete - 1);
  fly(p, 31);
  assert.deepEqual(tile(p), tree, 'Grand Tree is required too');
}
for (const stage of [complete, complete + 1]) {
  const p = fixture(tree, stage);
  fly(p, 31, 8); near(tile(p), feldip, 'outbound Feldip flight');
  pathTo(tile(p), [0, 2544, 2968], 'actual Feldip landing has a route out');
  fly(p, 27, 9); near(tile(p), tree, 'return Grand Tree flight');
}
for (const from of [destinations[0].tile, destinations[2].tile, destinations[4].tile]) {
  const p = fixture(from);
  fly(p, 31);
  assert.deepEqual(tile(p), from, 'another spoke cannot fly directly to Feldip');
  assert(p.messages.includes("You can't go there at the moment."));
}
{
  const p = fixture(feldip);
  fly(p, 30);
  assert.deepEqual(tile(p), feldip, 'Feldip cannot bypass the hub to another spoke');
  fly(p, 31);
  assert.deepEqual(tile(p), feldip, 'Feldip detects already-there');
  assert(p.messages.includes("You're already there."));
}
for (const row of destinations.slice(0, 5)) {
  const p = fixture(tree, 0);
  fly(p, row.button, row.outward ?? null);
  near(tile(p), row.tile, `existing route button ${row.button}`);
  if (row.inward !== undefined) {
    fly(p, 27, row.inward); near(tile(p), tree, 'existing return via hub');
  }
}
function talk(p, actor) {
  return startDialogue(actor.handler.name, p, actor.n);
}
{
  const p = fixture(); p.closeModal();
  const state = talk(p, grandPilot);
  resumeDialogue(p, 1); resumeDialogue(p); resumeDialogue(p);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(p.modalMain, mapRoot, 'Grand Tree pilot still opens glidermap');
}
{
  const p = fixture(feldip); p.closeModal();
  const state = talk(p, feldipPilot);
  resumeDialogue(p); resumeDialogue(p);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(p.modalMain, mapRoot, 'completed Feldip pilot opens the authentic map');
}
// Exercise the original favour stages through the engine-selected Talk-to handler.
{
  const p = fixture(feldip, 20); p.closeModal();
  talk(p, feldipPilot); resumeDialogue(p);
  assert(dialoguePage(p).includes('Rantz said I should help you finish this project.'));
  resumeDialogue(p, 4); resumeDialogue(p); resumeDialogue(p); resumeDialogue(p);
  resumeDialogue(p, 1); resumeDialogue(p); resumeDialogue(p); resumeDialogue(p);
  assert.equal(p.getVar(quest), 21, 'original Gnormadium favour acceptance still writes 20 to 21');
  assert.notEqual(p.modalMain, mapRoot);
}
{
  const p = fixture(feldip, 21); p.closeModal();
  for (let bit = 1; bit <= 8; bit++) p.setVarBit(id('VarBitType', `onesmallfavourmulti_${bit}_${bit}`), 1);
  talk(p, feldipPilot); resumeDialogue(p);
  assert(dialoguePage(p).includes("I've fixed all the lights!"), 'original completed-lights option remains');
  resumeDialogue(p, 4);
  for (let step = 0; p.activeScript?.execution === ScriptState.PAUSEBUTTON && step < 10; step++) resumeDialogue(p);
  assert.equal(p.getVar(quest), 22, 'original fixed-lights hand-in still writes 21 to 22');
  assert.equal(p.getVarBit(id('VarBitType', 'all_lights_fixed')), 1, 'original light morph write remains');
}
{
  const p = fixture(feldip, 21); p.closeModal();
  seed(p, ['coins']); p.invAdd(id('InvType', 'inv'), id('ObjType', 'coins'), 9);
  talk(p, feldipPilot); resumeDialogue(p); resumeDialogue(p, 4);
  resumeDialogue(p); resumeDialogue(p); resumeDialogue(p, 1);
  for (let step = 0; p.activeScript?.execution === ScriptState.PAUSEBUTTON && step < 10; step++) resumeDialogue(p);
  assert.equal(count(p, 'chisel'), 1, 'original chisel purchase remains');
  assert.equal(count(p, 'coins'), 0, 'original 10-coin price remains');
  assert.equal(p.getVar(quest), 21, 'chisel purchase does not advance the quest');
}
console.log('PASS compiled Feldip glider: both quest gates, native pilot/map dispatch, authentic 8/9 flights, safe connected landings, hub restrictions, all five old buttons and original Gnormadium stages/chisel');
process.exit(0);
