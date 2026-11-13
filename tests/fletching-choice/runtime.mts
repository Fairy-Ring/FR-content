// Executes packed RuneScript and real button/count-dialog handlers, not a world server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Component from "#/cache/config/Component.js";
import VarPlayerType from "#/cache/config/VarPlayerType.js";
import ParamType from "#/cache/config/ParamType.js";
import ObjType from "#/cache/config/ObjType.js";
import LocType from "#/cache/config/LocType.js";
import InvType from "#/cache/config/InvType.js";
import CategoryType from "#/cache/config/CategoryType.js";
import EnumType from "#/cache/config/EnumType.js";
import StructType from "#/cache/config/StructType.js";
import SeqType from "#/cache/config/SeqType.js";
import MesanimType from "#/cache/config/MesanimType.js";
import DbTableType from "#/cache/config/DbTableType.js";
import DbRowType from "#/cache/config/DbRowType.js";
import DbTableIndex from "#/cache/config/DbTableIndex.js";
import FontType from "#/cache/config/FontType.js";
import Player from "#/engine/entity/Player.js";
import Loc from "#/engine/entity/Loc.js";
import { EntityLifeCycle } from "#/engine/entity/EntityLifeCycle.js";
import { PlayerStat } from "#/engine/entity/PlayerStat.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import World from "#/engine/World.js";
import IfButtonHandler from "#/network/game/client/handler/IfButtonHandler.js";
import IfButton from "#/network/game/client/model/IfButton.js";
import ResumePCountDialogHandler from "#/network/game/client/handler/ResumePCountDialogHandler.js";
import ResumePCountDialog from "#/network/game/client/model/ResumePCountDialog.js";
import ResumePauseButtonHandler from "#/network/game/client/handler/ResumePauseButtonHandler.js";
import ResumePauseButton from "#/network/game/client/model/ResumePauseButton.js";
import IfSetPosition from "#/network/game/server/model/IfSetPosition.js";
import IfSetObject from "#/network/game/server/model/IfSetObject.js";
import IfSetText from "#/network/game/server/model/IfSetText.js";

let checks = 0;
const button = new IfButtonHandler();
const countDialog = new ResumePCountDialogHandler();
const packets = new WeakMap<Player, unknown[]>();
function id(name: string): number {
  const value = ObjType.getId(name);
  assert(value >= 0, `missing object ${name}`);
  return value;
}
function component(name: string): number {
  const value = Component.getId(name);
  assert(value >= 0, `missing component ${name}`);
  return value;
}
function player(level = 99): Player {
  const p = new Player("fletchtest", 1n, 0n);
  p.pid = 1;
  p.uid = 1;
  p.vars.fill(0);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.baseLevels[PlayerStat.FLETCHING] = level;
  p.levels[PlayerStat.FLETCHING] = level;
  p.stats[PlayerStat.FLETCHING] = level === 99 ? 130344310 : 0;
  p.stats[PlayerStat.CRAFTING] = 130344310;
  p.stats[PlayerStat.COOKING] = 130344310;
  p.buildArea.originX = 3000;
  p.buildArea.originZ = 3000;
  const output: unknown[] = [];
  packets.set(p, output);
  p.write = (message) => {
    output.push(message);
  };
  return p;
}
function start(
  p: Player,
  name: string,
  args: (number | string)[] = [],
  target: Loc | null = null,
): ScriptState {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing script ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, name);
  return state;
}
function click(p: Player, name: string): void {
  assert(
    button.handle(new IfButton(component(name)), p),
    `button ${name} rejected`,
  );
}
function tick(p: Player): void {
  // Mirror World.processPlayers' delayed-script phase before its queue phase.
  if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
  if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED)
    p.executeScript(p.activeScript, true, true);
  p.processQueues();
  World.currentTick++;
}
function drain(p: Player): void {
  for (let i = 0; i < 100; i++) tick(p);
}
function beginLogs(
  p: Player,
  log: string,
  amount: number,
  reverse = false,
): ScriptState {
  p.invAdd(InvType.getId("inv"), id("knife"), 1);
  p.invAdd(InvType.getId("inv"), id(log), amount);
  p.lastItem = id(reverse ? "knife" : log);
  p.lastUseItem = id(reverse ? log : "knife");
  const state = start(
    p,
    reverse ? "[opheldu,knife]" : "[opheldu,_category_22]",
  );
  assert.equal(state.execution, ScriptState.PAUSEBUTTON);
  return state;
}
function quantity(p: Player, root: string, product: number, n: number): void {
  // Cache layers are ordered Make X, Make 10, Make 5, Make 1.
  const offset = n === 1 ? 3 : n === 5 ? 2 : n === 10 ? 1 : 0;
  click(
    p,
    `${root}:com_${(root === "skillmulti2" ? 4 : 5) + product * 4 + offset}`,
  );
  if (offset === 0) {
    assert.equal(p.activeScript?.execution, ScriptState.COUNTDIALOG);
    assert(countDialog.handle(new ResumePCountDialog(n), p));
  }
  drain(p);
}
function inventory(p: Player, obj: string): number {
  return p.invTotal(InvType.getId("inv"), id(obj));
}
function chooserArgs(objects: string[], close: boolean): (number | string)[] {
  return [
    "Choose a product",
    ...objects.flatMap((obj) =>
      close ? [id(obj), 175, obj] : [id(obj), 0, 0, 175, obj, 0, 0],
    ),
  ];
}

function skillmulti3Buttons(p: Player) {
  const root = Component.get(component("skillmulti3"));
  const offsets = new Map<number, IfSetPosition>();
  for (const packet of packets.get(p)!)
    if (packet instanceof IfSetPosition) offsets.set(packet.component, packet);
  return [...root.childId!].flatMap((id, index) => {
    const child = Component.get(id);
    if (child.buttonType !== 1) return [];
    // Client-Java 377:11305-11342. Non-layer hide is deliberately ignored.
    const x = root.childX![index] + (offsets.get(id)?.x ?? 0);
    const y = root.childY![index] + (offsets.get(id)?.y ?? 0);
    return [
      {
        id,
        option: child.option,
        x,
        y,
        right: x + child.width,
        bottom: y + child.height,
        reachable:
          x <= root.width &&
          y <= root.height &&
          x + child.width > 0 &&
          y + child.height > 0,
      },
    ];
  });
}

function assertSkillmulti3Menu(p: Player): void {
  const buttons = skillmulti3Buttons(p);
  const reachable = buttons.filter((b) => b.reachable);
  // Check the entire root, not just one click point: no unreachable registration
  // or unregistered hitbox can leave a dead right-click entry elsewhere.
  assert.deepEqual(
    reachable.map((b) => b.id).sort((a, b) => a - b),
    [...p.resumeButtons].sort((a, b) => a - b),
  );
  for (const index of [8, 12, 16]) {
    const product = buttons.find(
      (b) => b.id === component(`skillmulti3:com_${index}`),
    )!;
    const x = product.x + 50;
    const y = product.y + 40;
    assert.deepEqual(
      reachable
        .filter((b) => x >= b.x && x < b.right && y >= b.y && y < b.bottom)
        .map((b) => b.option),
      ["Make X", "Make 10", "Make 5", "Make 1"],
    );
  }
}

type CraftRecipe = [
  family: "glass" | "pottery" | "dhide",
  product: string,
  selection: number,
  input: string,
  per: number,
  xp: number,
  level: number,
];

function beginCraft(p: Player, recipe: CraftRecipe): ScriptState {
  const [family, , , input] = recipe;
  const tool = family === "glass" ? "glassblowingpipe" : "needle";
  if (family !== "pottery") p.invAdd(InvType.getId("inv"), id(tool), 1);
  p.invAdd(InvType.getId("inv"), id(input), 24);
  if (family === "dhide") p.invAdd(InvType.getId("inv"), id("thread"), 100);
  assert.equal(inventory(p, input), 24, "fixture stock");
  p.lastUseItem = id(input);
  p.lastUseSlot = family === "pottery" ? 0 : 1;
  if (family === "pottery") {
    const type = LocType.getId("potterywheel");
    assert(type >= 0);
    return start(
      p,
      "[oplocu,potterywheel]",
      [],
      new Loc(0, 3200, 3200, 1, 1, EntityLifeCycle.RESPAWN, type, 10, 0),
    );
  }
  p.lastItem = id(tool);
  return start(p, `[opheldu,${tool}]`);
}

try {
  for (const config of [
    VarPlayerType,
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
  ])
    config.load("data/pack");
  DbTableIndex.init();
  Component.load("data/pack");
  FontType.load("data/pack");
  ScriptProvider.load("data/pack");

  // Ordinary logs offer three products; each other supported log offers two.
  const recipes: [string, string, number, number, number][] = [
    ["logs", "arrow_shaft", 0, 15, 50],
    ["logs", "unstrung_shortbow", 1, 1, 50],
    ["logs", "unstrung_longbow", 2, 1, 100],
    ["oak_logs", "unstrung_oak_shortbow", 0, 1, 165],
    ["oak_logs", "unstrung_oak_longbow", 1, 1, 250],
    ["willow_logs", "unstrung_willow_shortbow", 0, 1, 333],
    ["willow_logs", "unstrung_willow_longbow", 1, 1, 415],
    ["maple_logs", "unstrung_maple_shortbow", 0, 1, 500],
    ["maple_logs", "unstrung_maple_longbow", 1, 1, 583],
    ["yew_logs", "unstrung_yew_shortbow", 0, 1, 675],
    ["yew_logs", "unstrung_yew_longbow", 1, 1, 750],
    ["magic_logs", "unstrung_magic_shortbow", 0, 1, 833],
    ["magic_logs", "unstrung_magic_longbow", 1, 1, 915],
  ];
  for (const [log, product, selection, output, xp] of recipes) {
    const p = player();
    const before = p.stats[PlayerStat.FLETCHING];
    beginLogs(p, log, 3, product === "unstrung_longbow");
    quantity(p, log === "logs" ? "skillmulti3" : "skillmulti2", selection, 1);
    assert.equal(inventory(p, log), 2, `${log} consumed`);
    assert.equal(inventory(p, product), output, product);
    assert.equal(p.stats[PlayerStat.FLETCHING] - before, xp, `${product} XP`);
    checks++;
  }
  // World processes input before queues in the same tick. Check both the initial
  // input-armed queue and every queue-armed repeat, including Make X resumption.
  for (const [log, product, selection, output, xp] of recipes) {
    for (const makeX of [false, true]) {
      const p = player();
      const before = p.stats[PlayerStat.FLETCHING];
      beginLogs(p, log, 12);
      const root = log === "logs" ? "skillmulti3" : "skillmulti2";
      const base = root === "skillmulti3" ? 5 : 4;
      click(p, `${root}:com_${base + selection * 4 + (makeX ? 0 : 1)}`);
      if (makeX) {
        assert.equal(p.activeScript?.execution, ScriptState.COUNTDIALOG);
        assert(countDialog.handle(new ResumePCountDialog(10), p));
      }
      const startTick = World.currentTick;
      const cuts: number[] = [];
      let previous = 12;
      for (let elapsed = 0; elapsed < 32; elapsed++) {
        // Read after the queue pass, before advancing to the next input phase.
        p.processQueues();
        const remaining = inventory(p, log);
        if (remaining !== previous) {
          assert.equal(previous - remaining, 1, "one log per cut");
          cuts.push(World.currentTick - startTick);
          previous = remaining;
        }
        World.currentTick++;
      }
      assert.deepEqual(cuts, [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
      assert.equal(inventory(p, log), 2, "requested count stops the queue");
      assert.equal(inventory(p, product), output * 10);
      assert.equal(p.stats[PlayerStat.FLETCHING] - before, xp * 10);
      console.log(
        `CADENCE ${product} ${makeX ? "Make X=10" : "Make 10"} cuts=${cuts.join(",")} gaps=${cuts
          .slice(1)
          .map((t, i) => t - cuts[i])
          .join(",")}`,
      );
      checks++;
    }
  }
  for (const n of [5, 10, 3, 28, 0, -1]) {
    const p = player();
    beginLogs(p, "logs", 12);
    quantity(p, "skillmulti3", 0, n);
    const made = Math.max(0, Math.min(n, 12));
    assert.equal(inventory(p, "arrow_shaft"), made * 15);
    assert.equal(inventory(p, "logs"), 12 - made);
    checks++;
  }
  const cancelled = player();
  beginLogs(cancelled, "logs", 5);
  cancelled.closeModal();
  drain(cancelled);
  assert.equal(inventory(cancelled, "logs"), 5);
  checks++;
  const minimums = [1, 5, 10, 20, 25, 35, 40, 50, 55, 65, 70, 80, 85];
  for (let i = 1; i < recipes.length; i++) {
    const [log, product, selection] = recipes[i];
    const low = player(minimums[i] - 1);
    beginLogs(low, log, 2);
    quantity(low, log === "logs" ? "skillmulti3" : "skillmulti2", selection, 1);
    assert.equal(inventory(low, log), 2);
    assert.equal(inventory(low, product), 0);
    assert.equal(low.stats[PlayerStat.FLETCHING], 0);
    checks++;
  }
  const interrupted = player();
  beginLogs(interrupted, "logs", 10);
  click(interrupted, "skillmulti3:com_6");
  tick(interrupted);
  assert.equal(inventory(interrupted, "logs"), 9, "first cut before walking");
  interrupted.stopAction();
  const remaining = inventory(interrupted, "logs");
  drain(interrupted);
  assert.equal(inventory(interrupted, "logs"), remaining);
  checks++;

  // Period batch menus: real callers, every product, every quantity layer.
  const crafts: CraftRecipe[] = [
    ["glass", "beer_glass", 0, "molten_glass", 1, 175, 1],
    ["glass", "vial_empty", 1, "molten_glass", 1, 350, 33],
    ["glass", "stafforb", 2, "molten_glass", 1, 525, 46],
    ["pottery", "pot_unfired", 0, "softclay", 1, 63, 1],
    ["pottery", "piedish_unfired", 1, "softclay", 1, 150, 7],
    ["pottery", "bowl_unfired", 2, "softclay", 1, 180, 8],
    ["dhide", "dragonhide_body", 0, "dragon_leather", 3, 1860, 63],
    ["dhide", "dragon_vambraces", 1, "dragon_leather", 1, 620, 57],
    ["dhide", "dragonhide_chaps", 2, "dragon_leather", 2, 1240, 60],
  ];
  for (const recipe of crafts) {
    const [family, product, selection, input, per, xp, level] = recipe;
    for (const requested of [1, 5, 10, 3, 28, 0, -2]) {
      const p = player();
      const before = p.stats[PlayerStat.CRAFTING];
      const state = beginCraft(p, recipe);
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${family} menu`);
      assertSkillmulti3Menu(p);
      quantity(p, "skillmulti3", selection, requested);
      const made = Math.max(0, Math.min(requested, Math.floor(24 / per)));
      assert.equal(inventory(p, product), made, `${product} Make ${requested}`);
      assert.equal(inventory(p, input), 24 - made * per);
      assert.equal(p.stats[PlayerStat.CRAFTING] - before, made * xp);
      if (family === "dhide")
        assert.equal(inventory(p, "thread"), 100 - Math.floor(made / 5));
      // A crafting chooser must not alter the next fletching chooser.
      beginLogs(p, "logs", 1);
      assertSkillmulti3Menu(p);
      p.stopAction();
      checks++;
    }
    // Walk/cancel during production, and before any product selection.
    for (const afterFirst of [false, true]) {
      const p = player();
      beginCraft(p, recipe);
      if (afterFirst) {
        click(p, `skillmulti3:com_${6 + selection * 4}`);
        for (let i = 0; i < 20 && !inventory(p, product); i++) tick(p);
        assert.equal(inventory(p, product), 1, `${family} first batch action`);
      }
      p.stopAction();
      const made = inventory(p, product);
      drain(p);
      assert.equal(inventory(p, product), made, `${family} interrupted`);
      checks++;
    }
    // Remove prerequisites directly between actions to distinguish a per-action
    // recheck from stopAction's ordinary weak-queue cancellation.
    for (const remove of family === "glass"
      ? ["glassblowingpipe"]
      : family === "dhide"
        ? ["needle", "thread"]
        : []) {
      const p = player();
      beginCraft(p, recipe);
      click(p, `skillmulti3:com_${6 + selection * 4}`);
      for (let i = 0; i < 20 && !inventory(p, product); i++) tick(p);
      assert.equal(inventory(p, product), 1);
      p.invDel(InvType.getId("inv"), id(remove), inventory(p, remove));
      drain(p);
      assert.equal(inventory(p, product), 1, `${family} missing ${remove}`);
      assert.equal(inventory(p, input), 24 - per);
      checks++;
    }
    if (level > 1) {
      const p = player();
      p.levels[PlayerStat.CRAFTING] = level - 1;
      beginCraft(p, recipe);
      quantity(p, "skillmulti3", selection, 5);
      assert.equal(inventory(p, input), 24, `${product} level refusal`);
      assert.equal(inventory(p, product), 0);
      assert.equal(p.stats[PlayerStat.CRAFTING], 130344310);
      checks++;
      const threshold = player();
      threshold.levels[PlayerStat.CRAFTING] = level;
      beginCraft(threshold, recipe);
      quantity(threshold, "skillmulti3", selection, 1);
      assert.equal(inventory(threshold, product), 1, `${product} threshold`);
      assert.equal(threshold.stats[PlayerStat.CRAFTING] - 130344310, xp);
      checks++;
    }
  }
  // Keep the separate OSF four-choice gate and its single-item potlid contract.
  const osf = player();
  const osfVar = VarPlayerType.getId("onesmallfavour");
  assert(osfVar >= 0);
  osf.vars[osfVar] = 35;
  beginCraft(osf, crafts[3]);
  assert.equal(osf.activeScript?.execution, ScriptState.PAUSEBUTTON);
  click(osf, "multi4:com_4");
  drain(osf);
  assert.equal(inventory(osf, "potlid_unfired"), 1);
  assert.equal(inventory(osf, "softclay"), 23);
  assert.equal(osf.stats[PlayerStat.CRAFTING] - 130344310, 200);
  checks++;
  // Unchanged multiobj2 callers (karambwan/fruit) use text overlays, not model buttons.
  for (const [index, name] of ["objtext1", "objtext2"].entries()) {
    const p = player();
    const objects = ["tbwt_poorly_cooked_karambwan", "tbwt_cooked_karambwan"];
    const state = start(p, "[proc,multiobj2]", chooserArgs(objects, false));
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
    click(p, `multiobj2:${name}`);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(state.popInt(), id(objects[index]));
    checks++;
  }
  // Every source recipe must retain its existing uncooked lookup, including
  // duplicate raw inputs. Cooked lookups now resolve the same complete row sets.
  const cooking = DbTableType.getByName("cooking_generic");
  assert(cooking);
  const source = readFileSync(process.env.COOKING_SOURCE!, "utf8");
  const cookingRecipes = source
    .split(/^\[/m)
    .slice(1)
    .map((section) => {
      const name = section.slice(0, section.indexOf("]"));
      const raw = /^data=uncooked,(.+)$/m.exec(section)?.[1];
      const cooked = /^data=cooked,(.+)$/m.exec(section)?.[1];
      assert(raw && cooked, name);
      return {
        name,
        raw: id(raw),
        cooked: cooked === "null" ? -1 : id(cooked),
      };
    });
  const rows = DbRowType.getInTable(cooking.id);
  assert.equal(rows.length, cookingRecipes.length);
  for (const recipe of cookingRecipes) {
    const row = DbRowType.getByName(recipe.name);
    assert(row);
    assert.deepEqual(row.getValue(1, 0), [recipe.raw]);
    assert.deepEqual(row.getValue(0, 0), [recipe.cooked]);
    for (const [column, value, field] of [
      [1, recipe.raw, "raw"],
      [0, recipe.cooked, "cooked"],
    ] as const) {
      const expected = cookingRecipes
        .filter((other) => other[field] === value)
        .map((other) => DbRowType.getId(other.name))
        .sort((a, b) => a - b);
      assert.deepEqual(
        [...DbTableIndex.find(value, (cooking.id << 12) | (column << 4))].sort(
          (a, b) => a - b,
        ),
        expected,
        `${recipe.name} ${field} lookup`,
      );
    }
    checks++;
  }
  console.log(
    `PASS cooking_generic lookup parity for all ${rows.length} source rows`,
  );
  // Raw oomlie remains a refusal: same text, no input loss, product or XP.
  for (const trigger of ["[oplocu,_cooking_oven]", "[oplocu,_cooking_fire]"]) {
    const p = player();
    p.invAdd(InvType.getId("inv"), id("raw_oomlie"), 1);
    p.lastUseItem = id("raw_oomlie");
    const loc = new Loc(
      0,
      3200,
      3200,
      1,
      1,
      EntityLifeCycle.RESPAWN,
      LocType.getId(
        trigger.endsWith("_cooking_fire]") ? "fire" : "cooksquestrange",
      ),
      10,
      0,
    );
    const state = start(p, trigger, [], loc);
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
    assert.equal(
      (packets.get(p) ?? [])
        .filter((packet): packet is IfSetText => packet instanceof IfSetText)
        .map((packet) => packet.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      "The meat is far too delicate to cook like this. Perhaps you should wrap it up to protect it from the heat.",
    );
    assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(), p));
    drain(p);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(inventory(p, "raw_oomlie"), 1);
    assert.equal(inventory(p, "cooked_oomlie"), 0);
    assert.equal(inventory(p, "burnt_oomlie"), 0);
    assert.equal(p.stats[PlayerStat.COOKING], 130344310);
    checks++;
  }
  // Exercise the real location-use cooking path, not just multiobj2's return.
  // Level 99 and high=255 give STAT_RANDOM value 256, so success is certain.
  for (const taught of [false, true]) {
    for (const selection of taught ? [0, 1] : [0]) {
      const p = player();
      const products = [
        "tbwt_poorly_cooked_karambwan",
        "tbwt_cooked_karambwan",
      ];
      const tinsay = VarPlayerType.getId("tbwt_tinsay");
      assert(tinsay >= 0);
      p.vars[tinsay] = taught ? 8 : 0;
      p.invAdd(InvType.getId("inv"), id("tbwt_raw_karambwan"), 1);
      p.lastUseItem = id("tbwt_raw_karambwan");
      const rangeId = LocType.getId("cooksquestrange");
      assert(rangeId >= 0);
      const range = new Loc(
        0,
        3200,
        3200,
        1,
        1,
        EntityLifeCycle.RESPAWN,
        rangeId,
        10,
        0,
      );
      const before = p.stats[PlayerStat.COOKING];
      const state = start(p, "[oplocu,_cooking_oven]", [], range);
      if (taught) {
        assert.equal(state.execution, ScriptState.PAUSEBUTTON);
        click(p, `multiobj2:objtext${selection + 1}`);
      }
      assert.equal(state.execution, ScriptState.FINISHED);
      assert.equal(inventory(p, "tbwt_raw_karambwan"), 0);
      assert.equal(inventory(p, products[selection]), 1);
      assert.equal(inventory(p, products[1 - selection]), 0);
      assert.equal(inventory(p, "tbwt_burnt_karambwan"), 0);
      assert.equal(
        p.stats[PlayerStat.COOKING] - before,
        selection ? 1900 : 800,
      );
      checks++;
    }
  }
  // Retained skillmulti1 and migrated helpers: every product and quantity layer.
  const objects = [
    "bronze_bar",
    "iron_bar",
    "steel_bar",
    "mithril_bar",
    "runite_bar",
  ];
  const productNames = ["Bronze bar", "Iron bar", "Steel bar", "Mithril bar", "Runite bar"];
  const productPositions = [
    [0, -15],
    [4, -11],
    [-3, 10],
    [6, -7],
    [8, 2],
  ];
  const productScales = [175, 180, 185, 190, 195];
  for (let size = 1; size <= 5; size++) {
    for (let product = 0; product < size; product++) {
      for (let option = 0; option < 4; option++) {
        const p = player();
        const products = objects.slice(0, size).map((object, index) => ({
          object,
          x: productPositions[index][0],
          y: productPositions[index][1],
          scale: productScales[index],
          label: `\\n\\n\\n\\n${productNames[index]}`,
        }));
        const args =
          size === 1
            ? [id(objects[0])]
            : products.flatMap((entry) => [
                id(entry.object),
                entry.x,
                entry.y,
                entry.scale,
                entry.label,
              ]);
        const name =
          size === 1 ? "[proc,skillmulti1]" : `[proc,skill_multi${size}]`;
        const packetStart = packets.get(p)!.length;
        const state = start(p, name, args);
        assert.equal(state.execution, ScriptState.PAUSEBUTTON);
        assert.equal(p.resumeButtons.length, size * 4);
        if (size === 1) {
          const observed = packets.get(p)!.slice(packetStart);
          assert.deepEqual(
            observed
              .filter(
                (packet): packet is IfSetObject =>
                  packet instanceof IfSetObject &&
                  packet.component === component("skillmulti1:com_2"),
              )
              .map((packet) => ({
                object: packet.obj,
                scale: packet.scale,
              })),
            [{ object: id(objects[0]), scale: 200 }],
          );
          assert.deepEqual(
            observed
              .filter(
                (packet): packet is IfSetText =>
                  packet instanceof IfSetText &&
                  packet.component === component("skillmulti1:com_7"),
              )
              .map((packet) => packet.text),
            ["How many would you like to make?"],
          );
          assert.equal(
            observed.filter((packet) => packet instanceof IfSetText).length,
            1,
            "single-item cache must not set a product label",
          );
        } else {
          const root = `skillmulti${size}`;
          const modelIds = new Map(
            products.map((entry, index) => [
              component(`${root}:com_${index + 2}`),
              index,
            ]),
          );
          const makeOneIds = new Map(
            products.map((entry, index) => [
              component(`${root}:com_${size + 5 + index * 4}`),
              index,
            ]),
          );
          const promptId = component(`${root}:com_${size * 5 + 2}`);
          const observed = packets.get(p)!.slice(packetStart);
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
            products.map((entry, index) => ({
              product: index,
              x: entry.x,
              y: entry.y,
            })),
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
            products.map((entry, index) => ({
              product: index,
              object: id(entry.object),
              scale: entry.scale,
            })),
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
            products.map((entry, index) => ({
              product: index,
              text: entry.label,
            })),
          );
          assert.deepEqual(
            observed
              .filter(
                (packet): packet is IfSetText =>
                  packet instanceof IfSetText && packet.component === promptId,
              )
              .map((packet) => packet.text),
            ["What would you like to make?"],
          );
        }
        click(
          p,
          `skillmulti${size}:com_${size + 2 + product * 4 + option}`,
        );
        if (state.execution === ScriptState.COUNTDIALOG)
          assert(countDialog.handle(new ResumePCountDialog(3), p));
        assert.equal(state.execution, ScriptState.FINISHED);
        const expected =
          size === 1 ? [0x7fffffff, 3, 5, 1][option] : [3, 10, 5, 1][option];
        assert.equal(state.popInt(), expected);
        assert.equal(state.popInt(), id(objects[product]));
        checks++;
      }
    }
  }
  console.log(
    `PASS ${checks} packed RuneScript fletching/shared-interface scenarios (no engine start)`,
  );
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
