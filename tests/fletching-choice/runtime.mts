// Executes packed RuneScript and real button/count-dialog handlers, not a world server.
import assert from "node:assert/strict";
import Component from "#/cache/config/Component.js";
import VarPlayerType from "#/cache/config/VarPlayerType.js";
import ParamType from "#/cache/config/ParamType.js";
import ObjType from "#/cache/config/ObjType.js";
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
import { PlayerStat } from "#/engine/entity/PlayerStat.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import World from "#/engine/World.js";
import IfButtonHandler from "#/network/game/client/handler/IfButtonHandler.js";
import IfButton from "#/network/game/client/model/IfButton.js";
import ResumePCountDialogHandler from "#/network/game/client/handler/ResumePCountDialogHandler.js";
import ResumePCountDialog from "#/network/game/client/model/ResumePCountDialog.js";
import IfSetHide from "#/network/game/server/model/IfSetHide.js";

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
): ScriptState {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing script ${name}`);
  const state = ScriptRunner.init(script, p, null, args);
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

try {
  for (const config of [
    VarPlayerType,
    ParamType,
    ObjType,
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

  // Pottery uses multiobj3. Dragonhide uses multiobj3_close. Both return one obj.
  for (const [proc, objects] of [
    ["multiobj3", ["pot_unfired", "piedish_unfired", "bowl_unfired"]],
    [
      "multiobj3_close",
      ["dragonhide_body", "dragon_vambraces", "dragonhide_chaps"],
    ],
  ] as [string, string[]][]) {
    for (let i = 0; i < objects.length; i++) {
      const p = player();
      const state = start(
        p,
        `[proc,${proc}]`,
        chooserArgs(objects, proc.endsWith("_close")),
      );
      assert.equal(state.execution, ScriptState.PAUSEBUTTON);
      assert.equal(p.resumeButtons.length, 3);
      for (const index of [5, 6, 7, 9, 10, 11, 13, 14, 15]) {
        assert(
          !p.resumeButtons.includes(component(`skillmulti3:com_${index}`)),
        );
        assert(
          packets
            .get(p)!
            .some(
              (packet) =>
                packet instanceof IfSetHide &&
                packet.component === component(`skillmulti3:com_${index}`) &&
                packet.hidden,
            ),
        );
      }
      click(p, `skillmulti3:com_${8 + i * 4}`);
      assert.equal(state.execution, ScriptState.FINISHED);
      assert.equal(state.popInt(), id(objects[i]));
      // Reopen the shared interface: fletching must restore every quantity layer.
      const next = start(p, "[proc,skillmulti3]", objects.map(id));
      assert.equal(next.execution, ScriptState.PAUSEBUTTON);
      assert.equal(p.resumeButtons.length, 12);
      assert(
        packets
          .get(p)!
          .some(
            (packet) =>
              packet instanceof IfSetHide &&
              packet.component === component("skillmulti3:com_5") &&
              !packet.hidden,
          ),
      );
      quantity(p, "skillmulti3", i, 5);
      assert.equal(next.execution, ScriptState.FINISHED);
      assert.equal(next.popInt(), 5);
      assert.equal(next.popInt(), id(objects[i]));
      checks++;
    }
  }
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
  // All related skillmulti procs: every product and every cache quantity layer resumes.
  const objects = [
    "bronze_bar",
    "iron_bar",
    "steel_bar",
    "mithril_bar",
    "runite_bar",
  ];
  for (let size = 1; size <= 5; size++) {
    for (let product = 0; product < size; product++) {
      for (let option = 0; option < 4; option++) {
        const p = player();
        const state = start(
          p,
          `[proc,skillmulti${size}]`,
          objects.slice(0, size).map(id),
        );
        assert.equal(state.execution, ScriptState.PAUSEBUTTON);
        assert.equal(p.resumeButtons.length, size * 4);
        click(p, `skillmulti${size}:com_${size + 2 + product * 4 + option}`);
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
