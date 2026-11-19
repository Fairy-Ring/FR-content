import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import CategoryType from '#/cache/config/CategoryType.js';
import LocType from '#/cache/config/LocType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
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
  for (let state = 0; state < config.multiloc.length; state++) {
    const id = config.multiloc[state];
    if (id === -1) continue; // The client shows no loc for this state, not the base fallback used by the server.
    if (state > maxState) {
      limits.add(`${typeName(root.id)}: state ${state} exceeds the controller bit range`);
      continue;
    }
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
  const original = World.getLoc;
  const options: Option[] = [];
  try {
    // An inactive root has no entity in GameMap. Probe hypothetical routing, but classify it as inactive below.
    World.getLoc = (() => loc) as typeof World.getLoc;
    for (let index = 0; index < 5; index++) {
      const text = client.get(form.type)!.op?.[index];
      if (text === null || text === undefined) continue; // All client strings count, regardless of spelling or case.
      assert.notEqual(text, 'hidden', `client gives an option the server rejects: ${typeName(form.type)} slot ${index + 1}`);
      let selected: Option | null = null;
      for (const state of form.states) {
        setState(player, root, state);
        assert.equal(new OpLocHandler().handle(new OpLoc(index + 1, 8, 8, root.id), player), true, `OpLocHandler rejected ${typeName(form.type)} slot ${index + 1}`);
        assert.equal(player.target, loc, 'production handler must establish the interaction');
        const ap = actualRoute(root.id, form.type, 'AP', index + 1, player.getApTrigger());
        const op = actualRoute(root.id, form.type, 'OP', index + 1, player.getOpTrigger());
        const scripts = [ap.script, op.script].filter((s): s is ScriptFile => s !== null);
        const kind = !root.active ? 'inactive type' : !scripts.length ? 'no handler' : scripts.every(onlyReturns) ? 'handler that only returns' : 'handled';
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

export function scan(placements: Placement[], client: Map<number, LocType>): { options: Option[]; gaps: Gap[]; limits: string[] } {
  const byRoot = new Map<number, Placement[]>();
  for (const p of placements) {
    const rows = byRoot.get(p.type) ?? [];
    rows.push(p);
    byRoot.set(p.type, rows);
  }
  const options: Option[] = [];
  const missing = new Map<string, Gap>();
  const limits = new Set<string>();
  for (const rootId of [...byRoot.keys()].sort((a, b) => a - b)) {
    const root = LocType.get(rootId);
    for (const form of forms(root, client, limits)) {
      for (const option of probe(root, form, client)) {
        options.push(option);
        if (option.kind === 'handled') continue;
        const key = JSON.stringify([form.type, option.slot, option.text, option.kind]);
        const gap = missing.get(key) ?? { type: form.type, slot: option.slot, text: option.text, kind: option.kind, roots: new Set(), placements: new Map(), options: [] };
        gap.roots.add(rootId);
        for (const p of byRoot.get(rootId)!) gap.placements.set(p.key, p);
        gap.options.push(option);
        missing.set(key, gap);
      }
    }
  }
  return { options, gaps: [...missing.values()].sort((a, b) => a.type - b.type || a.slot - b.slot || compare(a.kind, b.kind)), limits: [...limits].sort(compare) };
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
function lead(gap: Gap): string {
  const text = `${typeName(gap.type)} ${gap.text}`.toLowerCase();
  if (/door|gate/.test(text)) return 'doors and gates';
  if (/ladder|stair|steps/.test(text)) return 'ladders and stairs';
  if (/chest|crate|cupboard|drawer|bookcase|barrel|search|sack/.test(text)) return 'containers and searchable scenery';
  if (/tree|rock|ore|mine|chop|fish|harvest|pick|plant|herb|flax/.test(text)) return 'resources';
  if (/boat|canoe|ship|cart|travel|sail|ride|transport|board/.test(text)) return 'transport';
  if (/quest|soulbane|soul_bane|dt_|mourning|mep_|regicide|myreque|deserttreasure|rfd_|recipe|fremennik|viking/.test(text)) return 'quest scenery';
  return 'unclassified';
}
function sample(gap: Gap): Placement { return gap.placements.values().next().value!; }
function maps(gap: Gap): string { return [...new Set([...gap.placements.values()].map(p => p.map))].sort(compare).join(';'); }
const descriptions = (gap: Gap, phase: 'ap' | 'op') => [...new Set(gap.options.map(o => scriptDescription(o[phase])).filter(Boolean))].sort(compare).join(' | ');

export function selfChecks(client: Map<number, LocType>, placements: Placement[]): string[] {
  const results: string[] = [];
  const provider = ScriptProvider as unknown as { scriptLookup: Map<number, ScriptFile> };
  const originalLookup = provider.scriptLookup;
  const originalLength = LocType.configs.length;
  const ids: number[] = [];
  for (let id = 0; id < 16384 && ids.length < 3; id++) if (!LocType.get(id)) ids.push(id);
  assert.equal(ids.length, 3, 'three unallocated in-memory loc ids are required for self-checks');
  const synthetic = new Map(client);
  try {
    provider.scriptLookup = new Map(originalLookup);
    for (const phase of ['AP', 'OP'] as const) provider.scriptLookup.delete(trigger(phase, 1));
    const fixture = ids.map((id, i): Placement => {
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
    const test = scan(fixture, synthetic);
    assert(test.gaps.some(g => g.type === ids[0] && g.kind === 'no handler' && g.placements.size === 1), 'synthetic placed no-handler option must appear');
    assert(!test.gaps.some(g => g.type === ids[1]), 'synthetic handled option must not appear');
    assert(test.gaps.some(g => g.type === ids[2] && g.kind === 'handler that only returns'), 'bare-return handler must be separate');
    results.push('PASS synthetic placed option without a handler appears, with arbitrary option spelling');
    results.push('PASS synthetic placed option with a handler is absent from gaps');
    results.push('PASS bare RETURN handler is a separate gap kind');
    fixture[0].type = ids[1];
    LocType.get(ids[1]).active = 0;
    assert.equal(scan([fixture[0]], synthetic).gaps[0]?.kind, 'inactive type', 'inactive placement overrides an existing handler');
    results.push('PASS inactive mapped type is a gap even with a handler');
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
  const checks = selfChecks(client, inventory.placements);
  const audit = scan(inventory.placements, client);
  const names = labels(content);
  const byRoot = new Map<number, Placement[]>();
  for (const p of inventory.placements) { const rows = byRoot.get(p.type) ?? []; rows.push(p); byRoot.set(p.type, rows); }
  const gapRow = (g: Gap) => {
    const p = sample(g);
    return [g.type, typeName(g.type), LocType.get(g.type).name, g.slot, g.text, g.kind, g.placements.size, maps(g), tile(p), ...nearbyLabel(p, names), [...g.roots].map(typeName).sort(compare).join(';'), g.options.some(o => o.ap.category || o.op.category), g.options.some(o => o.ap.global || o.op.global), descriptions(g, 'ap'), descriptions(g, 'op'), lead(g)];
  };
  const gapHeader = ['loc_type', 'config_name', 'display_name', 'option_slot', 'option_text', 'kind', 'placement_count', 'map_squares', 'sample_tile', 'near_surface_label', 'label_distance_tiles', 'placed_roots', 'category_handler_exists', 'global_handler_exists', 'ap_handler', 'op_handler', 'mechanism_lead'];
  csv(path.join(output, 'loc-options-missing.csv'), gapHeader, audit.gaps.map(gapRow));
  csv(path.join(output, 'loc-options-inactive.csv'), gapHeader, audit.gaps.filter(g => g.kind === 'inactive type').map(gapRow));
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
  const groupHeader = ['key', 'gap_rows', 'distinct_placements', 'placement_option_form_associations', 'no_handler_associations', 'return_only_associations', 'inactive_associations'];
  const groupRows = (groups: ReturnType<typeof aggregate>) => groups.map(([key, g]) => [key, g.rows.size, g.placements.size, g.associations, g.kinds.get('no handler') ?? 0, g.kinds.get('handler that only returns') ?? 0, g.kinds.get('inactive type') ?? 0]);
  csv(path.join(output, 'loc-options-by-option.csv'), ['option_text', ...groupHeader.slice(1)], groupRows(optionTotals));
  csv(path.join(output, 'loc-options-by-mapsquare.csv'), ['map_square', ...groupHeader.slice(1)], groupRows(mapTotals));
  csv(path.join(output, 'loc-options-by-mechanism.csv'), ['mechanism_lead', ...groupHeader.slice(1)], groupRows(aggregate(g => lead(g))));
  const inactiveConfigs = [...client.values()].filter(c => !LocType.get(c.id).active && c.op?.some(o => o !== null));
  csv(path.join(output, 'inactive-loc-types.csv'), ['loc_type', 'config_name', 'options', 'direct_placements'], inactiveConfigs.map(c => [c.id, typeName(c.id), c.op?.map((o, i) => o === null ? '' : `${i + 1}:${o}`).filter(Boolean).join(';'), byRoot.get(c.id)?.length ?? 0]));
  const gapPlacements = new Set(audit.gaps.flatMap(g => [...g.placements.keys()]));
  const kinds = Object.fromEntries(['no handler', 'handler that only returns', 'inactive type'].map(kind => {
    const rows = audit.gaps.filter(g => g.kind === kind);
    return [kind, { rows: rows.length, forms: new Set(rows.map(g => g.type)).size, placements: new Set(rows.flatMap(g => [...g.placements.keys()])).size, associations: rows.reduce((n, g) => n + g.placements.size, 0) }];
  }));
  const summary = { maps: inventory.maps, placements: inventory.placements.length, placedTypes: byRoot.size, clientLocTypes: client.size, enumeratedRootFormOptions: audit.options.length, visibleOptionForms: new Set(audit.options.map(o => o.form.type)).size, gapRows: audit.gaps.length, gapForms: new Set(audit.gaps.map(g => g.type)).size, gapPlacements: gapPlacements.size, gapAssociations: audit.gaps.reduce((n, g) => n + g.placements.size, 0), kinds, inactiveConfigs: inactiveConfigs.length, inactivePlacedConfigs: inactiveConfigs.filter(c => byRoot.has(c.id)).length, limits: audit.limits };
  fs.writeFileSync(path.join(output, 'loc-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'self-checks.log'), checks.join('\n') + '\n');
  const md = (s: unknown) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# LOC option census', '', '## Method and limits', '',
    'This is a compiled-pack inventory, not a gameplay change or a claim that each handler completes its mechanism.',
    'VERIFIED inputs: the checked-out 377 map pack and built client loc.dat/loc.idx. No later-game source supplies options or placements.',
    'The tool decodes every built static location placement, then every non-null client op1–op5 string. It uses no option-name whitelist.',
    'The client hides no option string supplied by this loc config. Options are not inferred from display names or script source.',
    'For each root and immediate multiloc form, each representable non-null form index is set in a fixture player.',
    'OpLocHandler.handle establishes the interaction. Player.getApTrigger/getOpTrigger decide dispatch from the built ScriptProvider.',
    'Exact, category and global lookup are retained, including production base fallback only when both child phases are absent.',
    'A category/global default message is a handler. No speech analysis is attempted. Handler names and immediate constant call targets are reported.',
    'Only a nonempty bytecode body containing exclusively RETURN instructions is called return-only. Conditional silence and indirect no-ops remain handled.',
    'Inactive means the placed ROOT has active=0 after LocType.postDecode. GameMap.loadLocations creates no server loc for it.',
    'Inactive options are gaps even when hypothetical dispatch has a handler. A child form active=0 does not remove an active root entity.',
    'The inactive CSV gives every option-bearing inactive placed form. inactive-loc-types.csv also lists unplaced inactive client types.',
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
  lines.push('', '## Option texts ranked', '', '| Option text | Gap rows | Distinct placements | Form-option associations |', '|---|---:|---:|---:|');
  for (const [text, g] of optionTotals) lines.push(`| ${md(text)} | ${g.rows.size} | ${g.placements.size} | ${g.associations} |`);
  lines.push('', '## Inactive types with client options', '', '| Config | Client options | Direct map placements |', '|---|---|---:|');
  for (const c of inactiveConfigs) lines.push(`| ${typeName(c.id)} | ${md(c.op?.map((o, i) => o === null ? '' : `${i + 1}: ${o}`).filter(Boolean).join('; '))} | ${byRoot.get(c.id)?.length ?? 0} |`);
  lines.push('', 'All their placed option rows and placements are in loc-options-inactive.csv and loc-placements.csv.', '', '## Mechanism leads', '', '| Lead only | Gap rows | Distinct placements | Form-option associations |', '|---|---:|---:|---:|');
  for (const [name, g] of aggregate(g => lead(g))) lines.push(`| ${name} | ${g.rows.size} | ${g.placements.size} | ${g.associations} |`);
  for (const group of ['doors and gates', 'ladders and stairs', 'containers and searchable scenery', 'resources', 'transport', 'quest scenery']) {
    const examples = audit.gaps.filter(g => lead(g) === group).sort((a, b) => b.placements.size - a.placements.size || a.type - b.type).slice(0, 8);
    lines.push('', `${group}: ${examples.length ? examples.map(g => `${typeName(g.type)} (${g.text})`).join(', ') : 'no rows matched the heuristic'}.`);
  }
  lines.push('', '## Enumeration exceptions', '', ...(audit.limits.length ? audit.limits : ['None in the current built pack.']), '', '## Self-checks', '', ...checks.map(c => `- ${c}`), '', 'No headed run is requested or performed. Execution receipts and exact heads are recorded by the operator of this tool.', '');
  fs.writeFileSync(path.join(output, 'report.md'), lines.join('\n'));
  console.log(checks.join('\n'));
  console.log(`LOC_AUDIT maps=${summary.maps} placements=${summary.placements} types=${summary.placedTypes} gap_rows=${summary.gapRows} gap_forms=${summary.gapForms} gap_placements=${summary.gapPlacements}`);
}
