import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// All observers call the real VM handlers. Only the RNG stream and the isolated
// actors' initial state are controlled. No combat calculation is implemented here.
export async function runtime(engine, pack) {
  const load = name => import(pathToFileURL(path.join(engine, name)).href);
  const World = (await load('src/engine/World.ts')).default;
  const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
  const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
  const State = (await load('src/engine/script/ScriptState.ts')).default;
  const Pointer = (await load('src/engine/script/ScriptPointer.ts')).default;
  const { ScriptOpcode: op, ScriptOpcodeNameMap } = await load('src/engine/script/ScriptOpcode.ts');
  const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
  const Npc = (await load('src/engine/entity/Npc.ts')).default;
  const Player = (await load('src/engine/entity/Player.ts')).default;
  const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
  const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
  const Environment = (await load('src/util/Environment.ts')).default;
  const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
  const configs = {};
  for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(pack);
  }
  (await load('src/cache/config/DbTableIndex.ts')).default.init();
  const id = (type, name) => { const value = type.getId(name); assert(value >= 0, `packed ${name}`); return value; };
  const { NpcType, ParamType, VarPlayerType, VarNpcType, InvType, DbRowType, DbTableType } = configs;
  const param = (npc, name) => { const p = ParamType.getByName(name); assert(p, name); return ParamHelper.getIntParam(p.id, npc, p.defaultInt); };
  const table = DbTableType.getByName('magic_spell_table');
  const spell = name => { const row = DbRowType.getByName(`magic_spell_${name}`); assert(row, name); return row; };
  const field = (row, name) => { const col = table.columnNames.indexOf(name); assert(col >= 0, name); return row.getValue(col, 0)[0]; };
  Environment.NODE_MEMBERS = true;
  Environment.NODE_DEBUG_PROFILE = false;
  const books = new Set(['PUSH_CONSTANT_INT', 'PUSH_CONSTANT_STRING', 'PUSH_INT_LOCAL', 'POP_INT_LOCAL', 'PUSH_STRING_LOCAL', 'POP_STRING_LOCAL', 'POP_INT_DISCARD', 'POP_STRING_DISCARD', 'GOSUB', 'GOSUB_WITH_PARAMS', 'JUMP', 'JUMP_WITH_PARAMS', 'RETURN', 'BRANCH']);
  const scriptReferenceOps = new Set(['QUEUE', 'QUEUEVARARG', 'STRONGQUEUE', 'STRONGQUEUEVARARG', 'WEAKQUEUE', 'WEAKQUEUEVARARG', 'LONGQUEUE', 'LONGQUEUEVARARG', 'SETTIMER', 'SOFTTIMER', 'CLEARTIMER', 'CLEARSOFTTIMER', 'GETTIMER', 'WALKTRIGGER'].map(name => op[name]));
  let active = null;
  for (const method of ['popInt', 'popString', 'pushInt', 'pushString']) {
    const original = State.prototype[method];
    State.prototype[method] = function (...args) {
      const result = original.apply(this, args);
      if (active?.current) active.current[method.startsWith('pop') ? 'in' : 'out'].push(method.startsWith('pop') ? result : args[0]);
      return result;
    };
  }
  for (const [opcode, original] of Object.entries(Runner.HANDLERS)) {
    const name = ScriptOpcodeNameMap.get(Number(opcode));
    Runner.HANDLERS[opcode] = state => {
      if (!active) return original(state);
      const location = { script: state.script.name, file: state.script.info.sourceFilePath, line: state.script.lineNumber(state.pc) };
      active.visited.add(location.script);
      active.commands[name] = (active.commands[name] ?? 0) + 1;
      const event = books.has(name) ? null : { op: name, in: [], out: [] };
      if (event && /^(PUSH|POP)_VAR/.test(name)) event.variable = state.intOperand;
      active.current = event;
      try { original(state); }
      catch (error) { active.error = { op: name, message: error.message }; throw error; }
      finally {
        if (event) {
          // These handlers pop their typed script ID last. Clean pack builds
          // renumber scripts; compare the actual referenced name, not that ID.
          // Other integers (including damage, coordinates and actor IDs) stay exact.
          if (scriptReferenceOps.has(Number(opcode))) {
            const slot = event.in.length - 1, target = Provider.get(event.in[slot]);
            if (target) event.in[slot] = target.name;
          }
          if (Number(opcode) === op.GETWALKTRIGGER) {
            const target = Provider.get(event.out[0]);
            if (target) event.out[0] = target.name;
          }
          active.events.push(event);
        }
        active.current = null;
      }
    };
  }
  const packs = new Map();
  function select(directory) {
    if (!packs.has(directory)) {
      assert(Provider.load(directory) > 0, `real script pack ${directory}`);
      packs.set(directory, { scripts: Provider.scripts, scriptNames: Provider.scriptNames, scriptLookup: Provider.scriptLookup });
    }
    Object.assign(Provider, packs.get(directory));
  }
  select(pack);
  function fixture(type, variant = 'hit', style = 'melee', distance = 1) {
    World.currentTick = 100;
    const previous = World.players[1];
    if (previous) previous.unlink();
    const player = new Player('outcomevm', 1001n, 100001n);
    player.slot = 1; player.pid = 1; player.uid = (1001 << 11) | 1;
    player.x = 3500; player.z = 3500; player.level = 0; player.isActive = true;
    player.vars.fill(0); player.baseLevels.fill(80); player.levels.fill(80); player.stats.fill(0);
    player.baseLevels[3] = 255; player.levels[3] = 255;
    player.getInventory(id(InvType, 'worn')); player.getInventory(id(InvType, 'inv'));
    player.testMessages = [];
    player.write = () => {};
    player.messageGame = text => player.testMessages.push(String(text));
    player.wrappedMessageGame = player.messageGame;
    World.players[1] = player; World.playerLoop.add(player.hash64, player);
    const config = NpcType.getByName(type); assert(config, type);
    const npc = new Npc(0, player.x + distance, player.z, config.size, config.size, EntityLifeCycle.RESPAWN, 1, config.id, config.blockwalk);
    World.addNpc(npc, -1); npc.lastMovement = -100;
    npc.setVar(id(VarNpcType, 'npc_aggressive_player'), player.uid);
    if (variant.startsWith('protected')) player.setVar(id(VarPlayerType, style === 'melee' ? 'prayer14' : style === 'ranged' ? 'prayer13' : 'prayer12'), 1);
    if (variant === 'pending') npc.setVar(id(VarNpcType, 'npc_action_delay'), 110);
    if (variant === 'target-loss') {
      npc.setVar(id(VarNpcType, 'npc_lastcombat'), 100);
      npc.setVar(id(VarNpcType, 'npc_attacking_uid'), player.uid + 1);
      player.setVar(id(VarPlayerType, 'lastcombat'), 100);
      player.setVar(id(VarPlayerType, 'aggressive_npc'), npc.uid + 1);
    }
    if (variant === 'dead-npc') npc.levels[3] = 0;
    if (variant === 'dead-player') { player.levels[3] = 0; player.setVar(id(VarPlayerType, 'death'), 1); }
    return { player, npc };
  }
  function run(name, f, args = []) {
    const script = Provider.getByName(name); assert(script, name);
    const state = Runner.init(script, f.npc, f.player, args);
    state.pointerAdd(Pointer.ProtectedActivePlayer);
    f.npc.executeScript(state);
    return { state, values: state.intStack.slice(0, state.isp) };
  }
  function observe(name, f, args = [], variant = 'hit') {
    const tape = { events: [], draws: [], randomSources: [], commands: {}, visited: new Set(), error: null, current: null };
    let cursor = 0, seed = 0x377bc00;
    const originalRandom = JavaRandom.nextDouble;
    const originalMathRandom = Math.random;
    let engineSeed = 0x377bc01;
    // MAP_FINDSQUARE uses Math.random, independently of script RANDOM/INC.
    Math.random = () => {
      engineSeed ^= engineSeed << 13; engineSeed ^= engineSeed >>> 17; engineSeed ^= engineSeed << 5;
      const value = (engineSeed >>> 0) / 4294967296;
      tape.randomSources.push({ source: 'Math.random', value }); return value;
    };
    JavaRandom.nextDouble = () => {
      let value;
      if (cursor === 0) value = variant.endsWith('miss') ? 0 : 0.999999;
      else if (cursor === 1) value = variant.endsWith('miss') ? 0.999999 : 0;
      else if (cursor === 2) value = variant.endsWith('zero') ? 0 : 0.999999;
      else { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; value = (seed >>> 0) / 4294967296; }
      cursor++; tape.draws.push(value); tape.randomSources.push({ source: 'JavaRandom.nextDouble', value }); return value;
    };
    const errors = [], originalError = console.error;
    console.error = (...values) => errors.push(values.join(' '));
    active = tape;
    let result;
    try { result = run(name, f, args); }
    finally { active = null; JavaRandom.nextDouble = originalRandom; Math.random = originalMathRandom; console.error = originalError; }
    const queued = [...f.player.queue.all()].map(q => ({ script: q.script.name, args: [...q.args], delay: q.delay, type: q.type }));
    const snapshot = {
      execution: result.state.execution, error: tape.error,
      levels: [...f.player.levels], experience: [...f.player.stats], energy: f.player.runenergy,
      playerVars: [...f.player.vars], npcVars: [...f.npc.vars], npcLevels: [...f.npc.levels],
      mode: f.npc.mode, npcLifeCycle: f.npc.lifeCycle, playerProtected: f.player.protect,
      pointers: result.state.pointers, queued, messages: [...f.player.testMessages]
    };
    return { values: result.values, snapshot, events: tape.events, draws: tape.draws, randomSources: tape.randomSources, commands: tape.commands, opcount: result.state.opcount, visited: [...tape.visited], errors };
  }
  function settle(f, ticks = 6) {
    const tape = { events: [], draws: [], randomSources: [], commands: {}, visited: new Set(), error: null, current: null };
    const real = JavaRandom.nextDouble, realMath = Math.random;
    JavaRandom.nextDouble = () => { tape.draws.push(0); tape.randomSources.push({ source: 'JavaRandom.nextDouble', value: 0 }); return 0; };
    Math.random = () => { tape.randomSources.push({ source: 'Math.random', value: 0 }); return 0; };
    active = tape;
    try { for (let i = 0; i < ticks; i++) { World.currentTick++; f.player.processQueues(); } }
    finally { active = null; JavaRandom.nextDouble = real; Math.random = realMath; }
    return { levels: [...f.player.levels], experience: [...f.player.stats], energy: f.player.runenergy, vars: [...f.player.vars], messages: [...f.player.testMessages], events: tape.events, randomSources: tape.randomSources, error: tape.error };
  }
  function dispose() {
    for (const npc of [...World.npcs]) {
      const nid = npc.nid;
      World.removeNpc(npc, -1);
      World.npcs.remove(nid);
      if (npc.nid >= 0) npc.cleanup();
    }
  }
  function inventory(content, watched) {
    const scripts = fs.readFileSync(path.join(content, 'pack/script.pack'), 'utf8').trim().split(/\r?\n/).map(line => Provider.get(Number(line.slice(0, line.indexOf('='))))).filter(Boolean);
    const dynamic = new Set();
    const edges = new Map(scripts.map(script => [script.name, script.opcodes.flatMap((code, pc) => {
      let target;
      if ([op.GOSUB_WITH_PARAMS, op.JUMP_WITH_PARAMS].includes(code)) target = Provider.get(script.intOperands[pc]);
      if ([op.GOSUB, op.JUMP].includes(code)) {
        if (script.opcodes[pc - 1] === op.PUSH_CONSTANT_INT) target = Provider.get(script.intOperands[pc - 1]);
        else dynamic.add(script.name);
      }
      return target ? [target.name] : [];
    })]));
    const memo = new Map();
    function closure(name, seen = new Set()) {
      if (memo.has(name)) { for (const value of memo.get(name)) seen.add(value); return seen; }
      if (seen.has(name)) return seen;
      seen.add(name);
      for (const target of edges.get(name) ?? []) closure(target, seen);
      return seen;
    }
    const names = fs.readFileSync(path.join(content, 'pack/npc.pack'), 'utf8').trim().split(/\r?\n/).map(line => NpcType.get(Number(line.slice(0, line.indexOf('='))))).filter(n => n?.debugname);
    const npcs = names.flatMap(npc => {
      const entries = [];
      for (const trigger of ['AI_OPPLAYER2', 'AI_APPLAYER2']) {
        const script = Provider.getByTrigger(Trigger[trigger], npc.id, npc.category);
        if (!script) continue;
        const reachable = closure(script.name); memo.set(script.name, new Set(reachable));
        const paths = watched.filter(name => reachable.has(`[proc,${name}]`));
        if (!paths.length) continue;
        assert(![...reachable].some(name => dynamic.has(name)), `unresolved dynamic attack call for ${npc.debugname} ${script.name}`);
        entries.push({ trigger, script: script.name, paths, reachable: [...reachable] });
      }
      return entries.length ? [{ npc: npc.debugname, poison: param(npc, 'poison_severity'), entries }] : [];
    });
    const externalCallers = Object.fromEntries(watched.map(name => [name, scripts.filter(script => !script.info.sourceFilePath.startsWith('scripts/skill_combat/scripts/npc/') && (edges.get(script.name) ?? []).includes(`[proc,${name}]`)).map(script => script.name).sort()]).filter(([, callers]) => callers.length));
    return { npcs, externalCallers, scripts, edges };
  }
  return { World, Provider, State, Pointer, configs, id, param, spell, field, select, fixture, run, observe, settle, dispose, inventory };
}
