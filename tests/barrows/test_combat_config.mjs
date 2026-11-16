#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPackedRuntime, packedId, parseOptions, run } from './packed.mjs';

const CONFIG = 'scripts/minigames/game_barrows/configs/barrows_combat.npc';
const NAMES = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac', 'bloodworm', 'rat', 'giantrat', 'spider', 'giantspider', 'skeleton_unarmed', 'skeleton_armed'].map(name => `barrows_${name}`);
// Native stat order: Attack, Defence, Strength, Hitpoints, Ranged, Magic.
const TUNNELS = {
  barrows_bloodworm: { stats: [80, 35, 20, 45, 1, 1], style: 0, defence: [0, 0, 0, 0, 0] },
  barrows_rat: { stats: [70, 20, 20, 35, 1, 1], style: 0, defence: [0, 0, 0, 0, 0] },
  barrows_giantrat: { stats: [80, 65, 50, 70, 1, 1], style: 0, defence: [0, 0, 0, 0, 0] },
  barrows_spider: { stats: [45, 45, 47, 60, 1, 1], style: 0, defence: [20, 20, 10, 17, 20] },
  barrows_giantspider: { stats: [65, 65, 67, 80, 1, 1], style: 0, defence: [20, 20, 10, 17, 20] },
  barrows_skeleton_unarmed: { stats: [72, 72, 72, 50, 1, 1], style: 2, defence: [5, 5, -5, 0, 5], maximum: 10 },
  barrows_skeleton_armed: { stats: [72, 72, 72, 50, 1, 1], style: 1, defence: [5, 5, -5, 0, 5], maximum: 10 }
};

await run(async () => {
  const args = [...process.argv];
  const baselineIndex = args.indexOf('--baseline-pack');
  let baselinePack;
  if (baselineIndex !== -1) {
    baselinePack = args[baselineIndex + 1];
    assert(baselinePack && !baselinePack.startsWith('--'), '--baseline-pack requires a path');
    args.splice(baselineIndex, 2);
  }
  const options = parseOptions(args);
  const runtime = await loadPackedRuntime(options);
  const { contentRoot, engineRoot, packDir, NpcType, ParamType, ScriptProvider } = runtime;
  const eng = relative => import(pathToFileURL(path.join(engineRoot, relative)).href);
  const [{ default: ServerTriggerType }, { default: SeqType }] = await Promise.all([
    eng('src/engine/script/ServerTriggerType.ts'), eng('src/cache/config/SeqType.ts')
  ]);
  SeqType.load(packDir);
  const text = fs.readFileSync(path.join(contentRoot, CONFIG), 'utf8');
  const sections = [...text.matchAll(/^\[([^\]]+)\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)];
  assert.deepEqual(sections.map(match => match[1]), NAMES, 'exactly thirteen ordered, nonduplicated authored combat blocks');
  const unpack = fs.readFileSync(path.join(contentRoot, 'scripts/_unpack/377/all.npc'), 'utf8');
  for (const name of NAMES) assert(!unpack.includes(`[${name}]`), `${name} must not remain in all.npc`);
  const constants = ['scripts/skill_combat/configs/combat_damagetypes.constant', 'scripts/skill_slayer/configs/slayer.constant']
    .map(file => fs.readFileSync(path.join(contentRoot, file), 'utf8')).join('\n');
  const stats = { attack: 0, defence: 1, strength: 2, hitpoints: 3, ranged: 4, magic: 5 };
  for (const [index, match] of sections.entries()) {
    const name = match[1];
    const id = packedId(contentRoot, 'npc', name);
    assert.equal(id, 2025 + index, `${name} original cache id`);
    assert.equal(NpcType.getId(name), id, `${name} native packed identity`);
    const npc = NpcType.get(id);
    const fields = new Map();
    const params = new Map();
    for (const raw of match[2].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      const split = line.indexOf('=');
      assert(split > 0, `${name} malformed field ${line}`);
      const key = line.slice(0, split), value = line.slice(split + 1);
      if (key === 'param') {
        const comma = value.indexOf(',');
        const param = value.slice(0, comma);
        assert(comma > 0 && !params.has(param), `${name} duplicate/malformed parameter ${param}`);
        params.set(param, value.slice(comma + 1));
      } else {
        assert(!fields.has(key), `${name} duplicate field ${key}`);
        fields.set(key, value);
      }
    }
    for (const field of ['hitpoints', 'attack', 'strength', 'defence']) assert(fields.has(field), `${name} required server field ${field}`);
    for (const [field, stat] of Object.entries(stats)) assert.equal(npc.stats[stat], Number(fields.get(field) ?? 1), `${name} source/packed ${field}`);
    for (const field of ['name', 'desc']) assert.equal(npc[field], fields.get(field), `${name} source/packed client ${field}`);
    assert.equal(npc.vislevel, Number(fields.get('vislevel')), `${name} source/packed visible level`);
    assert.equal(npc.params.size, params.size, `${name} source/packed parameter count`);
    for (const [param, value] of params) {
      const paramId = ParamType.getId(param);
      assert.notEqual(paramId, -1, `${name} native parameter ${param}`);
      let expected;
      if (value.startsWith('^')) {
        const constant = [...constants.matchAll(new RegExp(`^\\^${value.slice(1)}\\s*=\\s*(-?\\d+)\\s*$`, 'gm'))];
        assert.equal(constant.length, 1, `${name} named native constant ${value}`);
        expected = Number(constant[0][1]);
      } else if (['attack_anim', 'defend_anim'].includes(param)) expected = SeqType.getId(value);
      else if (param === 'attack_sound') expected = packedId(contentRoot, 'synth', value);
      else expected = Number(value);
      assert(Number.isInteger(expected), `${name} supported authored server parameter ${param}`);
      assert.equal(npc.params.get(paramId), expected, `${name} source/packed parameter ${param}`);
    }
    const expected = TUNNELS[name];
    if (expected) {
      for (const [field, stat] of Object.entries(stats)) {
        assert(fields.has(field), `${name} explicit ${field}`);
        assert.equal(npc.stats[stat], expected.stats[stat], `${name} selected ${field}`);
      }
      assert.equal(fields.get('huntmode'), 'aggressive_melee', `${name} authored all-level hunt policy`);
      assert.equal(npc.huntmode, packedId(contentRoot, 'hunt', 'aggressive_melee'), `${name} selected huntmode`);
      assert.equal(npc.huntrange, 4, `${name} BARROWS_HUNT_RADIUS`);
      for (const [field, value] of Object.entries({ defaultmode: 1, wanderrange: 5, maxrange: 7, attackrange: 0, regenrate: 100, givechase: true })) {
        assert.equal(npc[field], value, `${name} retained native ${field}`);
      }
      const selected = { attackrate: 4, damagetype: expected.style, attackbonus: 0, strengthbonus: 0, magicattack: 0, rangeattack: 0, rangebonus: 0,
        ...Object.fromEntries(['stabdefence', 'slashdefence', 'crushdefence', 'magicdefence', 'rangedefence'].map((key, index) => [key, expected.defence[index]])),
        ...(expected.maximum === undefined ? {} : { barrows_maxhit: expected.maximum }) };
      for (const [key, value] of Object.entries(selected)) {
        assert(params.has(key), `${name} explicit ${key}`);
        assert.equal(npc.params.get(ParamType.getId(key)), value, `${name} selected ${key}`);
      }
      for (const [key, value] of Object.entries({ retreat: -1, poison_severity: 0 })) {
        const param = ParamType.getByName(key);
        assert.equal(npc.params.get(param.id) ?? param.defaultInt, value, `${name} native ${key}`);
      }
      assert(!params.has('magicdamage'), `${name} zero magic-damage ledger adds no unused NPC parameter`);
    }
    for (const trigger of ['AI_TIMER', 'AI_QUEUE1', 'AI_QUEUE3']) {
      const script = ScriptProvider.getByTrigger(ServerTriggerType[trigger], id, npc.category);
      assert(script, `${name} resolved ${trigger}`);
      const ownedTimer = trigger === 'AI_TIMER';
      const death = trigger === 'AI_QUEUE3';
      assert.equal(script.name, ownedTimer || death ? `[${trigger.toLowerCase()},${name}]` : `[${trigger.toLowerCase()},_]`, `${name} unchanged owned timer/death and native queue binding`);
    }
  }
  console.log('PASS BC-01 thirteen authored blocks, no unpack duplicates, original IDs, source/packed server fields and timer/death/queue bindings');
  console.log('PASS BC-02 explicit seven-type skills, HP, bonuses, subtypes, caps, hunt policy/radius and retained native server values');

  if (baselinePack) {
    // Decode both actual packs in this process. Never register frozen old server values or script bytecode.
    const capture = dir => {
      NpcType.load(dir);
      assert(ScriptProvider.load(dir) > 0, `compiled scripts in ${dir}`);
      return NAMES.map(name => {
        const id = NpcType.getId(name);
        assert.notEqual(id, -1, `comparison pack NPC ${name}`);
        const npc = NpcType.get(id);
        const triggers = ['AI_TIMER', 'AI_QUEUE1', 'AI_QUEUE3'].map(trigger => {
          const script = ScriptProvider.getByTrigger(ServerTriggerType[trigger], id, npc.category);
          assert(script, `${name} comparison trigger ${trigger}`);
          return { trigger, name: script.name, opcodes: [...script.opcodes], intOperands: [...script.intOperands], stringOperands: [...script.stringOperands] };
        });
        return structuredClone({ npc, triggers });
      });
    };
    const baseline = capture(path.resolve(baselinePack));
    const moved = capture(packDir);
    assert.deepEqual(moved, baseline, 'same-run base/moved packs: every decoded client/server field, parameter, ID and resolved timer/death/queue script');
    console.log('PASS BC-01 same-run base/moved native pack comparison: all thirteen complete NPCs and 39 resolved trigger bodies equal');
  }
});
