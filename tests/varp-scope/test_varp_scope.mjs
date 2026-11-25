#!/usr/bin/env node
/** Run from the sibling engine after npm run build: node --import tsx ../content/tests/varp-scope/test_varp_scope.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const policy = JSON.parse(fs.readFileSync(new URL('./scope-policy.json', import.meta.url), 'utf8'));
const load = async relative => import(pathToFileURL(path.join(ENGINE_ROOT, relative)).href);
const { default: VarPlayerType } = await load('src/cache/config/VarPlayerType.ts');
const { default: VarBitType } = await load('src/cache/config/VarBitType.ts');
const { default: ScriptProvider } = await load('src/engine/script/ScriptProvider.ts');
const { ScriptOpcode } = await load('src/engine/script/ScriptOpcode.ts');
assert(fs.existsSync(path.join(PACK_DIR, 'server/script.dat')), 'build the sibling engine first');
VarPlayerType.load(PACK_DIR);
VarBitType.load(PACK_DIR);
assert(ScriptProvider.load(PACK_DIR) > 0, 'compiled scripts are missing');

const failures = [];
const requirePermanent = (name, reason) => {
  const varp = VarPlayerType.getByName(name);
  if (!varp) failures.push(`${reason}: missing ${name}`);
  else if (varp.scope !== VarPlayerType.SCOPE_PERM) failures.push(`${reason}: ${name} (${varp.id}) is temporary`);
};
const baseVarp = (opcode, operand) => {
  const id = operand & 0xffff; // The high bits encode the player pointer, not the config ID.
  if (opcode === ScriptOpcode.PUSH_VARBIT || opcode === ScriptOpcode.POP_VARBIT) {
    const bit = VarBitType.get(id);
    assert(bit, `missing compiled varbit ${id}`);
    return VarPlayerType.get(bit.basevar);
  }
  return VarPlayerType.get(id);
};

// Follow the actual packed quest registry, including computed Clock Tower and
// Dig Site progress. update_questpoints holds a derived total, not a stage.
const registry = new Set();
const visited = new Set();
function visitRegistry(script) {
  assert(script, 'quest registry calls a missing compiled script');
  if (visited.has(script.id) || script.name === '[proc,update_questpoints]') return;
  visited.add(script.id);
  for (let pc = 0; pc < script.opcodes.length; pc++) {
    const opcode = script.opcodes[pc];
    const operand = script.intOperands[pc];
    if (opcode === ScriptOpcode.PUSH_VARP || opcode === ScriptOpcode.PUSH_VARBIT) {
      const varp = baseVarp(opcode, operand);
      assert(varp?.debugname, `${script.name}: missing varp for operand ${operand}`);
      registry.add(varp.debugname);
    } else if (opcode === ScriptOpcode.GOSUB_WITH_PARAMS || opcode === ScriptOpcode.JUMP_WITH_PARAMS) {
      visitRegistry(ScriptProvider.get(operand));
    }
  }
}
visitRegistry(ScriptProvider.getByName('[proc,count_questpoints]'));
visitRegistry(ScriptProvider.getByName('[proc,update_questlist]'));
assert(registry.size > 0, 'quest registry contains no stage/progress varps');
for (const name of registry) requirePermanent(name, 'quest registry');

// This is the complete permanent-name inventory at the pinned 289 commit.
// A renamed waterfall value is mapped; the changed autocast packing and login
// behavior are explicitly deferred rather than silently dropping that row.
assert.equal(new Set(policy.inheritedPermanent).size, policy.inheritedPermanent.length, 'duplicate inherited name');
for (const name of policy.inheritedPermanent) {
  if (Object.hasOwn(policy.deferred, name)) {
    const { current, reason } = policy.deferred[name];
    assert(reason && policy.deliberatelyTemporary[current], `unclassified inherited exception ${name}`);
    continue;
  }
  requirePermanent(policy.renamed[name] ?? name, `origin/289 ${policy.referenceCommit}`);
}

// This original declaration moved out of all.varp, but remains in this policy.
requirePermanent('goblin_caves', 'durable personal cave learning, rope and oil state');
const caves = VarPlayerType.getByName('goblin_caves');
assert.equal(caves?.id, 425, 'the original goblin_caves slot must not move');
assert.equal(caves.transmit, true, 'retain the original cave client readers');

// Discover every declaration, including moved unit configs and unwritten values.
// The checked-in inventory is deliberate: a new PERM declaration also needs review.
const declarations = new Map();
function discoverDeclarations(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      discoverDeclarations(file);
    } else if (entry.isFile() && entry.name.endsWith('.varp')) {
      let declaration;
      for (const [index, raw] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
        const line = raw.replace(/\/\/.*$/, '').trim();
        const header = /^\[([^\]]+)\]$/.exec(line);
        if (header) {
          const name = header[1];
          const location = `${path.relative(CONTENT_ROOT, file)}:${index + 1}`;
          assert(!declarations.has(name), `duplicate varp declaration: ${name} at ${location}`);
          declaration = { location, scope: 'temp' };
          declarations.set(name, declaration);
        } else if (declaration && line.startsWith('scope=')) {
          declaration.scope = line.slice('scope='.length).trim();
        }
      }
    }
  }
}
discoverDeclarations(path.join(CONTENT_ROOT, 'scripts'));
assert(declarations.size > 0, 'no varp declarations found');
const names = new Set(declarations.keys());
for (const [name, declaration] of declarations) {
  const expected = policy.declarationScopes[name];
  if (expected !== 'perm' && expected !== 'temp') {
    failures.push(`unclassified varp declaration: ${name} at ${declaration.location}`);
    continue;
  }
  assert.equal(declaration.scope, expected, `declared scope policy: ${name} at ${declaration.location}`);
  const varp = VarPlayerType.getByName(name);
  assert(varp, `missing packed declaration: ${name} at ${declaration.location}`);
  assert.equal(varp.scope, expected === 'perm' ? VarPlayerType.SCOPE_PERM : VarPlayerType.SCOPE_TEMP, `packed scope policy: ${name}`);
}
for (const name of Object.keys(policy.declarationScopes)) {
  assert(names.has(name), `stale declaration scope policy entry: ${name}`);
}
for (const [name, reason] of Object.entries(policy.declarationReasons)) {
  assert(names.has(name), `stale declaration reason: ${name}`);
  assert(typeof reason === 'string' && reason.length > 0, `missing declaration reason: ${name}`);
}
for (const [name, reason] of Object.entries(policy.permanentDecisions)) {
  assert(reason.length > 0, `missing PERM reason: ${name}`);
  requirePermanent(name, reason);
}

// Inspect packed POP instructions, not a source-assignment regex: tuple
// assignments, secondary player pointers and varbit writes all count.
const written = new Set();
for (const line of fs.readFileSync(path.join(CONTENT_ROOT, 'pack/script.pack'), 'utf8').split('\n')) {
  const match = /^(\d+)=/.exec(line);
  if (!match) continue;
  const script = ScriptProvider.get(Number(match[1]));
  if (!script) continue; // Retired IDs remain in the pack-name map.
  for (let pc = 0; pc < script.opcodes.length; pc++) {
    const opcode = script.opcodes[pc];
    if (opcode !== ScriptOpcode.POP_VARP && opcode !== ScriptOpcode.POP_VARBIT) continue;
    const varp = baseVarp(opcode, script.intOperands[pc]);
    assert(varp?.debugname, `${script.name}: missing written varp at ${pc}`);
    assert(names.has(varp.debugname), `${script.name}: written varp has no declaration: ${varp.debugname}`);
    written.add(varp.debugname);
    if (varp.scope !== VarPlayerType.SCOPE_PERM && !Object.hasOwn(policy.deliberatelyTemporary, varp.debugname)) {
      failures.push(`unclassified temporary written varp: ${varp.debugname} (${varp.id}), ${script.info.sourceFilePath}:${script.lineNumber(pc)}`);
    }
  }
}
for (const [name, reason] of Object.entries(policy.deliberatelyTemporary)) {
  assert(reason.length > 0, `missing TEMP reason: ${name}`);
  const varp = VarPlayerType.getByName(name);
  if (!varp || varp.scope !== VarPlayerType.SCOPE_TEMP || !written.has(name)) {
    failures.push(`stale deliberately-temporary policy entry: ${name}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  // Test the native serializer with the compiled scopes, not a copied save format.
  // UNKNOWN engineering fixture marker; it is not a gameplay state or historical value.
  const scopeRoundtripMarker = 12345;
  await load('src/engine/World.ts');
  const { PlayerLoading } = await load('src/engine/entity/PlayerLoading.ts');
  const { default: Packet } = await load('src/io/Packet.ts');
  const player = PlayerLoading.load('varp_scope', new Packet(new Uint8Array()), null);
  const fresh = PlayerLoading.load('varp_scope', new Packet(new Uint8Array()), null);
  for (const name of names) {
    player.vars[VarPlayerType.getByName(name).id] = scopeRoundtripMarker;
  }
  const reloaded = PlayerLoading.load(player.username, new Packet(player.save()), null);
  for (const name of names) {
    const varp = VarPlayerType.getByName(name);
    assert.equal(reloaded.vars[varp.id],
      policy.declarationScopes[name] === 'perm' ? scopeRoundtripMarker : fresh.vars[varp.id],
      `native save/load scope: ${name}`);
  }
  console.log(`PASS varp scope: ${declarations.size} classified declarations, ${registry.size} quest-registry bases, ${policy.inheritedPermanent.length} pinned inherited names (${Object.keys(policy.deferred).length} explicit deferral), ${written.size} written 377 varps, ${Object.keys(policy.deliberatelyTemporary).length} deliberate TEMP values`);
  // World imports create workers; every assertion above is synchronous and complete.
  process.exit(0);
}
