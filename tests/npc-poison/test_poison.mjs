#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function testOptions(argv) {
  const options = { selected: 'all' };
  const seen = new Set();
  for (let index = 2; index < argv.length; index++) {
    const [name, inlineValue] = argv[index].split(/=(.*)/s, 2);
    if (!['--case', '--content-root', '--engine-root'].includes(name)) throw new Error(`unknown option: ${argv[index]}`);
    assert.equal(seen.has(name), false, `${name} may be supplied once`);
    seen.add(name);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (name === '--case') {
      assert(['all', 'default', 'count', 'integrity'].includes(value), '--case must be all, default, count, or integrity');
      options.selected = value;
    } else {
      options[name === '--content-root' ? 'contentRoot' : 'engineRoot'] = value;
    }
  }
  return options;
}

function resolveRoots(options) {
  const contentRoot = path.resolve(options.contentRoot ?? path.resolve(HERE, '../..'));
  const engineRoot = path.resolve(options.engineRoot ?? process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine'));
  return { contentRoot, engineRoot, packDir: path.join(engineRoot, 'data/pack') };
}

async function loadRuntime(options) {
  const roots = resolveRoots(options);
  const scriptDat = path.join(roots.packDir, 'server/script.dat');
  assert(fs.existsSync(scriptDat), `missing compiled script.dat at ${scriptDat} — build the selected engine pack first`);
  const eng = relative => import(pathToFileURL(path.join(roots.engineRoot, relative)).href);
  const loadDefault = async relative => (await eng(relative)).default;
  const [World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType, VarBitType,
    VarNpcType, NpcType, DbRowType, DbTableType, DbTableIndex, ParamType, { EntityLifeCycle }, { BlockWalk }] = await Promise.all([
    loadDefault('src/engine/World.ts'),
    loadDefault('src/engine/entity/Player.ts'),
    loadDefault('src/engine/entity/Npc.ts'),
    loadDefault('src/engine/script/ScriptProvider.ts'),
    loadDefault('src/engine/script/ScriptRunner.ts'),
    loadDefault('src/engine/script/ScriptState.ts'),
    loadDefault('src/cache/config/VarPlayerType.ts'),
    loadDefault('src/cache/config/VarBitType.ts'),
    loadDefault('src/cache/config/VarNpcType.ts'),
    loadDefault('src/cache/config/NpcType.ts'),
    loadDefault('src/cache/config/DbRowType.ts'),
    loadDefault('src/cache/config/DbTableType.ts'),
    loadDefault('src/cache/config/DbTableIndex.ts'),
    loadDefault('src/cache/config/ParamType.ts'),
    eng('src/engine/entity/EntityLifeCycle.js'),
    eng('src/engine/entity/BlockWalk.js')
  ]);
  for (const config of [VarPlayerType, VarBitType, VarNpcType, NpcType, DbRowType, DbTableType, ParamType]) config.load(roots.packDir);
  DbTableIndex.init();
  assert(ScriptProvider.load(roots.packDir) > 0, `ScriptProvider.load found no compiled scripts in ${roots.packDir}`);
  return { ...roots, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState, VarNpcType, NpcType, EntityLifeCycle, BlockWalk };
}

function createFixture(runtime) {
  const { World, Player, Npc, NpcType, ScriptProvider, ScriptRunner, ScriptState, EntityLifeCycle, BlockWalk } = runtime;
  World.currentTick = 1;
  let nextUid = 8100;
  const spawned = [];
  function makePlayer(label, level = 0, x = 3200, z = 3200) {
    const player = new Player(`npc_poison_${label}`, 0n, 0n);
    player.uid = nextUid++;
    player.pid = player.uid;
    player.staffModLevel = 0;
    player.level = level;
    player.x = x;
    player.z = z;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    return player;
  }
  function call(player, key, args = [], target = null) {
    const script = ScriptProvider.getByName(key.startsWith('[') ? key : `[proc,${key}]`);
    assert(script, `compiled script is missing: ${key}`);
    const state = ScriptRunner.init(script, player, target, args);
    const execution = player.runScript(state, true, false);
    assert.equal(execution, ScriptState.FINISHED, `${key} must finish synchronously`);
    assert.equal(state.execution, ScriptState.FINISHED, `${key} must not suspend or abort`);
    assert.equal(player.delayed, false, `${key} must not leave a delay`);
    assert.equal(player.activeScript, null, `${key} must not attach a suspended script`);
    assert.equal(player.protect, false, `${key} must release protected access`);
    return state;
  }
  function procVoid(player, name, args = [], target = null) {
    const state = call(player, name, args, target);
    assert.equal(state.isp, 0, `${name} must return no ints`);
  }
  function addNpc(typeName, level, x, z) {
    const typeId = NpcType.getId(typeName);
    assert.notEqual(typeId, -1, `NPC type missing: ${typeName}`);
    const type = NpcType.get(typeId);
    const npc = new Npc(level, x, z, type.size, type.size, EntityLifeCycle.DESPAWN, World.getNextNid(), typeId, BlockWalk.NONE);
    World.addNpc(npc, -1);
    assert(npc.isActive, `World.addNpc did not activate ${typeName} at L${level}`);
    const row = { npc, nid: npc.nid };
    spawned.push(row);
    return row;
  }
  function removeFixtures() {
    for (const { npc, nid } of spawned) if (npc.isActive && World.getNpc(nid) === npc) World.removeNpc(npc, -1);
    spawned.length = 0;
  }
  return { makePlayer, procVoid, addNpc, removeFixtures };
}

async function run(main) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

await run(async () => {
  const options = testOptions(process.argv);
  const { selected } = options;
  const runtime = await loadRuntime(options);
  const { World, NpcType, VarNpcType, ScriptProvider } = runtime;
  const { NpcStatMap } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/NpcStat.ts')).href);
  const { default: ServerTriggerType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href);
  const runner = createFixture(runtime);
  const player = runner.makePlayer('tester', 3, 3200, 3200);
  const hp = NpcStatMap.get('HITPOINTS');
  const poison = VarNpcType.getId('npc_poison');
  const rat = NpcType.getId('rat');
  assert.notEqual(poison, -1, 'published npc_poison field exists');
  assert.notEqual(rat, -1, 'generic rat fixture exists');
  const ratType = NpcType.get(rat);
  const defaultTimer = ScriptProvider.getByName('[ai_timer,_]');
  assert(defaultTimer, 'published default NPC timer is compiled');
  assert.equal(
    ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, ratType.id, ratType.category),
    defaultTimer,
    'generic rat resolves to the published default AI_TIMER path'
  );

  function spawn(x = 3200, z = 3200) {
    const row = runner.addNpc('rat', 3, x, z);
    const npc = row.npc;
    npc.regenInterval = 100000;
    npc.regenClock = 0;
    return npc;
  }
  function seedHp(npc, value) {
    npc.levels[hp] = value;
    npc.baseLevels[hp] = value;
  }
  function turn(npc) {
    World.currentTick++;
    npc.lastTickX = npc.x;
    npc.lastTickZ = npc.z;
    npc.walkDir = npc.runDir = -1;
    npc.moveSpeed = npc.defaultMoveSpeed();
    npc.turn();
  }
  function requireCountedRuntime() {
    assert(ScriptProvider.getByName('[proc,npc_poison_counted_timer]'), 'compiled shared counted poison timer is required');
    const interval = VarNpcType.getId('npc_owned_timer_interval');
    const runs = VarNpcType.getId('npc_poison_timer_runs');
    assert.notEqual(interval, -1, 'shared owned-timer interval field exists');
    assert.notEqual(runs, -1, 'shared poison timer-run counter exists');
    return { interval, runs };
  }
  function countedRun(npc) {
    World.currentTick++;
    runner.procVoid(player, 'npc_poison_counted_timer', [1], npc);
  }

  function testDefaultTimer() {
    const npc = spawn();
    seedHp(npc, 1000);
    runner.procVoid(player, 'npc_poison_start', [20], npc);
    assert.equal(npc.getVar(poison), 20, 'native poison start publishes severity 20');
    assert.equal(npc.timerInterval, 30, 'unmarked NPC keeps the published 30-tick poison timer');
    const runs = VarNpcType.getId('npc_poison_timer_runs');
    let expectedHp = npc.levels[hp];
    let expectedSeverity = 20;
    for (let tick = 1; tick <= 600; tick++) {
      if (tick % 30 === 0) {
        expectedSeverity--;
        if (expectedSeverity > 0) expectedHp -= Math.floor((expectedSeverity + 4) / 5);
      }
      turn(npc);
      assert.equal(npc.getVar(poison), expectedSeverity, `default poison countdown after tick ${tick}`);
      assert.equal(npc.levels[hp], expectedHp, `default poison HP after tick ${tick}`);
      assert.equal(npc.timerInterval, expectedSeverity > 0 ? 30 : 0, `default timer interval after tick ${tick}`);
      if (runs !== -1) assert.equal(npc.getVar(runs), 0, `default AI_TIMER leaves the counted field untouched on tick ${tick}`);
    }
    assert.equal(expectedHp, 954, 'default severity-20 poison deals exactly the published total 46 damage');
    assert.equal(npc.getVar(poison), 0, 'default poison naturally ends on tick 600');
    assert.equal(npc.timerInterval, 0, 'default poison expiry keeps the published zero timer');
    console.log('PASS npc-poison default AI_TIMER: all 600 ticks, 46 damage, natural expiry, and no counted runs');
  }

  function testCountedTimer() {
    const { interval, runs } = requireCountedRuntime();
    const npc = spawn();
    seedHp(npc, 1000);
    npc.setVar(interval, 1);
    npc.setTimer(1);
    runner.procVoid(player, 'npc_poison_start', [20], npc);
    assert.equal(npc.getVar(poison), 20, 'native poison start records severity 20 for the counted NPC');
    assert.equal(npc.timerInterval, 1, 'native poison start preserves the owned one-tick timer');
    assert.equal(npc.getVar(runs), 0, 'stronger poison starts a fresh counted cadence');

    let expectedHp = npc.levels[hp];
    let expectedSeverity = 20;
    for (let tick = 1; tick <= 600; tick++) {
      if (tick % 30 === 0 && expectedSeverity > 0) {
        expectedSeverity--;
        if (expectedSeverity > 0) expectedHp -= Math.floor((expectedSeverity + 4) / 5);
      }
      countedRun(npc);
      assert.equal(npc.getVar(poison), expectedSeverity, `counted poison severity after timer run ${tick}`);
      assert.equal(npc.levels[hp], expectedHp, `counted poison HP after timer run ${tick}`);
      assert.equal(npc.timerInterval, 1, `counted helper reasserts interval 1 on timer run ${tick}`);
      assert.equal(npc.getVar(runs), expectedSeverity > 0 ? tick : 0, `counted helper records timer run ${tick}`);
    }
    assert.equal(npc.getVar(poison), 0, 'counted poison ends on run 600');
    assert.equal(npc.levels[hp], 954, 'counted cadence deals exactly the published total 46 damage');
    assert.equal(npc.timerInterval, 1, 'poison end preserves the caller timer');
    assert.equal(npc.getVar(runs), 0, 'poison end resets the counted cadence');
    countedRun(npc);
    assert.equal(npc.getVar(poison), 0, 'later timer runs do not restart poison');
    assert.equal(npc.levels[hp], 954, 'later timer runs do not deal poison damage');
    assert.equal(npc.getVar(runs), 0, 'unpoisoned timer runs keep the counter clear');
    assert.equal(npc.timerInterval, 1, 'unpoisoned counted helper continues the caller timer');

    const lethal = spawn(3201, 3200);
    seedHp(lethal, 4);
    lethal.setVar(interval, 1);
    lethal.setTimer(1);
    runner.procVoid(player, 'npc_poison_start', [20], lethal);
    for (let tick = 1; tick <= 30; tick++) countedRun(lethal);
    assert.equal(lethal.getVar(poison), 19, 'lethal counted step still performs the published countdown');
    assert.equal(lethal.levels[hp], 0, 'published severity-19 poison damage kills the 4-HP NPC');
    const queues = Array.from(lethal.queue.all());
    assert.equal(queues.length, 1, 'lethal poison schedules exactly one NPC queue');
    assert.equal(queues[0].queueId, ServerTriggerType.AI_QUEUE3, 'lethal poison schedules the published queue3');
    assert.equal(queues[0].delay, 0, 'lethal poison preserves the published queue3 delay');
    assert.equal(lethal.timerInterval, 1, 'lethal counted step preserves the caller timer');
    console.log('PASS npc-poison counted timer: damage every 30 runs through poison end and lethal queue3');
  }

  function testTimerIntegrity() {
    const { interval, runs } = requireCountedRuntime();
    const npc = spawn(3202, 3200);
    seedHp(npc, 1000);
    npc.setVar(interval, 1);
    npc.setTimer(1);
    npc.setVar(runs, 9);
    runner.procVoid(player, 'npc_poison_start', [20], npc);
    assert.equal(npc.getVar(poison), 20, 'native counted start accepts stronger poison');
    assert.equal(npc.timerInterval, 1, 'native counted start does not replace the one-tick interval with 30');
    assert.equal(npc.getVar(runs), 0, 'native stronger-poison start resets the counted cadence');

    countedRun(npc);
    assert.equal(npc.getVar(runs), 1, 'first counted callback records one timer run');
    npc.setTimer(30);
    countedRun(npc);
    assert.equal(npc.timerInterval, 1, 'counted callback repairs a timer changed to 30');
    assert.equal(npc.getVar(runs), 2, 'timer repair is still one counted callback');
    npc.setTimer(0);
    countedRun(npc);
    assert.equal(npc.timerInterval, 1, 'counted callback repairs a timer changed to 0');
    assert.equal(npc.getVar(runs), 3, 'zero-timer repair is still one counted callback');

    runner.procVoid(player, 'npc_poison_start', [20], npc);
    assert.equal(npc.getVar(runs), 3, 'equal poison does not restart the cadence');
    runner.procVoid(player, 'npc_poison_start', [21], npc);
    assert.equal(npc.getVar(poison), 21, 'stronger native poison replaces the severity');
    assert.equal(npc.timerInterval, 1, 'stronger native poison still preserves the one-tick interval');
    assert.equal(npc.getVar(runs), 0, 'stronger native poison restarts the counted cadence');
    for (let tick = 1; tick < 30; tick++) {
      countedRun(npc);
      assert.equal(npc.getVar(poison), 21, `stronger poison waits through counted run ${tick}`);
      assert.equal(npc.getVar(runs), tick, `stronger poison cadence count ${tick}`);
    }
    countedRun(npc);
    assert.equal(npc.getVar(poison), 20, 'stronger poison first damage countdown occurs on its run 30');
    assert.equal(npc.levels[hp], 996, 'stronger poison keeps the published severity-20 damage formula');

    runner.procVoid(player, 'npc_poison_clear', [], npc);
    assert.equal(npc.getVar(poison), 0, 'native opted-in clear ends poison');
    assert.equal(npc.timerInterval, 1, 'native opted-in clear preserves the owner interval instead of stopping it');
    assert.equal(npc.getVar(runs), 0, 'native opted-in clear resets the counted cadence');
    npc.setTimer(0);
    countedRun(npc);
    assert.equal(npc.timerInterval, 1, 'unpoisoned helper repairs a zero timer after native clear');
    assert.equal(npc.getVar(runs), 0, 'unpoisoned repair leaves the counter at zero');
    console.log('PASS npc-poison timer integrity: opted-in start/clear, stronger resets, and 30/0 repair');
  }

  try {
    if (selected === 'all' || selected === 'default') testDefaultTimer();
    if (selected === 'all' || selected === 'count') testCountedTimer();
    if (selected === 'all' || selected === 'integrity') testTimerIntegrity();
  } finally {
    runner.removeFixtures();
  }
});
