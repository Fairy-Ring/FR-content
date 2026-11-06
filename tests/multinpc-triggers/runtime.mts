// Packed configs + production Player dispatch/ScriptRunner. No server is started.
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
import NpcType from "#/cache/config/NpcType.js";
import ObjType from "#/cache/config/ObjType.js";
import ParamType from "#/cache/config/ParamType.js";
import SeqType from "#/cache/config/SeqType.js";
import StructType from "#/cache/config/StructType.js";
import VarBitType from "#/cache/config/VarBitType.js";
import VarNpcType from "#/cache/config/VarNpcType.js";
import VarPlayerType from "#/cache/config/VarPlayerType.js";
import { EntityLifeCycle } from "#/engine/entity/EntityLifeCycle.js";
import { BlockWalk } from "#/engine/entity/BlockWalk.js";
import Npc from "#/engine/entity/Npc.js";
import Player from "#/engine/entity/Player.js";
import ScriptProvider from "#/engine/script/ScriptProvider.js";
import ScriptRunner from "#/engine/script/ScriptRunner.js";
import ScriptState from "#/engine/script/ScriptState.js";
import ServerTriggerType from "#/engine/script/ServerTriggerType.js";
import World from "#/engine/World.js";
import ResumePauseButtonHandler from "#/network/game/client/handler/ResumePauseButtonHandler.js";
import ResumePauseButton from "#/network/game/client/model/ResumePauseButton.js";
import IfSetText from "#/network/game/server/model/IfSetText.js";

let checks = 0;
let nextNid = 1;
const pause = new ResumePauseButtonHandler();
const packets = new WeakMap<Player, unknown[]>();
function pass(name: string): void {
  checks++;
  console.log(`PASS ${name}`);
}
function npc(name: string, x = 2589, z = 3358): Npc {
  const type = NpcType.getByName(name);
  assert(type, `missing npc ${name}`);
  const n = new Npc(
    0,
    x,
    z,
    1,
    1,
    EntityLifeCycle.RESPAWN,
    nextNid++,
    type.id,
    BlockWalk.NONE,
  );
  n.isActive = true;
  n.lastMovement = -100;
  return n;
}
function player(): Player {
  const p = new Player("multinpctest", 1n, 0n);
  p.pid = 1;
  p.uid = 1;
  p.vars.fill(0);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.buildArea.originX = 2500;
  p.buildArea.originZ = 3300;
  const output: unknown[] = [];
  packets.set(p, output);
  // Transport capture only. Dispatch and all script opcodes remain production code.
  p.write = (message) => {
    output.push(message);
  };
  return p;
}
function varp(p: Player, name: string, value?: number): number {
  const id = VarPlayerType.getId(name);
  assert(id >= 0, `missing varp ${name}`);
  if (value !== undefined) p.setVar(id, value);
  return p.getVar(id) as number;
}
function select(p: Player, n: Npc, slot: number): NpcType {
  const root = NpcType.get(n.type);
  assert(root.multinpc[slot] >= 0);
  if (root.multivarp !== -1) p.setVar(root.multivarp, slot);
  else {
    assert(root.multivarbit >= 0);
    p.setVarBit(root.multivarbit, slot);
    assert.equal(p.getVarBit(root.multivarbit), slot);
  }
  return NpcType.get(root.multinpc[slot]);
}
function dispatch(p: Player, n: Npc, op: ServerTriggerType) {
  p.target = n;
  p.targetOp = op - 7;
  const script = p.getOpTrigger();
  assert(script, `no dispatch for ${NpcType.get(n.type).debugname} op ${op}`);
  return script;
}
function start(p: Player, n: Npc, op: ServerTriggerType): ScriptState {
  const state = ScriptRunner.init(dispatch(p, n, op), p, n);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED);
  return state;
}
function finish(p: Player, state: ScriptState): void {
  for (
    let step = 0;
    state.execution !== ScriptState.FINISHED && step < 100;
    step++
  ) {
    assert.notEqual(state.execution, ScriptState.ABORTED);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      assert(pause.handle(new ResumePauseButton(), p));
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else assert.fail(`unexpected suspension ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED);
}
function text(p: Player): string {
  return packets
    .get(p)!
    .filter((m): m is IfSetText => m instanceof IfSetText)
    .map((m) => m.text)
    .join(" ");
}
function equip(p: Player): void {
  const worn = p.getInventory(InvType.getId("worn"))!;
  worn.set(4, { id: ObjType.getId("plague_jacket"), count: 1 });
  worn.set(7, { id: ObjType.getId("plague_trousers"), count: 1 });
  worn.set(3, { id: ObjType.getId("cattleprod"), count: 1 });
}

try {
  for (const config of [
    VarPlayerType,
    VarBitType,
    VarNpcType,
    ParamType,
    ObjType,
    LocType,
    NpcType,
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
  assert(ScriptProvider.load("data/pack") > 0);
  World.currentTick = 10;

  const roots: [string, ServerTriggerType[]][] = [
    ["juliet_multi_visible", [ServerTriggerType.OPNPC1]],
    ["reldo", [ServerTriggerType.OPNPC1]],
    ["sinister_stranger", [ServerTriggerType.OPNPC1]],
    ["elenap", [ServerTriggerType.OPNPC1]],
    ["elena2", [ServerTriggerType.OPNPC1]],
    ["edmond_top", [ServerTriggerType.OPNPC1]],
    ["edmond_bottom", [ServerTriggerType.OPNPC1]],
    ...[1, 2, 3, 4].map((i): [string, ServerTriggerType[]] => [
      `plaguesheep_${i}`,
      [ServerTriggerType.OPNPC1, ServerTriggerType.OPNPCU],
    ]),
    [
      "rcu_zammy_mage1",
      [
        ServerTriggerType.OPNPC1,
        ServerTriggerType.OPNPC3,
        ServerTriggerType.OPNPC4,
      ],
    ],
    ["rcu_zammy_mage1_edge", [ServerTriggerType.OPNPC1]],
  ];
  assert.equal(roots.length, 13);
  // Each non-null packed slot is exercised, including repeated child slots.
  for (const [name, ops] of roots) {
    const n = npc(name);
    const root = NpcType.get(n.type);
    assert(root.multinpc.length > 0);
    for (let slot = 0; slot < root.multinpc.length; slot++) {
      if (root.multinpc[slot] < 0) continue;
      const p = player();
      const child = select(p, n, slot);
      for (const op of ops) {
        if (
          name === "rcu_zammy_mage1" &&
          op === ServerTriggerType.OPNPC4 &&
          slot < 4
        ) {
          assert.equal(child.op?.[3] ?? null, null);
          assert.equal(
            ScriptProvider.getByTriggerSpecific(op, child.id),
            undefined,
          );
          pass(
            `no Teleport binding or menu on pre-completion mage slot=${slot}`,
          );
          continue;
        }
        const actual = dispatch(p, n, op);
        const expected =
          ScriptProvider.getByTriggerSpecific(op, child.id, child.category) ??
          ScriptProvider.getByTriggerSpecific(op, -1, child.category);
        assert(
          expected,
          `no child/category binding ${child.debugname} op ${op}`,
        );
        assert.equal(actual, expected);
        assert.notEqual(
          actual.name,
          `[${ServerTriggerType[op].toLowerCase()},${name}]`,
        );
        pass(
          `dispatch ${name} slot=${slot} child=${child.debugname} op=${ServerTriggerType[op]} -> ${actual.name} menu=${child.op?.[op - ServerTriggerType.OPNPC1] ?? "none/item-use"}`,
        );
      }
    }
  }

  // Stage 10 is a labelled fixture. Only product RuneScript can write stage 20.
  for (const slot of [0, 2]) {
    const p = player();
    const n = npc("juliet_multi_visible", 3157, 3426);
    select(p, n, slot);
    varp(p, "rjquest", 10);
    const state = start(p, n, ServerTriggerType.OPNPC1);
    assert.equal(varp(p, "rjquest"), 10);
    finish(p, state);
    assert.equal(varp(p, "rjquest"), 20);
    assert.equal(
      p.invTotal(InvType.getId("inv"), ObjType.getId("julietmessage")),
      1,
    );
    assert(text(p).includes("Juliet gives you a message."));
    pass(`Juliet slot=${slot} real dialogue 10->20 and one message`);
  }

  for (const i of [1, 2, 3, 4]) {
    for (const slot of [0, 1]) {
      const root = `plaguesheep_${i}`;
      const p = player();
      const n = npc(root);
      const child = select(p, n, slot);
      varp(p, "sheepherderquest", 2);
      equip(p);
      const state = start(p, n, ServerTriggerType.OPNPC1);
      finish(p, state);
      assert(
        n.hasWaypoints(),
        `${child.debugname} canonical sheep_table row must allow prod`,
      );
      assert.equal(n.sayMessage, "BAAAAA!");
      assert.equal(varp(p, "sheepherdervar"), 0);
      pass(
        `prod ${child.debugname} queues movement (slot 1 has no client Prod menu)`,
      );

      const poisoner = player();
      const victim = npc(root, 2596 + i, 3362 + slot);
      select(poisoner, victim, slot);
      varp(poisoner, "sheepherderquest", 2);
      poisoner.lastUseItem = ObjType.getId("poisoned_feed");
      World.addNpc(victim, -1);
      const bones = ObjType.getId(`sheepbones${"abcd"[i - 1]}`);
      assert.equal(
        World.getObj(victim.x, victim.z, 0, bones, poisoner.hash64),
        null,
      );
      const poisoned = start(poisoner, victim, ServerTriggerType.OPNPCU);
      assert.equal(
        (varp(poisoner, "sheepherdervar") >> (1 + (i - 1) * 3)) & 7,
        2,
      );
      assert(
        text(poisoner).includes("You feed the poisoned food to the sheep."),
      );
      finish(poisoner, poisoned);
      assert.equal(victim.isActive, false);
      const drop = World.getObj(victim.x, victim.z, 0, bones, poisoner.hash64);
      assert(drop);
      assert.equal(drop.count, 1);
      pass(
        `poison ${child.debugname} sets correct bits, removes sheep and drops matching bones`,
      );
    }
  }
  console.log(`PASS ${checks} packed runtime scenarios; no server started`);
  // Engine module imports retain housekeeping timers even without a server.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
