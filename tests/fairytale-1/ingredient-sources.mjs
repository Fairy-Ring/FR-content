import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const itemNames = [
  'avantoe', 'babydragon_bones', 'blue_dragon_scale', 'bucket_supercompost', 'grapes',
  'raw_cave_eel', 'charcoal', 'crushed_gemstone', 'edible_seaweed', 'snail_corpse3', 'irit_leaf',
  'jangerberries', 'tbwt_jogre_bones', 'king_worm', 'lime', 'mortmyremushroom', 'mortmyrepear',
  'mortmyrebuddingstem', 'nature_talisman', 'cactus_potato', 'mosquito_proboscis', 'red_spiders_eggs',
  'red_vine_worm', 'mort_slimey_eel', 'snapdragon', 'snape_grass', 'uncut_diamond', 'uncut_ruby',
  'oystershell', 'volencia_moss', 'white_berries'
];

const mapPathFor = row => `maps/m${row.mx}_${row.mz}.jm2`;

function hasPackedGroundObject(World, row) {
  const zone = World.gameMap.getZone(row.x, row.z, row.level);
  for (const obj of zone.getAllObjsSafe()) {
    if (obj.type === row.id && obj.count === row.count && obj.x === row.x && obj.z === row.z && obj.level === row.level) {
      return true;
    }
  }
  return false;
}

function sourcePath(script, content) {
  const raw = String(script.info?.sourceFilePath ?? script.fileName ?? '').replaceAll('\\', '/');
  if (raw.startsWith('scripts/')) return raw;
  if (path.isAbsolute(raw)) {
    const relative = path.relative(content, raw).replaceAll('\\', '/');
    if (!relative.startsWith('../')) return relative;
  }
  const scriptsAt = raw.indexOf('/scripts/');
  if (scriptsAt >= 0) return raw.slice(scriptsAt + 1);
  return raw.replace(/^\.\//, '');
}

export async function verifyIngredientSources(context) {
  const {
    content, engine, World, types, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
    nativeNpcRows, nativeLocRows, player, withRandom, add, count, obj, driveDialogue, JavaRandom, druidComplete, integerConstant
  } = context;
  const { default: ScriptPointer } = await import(pathToFileURL(path.join(engine, 'src/engine/script/ScriptPointer.ts')).href);
  const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
  const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
  const inv = types.InvType.getId('inv');
  const bank = types.InvType.getId('bank');
  const witnesses = new Map();
  const items = [...types.EnumType.getByName('ft1_nature_items').values]
    .filter(([index]) => index !== 21)
    .map(([index, id]) => ({ index, id, item: itemNames[index - 1] }));
  assert.equal(items.length, 30, 'all 30 eligible ingredients need a native producer');
  for (const entry of items) assert.equal(entry.id, obj(entry.item), `nature item ${entry.index} identity`);

  function packed(name) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed ingredient producer ${name}`);
    return script;
  }
  function execute(script, p, target = null, args = []) {
    if (typeof script === 'string') script = packed(script);
    const state = ScriptRunner.init(script, p, target, args);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    p.executeScript(state, true, true);
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
      const actor = state.activeNpc;
      assert.equal(actor.activeScript, state, 'native Player execution hands the delayed script to its active NPC');
      World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
      actor.delayed = false;
      actor.executeScript(state);
    }
    driveDialogue(p, state);
    return state;
  }
  function dispatch(trigger, target, Type) {
    const type = Type.get(target.type);
    const script = ScriptProvider.getByTrigger(trigger, target.type, type.category);
    assert(script, `packed ${type.debugname} has trigger ${trigger}`);
    return script;
  }
  function record(item, kind, paths, evidence) {
    assert(!witnesses.has(obj(item)), `${item} has one explicit producer witness`);
    witnesses.set(obj(item), { kind, path: paths.join(' + '), evidence });
  }
  function placedNpc(name) {
    const id = types.NpcType.getId(name);
    assert(id >= 0, `packed NPC ${name}`);
    const rows = nativeNpcRows(name);
    for (const row of rows) {
      const actor = [...World.gameMap.getZone(row.x, row.z, row.level).getAllNpcsSafe()]
        .find(npc => npc.isActive && npc.type === id && npc.x === row.x && npc.z === row.z && npc.level === row.level);
      if (actor) return { actor, row };
    }
    assert.fail(`no active native placement of ingredient producer ${name}`);
  }
  function placedLoc(name, accept = () => true) {
    const id = types.LocType.getId(name);
    for (const row of nativeLocRows(name)) {
      if (!accept(row)) continue;
      const loc = World.getLoc(row.x, row.z, row.level, id);
      if (loc) return { loc, row };
    }
    assert.fail(`no native placement of ingredient producer ${name}`);
  }
  function stand(p, target) {
    [p.level, p.x, p.z] = [target.level, target.x, target.z];
  }
  function pickup(p, object) {
    stand(p, object);
    const before = p.invTotal(inv, object.type);
    const script = dispatch(ServerTriggerType.OPOBJ3, object, types.ObjType);
    execute(script, p, object);
    assert.equal(p.invTotal(inv, object.type) - before, object.count, 'native Take receives the produced object');
  }
  function slot(p, name, inventory = inv) {
    const value = p.getInventory(inventory).getItemIndex(obj(name));
    assert(value >= 0, `${name} occupies a real inventory slot`);
    p.lastSlot = value;
    p.lastItem = obj(name);
    return value;
  }
  function identify(p, unid, clean) {
    slot(p, unid);
    const script = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, obj(unid), types.ObjType.get(obj(unid)).category);
    assert(script, `${unid} has a packed identification handler`);
    execute(script, p);
    assert.equal(count(p, unid), 0, 'identification consumes the unidentified item');
    assert.equal(count(p, clean), 1, 'identification produces the requested clean herb');
    return script;
  }
  function constantRoll(value, action) {
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => value;
    try { return action(); }
    finally { JavaRandom.nextDouble = original; }
  }
  function death(actor, p, expected, draws = null) {
    actor.heroPoints.addHero(p.hash64, actor.levels[NpcStat.HITPOINTS]);
    actor.setVar(types.VarNpcType.getId('npc_aggressive_player'), p.uid);
    actor.applyDamage(actor.levels[NpcStat.HITPOINTS], 1);
    const root = dispatch(ServerTriggerType.AI_QUEUE3, actor, types.NpcType);
    const state = ScriptRunner.init(root, actor);
    const drops = [];
    const original = World.addObj;
    World.addObj = function(object, receiver, duration) {
      drops.push(object);
      return original.call(this, object, receiver, duration);
    };
    const run = () => {
      actor.executeScript(state);
      for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
        World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
        actor.delayed = false;
        actor.executeScript(state);
      }
      assert.equal(state.execution, ScriptState.FINISHED, `${root.name} completes its native death lifecycle`);
    };
    try {
      if (draws) withRandom(draws, run);
      else run();
    } finally { World.addObj = original; }
    const drop = drops.find(object => object.type === obj(expected));
    assert(drop, `${root.name} actually creates ${expected}`);
    pickup(p, drop);
    return root;
  }

  // Native OBJ placements are loaded into the actual World, then taken through
  // the packed default Take handler. A source numeric match alone is not proof.
  const wantedIds = new Set(items.map(entry => entry.id));
  for (const file of readdirSync(path.join(content, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file)).sort()) {
    const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
    let section = '';
    for (const [offset, line] of readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/).entries()) {
      if (line.startsWith('====')) { section = line.split(/\s+/)[1] ?? ''; continue; }
      if (section !== 'OBJ') continue;
      const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
      if (!match) continue;
      const [id, quantity] = match[4].trim().split(/\s+/).map(Number);
      if (!wantedIds.has(id) || witnesses.has(id)) continue;
      const row = { id, count: quantity, level: +match[1], x: mx * 64 + +match[2], z: mz * 64 + +match[3] };
      if (!hasPackedGroundObject(World, row)) continue;
      const object = [...World.gameMap.getZone(row.x, row.z, row.level).getAllObjsSafe()]
        .find(value => value.type === id && value.x === row.x && value.z === row.z && value.level === row.level);
      const p = player();
      pickup(p, object);
      const item = items.find(entry => entry.id === id).item;
      record(item, 'native-ground-Take', [`maps/${file}:${offset + 1}`, 'scripts/player/scripts/pickup.rs2'],
        `native OBJ placement and packed Take put ${item} in the player's inventory`);
    }
  }

  // Exercise payment and stock transfer, not just the presence of shop config.
  for (const [item, keeper] of [['charcoal', 'jiminua'], ['lime', 'gnome_hudo']]) {
    const { actor, row } = placedNpc(keeper);
    const p = player();
    add(p, 'coins', 10000);
    const root = dispatch(ServerTriggerType.OPNPC3, actor, types.NpcType);
    execute(root, p, actor);
    const shop = p.getVar(types.VarPlayerType.getId('shop'));
    assert.equal(shop, types.NpcType.get(actor.type).params.get(types.ParamType.getId('owned_shop')));
    assert(p.invTotal(shop, obj(item)) > 0, 'the native shop has positive stock');
    slot(p, item, shop);
    const before = count(p, 'coins');
    execute('[inv_button2,shop_template:inv]', p);
    assert.equal(count(p, item), 1, 'the ordinary shop Buy-1 creates the requested ingredient');
    assert(count(p, 'coins') < before, 'the purchase pays its actual price');
    record(item, 'native-shop-purchase', [mapPathFor(row), sourcePath(root, content), 'scripts/shop/scripts/shop.rs2'],
      `${keeper} opens its own shop; native Buy-1 transfers one ${item} and charges coins`);
  }

  for (const [item, name] of [['babydragon_bones', 'babybluedragon'], ['tbwt_jogre_bones', 'jogre'], ['snail_corpse3', 'mmsnailround_blue']]) {
    const { actor, row } = placedNpc(name);
    const p = player();
    const root = death(actor, p, item);
    record(item, 'native-NPC-death-Take', [mapPathFor(row), sourcePath(root, content), 'scripts/player/scripts/pickup.rs2'],
      `native ${name} death creates ${item}; packed Take receives it`);
  }

  // The sinister chest supplies both unidentified herbs before their ordinary
  // held-item handlers produce the exact clean objects in the nature-item enum.
  {
    const { loc, row } = placedLoc('shuttwistedchest');
    const p = player();
    add(p, 'sinister_key');
    p.lastUseItem = obj('sinister_key');
    p.lastUseSlot = slot(p, 'sinister_key');
    const root = dispatch(ServerTriggerType.OPLOCU, loc, types.LocType);
    execute(root, p, loc);
    assert.equal(count(p, 'sinister_key'), 0);
    for (const [unid, item] of [['unidentified_avantoe', 'avantoe'], ['unidentified_irit', 'irit_leaf']]) {
      const handler = identify(p, unid, item);
      record(item, 'native-chest-identification', [mapPathFor(row), sourcePath(root, content), sourcePath(handler, content)],
        `sinister-key chest produces ${unid}; packed Identify converts it to ${item}`);
    }
  }

  {
    const { actor, row } = placedNpc('agilityarena_tickettrader');
    const p = player();
    add(p, 'agilityarena_ticket', 10);
    const root = dispatch(ServerTriggerType.OPNPC3, actor, types.NpcType);
    execute(root, p, actor);
    assert.equal(p.modalMain, types.Component.getId('agilityarena_trade'));
    execute('[if_button,agilityarena_trade:com_100]', p);
    assert.equal(count(p, 'agilityarena_ticket'), 0);
    assert.equal(count(p, 'snapdragon'), 1);
    record('snapdragon', 'native-ticket-purchase', [mapPathFor(row), sourcePath(root, content)],
      'native ticket trader opens the exchange; the packed Snapdragon button consumes ten tickets and produces one herb');
  }

  for (const [item, fishingLevel] of [['raw_cave_eel', 99], ['mort_slimey_eel', 28]]) {
    const { actor, row } = placedNpc('0_49_149_cavefish');
    const p = player();
    p.levels[PlayerStat.FISHING] = fishingLevel;
    add(p, 'fishing_rod');
    add(p, 'fishing_bait', 5);
    p.setVar(types.VarPlayerType.getId('action_delay'), World.currentTick);
    const root = dispatch(ServerTriggerType.OPNPC3, actor, types.NpcType);
    constantRoll(0, () => execute(root, p, actor));
    assert.equal(count(p, item), 1);
    assert.equal(count(p, 'fishing_bait'), 4);
    record(item, 'native-fishing-catch', [mapPathFor(row), sourcePath(root, content)],
      `native Bait handler at Fishing ${fishingLevel} consumes one bait and catches ${item}`);
  }

  {
    const p = player();
    add(p, 'chisel');
    add(p, 'uncut_opal');
    p.lastUseItem = obj('uncut_opal');
    p.lastUseSlot = slot(p, 'uncut_opal');
    constantRoll(0.999999, () => execute('[opheldu,chisel]', p));
    assert.equal(count(p, 'uncut_opal'), 0);
    assert.equal(count(p, 'crushed_gemstone'), 1);
    record('crushed_gemstone', 'native-gem-cutting-failure', ['scripts/skill_crafting/scripts/gem/uncut_gem.rs2'],
      'the packed chisel handler consumes an uncut opal and produces a crushed gemstone on its actual failed skill roll');
  }

  for (const [base, grown, item] of [
    ['log_druidicspirit', 'log_druidicspirit2', 'mortmyremushroom'],
    ['peartree_druidicspirit', 'peartree_druidicspirit2', 'mortmyrepear'],
    ['branch_druidicspirit', 'branch_druidicspirit2', 'mortmyrebuddingstem']
  ]) {
    const { loc, row } = placedLoc(base, row => row.mx >= 53 && row.mx <= 54 && row.mz >= 52 && row.mz <= 53);
    const p = player();
    p.setVar(types.VarPlayerType.getId('druidspirit'), druidComplete);
    add(p, 'silver_sickle_blessed');
    [p.level, p.x, p.z] = [loc.level, loc.x - 1, loc.z];
    slot(p, 'silver_sickle_blessed');
    constantRoll(0, () => execute('[opheld3,silver_sickle_blessed]', p));
    const changed = World.getLoc(loc.x, loc.z, loc.level, types.LocType.getId(grown));
    assert(changed, `native Bloom transforms the original ${base}`);
    const root = dispatch(ServerTriggerType.OPLOC2, changed, types.LocType);
    execute(root, p, changed);
    assert.equal(count(p, item), 1);
    record(item, 'native-Bloom-pick', [mapPathFor(row), sourcePath(root, content)],
      `native blessed-sickle Bloom transforms ${base}; its packed Pick handler produces ${item}`);
  }

  {
    const candidates = types.LocType.configs.filter(type => type?.category === types.CategoryType.getId('red_vine'));
    const type = candidates.find(type => nativeLocRows(type.debugname).length);
    assert(type, 'a native red vine is placed');
    const { loc, row } = placedLoc(type.debugname);
    const p = player();
    add(p, 'spade');
    const root = dispatch(ServerTriggerType.OPLOC1, loc, types.LocType);
    execute(root, p, loc);
    assert.equal(count(p, 'red_vine_worm'), 1);
    record('red_vine_worm', 'native-vine-dig', [mapPathFor(row), sourcePath(root, content)],
      'the original vine Dig handler requires the spade and produces one red vine worm');
  }

  {
    const { loc, row } = placedLoc('volencia_moss_rock_full');
    const p = player();
    p.setVar(types.VarPlayerType.getId('junglepotion'),
      integerConstant('scripts/quests/quest_junglepotion/configs/quest_junglepotion.constant', 'junglepotion_get_volencia_moss'));
    const root = dispatch(ServerTriggerType.OPLOC2, loc, types.LocType);
    execute(root, p, loc);
    assert.equal(count(p, 'unidentified_volencia_moss'), 1);
    const handler = identify(p, 'unidentified_volencia_moss', 'volencia_moss');
    record('volencia_moss', 'native-rock-identification', [mapPathFor(row), sourcePath(root, content), sourcePath(handler, content)],
      'the original rock Search produces unidentified moss; packed Identify produces clean Volencia moss');
  }

  {
    const { actor, row } = placedNpc('abyssal_leech');
    const p = player();
    const root = death(actor, p, 'nature_talisman', [41 / 256]);
    record('nature_talisman', 'native-abyssal-death-Take', [mapPathFor(row), sourcePath(root, content)],
      'the placed Abyssal leech native death table creates a nature talisman at its selected roll; packed Take receives it');
  }

  {
    const { actor, row } = placedNpc('slayer_mutated_zygomite_adolescent_cap');
    const p = player();
    const pick = dispatch(ServerTriggerType.OPNPC1, actor, types.NpcType);
    execute(pick, p, actor);
    assert.equal(actor.type, types.NpcType.getId('slayer_mutated_zygomite_adolescent'));
    actor.heroPoints.addHero(p.hash64, actor.levels[NpcStat.HITPOINTS]);
    actor.setVar(types.VarNpcType.getId('npc_aggressive_player'), p.uid);
    actor.applyDamage(actor.levels[NpcStat.HITPOINTS] - 1, 1);
    const spray = types.EnumType.getByName('slayer_spray_forms').values.get(10);
    assert(Number.isInteger(spray) && spray >= 0, 'packed ten-charge fungicide spray exists');
    p.invAdd(inv, spray, 1);
    p.lastUseItem = spray;
    p.lastUseSlot = p.getInventory(inv).getItemIndex(spray);
    execute(dispatch(ServerTriggerType.OPNPCU, actor, types.NpcType), p, actor);
    assert([...actor.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4),
      'ordinary fungicide use queues the actual finish-off handler');
    const root = dispatch(ServerTriggerType.AI_QUEUE4, actor, types.NpcType);
    const drops = [];
    const original = World.addObj;
    World.addObj = function(object, receiver, duration) {
      drops.push(object);
      return original.call(this, object, receiver, duration);
    };
    try {
      withRandom([122 / 137], () => {
        for (let tick = 0; actor.isActive && tick < 20; tick++) {
          World.currentTick++;
          actor.turn();
          p.processQueues();
        }
      });
    } finally { World.addObj = original; }
    assert.equal(actor.isActive, false, 'queued fungicide finish removes the original zygomite');
    const note = drops.find(object => object.type === obj('cert_bucket_supercompost'));
    assert(note, 'the real queued finish-off produces noted supercompost');
    pickup(p, note);
    const certSlot = slot(p, 'cert_bucket_supercompost');
    execute('[label,bank_deposit]', p, null, [certSlot, 1]);
    assert.equal(count(p, 'cert_bucket_supercompost'), 0);
    assert.equal(p.invTotal(bank, obj('bucket_supercompost')), 1);
    const bankSlot = slot(p, 'bucket_supercompost', bank);
    execute('[label,bank_withdraw]', p, null, [bankSlot, 1]);
    assert.equal(count(p, 'bucket_supercompost'), 1);
    record('bucket_supercompost', 'native-zygomite-drop-bank-unnoting', [mapPathFor(row), sourcePath(pick, content), sourcePath(root, content), 'scripts/interface_bank/scripts/bank.rs2'],
      'native fungus Pick produces the zygomite form; its finish-off death creates noted supercompost; Take, bank deposit and withdrawal produce the unnoted bucket');
  }

  {
    const { loc, row } = placedLoc('game_trawler_reward_net');
    const p = player();
    p.setVar(types.VarPlayerType.getId('trawler'), 3);
    p.setVar(types.VarPlayerType.getId('trawler_catch'), 1);
    p.levels[PlayerStat.FISHING] = 16;
    const root = dispatch(ServerTriggerType.OPLOC1, loc, types.LocType);
    withRandom([0, 0, 2 / 3], () => execute(root, p, loc));
    const reward = types.InvType.getId('trawler_rewardinv');
    assert.equal(p.invTotal(reward, obj('edible_seaweed')), 1);
    p.lastItem = obj('edible_seaweed');
    execute('[inv_button1,trawler_catch:inv]', p);
    assert.equal(count(p, 'edible_seaweed'), 1);
    record('edible_seaweed', 'native-trawler-reward-claim', [mapPathFor(row), sourcePath(root, content)],
      'with a completed one-catch trip fixture, the native reward net rolls edible seaweed and its ordinary claim button transfers it to inventory');
  }

  // One real big-net catch supplies both oysters and the caskets whose actual
  // Open handlers can produce each uncut gem. No result item is seeded.
  {
    const category = types.CategoryType.getId('memberfish');
    const type = types.NpcType.configs.find(type => type?.category === category && nativeNpcRows(type.debugname).length);
    assert(type, 'a native big-net fishing spot is placed');
    const { actor, row } = placedNpc(type.debugname);
    for (const [item, draw] of [['uncut_diamond', 125 / 128], ['uncut_ruby', 112 / 128]]) {
      const p = player();
      add(p, 'big_net');
      p.setVar(types.VarPlayerType.getId('action_delay'), World.currentTick);
      const root = dispatch(ServerTriggerType.OPNPC1, actor, types.NpcType);
      constantRoll(0, () => execute(root, p, actor));
      assert.equal(count(p, 'casket'), 1);
      if (!witnesses.has(obj('oystershell'))) {
        assert.equal(count(p, 'oystershell'), 1);
        record('oystershell', 'native-big-net-catch', [mapPathFor(row), sourcePath(root, content)],
          'native big-net fishing catches an oyster shell in the actual player inventory');
      }
      slot(p, 'casket');
      withRandom([draw], () => execute('[opheld1,casket]', p));
      assert.equal(count(p, 'casket'), 0);
      assert.equal(count(p, item), 1);
      record(item, 'native-fishing-casket-Open', [mapPathFor(row), sourcePath(root, content)],
        `native big-net fishing catches the casket; its packed Open handler consumes it and produces ${item}`);
    }
  }

  for (const entry of items) {
    const witness = witnesses.get(entry.id);
    assert(witness, `no native producing path for Fairy Tale item ${entry.index} ${entry.item}`);
    console.log(`ingredient-source ${JSON.stringify({ ...entry, ...witness })}`);
  }
  return items.map(entry => ({ ...entry, ...witnesses.get(entry.id) }));
}
