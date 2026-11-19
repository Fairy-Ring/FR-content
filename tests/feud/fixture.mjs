import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach } from 'node:test';
import {
  Packet, PlayerLoading, ScriptState, ServerTriggerType, World, contentRoot, count, dialoguePage,
  engineModule, held, id, inv, invButton, map, obj, resumeDialogue, tile, types, useLoc, worn
} from '../swamp-caves/runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { default: OpLoc } = await engineModule('network/game/client/model/OpLoc.ts');
const { default: OpLocHandler } = await engineModule('network/game/client/handler/OpLocHandler.ts');
const locActionHandler = new OpLocHandler();
let sourceLocRows;
const bit = name => id('VarBitType', name);
const read = (p, name) => p.getVarBit(bit(name));
const stage = p => read(p, 'feud_var');
const gangMask = p => read(p, 'feud_var_comp_gangs');
const operationOffsets = {
  feud_ali_m: [1, 0],
  feud_arabian_guard2_multi: [0, -1],
  feud_drunken_ali: [1, 0],
  feud_egyptian_doorman_multi: [0, -1],
  feud_egyptian_minder: [1, 0],
  feud_kebabman: [0, 1]
};
const actors = name => {
  const type = id('NpcType', name);
  const found = [...World.npcs].filter(n => n.isActive && (n.baseType === type || n.type === type));
  assert(found.length, `original packed NPC placement ${name}`);
  return found;
};
const witnessRadius = 5; // ^feud_villager_witness_radius in the native Feud constants.
const animalTypes = new Set(['feud_camel', 'feud_charmers_snake', 'feud_desert_snake', 'magic_carpet_monkey']
  .map(name => id('NpcType', name)));
function displayNpcType(p, npc) {
  const base = types.NpcType.get(npc.type);
  const state = base.multivarp !== -1 ? p.getVar(base.multivarp)
    : base.multivarbit !== -1 ? p.getVarBit(base.multivarbit) : -1;
  const form = state >= 0 && state < base.multinpc.length ? base.multinpc[state] : -1;
  return form === -1 ? base : types.NpcType.get(form);
}
function isWitness(p, target, npc) {
  // Independent original-town oracle: visible models, minus its four animal types.
  // This does not read the production feud_witness_people enum.
  return npc.isActive && npc.uid !== target.uid && npc.level === target.level &&
    !animalTypes.has(npc.baseType) && Boolean(displayNpcType(p, npc).models?.length) &&
    CoordGrid.distanceToSW({ x: target.x, z: target.z }, npc) <= witnessRadius &&
    npc.targetOp !== NpcMode.OPPLAYER2 &&
    map.isLineOfSight(target.level, npc.x, npc.z, target.x, target.z);
}
function hasWitness(p, target) {
  for (const npc of World.npcs) if (isWitness(p, target, npc)) return true;
  return false;
}
const nativeNpcTriggerName = (p, npc, option) => {
  return `[opnpc${option},${displayNpcType(p, npc).debugname}]`;
};

function locs(name) {
  if (!sourceLocRows) {
    const names = new Map(readFileSync(path.join(contentRoot, 'pack/loc.pack'), 'utf8').trim().split('\n').map(line => {
      const split = line.indexOf('=');
      return [Number(line.slice(0, split)), line.slice(split + 1)];
    }));
    sourceLocRows = [];
    let section = '';
    for (const line of readFileSync(path.join(contentRoot, 'maps/m52_46.jm2'), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) { section = line.slice(5).split(' ')[0]; continue; }
      if (section !== 'LOC') continue;
      const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
      if (!row) continue;
      const [type, shape = 10, angle = 0] = row[4].split(' ').map(Number);
      sourceLocRows.push({ name: names.get(type), type, shape, angle, level: Number(row[1]),
        x: 52 * 64 + Number(row[2]), z: 46 * 64 + Number(row[3]) });
    }
  }
  const found = sourceLocRows.filter(row => row.name === name);
  assert(found.length, `original packed loc placement ${name}`);
  return found;
}
function activeLoc(placement) {
  const zone = World.gameMap.getZone(placement.x, placement.z, placement.level);
  const coord = CoordGrid.packZoneCoord(placement.x, placement.z);
  const matches = [...zone.getLocsSafe(coord)].filter(loc => loc.x === placement.x &&
    loc.z === placement.z && loc.level === placement.level &&
    loc.shape === placement.shape && loc.angle === placement.angle);
  assert.equal(matches.length, 1, `one current loc form remains at original placement ${placement.name}`);
  return matches[0];
}

function operateLoc(p, placement, { option = 1, item = null, position = null, choices = [] } = {}) {
  let loc = activeLoc(placement);
  if (loc.type !== placement.type) {
    assert(loc.isChanged() && loc.lifecycleTick > 0,
      'a temporary changed loc has its published restoration countdown');
    const remaining = loc.lifecycleTick;
    for (let step = 0; step < remaining; step++) worldTick();
    loc = activeLoc(placement);
    assert.equal(loc.type, placement.type, 'the native zone lifecycle restores the original loc before its next click');
  }
  const config = types.LocType.get(loc.type);
  const width = loc.angle % 2 ? config.length : config.width;
  const length = loc.angle % 2 ? config.width : config.length;
  const candidates = [];
  p.clearInteraction();
  for (let x = loc.x - 1; x <= loc.x + width; x++) for (let z = loc.z - 1; z <= loc.z + length; z++) {
    [p.level, p.x, p.z] = [loc.level, x, z];
    if (!map.isMapBlocked(x, z, loc.level) && p.inOperableDistance(loc)) candidates.push(tile(p));
  }
  const stand = position ?? candidates[0];
  assert(stand && candidates.some(point => point.every((value, index) => value === stand[index])),
    `collision-passable native operation stand for ${placement.name}`);
  [p.level, p.x, p.z] = stand;
  p.originX = p.x; p.originZ = p.z;
  p.dialogueMark = p.packets.length;
  if (item) assert(useLoc(p, item, loc), 'production item-on-loc packet is accepted');
  else {
    assert(locActionHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p),
      'production loc-option packet is accepted');
    assert(p.inOperableDistance(loc), 'the selected loc is in native operation range');
    p.processInteraction();
  }
  return { text: finish(p, choices), position: tile(p) };
}

function operationStand(p, n) {
  const original = tile(p);
  const candidates = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    p.level = n.level; p.x = n.x + dx; p.z = n.z + dz;
    if (map.isMapBlocked(p.x, p.z, p.level) || !p.inOperableDistance(n)) continue;
    candidates.push(tile(p));
  }
  const name = types.NpcType.get(n.baseType).debugname;
  const explicitOffset = operationOffsets[name];
  const [dx, dz] = explicitOffset ?? [-1, 0];
  const preferred = candidates.find(point => point[1] === n.x + dx && point[2] === n.z + dz);
  const reaches = destination => {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 4) continue;
      const x = destination[1] + dx, z = destination[2] + dz;
      if (map.isMapBlocked(x, z, destination[0])) continue;
      const route = [...map.findPath(destination[0], x, z, destination[1], destination[2])];
      if (!route.length) continue;
      const last = CoordGrid.unpackCoord(route.at(-1));
      if (last.level === destination[0] && last.x === destination[1] && last.z === destination[2]) return true;
    }
    return false;
  };
  const destination = preferred && reaches(preferred) ? preferred
    : candidates.find(reaches);
  [p.level, p.x, p.z] = original;
  return destination;
}

function stand(p, n) {
  const destination = operationStand(p, n);
  assert(destination, `pathfinder reaches the native operation stand beside NPC ${n.baseType}`);
  [p.level, p.x, p.z] = destination;
  p.originX = p.x; p.originZ = p.z;
  return destination;
}

export function worldTick(beforeNpcInput = null) {
  World.currentTick++;
  let inputResult;
  for (const p of World.playerLoop.all()) {
    if (p?.isActive) p.lastResponse = p.lastConnected = World.currentTick;
  }
  for (const phase of [
    'processWorld', 'processNpcEventQueue', 'processNpcs', 'processPlayers',
    'processLogouts', 'processLogins', 'processZones', 'processInfo', 'processCleanup'
  ]) {
    assert.equal(typeof World[phase], 'function', `native World.${phase} phase is available`);
    if (phase === 'processNpcEventQueue') inputResult = beforeNpcInput?.();
    World[phase]();
  }
  return inputResult;
}

export function tickThrough(deadline) {
  assert(Number.isInteger(deadline), 'the native NPC deadline is an integer tick');
  assert(deadline >= World.currentTick, 'the native NPC deadline has not already passed');
  while (World.currentTick < deadline) worldTick();
  assert.equal(World.currentTick, deadline, 'native world phases ran once through the exact deadline');
}

afterEach(() => {
  const stateVar = id('VarNpcType', 'feud_villager_state');
  const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
  let deadline = World.currentTick + 1;
  for (const npc of World.npcs) {
    if (npc.isActive && npc.getVar(stateVar) !== 0) deadline = Math.max(deadline, npc.getVar(deadlineVar));
  }
  for (const p of [...World.playerLoop.all()]) {
    const username = p.username;
    World.removePlayer(p);
    // These process-local compiled fixtures have no persistence worker.
    World.logoutRequests.delete(username);
  }
  tickThrough(deadline);
});

function finish(p, choices = []) {
  const options = [...choices], pages = [];
  for (let step = 0; step < 240 && p.activeScript; step++) {
    const state = p.activeScript;
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled dialogue does not abort');
    if (state.execution === ScriptState.FINISHED) break;
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const root = types.Component.get(p.modalChat).comName;
      if (/^multi[2-5]$/.test(root)) {
        assert(options.length, `unanswered choice ${root}: ${pages.at(-1)}`);
        const choice = options.shift();
        const selected = typeof choice === 'number' ? choice : Array.from({ length: Number(root.at(-1)) }, (_, i) => i + 1)
          .find(option => p.packets.slice(p.dialogueMark).some(packet => packet.constructor.name === 'IfSetText'
            && packet.component === id('Component', `${root}:com_${option}`) && packet.text === choice));
        assert(selected, `offered dialogue choice ${choice}`);
        resumeDialogue(p, selected);
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) worldTick();
    else assert.fail(`unexpected compiled dialogue state ${state.execution}`);
  }
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'dialogue finishes within its bound');
  assert.equal(options.length, 0, 'every selected option was offered');
  return pages.join(' ');
}
function wield(p, name) {
  assert(held(p, name, 2), `native Wear accepts ${name}`);
  finish(p);
  assert.equal(count(p, name, worn), 1, `${name} is actually equipped`);
}

function operateHere(p, n, option = 1, choices = [], item = null) {
  p.clearInteraction();
  if (item) { p.lastUseItem = obj(item); p.lastUseSlot = p.getInventory(inv).items.findIndex(entry => entry?.id === obj(item)); }
  const operation = item ? ServerTriggerType.APNPCU : ServerTriggerType.APNPC1 + option - 1;
  assert(p.setInteraction(1, n, operation), 'ordinary engine interaction is accepted');
  assert(p.inOperableDistance(n), 'the player can operate from the path-checked stand');
  const trigger = p.getOpTrigger();
  assert(trigger, 'production visible-form dispatcher finds a compiled handler');
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  return { text: finish(p, choices), trigger: trigger.name };
}
function operate(p, n, option = 1, choices = [], item = null) {
  stand(p, n);
  return operateHere(p, n, option, choices, item);
}
const talk = (p, name, choices = []) => operate(p, actors(name)[0], 1, choices);
function begin(p) {
  assert.equal(stage(p), 0);
  talk(p, 'feud_ali_m', [1, 2, 2, 1]);
  assert.equal(stage(p), 1, 'accepting Morrisane starts the compatible published stage');
}
function buyBeers(p) {
  p.invAdd(inv, obj('coins'), 100);
  talk(p, 'feud_ali_the_barman', ["Yes, I'd like a drink please."]);
  assert.equal(p.modalMain, id('Component', 'shop_template'), 'the drink option opens the real shop');
  const config = types.InvType.get(id('InvType', 'feud_alispub'));
  const expected = [
    ['beer', 83, 10], ['whisky', 10, 100], ['jug_wine', 13, 150],
    ['vodka', 5, 5], ['brandy', 4, 1500], ['grog', 12, 2500]
  ];
  assert.deepEqual(Array.from(config.stockobj), expected.map(([name]) => obj(name)), 'the pre-2021 six-drink stock is retained');
  assert.deepEqual(Array.from(config.stockcount), expected.map(([, quantity]) => quantity));
  assert.deepEqual(Array.from(config.stockrate), expected.map(([, , rate]) => rate));
  const component = id('Component', 'shop_template:inv');
  const listener = p.invListeners.find(entry => entry.com === component);
  assert(listener, 'the shop inventory is transmitted to the player');
  const stock = p.getInventoryFromListener(listener);
  const option = types.Component.get(component).iop.findIndex(text => /buy[^\d]*1\b/i.test(text ?? '')) + 1;
  assert(option > 0, 'the original shop component offers Buy 1');
  for (let n = 1; n <= 3; n++) {
    const money = count(p, 'coins'), available = stock.getItemCount(obj('beer'));
    assert(invButton(p, 'shop_template:inv', 'beer', option, stock.getItemIndex(obj('beer'))),
      'the production inventory packet buys beer');
    assert.equal(count(p, 'beer'), n, 'beer is purchased, not seeded');
    assert.equal(stock.getItemCount(obj('beer')), available - 1, 'a real shared-stock item is sold');
    assert.equal(money - count(p, 'coins'), 2, 'the candidate pub policy charges two coins, not the unscaled shop default');
  }
  p.closeModal();
}
function drink(p) {
  buyBeers(p);
  const drunk = actors('feud_drunken_ali')[0];
  for (let n = 1; n <= 3; n++) {
    operate(p, drunk, 1, [], 'beer');
    assert.equal(read(p, 'feud_var_drink'), n, `beer ${n} is recorded by the quest`);
    assert.equal(count(p, 'beer'), 3 - n, `beer ${n} is consumed once`);
    assert.equal(stage(p), n === 3 ? 2 : 1, 'the third beer reaches the sourced gang-inquiry checkpoint');
  }
}
function buyReceipts(p, generous = false) {
  const price = generous ? 1000 : 500;
  p.invAdd(inv, obj('coins'), price);
  const before = count(p, 'coins');
  const result = talk(p, 'feud_ali_the_discount_camel_seller', [4, 2, generous ? 4 : 3, 5]);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'one purchase produces two original camel receipts');
  assert.equal(before - count(p, 'coins'), price, 'the charged constant matches the printed offer and receipt amount');
  assert.match(result.text, new RegExp(`Would ${price} gold coins for the pair of them do\\?`), 'the spoken offer matches the amount charged');
  assert.match(result.text, new RegExp(`return for ${price} gold coins`), 'the receipt message box states the amount actually charged');
  if (!generous) assert.match(result.text, /I suppose I can silence my moral objections for that\./);
  assert.equal(stage(p), 4, 'buying the camels reaches the sourced purchase checkpoint');
}
function deliver(p, banditsFirst = false, coward = false) {
  const bandit = coward ? 'feud_arabian_guard_coward' : 'feud_arabian_guard_multi';
  const first = banditsFirst ? bandit : 'feud_egyptian_doorman_multi';
  const second = banditsFirst ? 'feud_egyptian_doorman_multi' : bandit;
  const firstMask = banditsFirst ? 2 : 1;
  const result = talk(p, first);
  assert.match(p.messages.join(' '), /You hand the (?:guard|doorman) a sales receipt for the camel\./);
  assert.equal(gangMask(p), firstMask, 'the first gang accepts only its own receipt');
  assert.equal(count(p, 'feud_camel_receipt'), 1);
  assert.equal(stage(p), 4, 'one receipt cannot reach the both-gangs checkpoint');
  assert.doesNotMatch(result.text, /try join one of the gangs/, 'the joining musing follows the second distinct hand-in');
  talk(p, first);
  assert.equal(gangMask(p), firstMask, 'a repeated hand-in cannot substitute for the other gang');
  assert.equal(count(p, 'feud_camel_receipt'), 1, 'a repeated hand-in consumes nothing');
  assert.equal(stage(p), 4, 'repeating the first gang cannot reach the both-gangs checkpoint');
  talk(p, second);
  assert.equal(gangMask(p), 3);
  assert.equal(count(p, 'feud_camel_receipt'), 0);
  assert.equal(stage(p), 5, 'both distinct hand-ins reach the sourced delivery checkpoint');
}

function relog(p, session = p) {
  const saved = p.save(), { slot, pid } = session;
  p.unlink(); World.players[slot] = null;
  const loaded = PlayerLoading.load(p.username, new Packet(saved), null);
  loaded.varsString ??= [];
  loaded.slot = slot; loaded.pid = pid; loaded.isActive = true;
  loaded.uid = ((Number(loaded.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  loaded.messages = []; loaded.packets = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = text => loaded.messages.push(String(text));
  loaded.wrappedMessageGame = loaded.messageGame;
  World.players[slot] = loaded; World.playerLoop.add(loaded.hash64, loaded);
  // The codec-only fixture reconstructs the same canonical session UID from the saved name.
  loaded.onLogin();
  loaded.processEngineQueue();
  return loaded;
}

export {
  activeLoc, actors, begin, bit, buyBeers, buyReceipts, deliver, displayNpcType, drink, finish, gangMask, hasWitness,
  isWitness, locs, nativeNpcTriggerName, operate, operateHere, operateLoc, operationOffsets, operationStand, read, relog,
  stage, stand, talk, wield
};
