#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const constantText = fs.readFileSync(path.join(runtime.contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant'), 'utf8');
  function classConstant(label) {
    const name = `barrows_door_class_${label}`;
    const definitions = [...constantText.matchAll(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'gm'))];
    assert.equal(definitions.length, 1, `one named class constant ${name}`);
    return Number(definitions[0][1]);
  }
  const { EnumType, NpcType } = runtime;
  const { makePlayer, procInt } = createRunner(runtime, { prefix: 'barrows_monsters' });
  const player = makePlayer('classes');
  function packedEnum(name) {
    const id = EnumType.getId(name);
    assert.notEqual(id, -1, `compiled S04 enum missing ${name}`);
    return EnumType.get(id);
  }
  const levels = packedEnum('barrows_monster_level');
  const expectedLevels = [
    ['barrows_rat', 43], ['barrows_bloodworm', 52], ['barrows_spider', 56],
    ['barrows_giantrat', 76], ['barrows_skeleton_unarmed', 77],
    ['barrows_skeleton_armed', 77], ['barrows_giantspider', 79]
  ];
  assert.equal(levels.values.size, expectedLevels.length, 'only all seven original ordinary monsters have level rows');
  for (const [name, level] of expectedLevels) {
    const id = NpcType.getId(name);
    assert.notEqual(id, -1, `original NPC missing ${name}`);
    assert.equal(levels.values.get(id), level, `${name} packed level join`);
    assert.equal(NpcType.get(id).vislevel, level, `${name} original packed visible level`);
  }
  assert.equal(levels.defaultInt, 0, 'unsupported ordinary types have no level credit');

  const classNpc = packedEnum('barrows_door_class_npc');
  const drawClass = packedEnum('barrows_door_draw_class');
  const knownClasses = new Map(['brother', 'skeleton', 'bloodworm', 'crypt_rat'].map(label => [label, classConstant(label)]));
  const noSpawn = classConstant('none');
  const expectedNpcs = new Map([
    [classConstant('skeleton'), NpcType.getId('barrows_skeleton_unarmed')],
    [classConstant('bloodworm'), NpcType.getId('barrows_bloodworm')],
    [classConstant('crypt_rat'), NpcType.getId('barrows_rat')]
  ]);
  assert.deepEqual(classNpc.values, expectedNpcs, 'only the three selected non-brother classes resolve to ordinary NPCs');
  assert.equal(classNpc.defaultInt, -1, 'unmapped classes select no NPC');
  assert.equal(drawClass.values.size, 128, 'the packed draw table is exhaustive');
  const counts = new Map([...knownClasses.keys()].map(label => [label, 0]));
  for (let draw = 0; draw < 128; draw++) {
    const expected = draw < 12 ? 'brother' : draw < 64 ? 'skeleton' : draw < 96 ? 'bloodworm' : 'crypt_rat';
    const label = drawClass.values.get(draw);
    assert.equal(label, expected, `exact packed draw ${draw}`);
    const classId = procInt(player, 'barrows_door_class', [label]);
    assert.equal(classId, knownClasses.get(label), `packed bridge for draw ${draw}`);
    if (label !== 'brother') assert.equal(classNpc.values.get(classId), expectedNpcs.get(classId), `draw ${draw} resolves to its selected NPC`);
    else assert.equal(classNpc.values.has(classId), false, 'the brother class never aliases an ordinary NPC');
    counts.set(label, counts.get(label) + 1);
  }
  assert.deepEqual([...counts.values()], [12, 52, 32, 32], 'exact class counts, not a statistical tolerance');
  for (const label of ['', 'unknown', 'Skeleton', 'barrows_ahrim']) {
    const classId = procInt(player, 'barrows_door_class', [label]);
    assert.equal(classId, noSpawn, 'unknown labels select the named no-spawn class');
    assert.equal(classNpc.values.get(classId) ?? classNpc.defaultInt, -1, 'unknown labels resolve to no NPC');
  }
  console.log('PASS S04 seven packed monster levels, all 128 draw-to-class bridges and no-spawn default');
});
