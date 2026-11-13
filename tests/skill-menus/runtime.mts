// Execute packed production triggers and skill-menu handlers without starting a world server.
import assert from "node:assert/strict";
import Component from "#/cache/config/Component.js";
import CategoryType from "#/cache/config/CategoryType.js";
import DbRowType from "#/cache/config/DbRowType.js";
import DbTableType from "#/cache/config/DbTableType.js";
import DbTableIndex from "#/cache/config/DbTableIndex.js";
import EnumType from "#/cache/config/EnumType.js";
import FontType from "#/cache/config/FontType.js";
import InvType from "#/cache/config/InvType.js";
import LocType from "#/cache/config/LocType.js";
import MesanimType from "#/cache/config/MesanimType.js";
import ObjType from "#/cache/config/ObjType.js";
import ParamType from "#/cache/config/ParamType.js";
import SeqType from "#/cache/config/SeqType.js";
import StructType from "#/cache/config/StructType.js";
import VarBitType from "#/cache/config/VarBitType.js";
import VarNpcType from "#/cache/config/VarNpcType.js";
import VarPlayerType from "#/cache/config/VarPlayerType.js";
import { EntityLifeCycle } from "#/engine/entity/EntityLifeCycle.js";
import Loc from "#/engine/entity/Loc.js";
import Player from "#/engine/entity/Player.js";
import { PlayerStat } from "#/engine/entity/PlayerStat.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import World from "#/engine/World.js";
import IfButtonHandler from "#/network/game/client/handler/IfButtonHandler.js";
import IfButton from "#/network/game/client/model/IfButton.js";
import ResumePCountDialogHandler from "#/network/game/client/handler/ResumePCountDialogHandler.js";
import ResumePCountDialog from "#/network/game/client/model/ResumePCountDialog.js";
import IfOpenChat from "#/network/game/server/model/IfOpenChat.js";
import IfSetObject from "#/network/game/server/model/IfSetObject.js";
import IfSetPosition from "#/network/game/server/model/IfSetPosition.js";
import IfSetText from "#/network/game/server/model/IfSetText.js";

const packDir = process.env.SKILL_MENU_PACK_DIR ?? "data/pack";
const defaultPrompt = "What would you like to make?";
const labels = (text: string): string => `\\n\\n\\n\\n${text}`;
const button = new IfButtonHandler();
const countDialog = new ResumePCountDialogHandler();
const packetLog = new WeakMap<Player, unknown[]>();
const mutantSwapLabels = process.argv.includes("--mutant-swap-labels");
let mutantApplied = false;
let playerSerial = 0;
let checks = 0;

function requiredId(name: string): number {
  const id = ObjType.getId(name);
  assert(id >= 0, `missing object ${name}`);
  return id;
}

function requiredComponent(name: string): number {
  const id = Component.getId(name);
  assert(id >= 0, `missing component ${name}`);
  return id;
}

function player(): Player {
  const serial = ++playerSerial;
  const p = new Player("skillmenutest", BigInt(serial), 0n);
  p.pid = serial;
  p.uid = serial;
  p.vars.fill(0);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.stats[PlayerStat.FLETCHING] = 130344310;
  p.stats[PlayerStat.CRAFTING] = 130344310;
  p.buildArea.originX = 3000;
  p.buildArea.originZ = 3000;
  const output: unknown[] = [];
  packetLog.set(p, output);
  p.write = (message) => output.push(message);
  return p;
}

function start(
  p: Player,
  scriptName: string,
  args: (number | string)[] = [],
  target: Loc | null = null,
): ScriptState {
  const script = ScriptProvider.getByName(scriptName);
  assert(script, `missing packed script ${scriptName}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${scriptName} aborted`);
  return state;
}

function add(p: Player, name: string, count: number): void {
  p.invAdd(InvType.getId("inv"), requiredId(name), count);
}

function inventory(p: Player, name: string): number {
  return p.invTotal(InvType.getId("inv"), requiredId(name));
}

function tick(p: Player): void {
  if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
  if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED)
    p.executeScript(p.activeScript, true, true);
  p.processQueues();
  World.currentTick++;
}

function drain(p: Player): void {
  for (let i = 0; i < 100; i++) tick(p);
}

function promptIndex(size: number): number {
  return size * 5 + 2;
}

function modelIndex(index: number): number {
  return index + 2;
}

function makeOneIndex(size: number, product: number): number {
  return size + 5 + product * 4;
}

function buttonIndex(size: number, product: number, option: number): number {
  return size + 2 + product * 4 + option;
}

type MenuProduct = {
  object: string;
  x: number;
  y: number;
  scale: number;
  label: string;
};

function assertMenuPackets(
  p: Player,
  firstPacket: number,
  size: number,
  expected: MenuProduct[],
  prompt: string | null,
): void {
  const rootName = `skillmulti${size}`;
  const rootId = requiredComponent(rootName);
  const modelIds = new Map(
    expected.map((product, index) => [
      requiredComponent(`${rootName}:com_${modelIndex(index)}`),
      index,
    ]),
  );
  const makeOneIds = new Map(
    expected.map((product, index) => [
      requiredComponent(`${rootName}:com_${makeOneIndex(size, index)}`),
      index,
    ]),
  );
  const promptId = requiredComponent(`${rootName}:com_${promptIndex(size)}`);
  const observed = packetLog.get(p)!.slice(firstPacket);
  const openIndex = observed.findIndex(
    (packet) => packet instanceof IfOpenChat && packet.component === rootId,
  );
  const lastSetter = observed.findLastIndex(
    (packet) =>
      ((packet instanceof IfSetPosition || packet instanceof IfSetObject) &&
        modelIds.has(packet.component)) ||
      (packet instanceof IfSetText &&
        (makeOneIds.has(packet.component) || packet.component === promptId)),
  );
  assert(
    lastSetter >= 0 && openIndex > lastSetter,
    `${rootName} must open after its last setter so the 377 client repaints`,
  );


  assert.deepEqual(
    observed
      .filter((packet): packet is IfOpenChat => packet instanceof IfOpenChat)
      .map((packet) => packet.component),
    [rootId],
    `${rootName} must open the packed chat root`,
  );
  assert.deepEqual(
    observed
      .filter(
        (packet): packet is IfSetPosition =>
          packet instanceof IfSetPosition && modelIds.has(packet.component),
      )
      .map((packet) => ({
        product: modelIds.get(packet.component),
        x: packet.x,
        y: packet.y,
      })),
    expected.map((product, index) => ({
      product: index,
      x: product.x,
      y: product.y,
    })),
    `${rootName} model positions and product order`,
  );
  assert.deepEqual(
    observed
      .filter(
        (packet): packet is IfSetObject =>
          packet instanceof IfSetObject && modelIds.has(packet.component),
      )
      .map((packet) => ({
        product: modelIds.get(packet.component),
        object: packet.obj,
        scale: packet.scale,
      })),
    expected.map((product, index) => ({
      product: index,
      object: requiredId(product.object),
      scale: product.scale,
    })),
    `${rootName} model objects, scales, and product order`,
  );
  assert.deepEqual(
    observed
      .filter(
        (packet): packet is IfSetText =>
          packet instanceof IfSetText && makeOneIds.has(packet.component),
      )
      .map((packet) => ({
        product: makeOneIds.get(packet.component),
        text: packet.text,
      })),
    expected.map((product, index) => ({
      product: index,
      text: product.label,
    })),
    `${rootName} Make 1 labels and product order`,
  );
  assert.deepEqual(
    observed
      .filter(
        (packet): packet is IfSetText =>
          packet instanceof IfSetText && packet.component === promptId,
      )
      .map((packet) => packet.text),
    prompt === null ? [] : [prompt],
    `${rootName} prompt text`,
  );
  checks++;
}

function pressMenuButton(
  p: Player,
  state: ScriptState,
  size: number,
  product: number,
  option: number,
  count: number,
  assertAmount = true,
): void {
  const component = requiredComponent(
    `skillmulti${size}:com_${buttonIndex(size, product, option)}`,
  );
  assert(button.handle(new IfButton(component), p), "packed Make button rejected");
  if (option === 0) {
    assert.equal(state.execution, ScriptState.COUNTDIALOG);
    assert(
      countDialog.handle(new ResumePCountDialog(count), p),
      "packed count-dialog response rejected",
    );
  }
  drain(p);
  assert.equal(state.execution, ScriptState.FINISHED, "choice should return to caller");
  if (assertAmount) assert.equal(state.popInt(), count, "selected amount returned to caller");
}

function assertReturnedObject(state: ScriptState, expectedObject: string): void {
  assert.equal(state.popInt(), requiredId(expectedObject), "selected product returned to caller");
  checks++;
}

function callArgs(products: MenuProduct[]): (number | string)[] {
  return products.flatMap((product) => [
    requiredId(product.object),
    product.x,
    product.y,
    product.scale,
    product.label,
  ]);
}

function syntheticProducts(objects: string[], size: number): MenuProduct[] {
  return objects.slice(0, size).map((object, index) => ({
    object,
    x: -11 + index * 7,
    y: -5 - index * 3,
    scale: 130 + size * 10 + index,
    label: labels(`Test ${object.replaceAll("_", " ")}`),
  }));
}

function startMenu(p: Player, trigger: string, target: Loc | null = null): ScriptState {
  const state = start(p, trigger, [], target);
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${trigger} should pause on its menu`);
  return state;
}

function openFletching(log: string): { player: Player; state: ScriptState } {
  const p = player();
  add(p, "knife", 1);
  add(p, log, 1);
  p.lastItem = requiredId(log);
  p.lastUseItem = requiredId("knife");
  return { player: p, state: startMenu(p, "[opheldu,_category_22]") };
}

function openGlass(): { player: Player; state: ScriptState } {
  const p = player();
  add(p, "glassblowingpipe", 1);
  add(p, "molten_glass", 1);
  p.lastItem = requiredId("glassblowingpipe");
  p.lastUseItem = requiredId("molten_glass");
  p.lastUseSlot = 1;
  return { player: p, state: startMenu(p, "[opheldu,glassblowingpipe]") };
}

function openDhide(leather: string): { player: Player; state: ScriptState } {
  const p = player();
  add(p, "needle", 1);
  add(p, leather, 3);
  add(p, "thread", 1);
  p.lastItem = requiredId("needle");
  p.lastUseItem = requiredId(leather);
  p.lastUseSlot = 1;
  return { player: p, state: startMenu(p, "[opheldu,needle]") };
}

function potteryWheel(): Loc {
  const type = LocType.getId("potterywheel");
  assert(type >= 0, "missing pottery wheel location");
  return new Loc(0, 3200, 3200, 1, 1, EntityLifeCycle.RESPAWN, type, 10, 0);
}

function openPottery(p: Player): ScriptState {
  add(p, "softclay", 1);
  p.lastUseItem = requiredId("softclay");
  p.lastUseSlot = 0;
  return startMenu(p, "[oplocu,potterywheel]", potteryWheel());
}

function assertCrafted(p: Player, input: string, output: string, amount = 1): void {
  drain(p);
  assert.equal(inventory(p, input), 0, `${input} should be consumed`);
  assert.equal(inventory(p, output), amount, `${output} should be produced`);
  checks++;
}

try {
  const configs = [
    VarPlayerType,
    VarBitType,
    VarNpcType,
    ParamType,
    ObjType,
    LocType,
    InvType,
    CategoryType,
    EnumType,
    StructType,
    SeqType,
    MesanimType,
    DbTableType,
    DbRowType,
  ];
  for (const config of configs) config.load(packDir);
  DbTableIndex.init();
  Component.load(packDir);
  FontType.load(packDir);
  assert(ScriptProvider.load(packDir) > 0, `no compiled scripts in ${packDir}`);
  World.currentTick = 100;

  if (mutantSwapLabels) {
    const script = ScriptProvider.getByName("[label,fletch_log]");
    assert(script, "mutant requires packed fletching caller");
    const first = script.stringOperands.indexOf(labels("15 Arrow Shafts"));
    const second = script.stringOperands.indexOf(labels("Short Bow"));
    assert(first >= 0 && second >= 0, "mutant requires both fletching label literals");
    [script.stringOperands[first], script.stringOperands[second]] =
      [script.stringOperands[second], script.stringOperands[first]];
    mutantApplied = true;
    console.error("MUTANT: swapped two packed fletching label operands; failure is expected");
  }


  // Ordinary fletching dispatch: the standard log menu has three products;
  // each other published bow-wood row has two. Product IDs stay in caller order.
  const fletchingMenus = [
    {
      log: "logs",
      size: 3,
      products: [
        { object: "arrow_shaft", x: 5, y: -15, scale: 175, label: labels("15 Arrow Shafts") },
        { object: "shortbow", x: 9, y: -11, scale: 175, label: labels("Short Bow") },
        { object: "longbow", x: 0, y: -15, scale: 175, label: labels("Long Bow") },
      ],
      result: "arrow_shaft",
      resultCount: 15,
    },
    ...[
      ["oak_logs", "Oak", "unstrung_oak_shortbow", "unstrung_oak_longbow"],
      ["willow_logs", "Willow", "unstrung_willow_shortbow", "unstrung_willow_longbow"],
      ["maple_logs", "Maple", "unstrung_maple_shortbow", "unstrung_maple_longbow"],
      ["yew_logs", "Yew", "unstrung_yew_shortbow", "unstrung_yew_longbow"],
      ["magic_logs", "Magic", "unstrung_magic_shortbow", "unstrung_magic_longbow"],
    ].map(([log, wood, shortbow, longbow]) => ({
      log,
      size: 2,
      products: [
        { object: shortbow.replace("unstrung_", ""), x: 0, y: -15, scale: 175, label: labels(`${wood} Short Bow`) },
        { object: longbow.replace("unstrung_", ""), x: 0, y: -15, scale: 175, label: labels(`${wood} Long Bow`) },
      ],
      result: shortbow,
      resultCount: 1,
    })),
  ];
  for (const menu of fletchingMenus) {
    const { player: p, state } = openFletching(menu.log);
    const firstPacket = 0;
    assertMenuPackets(p, firstPacket, menu.size, menu.products, defaultPrompt);
    pressMenuButton(p, state, menu.size, 0, 3, 1, false);
    assertCrafted(p, menu.log, menu.result, menu.resultCount);
  }

  // Glass-blowing's ordinary held-item trigger and all three published models.
  const glassProducts: MenuProduct[] = [
    { object: "beer_glass", x: 0, y: 5, scale: 200, label: labels("Beer Glass") },
    { object: "vial_empty", x: 2, y: 10, scale: 180, label: labels("Vial") },
    { object: "stafforb", x: 2, y: -10, scale: 200, label: labels("Orb") },
  ];
  const glass = openGlass();
  assertMenuPackets(glass.player, 0, 3, glassProducts, defaultPrompt);
  pressMenuButton(glass.player, glass.state, 3, 0, 3, 1, false);
  assertCrafted(glass.player, "molten_glass", "beer_glass");

  // Dragonhide dispatch derives four color-specific product sets from the pack.
  const dhideColors = [
    ["dragon_leather", "Green", "dragonhide_body", "dragon_vambraces", "dragonhide_chaps"],
    ["dragon_leather_blue", "Blue", "blue_dragonhide_body", "blue_dragon_vambraces", "blue_dragonhide_chaps"],
    ["dragon_leather_red", "Red", "red_dragonhide_body", "red_dragon_vambraces", "red_dragonhide_chaps"],
    ["dragon_leather_black", "Black", "black_dragonhide_body", "black_dragon_vambraces", "black_dragonhide_chaps"],
  ];
  for (const [leather, color, body, vambraces, chaps] of dhideColors) {
    const { player: p, state } = openDhide(leather);
    const products: MenuProduct[] = [
      { object: body, x: 1, y: -19, scale: 155, label: labels(`${color} body`) },
      { object: vambraces, x: 1, y: -23, scale: 180, label: labels(`${color} vambraces`) },
      { object: chaps, x: 2, y: -22, scale: 180, label: labels(`${color} chaps`) },
    ];
    assertMenuPackets(p, 0, 3, products, defaultPrompt);
    pressMenuButton(p, state, 3, 0, 3, 1, false);
    assertCrafted(p, leather, body);
  }

  // Pottery-wheel dispatch keeps its three original products and Make 1 return.
  const potteryProducts: MenuProduct[] = [
    { object: "pot_unfired", x: 0, y: 2, scale: 185, label: labels("Pot") },
    { object: "piedish_unfired", x: 0, y: -4, scale: 190, label: labels("Pie Dish") },
    { object: "bowl_unfired", x: 0, y: 0, scale: 200, label: labels("Bowl") },
  ];
  const potteryPlayer = player();
  const potteryState = openPottery(potteryPlayer);
  assertMenuPackets(potteryPlayer, 0, 3, potteryProducts, defaultPrompt);
  pressMenuButton(potteryPlayer, potteryState, 3, 0, 3, 1, false);
  assertCrafted(potteryPlayer, "softclay", "pot_unfired");

  // The retained single-item cache still takes only a product id and restores
  // its own static title when opened.
  const retained = player();
  const retainedObject = "bronze_bar";
  const retainedStart = packetLog.get(retained)!.length;
  const retainedState = start(
    retained,
    "[proc,skillmulti1]",
    [requiredId(retainedObject)],
  );
  assert.equal(retainedState.execution, ScriptState.PAUSEBUTTON);
  const singlePrompt = requiredComponent("skillmulti1:com_7");
  assert.deepEqual(
    packetLog
      .get(retained)!
      .slice(retainedStart)
      .filter(
        (packet): packet is IfSetText =>
          packet instanceof IfSetText && packet.component === singlePrompt,
      )
      .map((packet) => packet.text),
    ["How many would you like to make?"],
  );
  assert.equal(
    packetLog.get(retained)!.filter((packet) => packet instanceof IfSetText).length,
    1,
    "single-item cache must not set a product label",
  );
  assert.equal(retained.resumeButtons.length, 4);
  pressMenuButton(retained, retainedState, 1, 0, 3, 1);
  assertReturnedObject(retainedState, retainedObject);
  // One shared skillmulti3 client root receives two real caller menus in order.
  // The second menu must replace all three prior labels rather than inherit any.
  const shared = player();
  add(shared, "glassblowingpipe", 1);
  add(shared, "molten_glass", 1);
  shared.lastItem = requiredId("glassblowingpipe");
  shared.lastUseItem = requiredId("molten_glass");
  shared.lastUseSlot = 1;
  const firstSharedPacket = packetLog.get(shared)!.length;
  const firstShared = startMenu(shared, "[opheldu,glassblowingpipe]");
  assertMenuPackets(shared, firstSharedPacket, 3, glassProducts, defaultPrompt);
  pressMenuButton(shared, firstShared, 3, 0, 3, 1, false);
  assertCrafted(shared, "molten_glass", "beer_glass");
  add(shared, "softclay", 1);
  shared.lastUseItem = requiredId("softclay");
  shared.lastUseSlot = 1;
  const secondSharedPacket = packetLog.get(shared)!.length;
  const secondShared = startMenu(shared, "[oplocu,potterywheel]", potteryWheel());
  assertMenuPackets(shared, secondSharedPacket, 3, potteryProducts, defaultPrompt);
  pressMenuButton(shared, secondShared, 3, 0, 3, 1, false);
  assertCrafted(shared, "softclay", "pot_unfired");

  // The title is mutable on skillmulti2. Prove a header call is followed by an
  // ordinary call that resets both the prompt and every product label.
  const resetPlayer = player();
  const firstTwo = syntheticProducts(["bronze_bar", "iron_bar"], 2);
  const header = "Choose a metal product";
  const headerStart = packetLog.get(resetPlayer)!.length;
  const headed = start(
    resetPlayer,
    "[proc,skill_multi2_header]",
    [header, ...callArgs(firstTwo)],
  );
  assert.equal(headed.execution, ScriptState.PAUSEBUTTON);
  assertMenuPackets(resetPlayer, headerStart, 2, firstTwo, header);
  pressMenuButton(resetPlayer, headed, 2, 1, 2, 5);
  assertReturnedObject(headed, "iron_bar");

  const secondTwo = [
    { ...firstTwo[0], x: 4, y: -15, scale: 175, label: labels("New first product") },
    { ...firstTwo[1], x: -3, y: -10, scale: 190, label: labels("New second product") },
  ];
  const ordinaryStart = packetLog.get(resetPlayer)!.length;
  const ordinary = start(resetPlayer, "[proc,skill_multi2]", callArgs(secondTwo));
  assert.equal(ordinary.execution, ScriptState.PAUSEBUTTON);
  assertMenuPackets(resetPlayer, ordinaryStart, 2, secondTwo, defaultPrompt);
  pressMenuButton(resetPlayer, ordinary, 2, 1, 0, 7);
  assertReturnedObject(ordinary, "iron_bar");

  // Every button on every migrated helper returns the selected named object and
  // exact amount. Existing production batch coverage remains in
  // tests/fletching-choice/runtime.mts and tests/leather-batch/test_leather_batch.mjs.
  const bars = ["bronze_bar", "iron_bar", "steel_bar", "mithril_bar", "runite_bar"];
  for (let size = 2; size <= 5; size++) {
    const products = syntheticProducts(bars, size);
    for (let product = 0; product < size; product++) {
      for (const choice of [
        { option: 0, count: 3 },
        { option: 1, count: 10 },
        { option: 2, count: 5 },
        { option: 3, count: 1 },
      ]) {
        const p = player();
        const firstPacket = packetLog.get(p)!.length;
        const state = start(p, `[proc,skill_multi${size}]`, callArgs(products));
        assert.equal(state.execution, ScriptState.PAUSEBUTTON);
        assert.equal(p.resumeButtons.length, size * 4);
        assertMenuPackets(
          p,
          firstPacket,
          size,
          products,
          defaultPrompt,
        );
        pressMenuButton(p, state, size, product, choice.option, choice.count);
        assertReturnedObject(state, products[product].object);
      }
    }
  }

  if (mutantSwapLabels) {
    assert(mutantApplied, "label-swap mutant did not reach a multi-product menu");
    assert.fail("swapped-label mutant should have failed the menu assertions");
  }

  console.log(
    `PASS ${checks} packed skill-menu trigger, packet, reset, and button scenarios (no engine start)`,
  );
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
