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
// Operator decisions 2026-11-16: a compatible published same-model donor supplies combat
// animations and sounds first; where none carries a field, the type's own family does (the
// prefix and frame base of its own walk/ready, moving only labels its model has), a weaker
// CANDIDATE basis. The skeletons' own family is human_*: only donor sounds are bound. The pack
// names no bloodworm sound. An absent key resolves the native default.
const PRESENTATION = {
  barrows_bloodworm: { attack_anim: 'bloodworm_attack', defend_anim: 'bloodworm_block', death_anim: 'bloodworm_death' },
  barrows_rat: { attack_anim: 'rat_attack', defend_anim: 'rat_block', death_anim: 'rat_death', attack_sound: 'rat_attack', defend_sound: 'rat_hit', death_sound: 'rat_death' },
  barrows_giantrat: { attack_anim: 'giantrat_attack', defend_anim: 'giantrat_block', death_anim: 'giantrat_death', attack_sound: 'rat_attack', defend_sound: 'rat_hit', death_sound: 'rat_death' },
  barrows_spider: { attack_anim: 'spider_attack', defend_anim: 'spider_block', death_anim: 'spider_death', attack_sound: 'insect_attack', defend_sound: 'insect_hit', death_sound: 'insect_death' },
  barrows_giantspider: { attack_anim: 'giantspider_attack', defend_anim: 'giantspider_block', death_anim: 'giantspider_death', attack_sound: 'insect_attack', defend_sound: 'insect_hit', death_sound: 'insect_death' },
  barrows_skeleton_unarmed: { attack_sound: 'skeleton_attack', defend_sound: 'skelly_hit', death_sound: 'skeleton_death' },
  barrows_skeleton_armed: { attack_sound: 'skeleton_attack', defend_sound: 'skelly_hit', death_sound: 'skeleton_death' }
};
// Published same-model donors; keys listed in FAMILY have none and use the own family.
const DONORS = { barrows_bloodworm: [], barrows_rat: ['witchrat'], barrows_giantrat: ['giantrat'], barrows_spider: ['spider'], barrows_giantspider: ['giantspider1'],
  barrows_skeleton_unarmed: ['dragonslayer_skeleton'], barrows_skeleton_armed: ['dragonslayer_skeleton'] };
const FAMILY = { barrows_bloodworm: ['attack_anim', 'defend_anim', 'death_anim'], barrows_rat: ['attack_anim', 'defend_anim', 'attack_sound', 'defend_sound'] };
const PRESENTATION_KEYS = ['attack_anim', 'defend_anim', 'death_anim', 'attack_sound', 'defend_sound', 'death_sound'];

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
  const [{ default: ServerTriggerType }, { default: SeqType }, { default: AnimFrame }, { default: AnimBase }, { default: Model }] = await Promise.all([
    eng('src/engine/script/ServerTriggerType.ts'), eng('src/cache/config/SeqType.ts'), eng('src/cache/graphics/AnimFrame.ts'), eng('src/cache/graphics/AnimBase.ts'),
    eng('src/cache/graphics/Model.ts')
  ]);
  SeqType.load(packDir);
  // Frame bases are decoded from the authored animation sets, as the client applies them.
  const modelsDir = path.join(contentRoot, 'models');
  for (const file of fs.readdirSync(modelsDir).filter(file => /^anim_\d+\.anim$/.test(file))) AnimFrame.unpack(fs.readFileSync(path.join(modelsDir, file)));
  const frameBase = frame => {
    const base = AnimBase.instances[AnimFrame.instances[frame].base];
    return JSON.stringify({ types: Array.from(base.types), labels: base.labels.map(labels => Array.from(labels)) });
  };
  const sequenceBases = seq => [...new Set([...SeqType.get(seq).frames].filter(frame => frame >= 0).map(frameBase))];
  const presentationValue = (key, value) => key.endsWith('_anim') ? SeqType.getId(value) : packedId(contentRoot, 'synth', value);
  // Moved-label test (BC-M2): every non-identity transform group of every frame must move at
  // least one vertex label (face label for alpha) that the type's own models carry.
  const modelFiles = new Map();
  const walkModels = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walkModels(full); else if (entry.name.endsWith('.ob2')) modelFiles.set(entry.name.slice(0, -4), full); } };
  walkModels(modelsDir);
  const modelNames = new Map(fs.readFileSync(path.join(contentRoot, 'pack/model.pack'), 'utf8').split('\n').map(line => /^(\d+)=(.+)$/.exec(line)).filter(Boolean).map(match => [Number(match[1]), match[2]]));
  const carriedLabels = npc => {
    const vertex = new Set(), face = new Set();
    for (const id of npc.models) {
      Model.unpack(id, fs.readFileSync(modelFiles.get(modelNames.get(id))));
      const model = Model.fromId(id);
      for (let i = 0; i < model.vertexCount; i++) if ((model.vertexLabel?.[i] ?? -1) >= 0) vertex.add(model.vertexLabel[i]);
      for (let i = 0; i < model.faceCount; i++) if ((model.faceLabel?.[i] ?? -1) >= 0) face.add(model.faceLabel[i]);
    }
    return { vertex, face };
  };
  const identityTransform = (type, x, y, z) => type === 2 ? [x, y, z].every(value => (value & 255) === 0) : type === 3 ? x === 128 && y === 128 && z === 128 : type === 5 ? x === 0 : x === 0 && y === 0 && z === 0;
  const lostGroups = (npc, seq) => {
    const carried = carriedLabels(npc);
    let lost = 0;
    for (const id of [...SeqType.get(seq).frames].filter(frame => frame >= 0)) {
      const frame = AnimFrame.instances[id], base = AnimBase.instances[frame.base];
      for (let i = 0; i < frame.groups.length; i++) {
        const group = frame.groups[i], type = base.types[group];
        if (type === 0 || identityTransform(type, frame.x[i], frame.y[i], frame.z[i])) continue;
        if (![...base.labels[group]].some(label => (type === 5 ? carried.face : carried.vertex).has(label))) lost++;
      }
    }
    return lost;
  };
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
      } else if (['attack_anim', 'defend_anim', 'death_anim'].includes(param)) expected = SeqType.getId(value);
      else if (['attack_sound', 'defend_sound', 'death_sound', 'rangeattack_sound'].includes(param)) expected = packedId(contentRoot, 'synth', value);
      else if (['proj_launch', 'proj_travel'].includes(param)) expected = packedId(contentRoot, 'spotanim', value);
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
      assert(!fields.has('huntmode'), `${name} authored huntless type default`);
      assert.equal(npc.huntmode, -1, `${name} reset-safe huntmode`);
      assert.equal(fields.get('timer'), '1', `${name} authored reset-safe timer`);
      assert.equal(npc.timer, 1, `${name} reset-safe timer`);
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
      const presentation = PRESENTATION[name];
      assert(presentation, `${name} explicit presentation decision`);
      const ownBases = [npc.walkanim, npc.readyanim].filter(seq => seq >= 0).flatMap(sequenceBases);
      assert.equal(new Set(ownBases).size, 1, `${name} walk and ready sequences share one frame base`);
      // The own family is the name prefix shared by the type's own walk and ready sequences.
      const ownNames = [npc.walkanim, npc.readyanim].filter(seq => seq >= 0).map(seq => SeqType.get(seq).debugname);
      const prefix = ownNames.map(name => name.slice(0, name.indexOf('_') + 1)).reduce((a, b) => a === b ? a : '');
      for (const key of PRESENTATION_KEYS) {
        const param = ParamType.getByName(key);
        if (!(key in presentation)) {
          assert(!params.has(key), `${name} binds no ${key} without a compatible published donor`);
          continue;
        }
        const value = presentationValue(key, presentation[key]);
        assert(Number.isInteger(value) && value >= 0, `${name} packed ${key} ${presentation[key]}`);
        assert(params.has(key), `${name} explicit ${key}`);
        assert.equal(npc.params.get(param.id), value, `${name} selected ${key} ${presentation[key]}`);
        const sameModel = DONORS[name].map(donor => NpcType.get(NpcType.getId(donor))).filter(donor => donor.models[0] === npc.models[0]);
        assert.equal(sameModel.length, DONORS[name].length, `${name} donors share its model`);
        if ((FAMILY[name] ?? []).includes(key)) {
          // Own family: no published same-model donor carries this field; the value has the family prefix.
          assert(!sameModel.some(donor => donor.params?.has(param.id)), `${name} ${key}: a published same-model donor comes first`);
          assert(prefix && presentation[key].startsWith(prefix), `${name} ${key} ${presentation[key]} is of the own ${prefix} family`);
        } else {
          assert(sameModel.some(donor => donor.params?.get(param.id) === value), `${name} ${key} ${presentation[key]} is bound by a published same-model donor`);
        }
        if (key.endsWith('_anim')) {
          assert.deepEqual(sequenceBases(value), [ownBases[0]], `${name} ${key} ${presentation[key]} frame base equals its walk/ready base`);
          assert.equal(lostGroups(npc, value), 0, `${name} ${key} ${presentation[key]} moves only labels its models carry`);
        }
      }
    }
    for (const trigger of ['AI_TIMER', 'AI_QUEUE1', 'AI_QUEUE3']) {
      const script = ScriptProvider.getByTrigger(ServerTriggerType[trigger], id, npc.category);
      assert(script, `${name} resolved ${trigger}`);
      const ownedTimer = trigger === 'AI_TIMER';
      const death = trigger === 'AI_QUEUE3';
      const approach = [3, 4].includes(npc.params.get(ParamType.getId('damagetype')) ?? ParamType.getByName('damagetype').defaultInt);
      assert.equal(script.name, ownedTimer || death || approach ? `[${trigger.toLowerCase()},${name}]` : `[${trigger.toLowerCase()},_]`, `${name} owned timer/death and style-selected native retaliation binding`);
    }
  }
  console.log('PASS BC-01 thirteen authored blocks, no unpack duplicates, original IDs, source/packed server fields and timer/death/queue bindings');
  console.log('PASS BC-02 explicit seven-type skills, HP, bonuses, subtypes, caps, hunt policy/radius and retained native server values');
  // Compatibility proofs behind the unbound keys.
  const humanBase = sequenceBases(SeqType.getId('human_ready'));
  for (const seq of ['skeleton_attack', 'skeleton_block', 'skeleton_death']) {
    assert.notDeepEqual(sequenceBases(SeqType.getId(seq)), humanBase, `${seq} uses another frame base than the skeletons' human_ready`);
  }
  const bloodworm = NpcType.get(NpcType.getId('barrows_bloodworm'));
  const bloodwormSeqs = ['bloodworm_attack', 'bloodworm_block', 'bloodworm_death'].map(seq => SeqType.getId(seq));
  for (let id = 0; id < NpcType.count; id++) {
    const other = NpcType.get(id);
    if (!other || other.debugname === 'barrows_bloodworm') continue;
    assert(!(other.models ?? []).includes(bloodworm.models[0]), `no published ${other.debugname} shares the bloodworm model`);
    for (const key of ['attack_anim', 'defend_anim', 'death_anim']) {
      assert(!bloodwormSeqs.includes(other.params?.get(ParamType.getByName(key).id)), `no published ${other.debugname} binds a bloodworm sequence`);
    }
  }
  // The moved-label test separates: the human defaults move labels the crypt rat lacks.
  const rat = NpcType.get(NpcType.getId('barrows_rat'));
  for (const seq of ['human_unarmedpunch', 'human_unarmed_def', 'human_death']) assert(lostGroups(rat, SeqType.getId(seq)) > 0, `${seq} moves labels the crypt rat model lacks`);
  console.log('PASS BC-02 animations/sounds: explicit packed values, same-model donors first, own-family prefix otherwise, equal frame bases and moved-label tests; skeleton sequences and bloodworm donors absent');

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
