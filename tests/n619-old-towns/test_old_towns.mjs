// Production packed NPC dispatch and Continue/choice packets. No server or vault reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(content, '../engine');
process.chdir(engine);
const load = async name => (await import(pathToFileURL(path.join(engine, 'src', name)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const Trigger = await load('engine/script/ServerTriggerType.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const IfSetAnim = await load('network/game/server/model/IfSetAnim.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
const { NpcModeMap } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcMode.ts')).href);
const cfg = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'NpcType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType']) {
  cfg[name] = await load(`cache/config/${name}.ts`);
  cfg[name].load('data/pack');
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load('data/pack') > 0);
const { NpcType, VarPlayerType, Component } = cfg;
const pause = new ResumePauseButtonHandler();
const normalize = text => text.replace(/<[^>]*>/g, '').replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
const placements = new Map();
for (const file of fs.readdirSync(path.join(content, 'maps')).filter(x => /^m\d+_\d+\.jm2$/.test(x))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  let section = '';
  for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('NPC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+)$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match;
    const rows = placements.get(+type) ?? [];
    rows.push({ level: +level, x: +mx * 64 + +x, z: +mz * 64 + +z });
    placements.set(+type, rows);
  }
}
function serviceResult(packets, player) {
  if (player.modalMain === -1) return null;
  const name = Component.get(player.modalMain)?.comName;
  assert(['tanner', 'shop_template'].includes(name), `unexpected service interface ${name}`);
  const sideName = name === 'shop_template' ? 'shop_template_side' : undefined;
  assert.equal(player.modalMain, Component.getId(name), 'exact native main interface');
  assert.equal(player.modalSide, sideName ? Component.getId(sideName) : -1, 'exact native side interface');
  assert.equal(player.refreshModal, true, 'native interface open awaits the network output phase');
  // Base Player has no network output phase. Prove native modal state and VM widget
  // packets here against unchanged Trade; the open packet itself needs the headed receipt.
  const updates = packets.filter(packet => {
    const component = Component.get(packet.component ?? packet.main)?.comName;
    return component === name || component?.startsWith(`${name}:`) || (sideName && (component === sideName || component?.startsWith(`${sideName}:`)));
  }).map(packet => ({ type: packet.constructor.name, ...packet }));
  const variables = {};
  if (name === 'shop_template') for (const key of ['shop', 'shop_buy', 'shop_sell', 'shop_haggle']) {
    const id = VarPlayerType.getId(key); assert(id >= 0);
    assert.equal(VarPlayerType.get(id).scope, VarPlayerType.SCOPE_TEMP, `${key}: only session state`);
    variables[key] = player.vars[id];
  }
  return { name, modalMain: player.modalMain, modalSide: player.modalSide, refreshModal: player.refreshModal, updates, variables };
}
function pages(packets) {
  const result = [];
  let current, animation;
  const finish = () => { if (current) result.push(current); current = null; };
  for (const packet of packets) {
    if (packet instanceof MessageGame) {
      finish(); result.push({ kind: 'message', speaker: 'game', lines: [packet.msg] }); continue;
    }
    if (packet instanceof IfSetAnim && /^(npcchat|chat)[1-4]:com_0$/.test(Component.get(packet.component)?.comName)) {
      animation = packet.seq; continue;
    }
    if (!(packet instanceof IfSetText)) continue;
    const component = Component.get(packet.component)?.comName;
    if (component?.startsWith('tanner:') || component?.startsWith('shop_template:')) continue;
    let match = /^(npcchat|chat)([1-4]):com_([1-5])$/.exec(component);
    if (match) {
      if (+match[3] === 1) {
        finish(); current = { kind: 'speech', speaker: match[1] === 'npcchat' ? 'npc' : 'player', name: packet.text, animation, lines: [] };
      } else {
        assert.equal(current?.kind, 'speech', `speech without header: ${component}`);
        current.lines.push(packet.text);
      }
      continue;
    }
    match = /^(multi[2-5]):com_([0-5])$/.exec(component);
    if (match) {
      if (+match[2] === 0) { finish(); current = { kind: 'menu', options: [] }; }
      else { assert.equal(current?.kind, 'menu'); current.options.push(packet.text); }
      continue;
    }
    // Message boxes are still checked against retained source text, not ignored.
    finish(); result.push({ kind: 'speech', speaker: 'game', lines: [packet.text] });
  }
  finish();
  return result;
}
function inventorySnapshot(player, name) {
  const counts = new Map();
  for (const item of player.getInventory(cfg.InvType.getId(name)).items) if (item) counts.set(item.id, (counts.get(item.id) ?? 0) + item.count);
  return counts;
}
function run(form, seed, choices, seenLabels) {
  World.currentTick = 100;
  const type = NpcType.getByName(form.name);
  assert(type && type.id >= 0, `missing NPC ${form.name}`);
  const base = form.placed ?? form.name;
  const tile = placements.get(NpcType.getId(base))?.[0];
  assert(tile, `${base}: retained map placement required`);
  const player = new Player('oldtownstest', 1n, 0n);
  player.pid = 1; player.uid = 1; player.vars.fill(0); player.levels.fill(99); player.baseLevels.fill(99);
  player.level = tile.level; player.x = tile.x; player.z = tile.z - 1;
  player.buildArea.originX = tile.x - 32; player.buildArea.originZ = tile.z - 32;
  if (form.woodcutting !== undefined) player.baseLevels[8] = player.levels[8] = form.woodcutting;
  if (form.mining !== undefined) player.baseLevels[14] = player.levels[14] = form.mining;
  if (form.crafting !== undefined) player.baseLevels[12] = player.levels[12] = form.crafting;
  if (form.currentWoodcutting !== undefined) player.levels[8] = form.currentWoodcutting;
  if (form.gender !== undefined) player.gender = form.gender;
  for (const [name, value] of Object.entries(form.vars ?? {})) {
    const id = VarPlayerType.getId(name); assert(id >= 0, `missing varp ${name}`); player.setVar(id, value);
  }
  for (const [name, value] of Object.entries(form.varbits ?? {})) {
    const id = cfg.VarBitType.getId(name); assert(id >= 0, `missing varbit ${name}`); player.setVarBit(id, value);
  }
  for (const item of form.worn ?? []) player.invAdd(cfg.InvType.getId('worn'), cfg.ObjType.getId(item), 1);
  for (const [item, count] of Object.entries(form.inventory ?? {})) player.invAdd(cfg.InvType.getId('inv'), cfg.ObjType.getId(item), count);
  const before = player.vars.slice(), packets = [];
  const heldBefore = inventorySnapshot(player, 'inv'), wornBefore = inventorySnapshot(player, 'worn'), selectedOptions = [];
  player.write = packet => packets.push(packet);
  const placedType = NpcType.getByName(base);
  const npc = new Npc(tile.level, tile.x, tile.z, placedType.size, placedType.size, EntityLifeCycle.RESPAWN, 1, placedType.id, BlockWalk.NONE);
  npc.isActive = true; npc.lastMovement = -100;
  const op = form.op ?? 1;
  const option = op === 3 ? 'trade' : 'talk';
  assert(type.op[op - 1]?.toLowerCase().startsWith(option), `${form.name}: original ${option} option ${op}`);
  const nearby = (form.nearbyNpcs ?? []).map((name, index) => {
    const type = NpcType.getByName(name), tile = placements.get(type.id)?.[0];
    assert(tile, `${name}: nearby speaker retains its map placement`);
    const other = new Npc(tile.level, tile.x, tile.z, type.size, type.size, EntityLifeCycle.RESPAWN, index + 2, type.id, BlockWalk.NONE);
    other.isActive = true; other.lastMovement = -100;
    World.gameMap.getZone(tile.x, tile.z, tile.level).enter(other);
    return other;
  });
  const finish = result => {
    for (const speaker of [npc, ...nearby]) if (speaker.sayMessage) {
      result.pages.push({ kind: 'overhead', speaker: 'npc', name: NpcType.get(speaker.type).name, lines: [speaker.sayMessage] });
    }
    for (const other of nearby) World.gameMap.getZone(other.x, other.z, other.level).leave(other);
    if (result.done && selectedOptions.includes(form.overheadWhen)) {
      const overheads = Object.fromEntries(result.pages.filter(page => page.kind === 'overhead').map(page => [page.name, page.lines.join(' ')]));
      assert.deepEqual(overheads, form.overheads, `${form.name}: both sourced cries are native overhead speech`);
    }
    if (result.done && form.advice && result.pages.some(page => page.speaker === 'player' && /teach me about canoes\?/.test(normalize(page.lines.join(' '))))) {
      assert(result.pages.some(page => normalize(page.lines?.join(' ') ?? '').includes(normalize(form.advice))), `${form.name}: advice follows current, not base, Woodcutting`);
    }
    return result;
  };
  player.target = npc; player.targetOp = Trigger[`OPNPC${op}`] - 7;
  const script = player.getOpTrigger();
  assert(script, `${form.name}: visible form must dispatch through Player.getOpTrigger`);
  assert.equal(script.name, form.expectedScript ?? `[opnpc${op},${form.name}]`, 'exact visible-form dispatch');
  JavaRandom.setSeed(seed);
  const state = ScriptRunner.init(script, player, npc);
  player.executeScript(state, true);
  let choice = 0;
  for (let steps = 0; steps < 300; steps++) {
    // The VM clears ordinary call frames on GOTO; its debug frames retain those real transitions.
    seenLabels.add(state.script.name);
    for (let frame = 0; frame < state.debugFp; frame++) seenLabels.add(state.debugFrames[frame].script.name);
    assert.notEqual(state.execution, ScriptState.ABORTED, `${form.name}: conversation aborted`);
    if (state.execution === ScriptState.FINISHED) {
      assert.equal(choice, choices.length, 'all requested choices consumed');
      const service = serviceResult(packets, player);
      const allowed = new Set(Object.keys(service?.variables ?? {}).map(name => VarPlayerType.getId(name)));
      for (let id = 0; id < before.length; id++) if (!allowed.has(id)) assert.equal(player.vars[id], before[id], `conversation does not write unrelated or saved state: varp ${id}`);
      if (form.attacks) assert.equal(npc.mode, NpcModeMap.get('opplayer2'), 'barbarian initiates its sourced attack after Continue');
      const heldAfter = inventorySnapshot(player, 'inv'), expectedHeld = new Map(heldBefore), rewards = [], consumed = [];
      for (const reward of form.rewards ?? []) if (selectedOptions.includes(normalize(reward.when))) {
        const id = cfg.ObjType.getId(reward.item); assert(id >= 0);
        const delta = (heldAfter.get(id) ?? 0) - (heldBefore.get(id) ?? 0);
        assert(Number.isInteger(delta) && delta >= reward.min && delta <= reward.max, `${form.name}: sourced ${reward.item} reward range`);
        expectedHeld.set(id, (expectedHeld.get(id) ?? 0) + delta);
        rewards.push({ item: reward.item, delta });
      }
      for (const transfer of form.consumes ?? []) if (selectedOptions.includes(normalize(transfer.when))) {
        const id = cfg.ObjType.getId(transfer.item); assert(id >= 0);
        assert(Number.isInteger(transfer.count) && transfer.count > 0, 'positive sourced transfer count');
        const beforeCount = heldBefore.get(id) ?? 0;
        assert(beforeCount >= transfer.count, `${form.name}: fixture holds the offered ${transfer.item}`);
        assert.equal((heldAfter.get(id) ?? 0) - beforeCount, -transfer.count, `${form.name}: exact sourced ${transfer.item} consumption`);
        const expectedCount = (expectedHeld.get(id) ?? 0) - transfer.count;
        if (expectedCount) expectedHeld.set(id, expectedCount); else expectedHeld.delete(id);
        consumed.push({ item: transfer.item, count: transfer.count });
      }
      assert.deepEqual(heldAfter, expectedHeld, `${form.name}: only selected sourced item transfers change inventory`);
      assert.deepEqual(inventorySnapshot(player, 'worn'), wornBefore, 'conversation does not change equipment');
      return finish({ done: true, pages: pages(packets), service, rewards, consumed });
    }
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false; player.executeScript(state, true, true); continue;
    }
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${form.name}: expected real dialogue pause`);
    const menu = Component.get(player.modalChat)?.comName;
    if (/^multi[2-5]$/.test(menu)) {
      if (choice === choices.length) return finish({ done: false, count, pages: pages(packets) });
      const index = choices[choice++]; assert(index >= 1 && index <= count);
      selectedOptions.push(normalize(pages(packets).filter(page => page.kind === 'menu').at(-1).options[index - 1]));
      const component = Component.getId(`${menu}:com_${index}`);
      assert(player.resumeButtons.includes(component)); player.lastCom = component;
      assert(pause.handle(new ResumePauseButton(component), player));
    } else assert(pause.handle(new ResumePauseButton(0), player));
  }
  assert.fail(`${form.name}: conversation exceeded 300 production resumes`);
}
let total = 0;
for (const file of ['barbarian-draynor-source.json', 'alkharid-source.json', 'west-east-source.json']) {
  const oracle = JSON.parse(fs.readFileSync(path.join(content, 'tests/n619-old-towns', file), 'utf8'));
  const speech = oracle.speech.map(normalize), options = new Set(oracle.options.map(normalize));
  const seenSpeech = new Set(), seenOptions = new Set(), seenLabels = new Set();
  const seenRewards = new Set(), seenConsumption = new Set();
  let conversations = 0, shopOpens = 0, tannerOpens = 0;
  const check = result => {
    for (const reward of result.rewards ?? []) seenRewards.add(`${reward.item}:${reward.delta}`);
    for (const transfer of result.consumed ?? []) seenConsumption.add(`${transfer.item}:${transfer.count}`);
    const emitted = [];
    for (const page of result.pages) {
      if (page.kind === 'menu') {
        for (const raw of page.options) {
          const text = normalize(raw); assert(options.has(text), `${file}: unsourced option ${JSON.stringify(text)}`); seenOptions.add(text);
        }
      } else {
        const text = normalize(page.lines.join(' '));
        assert(speech.some(line => line.includes(text)), `${file}: unsourced speech ${JSON.stringify(text)}`);
        const presentation = oracle.presentations?.[text];
        if (presentation) {
          assert.equal(page.kind, presentation.kind, `${file}: retained output medium for ${text}`);
          assert.equal(page.speaker, presentation.speaker, `${file}: retained speaker for ${text}`);
          if (presentation.name) assert.equal(normalize(page.name), presentation.name, `${file}: retained NPC name for ${text}`);
        }
        const expression = oracle.expressions?.[text];
        if (expression) {
          const id = cfg.MesanimType.getId(expression); assert(id >= 0);
          assert.equal(page.animation, cfg.MesanimType.get(id).len[page.lines.length - 1], `${file}: retained ${expression} expression for ${text}`);
        }
        emitted.push(text);
      }
    }
    const text = emitted.join(' ');
    for (const line of speech) if (text.includes(line)) seenSpeech.add(line);
  };
  for (const form of oracle.forms) {
    let seeds = form.seeds ?? [0];
    if (form.randomReplies) {
      const variants = new Map();
      for (let index = 0; index < 100 && variants.size < form.randomReplies; index++) {
        const seed = index * 100003 + 1, result = run(form, seed, form.randomRoute ?? [], seenLabels);
        check(result); const key = JSON.stringify(result.pages); if (!variants.has(key)) variants.set(key, seed);
      }
      assert.equal(variants.size, form.randomReplies, `${form.name}: every random reply reached`);
      seeds = [...variants.values()];
    }
    for (const seed of seeds) {
      const pending = [[]];
      let loopReturns = 0;
      for (let at = 0; at < pending.length; at++) {
        const route = pending[at], result = run(form, seed, route, seenLabels); check(result);
        if (form.repeatMenu) {
          assert(Number.isInteger(form.repeatMenu.exit) && form.repeatMenu.exit >= 1 && form.repeatMenu.exit <= form.repeatMenu.options.length, 'sourced repeated-menu farewell');
          for (const menu of result.pages.filter(page => page.kind === 'menu')) {
            assert.deepEqual(menu.options.map(normalize), form.repeatMenu.options.map(normalize), `${form.name}: original and returned source menu are identical`);
          }
        }
        if (result.done) {
          conversations++;
          if (result.service) {
            const shop = result.service.name === 'shop_template';
            assert(shop ? ['salesman_ranging', 'seed_merchant'].includes(form.name) : form.name === 'tanner', 'only the approved existing service callers');
            const control = run({ name: shop ? form.name : 'ellis_tanner', op: 3, inventory: form.inventory, expectedScript: shop ? '[opnpc3,_shop_keeper]' : '[opnpc3,ellis_tanner]' }, seed, [], new Set());
            assert(control.done && control.service, 'existing Trade service control opens');
            assert.deepEqual(result.service, control.service, 'new entry point emits the unchanged supported interface and session state');
            if (shop) {
              shopOpens++;
              assert.equal(result.service.variables.shop, cfg.InvType.getId(form.name === 'seed_merchant' ? 'seed_stall' : 'salesman_ranging'));
              const title = result.service.updates.find(packet => packet.component === Component.getId('shop_template:com_76'))?.text;
              assert(oracle.shopTitles?.includes(title), 'retained existing shop title');
            } else tannerOpens++;
          }
        }
        else if (form.repeatMenu && route.length) {
          // Exhaust the finite menu graph, including each return edge and its farewell.
          assert.equal(route.length, 1, `${form.name}: one source information edge returns to the menu`);
          assert.notEqual(route[0], form.repeatMenu.exit, 'the sourced farewell must terminate');
          assert.equal(result.count, form.repeatMenu.options.length);
          loopReturns++;
          pending.push([...route, form.repeatMenu.exit]);
        } else for (let option = 1; option <= result.count; option++) pending.push([...route, option]);
        assert(pending.length < 200, `${form.name}: bounded complete choice graph`);
      }
      if (form.repeatMenu) assert.equal(loopReturns, form.repeatMenu.options.length - 1, `${form.name}: every information edge returns to the unchanged menu`);
    }
  }
  assert.equal(conversations, oracle.expectedConversations, `${file}: pinned terminal conversation count`);
  if (oracle.expectedShopOpens !== undefined) assert.equal(shopOpens, oracle.expectedShopOpens, 'every sourced shop-opening route');
  if (oracle.expectedTannerOpens !== undefined) assert.equal(tannerOpens, oracle.expectedTannerOpens, 'both tanning entry points and sourced choices');
  for (const reward of oracle.forms.flatMap(form => form.rewards ?? [])) {
    for (let amount = reward.min; amount <= reward.max; amount++) assert(seenRewards.has(`${reward.item}:${amount}`), `${file}: every sourced reward amount reached`);
  }
  for (const transfer of oracle.forms.flatMap(form => form.consumes ?? [])) {
    assert(seenConsumption.has(`${transfer.item}:${transfer.count}`), `${file}: sourced ${transfer.item} transfer reached`);
  }
  for (const line of speech) assert(seenSpeech.has(line), `${file}: unreached source speech ${line}`);
  for (const option of options) assert(seenOptions.has(option), `${file}: unreached source option ${option}`);
  for (const label of oracle.labels) assert(seenLabels.has(`[label,${label}]`), `${file}: unreached compiled label ${label}`);
  total += conversations;
  console.log(`PASS ${file}: ${oracle.forms.length} form/context cases, ${conversations} complete conversations`);
}
console.log(`PASS N619 old towns: ${total} complete conversations; every retained line and choice reached`);
process.exit(0);
