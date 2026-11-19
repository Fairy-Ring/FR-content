import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import CategoryType from '#/cache/config/CategoryType.js';
import LocType from '#/cache/config/LocType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import { Interaction } from '#/engine/entity/Interaction.js';
import Loc from '#/engine/entity/Loc.js';
import Player from '#/engine/entity/Player.js';
import ScriptFile from '#/engine/script/ScriptFile.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import { ScriptOpcode } from '#/engine/script/ScriptOpcode.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import World from '#/engine/World.js';
import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';
import OpLocHandler from '#/network/game/client/handler/OpLocHandler.js';
import OpLoc from '#/network/game/client/model/OpLoc.js';

export type Placement = { key: string; map: string; type: number; level: number; x: number; z: number; shape: number; angle: number };
export type Form = { type: number; states: (number | null)[] };
type Route = { script: ScriptFile | null; rule: string; category: boolean; global: boolean };
export type Option = { root: number; form: Form; slot: number; text: string; ap: Route; op: Route; kind: string };
type Gap = { type: number; slot: number; text: string; kind: string; roots: Set<number>; placements: Map<string, Placement>; options: Option[] };
type Label = { name: string; x: number; z: number };

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const typeName = (id: number) => LocType.get(id).debugname ?? String(id);
const tile = (p: Placement) => `${p.x},${p.z},L${p.level}`;
const trigger = (phase: 'AP' | 'OP', slot: number) => (ServerTriggerType as unknown as Record<string, number>)[`${phase}LOC${slot}`] as ServerTriggerType;
const HIDDEN_KIND = 'not shown by the client (hidden)';
const INACTIVE_KIND = 'not shown by the client (inactive root)';
const notShown = (kind: string) => kind === HIDDEN_KIND || kind === INACTIVE_KIND;
// Java LocType.java:470-472 drops this sentinel with equalsIgnoreCase.
const isHidden = (text: string | null | undefined) => text?.toLowerCase() === 'hidden';
const isShown = (text: string | null | undefined) => text !== null && text !== undefined && !isHidden(text);

export function loadPack(pack = 'data/pack'): Map<number, LocType> {
  for (const config of [VarPlayerType, VarBitType, CategoryType, LocType]) config.load(pack);
  assert(ScriptProvider.load(pack) > 0, 'built scripts are required');
  World.currentTick = 10;
  const archive = Jagfile.load(path.join(pack, 'client/config'));
  const dat = archive.read('loc.dat');
  const idx = archive.read('loc.idx');
  assert(dat && idx, 'built client loc.dat and loc.idx are required');
  const count = dat.g2();
  assert.equal(idx.g2(), count, 'client loc index count');
  assert.equal(LocType.count, count, 'client/server loc count');
  const client = new Map<number, LocType>();
  for (let id = 0; id < count; id++) {
    const length = idx.g2();
    const start = dat.pos;
    const config = new LocType(id);
    config.decodeType(dat);
    assert.equal(dat.pos - start, length, `client loc record length: ${id}`);
    config.postDecode();
    assert.equal(config.active, LocType.get(id).active, `client/server activity: ${id}`);
    assert.deepEqual(config.op, LocType.get(id).op, `client/server options: ${id}`);
    assert.deepEqual(config.multiloc, LocType.get(id).multiloc, `client/server multiloc: ${id}`);
    assert.equal(config.multivarp, LocType.get(id).multivarp);
    assert.equal(config.multivarbit, LocType.get(id).multivarbit);
    client.set(id, config);
  }
  assert.equal(dat.available, 0, 'unread client loc bytes');
  return client;
}

export function readPlacements(pack = 'data/pack'): { maps: number; placements: Placement[] } {
  const zip = path.join(pack, '.cache/maps-server.zip');
  let entries: Record<string, Uint8Array>;
  if (fs.existsSync(zip)) {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    entries = require('fflate').unzipSync(fs.readFileSync(zip));
  } else {
    const directory = path.join(pack, 'server/maps');
    entries = Object.fromEntries(fs.readdirSync(directory).filter(n => /^[ml]\d+_\d+$/.test(n)).map(n => [n, fs.readFileSync(path.join(directory, n))]));
  }
  const maps = Object.keys(entries).filter(n => /^m\d+_\d+$/.test(n)).sort(compare);
  assert(maps.length > 0, 'built maps are required');
  const placements: Placement[] = [];
  for (const map of maps) {
    const [mx, mz] = map.slice(1).split('_').map(Number);
    assert(entries[`l${mx}_${mz}`], `missing built locations for ${map}`);
    const packet = new Packet(entries[`l${mx}_${mz}`]);
    let type = -1;
    let ordinal = 0;
    for (let delta = packet.gsmarts(); delta !== 0; delta = packet.gsmarts()) {
      type += delta;
      assert(LocType.get(type), `unknown placed loc ${type}`);
      let coord = 0;
      for (let offset = packet.gsmarts(); offset !== 0; offset = packet.gsmarts()) {
        coord += offset - 1;
        const info = packet.g1();
        placements.push({ key: `${map}:${ordinal++}`, map, type, level: coord >> 12, x: (mx << 6) + ((coord >> 6) & 63), z: (mz << 6) + (coord & 63), shape: info >> 2, angle: info & 3 });
      }
    }
    assert.equal(packet.available, 0, `unread location bytes: ${map}`);
  }
  return { maps: maps.length, placements };
}

export function forms(root: LocType, client: Map<number, LocType>, limits: Set<string>): Form[] {
  const config = client.get(root.id);
  assert(config, `missing client loc ${root.id}`);
  if (!config.multiloc.length) return [{ type: root.id, states: [null] }];
  if (config.multivarp === -1 && config.multivarbit === -1) {
    limits.add(`${typeName(root.id)}: multiloc has no controller; no visible form can be selected`);
    return [];
  }
  assert(config.multivarp === -1 || config.multivarbit === -1, `dual multiloc controller: ${typeName(root.id)}`);
  let maxState = Number.POSITIVE_INFINITY;
  if (config.multivarbit !== -1) {
    const bit = VarBitType.get(config.multivarbit);
    assert(bit && bit.basevar >= 0 && bit.basevar < VarPlayerType.count, `invalid multiloc varbit: ${root.id}`);
    maxState = 2 ** (bit.endbit - bit.startbit + 1) - 1;
  } else {
    assert(config.multivarp >= 0 && config.multivarp < VarPlayerType.count, `invalid multiloc varp: ${root.id}`);
  }
  const result = new Map<number, Form>();
  const outside = config.multiloc.flatMap((id, state) => id !== -1 && state > maxState ? [state] : []);
  if (outside.length) limits.add(`${typeName(root.id)}: ${outside.length} non-null indices in ${outside[0]}..${outside[outside.length - 1]} exceed controller range 0..${maxState}`);
  for (let state = 0; state < config.multiloc.length; state++) {
    const id = config.multiloc[state];
    if (id === -1) continue; // The client shows no loc for this state, not the base fallback used by the server.
    if (state > maxState) continue;
    assert(client.has(id) && LocType.get(id), `missing multiloc form ${id}`);
    if (client.get(id)!.multiloc.length) limits.add(`${typeName(root.id)} -> ${typeName(id)}: nested multiloc; only the immediate form is enumerated, as in server dispatch`);
    const form = result.get(id) ?? { type: id, states: [] };
    form.states.push(state);
    result.set(id, form);
  }
  return [...result.values()].sort((a, b) => a.type - b.type);
}

export function setState(player: Player, root: LocType, state: number | null): void {
  player.vars.fill(0);
  if (state === null) return;
  if (root.multivarp !== -1) player.vars[root.multivarp] = state;
  else {
    const bit = VarBitType.get(root.multivarbit);
    player.vars[bit.basevar] = state << bit.startbit;
    assert.equal(player.getVarBit(root.multivarbit), state, 'form controller round trip');
  }
}

function directRoute(id: number, phase: 'AP' | 'OP', slot: number): Route {
  const type = LocType.get(id);
  const t = trigger(phase, slot);
  const exact = ScriptProvider.getByTriggerSpecific(t, id, -1) ?? null;
  const category = type.category !== -1 ? ScriptProvider.getByTriggerSpecific(t, -1, type.category) ?? null : null;
  const global = ScriptProvider.getByTriggerSpecific(t) ?? null;
  return { script: exact ?? category ?? global, rule: exact ? 'exact' : category ? `category:${type.category}` : global ? 'global' : 'none', category: !!category, global: !!global };
}

function actualRoute(root: number, form: number, phase: 'AP' | 'OP', slot: number, actual: ScriptFile | null): Route {
  const child = directRoute(form, phase, slot);
  const other = directRoute(form, phase === 'AP' ? 'OP' : 'AP', slot);
  const base = directRoute(root, phase, slot);
  const selected = child.script || form === root || other.script ? child : { ...base, rule: base.script ? `base-fallback:${base.rule}` : 'none' };
  assert.equal(actual, selected.script, `production trigger lookup differs: ${typeName(root)} -> ${typeName(form)}, ${phase}${slot}`);
  return selected;
}

export function probe(root: LocType, form: Form, client: Map<number, LocType>): Option[] {
  const player = new Player('locaudit', 1n, 1n);
  player.x = player.z = player.originX = player.originZ = 8;
  player.level = 1;
  player.write = () => {};
  const loc = new Loc(1, 8, 8, root.width, root.length, EntityLifeCycle.FOREVER, root.id, 10, 0);
  loc.isActive = true;
  const original = World.getLoc;
  const options: Option[] = [];
  try {
    // Non-menu contexts retain hypothetical trigger lookup, without claiming a client click exists.
    World.getLoc = (() => loc) as typeof World.getLoc;
    for (let index = 0; index < 5; index++) {
      const text = client.get(form.type)!.op?.[index];
      if (text === null || text === undefined) continue;
      const hidden = isHidden(text);
      let selected: Option | null = null;
      for (const state of form.states) {
        setState(player, root, state);
        if (hidden || !root.active) {
          assert(player.setInteraction(Interaction.ENGINE, loc, trigger('AP', index + 1)));
        } else {
          assert.equal(new OpLocHandler().handle(new OpLoc(index + 1, 8, 8, root.id), player), true, `OpLocHandler rejected ${typeName(form.type)} slot ${index + 1}`);
        }
        assert.equal(player.target, loc, 'production handler must establish the interaction');
        const ap = actualRoute(root.id, form.type, 'AP', index + 1, player.getApTrigger());
        const op = actualRoute(root.id, form.type, 'OP', index + 1, player.getOpTrigger());
        const scripts = [ap.script, op.script].filter((s): s is ScriptFile => s !== null);
        const kind = hidden ? HIDDEN_KIND : !root.active ? INACTIVE_KIND : !scripts.length ? 'no handler' : scripts.every(onlyReturns) ? 'handler that only returns' : 'handled';
        const current = { root: root.id, form, slot: index + 1, text, ap, op, kind };
        if (selected) assert.deepEqual([ap.script, op.script, kind], [selected.ap.script, selected.op.script, selected.kind], 'equivalent visible states must dispatch equally');
        selected = current;
      }
      assert(selected);
      options.push(selected);
    }
  } finally {
    World.getLoc = original;
  }
  return options;
}

function onlyReturns(script: ScriptFile): boolean {
  return script.opcodes.length > 0 && script.opcodes.every(opcode => opcode === ScriptOpcode.RETURN);
}

function scriptDescription(route: Route): string {
  const script = route.script;
  if (!script) return '';
  const calls = new Set<string>();
  for (let pc = 0; pc < script.opcodes.length; pc++) {
    const opcode = script.opcodes[pc];
    if (opcode === ScriptOpcode.GOSUB_WITH_PARAMS || opcode === ScriptOpcode.JUMP_WITH_PARAMS) {
      const target = ScriptProvider.get(script.intOperands[pc]);
      calls.add(target?.info.scriptName ?? '(unresolved call)');
    }
  }
  return `${route.rule}: ${script.info.scriptName}${onlyReturns(script) ? ' (only RETURN)' : ''}${calls.size ? ` -> ${[...calls].sort(compare).join('; ')}` : ''}`;
}

function optionRows(options: Option[], byRoot: Map<number, Placement[]>): Gap[] {
  const rows = new Map<string, Gap>();
  for (const option of options) {
    const key = JSON.stringify([option.form.type, option.slot, option.text, option.kind]);
    const row = rows.get(key) ?? { type: option.form.type, slot: option.slot, text: option.text, kind: option.kind, roots: new Set(), placements: new Map(), options: [] };
    row.roots.add(option.root);
    for (const p of byRoot.get(option.root)!) row.placements.set(p.key, p);
    row.options.push(option);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.type - b.type || a.slot - b.slot || compare(a.kind, b.kind));
}

export function scan(placements: Placement[], client: Map<number, LocType>): { options: Option[]; gaps: Gap[]; limits: string[] } {
  const byRoot = new Map<number, Placement[]>();
  for (const p of placements) {
    const rows = byRoot.get(p.type) ?? [];
    rows.push(p);
    byRoot.set(p.type, rows);
  }
  const options: Option[] = [];
  const limits = new Set<string>();
  for (const rootId of [...byRoot.keys()].sort((a, b) => a - b)) {
    const root = LocType.get(rootId);
    for (const form of forms(root, client, limits)) {
      options.push(...probe(root, form, client));
    }
  }
  return { options, gaps: optionRows(options.filter(o => o.kind !== 'handled' && !notShown(o.kind)), byRoot), limits: [...limits].sort(compare) };
}

function cell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csv(file: string, header: string[], rows: Iterable<unknown[]>): void {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, header.map(cell).join(',') + '\n');
    let buffer = '';
    for (const row of rows) {
      buffer += row.map(cell).join(',') + '\n';
      if (buffer.length >= 65536) { fs.writeSync(fd, buffer); buffer = ''; }
    }
    if (buffer) fs.writeSync(fd, buffer);
  } finally { fs.closeSync(fd); }
}
function labels(content: string): Label[] {
  return fs.readFileSync(path.join(content, 'maps/labels.txt'), 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^=([^,]+),(\d+),(\d+),/);
    return match ? [{ name: match[1], x: Number(match[2]), z: Number(match[3]) }] : [];
  });
}
function nearbyLabel(p: Placement, names: Label[]): [string, string] {
  // User-specified lead radius. Never project underground coordinates onto a surface map.
  const sorted = names.map(n => ({ ...n, distance: Math.hypot(n.x - p.x, n.z - p.z) })).filter(n => n.distance <= 100).sort((a, b) => a.distance - b.distance || compare(a.name, b.name));
  return sorted.length ? [sorted[0].name, sorted[0].distance.toFixed(1)] : ['', ''];
}
function farmingPatch(gap: Gap): boolean {
  return [...gap.roots].some(id => /^farming_.*_patch(?:_|$)/.test(typeName(id)));
}

function lead(gap: Gap): string {
  const name = typeName(gap.type).toLowerCase();
  const option = gap.text.toLowerCase();
  if (farmingPatch(gap)) return 'resources';
  if (/ladder|stairs?|steps|trap_?door|hatch/.test(name)) return 'ladders and stairs';
  if (/door|gate/.test(name)) return 'doors and gates';
  if (/chest|crate|cupboard|drawer|bookcase|barrel|sack|floorboard/.test(name) || option === 'search') return 'containers and searchable scenery';
  if (/tree|rock|mineral_vein|(?:^|_)ore(?:_|\\d|$)|herb|flax|crops?/.test(name) || /^(mine|prospect|chop(?:-down)?|fish|harvest|pick(?:-from)?|plant|rake|prune|check-health)$/.test(option)) return 'resources';
  if (/boat|canoe|(?:^|_)ship(?:_|$)|(?:^|_)cart(?:_|\\d|$)|carpet|glider/.test(name) || /^(board|travel|sail|ride|paddle|charter|sail-to|travel-to)$/.test(option)) return 'transport';
  if (/quest|soulbane|soul_bane|^dt_|mourning|^mep_|regicide|myreque|deserttreasure|^rfd_|recipe|fremennik|viking|fever/.test(name)) return 'quest scenery';
  return 'unclassified';
}
function sample(gap: Gap): Placement { return gap.placements.values().next().value!; }
function maps(gap: Gap): string { return [...new Set([...gap.placements.values()].map(p => p.map))].sort(compare).join(';'); }
const descriptions = (gap: Gap, phase: 'ap' | 'op') => [...new Set(gap.options.map(o => scriptDescription(o[phase])).filter(Boolean))].sort(compare).join(' | ');

function priorityRows(gaps: Gap[]) {
  const groups = new Map<string, Gap[]>();
  for (const gap of gaps) {
    const key = farmingPatch(gap) ? `farming:${gap.text}` : `${gap.type}:${gap.slot}:${gap.kind}`;
    const group = groups.get(key) ?? [];
    group.push(gap);
    groups.set(key, group);
  }
  return [...groups.values()].map(rows => {
    const placements = new Map<string, Placement>();
    for (const row of rows) for (const [key, p] of row.placements) placements.set(key, p);
    return { name: farmingPatch(rows[0]) ? 'Farming patch forms (collapsed)' : typeName(rows[0].type), text: rows[0].text, slots: [...new Set(rows.map(g => g.slot))].sort().join(';'), rows: rows.length, placements, lead: lead(rows[0]) };
  }).sort((a, b) => b.placements.size - a.placements.size || compare(a.name, b.name) || compare(a.text, b.text));
}

export function selfChecks(client: Map<number, LocType>, placements: Placement[], output?: string): string[] {
  const results: string[] = [];
  const provider = ScriptProvider as unknown as { scriptLookup: Map<number, ScriptFile> };
  const originalLookup = provider.scriptLookup;
  const originalLength = LocType.configs.length;
  const ids: number[] = [];
  for (let id = 0; id < 16384 && ids.length < 6; id++) if (!LocType.get(id)) ids.push(id);
  assert.equal(ids.length, 6, 'six unallocated in-memory loc ids are required for self-checks');
  const synthetic = new Map(client);
  try {
    provider.scriptLookup = new Map(originalLookup);
    for (const phase of ['AP', 'OP'] as const) for (let slot = 1; slot <= 5; slot++) provider.scriptLookup.delete(trigger(phase, slot));
    const fixture = ids.slice(0, 3).map((id, i): Placement => {
      const config = new LocType(id);
      config.debugname = `locaudit_fixture_${i}`;
      config.active = 1;
      config.op = [i === 0 ? 'Synthetic odd Spelling' : 'Open', null, null, null, null];
      LocType.configs[id] = config;
      synthetic.set(id, config);
      return { key: `fixture:${i}`, map: 'm0_0', type: id, level: 0, x: i, z: 0, shape: 10, angle: 0 };
    });
    const handled = new ScriptFile(-1);
    handled.info.scriptName = '[oploc1,locaudit_fixture_1]';
    handled.opcodes = [ScriptOpcode.PUSH_CONSTANT_INT, ScriptOpcode.POP_INT_DISCARD, ScriptOpcode.RETURN];
    provider.scriptLookup.set(trigger('OP', 1) | (2 << 8) | (ids[1] << 10), handled);
    const silent = new ScriptFile(-2);
    silent.info.scriptName = '[aploc1,locaudit_fixture_2]';
    silent.opcodes = [ScriptOpcode.RETURN];
    provider.scriptLookup.set(trigger('AP', 1) | (2 << 8) | (ids[2] << 10), silent);
    LocType.get(ids[0]).op = ['Synthetic odd Spelling', 'hidden', 'HIDDEN', 'HiDdEn', null];
    const hiddenHandler = new ScriptFile(-3);
    hiddenHandler.info.scriptName = '[oploc2,locaudit_fixture_0]';
    hiddenHandler.opcodes = handled.opcodes;
    provider.scriptLookup.set(trigger('OP', 2) | (2 << 8) | (ids[0] << 10), hiddenHandler);
    const test = scan(fixture, synthetic);
    assert(test.gaps.some(g => g.type === ids[0] && g.kind === 'no handler' && g.placements.size === 1), 'synthetic placed no-handler option must appear');
    assert(!test.gaps.some(g => g.type === ids[1]), 'synthetic handled option must not appear');
    assert(test.gaps.some(g => g.type === ids[2] && g.kind === 'handler that only returns'), 'bare-return handler must be separate');
    assert.equal(test.options.filter(o => o.kind === HIDDEN_KIND).length, 3, 'hidden is case-insensitive');
    assert(!test.gaps.some(g => g.type === ids[0] && g.slot !== 1), 'hidden slots never become gaps');
    assert.equal(test.options.find(o => o.root === ids[0] && o.slot === 2)?.op.script, hiddenHandler, 'hidden script dispatch is still recorded');
    if (output) {
      const file = path.join(output, 'self-check-fixtures.csv');
      csv(file, ['config_name', 'option_slot', 'option_text', 'kind', 'placement_count'], test.gaps.map(g => [typeName(g.type), g.slot, g.text, g.kind, g.placements.size]));
      const written = fs.readFileSync(file, 'utf8');
      assert(written.includes('locaudit_fixture_0,1,Synthetic odd Spelling,no handler,1'));
      assert(!written.includes('locaudit_fixture_1'), 'handled fixture must not reach CSV output');
      assert(!/hidden/i.test(written), 'hidden slots must not reach missing CSV output');
    }
    results.push('PASS synthetic placed option without a handler appears, with arbitrary option spelling');
    results.push('PASS synthetic placed option with a handler is absent from gaps');
    results.push('PASS bare RETURN handler is a separate gap kind');
    results.push('PASS hidden, HIDDEN and HiDdEn are not menu gaps, and a hidden-slot trigger remains recorded');
    provider.scriptLookup.set(trigger('OP', 1), handled);
    const globalRoute = scan([fixture[0]], synthetic);
    assert.equal(globalRoute.gaps.length, 0, 'a global handler is not a missing route');
    assert.equal(globalRoute.options[0].op.rule, 'global');
    provider.scriptLookup.delete(trigger('OP', 1));
    LocType.get(ids[0]).category = 1;
    provider.scriptLookup.set(trigger('OP', 1) | (1 << 8) | (1 << 10), handled);
    assert.equal(scan([fixture[0]], synthetic).gaps.length, 0, 'a category handler is not a missing route');
    results.push('PASS global and category handlers count as handlers, without speech analysis');
    fixture[0].type = ids[1];
    LocType.get(ids[1]).active = 0;
    const inactive = scan([fixture[0]], synthetic);
    assert.equal(inactive.gaps.length, 0, 'an inactive root must not enter missing rows');
    assert.equal(inactive.options[0]?.kind, INACTIVE_KIND);
    assert.equal(inactive.options[0]?.op.script, handled, 'inactive-root hypothetical trigger is retained');
    results.push('PASS inactive roots are not menu gaps, even when a trigger exists');
    for (const id of ids.slice(3)) {
      const config = new LocType(id);
      config.debugname = `locaudit_multiloc_${id - ids[3]}`;
      config.active = 1;
      LocType.configs[id] = config;
      synthetic.set(id, config);
    }
    const controller = [...client.values()].find(c => c.multivarp !== -1)?.multivarp;
    assert(controller !== undefined, 'a current integer multiloc controller is required');
    const root = LocType.get(ids[3]);
    root.multivarp = controller;
    root.multiloc = [ids[4], ids[5], -1];
    LocType.get(ids[4]).op = ['Child unanswered', 'Child fallback', null, null, null];
    LocType.get(ids[5]).op = ['Child handled', null, null, null, null];
    LocType.get(ids[5]).active = 0;
    provider.scriptLookup.set(trigger('OP', 2) | (2 << 8) | (root.id << 10), handled);
    provider.scriptLookup.set(trigger('OP', 1) | (2 << 8) | (ids[5] << 10), handled);
    const multi = scan([{ ...fixture[0], type: root.id }], synthetic);
    assert.deepEqual(multi.options.map(o => [o.form.type, o.slot, o.text]), [[ids[4], 1, 'Child unanswered'], [ids[4], 2, 'Child fallback'], [ids[5], 1, 'Child handled']], 'synthetic multiloc reads child options, not root options, and omits the -1 state');
    assert.deepEqual(multi.gaps.map(g => [g.type, g.slot]), [[ids[4], 1]], 'only the unanswered visible child option is missing');
    assert.equal(multi.options[1].op.rule, 'base-fallback:exact');
    assert.equal(multi.options[2].kind, 'handled', 'an inactive child of an active root remains clickable');
    results.push('PASS synthetic multiloc uses child options, omits -1, preserves base fallback and permits an inactive child of an active root');
  } finally {
    provider.scriptLookup = originalLookup;
    for (const id of ids) delete LocType.configs[id];
    LocType.configs.length = originalLength;
  }
  const real = scan(placements, client);
  const witness = real.options.find(o => o.kind === 'handled' && /door|ladder/i.test(typeName(o.form.type)));
  assert(witness, 'a published mapped door or ladder with a compiled handler is required');
  assert(!real.gaps.some(g => g.type === witness.form.type && g.slot === witness.slot && g.roots.has(witness.root)), 'published handled door/ladder must be absent from gaps');
  results.push(`PASS published ${typeName(witness.root)} -> ${typeName(witness.form.type)} slot ${witness.slot} has ${scriptDescription(witness.op) || scriptDescription(witness.ap)} and no gap`);
  return results;
}

export function runAudit(content: string, output: string): void {
  assert(fs.statSync(output).isDirectory(), 'output directory must already exist');
  assert(!path.resolve(output).startsWith(path.resolve(content) + path.sep), 'outputs must be outside the repository');
  const client = loadPack();
  const inventory = readPlacements();
  const checks = selfChecks(client, inventory.placements, output);
  const audit = scan(inventory.placements, client);
  const names = labels(content);
  const byRoot = new Map<number, Placement[]>();
  for (const p of inventory.placements) { const rows = byRoot.get(p.type) ?? []; rows.push(p); byRoot.set(p.type, rows); }
  const inactiveOptions = audit.options.filter(o => o.kind === INACTIVE_KIND);
  const inactiveRows = optionRows(inactiveOptions, byRoot);
  const priority = priorityRows(audit.gaps);
  const priorityCells = (row: typeof priority[number]) => [row.name, row.text, row.slots, row.rows, row.placements.size, [...new Set([...row.placements.values()].map(p => p.map))].sort(compare).join(';'), tile(row.placements.values().next().value!), row.lead];
  csv(path.join(output, 'loc-options-priority.csv'), ['config_or_group', 'option_text', 'slots', 'gap_rows', 'distinct_placements', 'map_squares', 'sample_tile', 'mechanism_lead'], priority.map(priorityCells));
  const gapRow = (g: Gap) => {
    const p = sample(g);
    return [g.type, typeName(g.type), LocType.get(g.type).name, g.slot, g.text, g.kind, g.placements.size, maps(g), tile(p), ...nearbyLabel(p, names), [...g.roots].map(typeName).sort(compare).join(';'), g.options.some(o => o.ap.category || o.op.category), g.options.some(o => o.ap.global || o.op.global), descriptions(g, 'ap'), descriptions(g, 'op'), lead(g)];
  };
  const gapHeader = ['loc_type', 'config_name', 'display_name', 'option_slot', 'option_text', 'kind', 'placement_count', 'map_squares', 'sample_tile', 'near_surface_label', 'label_distance_tiles', 'placed_roots', 'category_handler_exists', 'global_handler_exists', 'ap_handler', 'op_handler', 'mechanism_lead'];
  csv(path.join(output, 'loc-options-missing.csv'), gapHeader, audit.gaps.map(gapRow));
  csv(path.join(output, 'loc-options-inactive.csv'), gapHeader, inactiveRows.map(gapRow));
  csv(path.join(output, 'loc-placements.csv'), ['placement_key', 'placed_type', 'config_name', 'map_square', 'x', 'z', 'client_plane', 'shape', 'angle', 'server_entity_active'], inventory.placements.map(p => [p.key, p.type, typeName(p.type), p.map, p.x, p.z, p.level, p.shape, p.angle, LocType.get(p.type).active]));
  csv(path.join(output, 'loc-options-all.csv'), ['placed_root', 'visible_type', 'config_name', 'states', 'slot', 'text', 'kind', 'root_placement_count', 'ap_handler', 'op_handler'], audit.options.map(o => [typeName(o.root), o.form.type, typeName(o.form.type), o.form.states.map(s => s === null ? 'base' : s).join(';'), o.slot, o.text, o.kind, byRoot.get(o.root)!.length, scriptDescription(o.ap), scriptDescription(o.op)]));
  const aggregate = (keyFor: (g: Gap, p: Placement) => string) => {
    const groups = new Map<string, { rows: Set<Gap>; placements: Set<string>; associations: number; kinds: Map<string, number> }>();
    for (const g of audit.gaps) for (const p of g.placements.values()) {
      const key = keyFor(g, p);
      const group = groups.get(key) ?? { rows: new Set(), placements: new Set(), associations: 0, kinds: new Map() };
      group.rows.add(g); group.placements.add(p.key); group.associations++;
      group.kinds.set(g.kind, (group.kinds.get(g.kind) ?? 0) + 1);
      groups.set(key, group);
    }
    return [...groups].sort((a, b) => b[1].associations - a[1].associations || compare(a[0], b[0]));
  };
  const optionTotals = aggregate(g => g.text);
  const mapTotals = aggregate((_g, p) => p.map);
  const groupHeader = ['key', 'gap_rows', 'distinct_placements', 'placement_option_form_associations', 'no_handler_associations', 'return_only_associations'];
  const groupRows = (groups: ReturnType<typeof aggregate>) => groups.map(([key, g]) => [key, g.rows.size, g.placements.size, g.associations, g.kinds.get('no handler') ?? 0, g.kinds.get('handler that only returns') ?? 0]);
  csv(path.join(output, 'loc-options-by-option.csv'), ['option_text', ...groupHeader.slice(1)], groupRows(optionTotals));
  csv(path.join(output, 'loc-options-by-mapsquare.csv'), ['map_square', ...groupHeader.slice(1)], groupRows(mapTotals));
  csv(path.join(output, 'loc-options-by-mechanism.csv'), ['mechanism_lead', ...groupHeader.slice(1)], groupRows(aggregate(g => lead(g))));
  const inactiveConfigs = [...client.values()].filter(c => !LocType.get(c.id).active && c.op?.some(isShown));
  csv(path.join(output, 'inactive-loc-types.csv'), ['loc_type', 'config_name', 'options', 'direct_placements'], inactiveConfigs.map(c => [c.id, typeName(c.id), c.op?.map((o, i) => o === null ? '' : `${i + 1}:${o}`).filter(Boolean).join(';'), byRoot.get(c.id)?.length ?? 0]));
  const gapPlacements = new Set(audit.gaps.flatMap(g => [...g.placements.keys()]));
  const kinds = Object.fromEntries(['no handler', 'handler that only returns'].map(kind => {
    const rows = audit.gaps.filter(g => g.kind === kind);
    return [kind, { rows: rows.length, forms: new Set(rows.map(g => g.type)).size, placements: new Set(rows.flatMap(g => [...g.placements.keys()])).size, associations: rows.reduce((n, g) => n + g.placements.size, 0) }];
  }));
  const hiddenOptions = audit.options.filter(o => o.kind === HIDDEN_KIND);
  const contextTotals = (options: Option[]) => ({ rootFormSlots: options.length, formSlots: new Set(options.map(o => `${o.form.type}:${o.slot}`)).size, roots: new Set(options.map(o => o.root)).size, placements: new Set(options.flatMap(o => byRoot.get(o.root)!.map(p => p.key))).size, withHandler: options.filter(o => o.ap.script || o.op.script).length, associations: options.reduce((n, o) => n + byRoot.get(o.root)!.length, 0) });
  const hidden = { kind: HIDDEN_KIND, ...contextTotals(hiddenOptions), byText: [...new Set(hiddenOptions.map(o => o.text))].sort(compare).map(text => ({ text, ...contextTotals(hiddenOptions.filter(o => o.text === text)) })) };
  const inactive = { kind: INACTIVE_KIND, rows: inactiveRows.length, forms: new Set(inactiveRows.map(g => g.type)).size, ...contextTotals(inactiveOptions) };
  const summary = { maps: inventory.maps, placements: inventory.placements.length, placedTypes: byRoot.size, clientLocTypes: client.size, enumeratedRootFormOptions: audit.options.length, visibleOptionForms: new Set(audit.options.filter(o => !notShown(o.kind)).map(o => o.form.type)).size, gapRows: audit.gaps.length, gapForms: new Set(audit.gaps.map(g => g.type)).size, gapPlacements: gapPlacements.size, gapAssociations: audit.gaps.reduce((n, g) => n + g.placements.size, 0), kinds, hidden, inactive, inactiveConfigs: inactiveConfigs.length, inactivePlacedConfigs: inactiveConfigs.filter(c => byRoot.has(c.id)).length, limits: audit.limits };
  fs.writeFileSync(path.join(output, 'loc-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'self-checks.log'), checks.join('\n') + '\n');
  const md = (s: unknown) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# LOC option census', '', '## Method and limits', '',
    'This is a compiled-pack inventory, not a gameplay change or a claim that each handler completes its mechanism.',
    'VERIFIED inputs: the checked-out 377 map pack and built client loc.dat/loc.idx. No later-game source supplies options or placements.',
    'The tool decodes every built static location placement, then every non-null client op1–op5 string. It uses no option-name whitelist.',
    'Java client LocType.java:470-472 reads each option, then replaces equalsIgnoreCase("hidden") with null. Client.java:4148-4151 adds only non-null loc options to the menu.',
    'These slots are not shown by the client (hidden), not gaps. Their totals are separate. loc-options-all.csv retains any script-trigger dispatch despite no menu entry.',
    'Engine OpLocHandler.ts:52 also rejects the exact lowercase hidden sentinel. Hidden-slot trigger probes establish a script interaction, not a client click.',
    'The same case-insensitive filter exists for NPC options (NpcType.java:157-159) and object ground options (ObjType.java:389-391).',
    'Object inventory options are read separately without that filter (ObjType.java:393-397). The NPC census should exclude hidden sentinels from exposed-option counts.',
    'Client source paths above are relative to vendor/client-java/src/main/java/jagex2, config/ for type files and client/ for Client.java.',
    'For each root and immediate multiloc form, each representable non-null form index is set in a fixture player.',
    'OpLocHandler.handle establishes the interaction. Player.getApTrigger/getOpTrigger decide dispatch from the built ScriptProvider.',
    'Exact, category and global lookup are retained, including production base fallback only when both child phases are absent.',
    'A category/global default message is a handler. No speech analysis is attempted. Handler names and immediate constant call targets are reported.',
    'Only a nonempty bytecode body containing exclusively RETURN instructions is called return-only. Conditional silence and indirect no-ops remain handled.',
    'An inactive placed ROOT is not pickable: Java dash3d/World.java:120-123 and 796-799 set the sign bit from its activity flag. Model.java:1571 gates picking on a positive bitset; 1643 passes that flag to the picker.',
    'The client activity flag is decoded at config/LocType.java:444-447, inferred only when absent at 386-395. Engine tools/pack/config/LocConfig.ts:236-239 writes it into client opcode 19.',
    'These options are not shown by the client (inactive root), not gaps. GameMap.loadLocations:347-348 also creates no server entity. Their own totals and loc-options-inactive.csv retain hypothetical dispatch.',
    'An inactive CHILD does not disable an active root: ClientLocAnim.java:118-124 selects the child model without its active flag; Client.java:4133-4140 selects its menu type without an active check. A rendered child remains pickable through the root bitset.',
    'An active, rendered loc with no options remains pickable and offers Examine (Client.java:4174-4179), plus applicable selected-item/spell targeting. No absent op1-op5 string is a gap.',
    'inactive-loc-types.csv also lists unplaced inactive types with option strings. The E-INSTCOL inactive-option follow-up leads are withdrawn for ordinary client clicking.',
    'Multiloc -1 entries and out-of-range controller values show no client loc and are not counted as visible base forms.',
    'This enumerates config states, not quest reachability. Dynamic loc_add/loc_change forms, instance copies and nested client morphs are not exhaustively enumerated.',
    'Placements retain raw map/client planes, before the loader bridge adjustment. Membership is not a pathfinding or reachability test.',
    'Rows aggregate missing contexts by visible type, slot, exact option string and kind. A visible type can be handled through another placed root.',
    'A placement is deduplicated within each row. Distinct placements are physical map entries. Association totals count every potential form and option separately.',
    'Place means map square and sample tile. Optional labels use actual coordinates within 100 tiles, with distance. No underground projection or distant label is used.',
    'Mechanism groups are UNKNOWN engineering leads from option text and config name only. Groups are mutually exclusive in the listed order, not authenticated mechanisms.', '',
    '## Totals', '', '```json', JSON.stringify(summary, null, 2), '```', '', '## Fifty most-placed gaps', '',
    '| Config | Slot | Option | Kind | Placements | Map squares | Sample tile | Nearby surface label |', '|---|---:|---|---|---:|---|---|---|'];
  for (const g of [...audit.gaps].sort((a, b) => b.placements.size - a.placements.size || a.type - b.type || a.slot - b.slot).slice(0, 50)) {
    const label = nearbyLabel(sample(g), names);
    lines.push(`| ${[typeName(g.type), g.slot, g.text, g.kind, g.placements.size, maps(g), tile(sample(g)), label[0] ? `${label[0]} (${label[1]} tiles)` : 'none within 100 tiles'].map(md).join(' | ')} |`);
  }
  const appendPriority = (title: string, rows: typeof priority, limit: number) => {
    lines.push('', title, '', '| Config or group | Option | Slots | Gap rows | Distinct placements | Map squares | Sample tile | Lead only |', '|---|---|---|---:|---:|---|---|---|');
    for (const row of rows.slice(0, limit)) lines.push(`| ${priorityCells(row).map(md).join(' | ')} |`);
  };
  lines.push('', 'The next work list unions physical placement keys across all Farming patch forms for each option. Other forms remain separate. It does not rank quest accessibility.');
  appendPriority('## Fifty largest gaps by distinct placements, Farming collapsed', priority, 50);
  lines.push('', '## Hidden sentinel letter case', '', 'Both spellings below are removed by Java equalsIgnoreCase. The engine packet handler rejects only lowercase hidden; uppercase variants are not 377 menu entries even if another client sends them.', '', '| Raw text | Root/form/slot contexts | Distinct form/slots | Placed roots | Placement associations | Contexts with a handler |', '|---|---:|---:|---:|---:|---:|');
  for (const row of hidden.byText) lines.push(`| ${row.text} | ${row.rootFormSlots} | ${row.formSlots} | ${row.roots} | ${row.associations} | ${row.withHandler} |`);
  lines.push('', '## Option texts ranked', '', '| Option text | Gap rows | Distinct placements | Form-option associations |', '|---|---:|---:|---:|');
  for (const [text, g] of optionTotals) lines.push(`| ${md(text)} | ${g.rows.size} | ${g.placements.size} | ${g.associations} |`);
  lines.push('', '## Inactive roots: options never shown by the client', '', '| Config | Config option strings, not menu entries | Direct map placements |', '|---|---|---:|');
  for (const c of inactiveConfigs) lines.push(`| ${typeName(c.id)} | ${md(c.op?.map((o, i) => o === null ? '' : `${i + 1}: ${o}`).filter(Boolean).join('; '))} | ${byRoot.get(c.id)?.length ?? 0} |`);
  lines.push('', 'These are not missing options. Their non-menu rows and placements are in loc-options-inactive.csv and loc-placements.csv.', '', '## Mechanism leads', '', '| Lead only | Gap rows | Distinct placements | Form-option associations |', '|---|---:|---:|---:|');
  for (const [name, g] of aggregate(g => lead(g))) lines.push(`| ${name} | ${g.rows.size} | ${g.placements.size} | ${g.associations} |`);
  lines.push('', 'Lead rules use only config names and option strings. Farming patch roots count as resources. Hatch/trapdoor names count as access leads. Transport requires a vehicle name or a whole transport option, not board inside notice_board or floorboard. Ore is token-bounded, and shiphull_leak is not a transport name.');
  for (const group of ['doors and gates', 'ladders and stairs', 'containers and searchable scenery', 'resources', 'transport', 'quest scenery', 'unclassified']) {
    appendPriority(`### ${group}: twenty largest leads`, priority.filter(row => row.lead === group), 20);
  }
  lines.push('', "## Reviewer's ten most plainly blocking leads", '', "This is the independent reviewer's list (review.md:154-165), not a new reachability or gameplay verdict. Each table joins that named lead to the current census. A completed lead can have no remaining rows.");
  const reviewerLeads: [string, string[]][] = [
    ['bank_booth Use', ['bank_booth']],
    ['ahoy_bankbooth Use / Use-quickly', ['ahoy_bankbooth']],
    ['elid_bankbooth Use / Use-quickly', ['elid_bankbooth']],
    ['dwarf_keldagrim_bankbooth Use / Use-quickly', ['dwarf_keldagrim_bankbooth']],
    ['fever_bankbooth Use / Use-quickly', ['fever_bankbooth']],
    ['pest_bankbooth Use / Use-quickly', ['pest_bankbooth']],
    ['ham_multi_trapdoor forms and osf_ham_ladder exit', ['osf_trapdoor_closed', 'osf_trapdoor_open', 'osf_ham_ladder']],
    ['ladder_11739 / ladder_11741', ['ladder_11739', 'ladder_11741']],
    ['wild_door and wild ladders', ['wild_door', 'wild_ladder', 'wild_ladder_middle', 'wild_laddertop']],
    ['castle_door_11717 / castle_door_11719', ['castle_door_11717', 'castle_door_11719']],
  ];
  for (let i = 0; i < reviewerLeads.length; i++) {
    const [title, configs] = reviewerLeads[i];
    const rows = audit.gaps.filter(g => configs.includes(typeName(g.type)));
    lines.push('', `### ${i + 1}. ${title}`, '', '| Census form | Slot | Option | Kind | Distinct placements | Map squares | Sample tile | Placed roots |', '|---|---:|---|---|---:|---|---|---|');
    for (const g of rows) lines.push(`| ${[typeName(g.type), g.slot, g.text, g.kind, g.placements.size, maps(g), tile(sample(g)), [...g.roots].map(typeName).sort(compare).join(';')].map(md).join(' | ')} |`);
    if (!rows.length) lines.push('No current missing rows match this reviewer lead.');
  }
  lines.push('', '## Enumeration exceptions', '', ...(audit.limits.length ? audit.limits : ['None in the current built pack.']), '', '## Self-checks', '', ...checks.map(c => `- ${c}`), '', 'No headed run is requested or performed. Execution receipts and exact heads are recorded by the operator of this tool.', '');
  fs.writeFileSync(path.join(output, 'report.md'), lines.join('\n'));
  console.log(checks.join('\n'));
  console.log(`LOC_AUDIT maps=${summary.maps} placements=${summary.placements} types=${summary.placedTypes} gap_rows=${summary.gapRows} gap_forms=${summary.gapForms} gap_placements=${summary.gapPlacements}`);
}
