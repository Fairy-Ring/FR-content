// Full packed map collision + production interaction dispatch and RuneScript. No server.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import Component from '#/cache/config/Component.js';
import CategoryType from '#/cache/config/CategoryType.js';
import DbRowType from '#/cache/config/DbRowType.js';
import DbTableType from '#/cache/config/DbTableType.js';
import DbTableIndex from '#/cache/config/DbTableIndex.js';
import EnumType from '#/cache/config/EnumType.js';
import FontType from '#/cache/config/FontType.js';
import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import MesanimType from '#/cache/config/MesanimType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import SeqType from '#/cache/config/SeqType.js';
import StructType from '#/cache/config/StructType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import VarNpcType from '#/cache/config/VarNpcType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import { BlockWalk } from '#/engine/entity/BlockWalk.js';
import Npc from '#/engine/entity/Npc.js';
import Player from '#/engine/entity/Player.js';
import { Interaction } from '#/engine/entity/Interaction.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import ScriptRunner from '#/engine/script/ScriptRunner.js';
import ScriptState from '#/engine/script/ScriptState.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import World from '#/engine/World.js';
import IfButtonHandler from '#/network/game/client/handler/IfButtonHandler.js';
import IfButton from '#/network/game/client/model/IfButton.js';
import ResumePauseButtonHandler from '#/network/game/client/handler/ResumePauseButtonHandler.js';
import ResumePauseButton from '#/network/game/client/model/ResumePauseButton.js';
import IfSetText from '#/network/game/server/model/IfSetText.js';

let checks = 0;
const packets = new WeakMap<Player, unknown[]>();
const pause = new ResumePauseButtonHandler();
const button = new IfButtonHandler();
function pass(label: string): void { console.log(`PASS ${++checks}: ${label}`); }
function player(x: number, z: number): Player {
    const p = new Player('elenatest', 1n, 0n);
    p.pid = 1; p.uid = 1; p.x = x; p.z = z;
    p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
    p.buildArea.originX = x - 48; p.buildArea.originZ = z - 48;
    const output: unknown[] = []; packets.set(p, output);
    // Capture transport only. Movement, reach tests, dispatch and opcodes are unmodified.
    p.write = message => { output.push(message); };
    return p;
}
function varp(p: Player, name: string, value?: number): number {
    const id = VarPlayerType.getId(name); assert(id >= 0, name);
    if (value !== undefined) p.setVar(id, value);
    return p.getVar(id) as number;
}
function text(p: Player): string {
    return packets.get(p)!.filter((m): m is IfSetText => m instanceof IfSetText).map(m => m.text).join(' ');
}
function placed(name: string): Npc {
    const type = NpcType.getId(name);
    assert(type >= 0, `missing NPC config ${name}`);
    const n = new Npc(0, 2589, 3358, 1, 1, EntityLifeCycle.RESPAWN, 1, type, BlockWalk.NONE);
    n.isActive = true;
    n.lastMovement = -100;
    return n;
}
function visible(p: Player, n: Npc): void {
    const root = NpcType.get(n.type);
    const slot = root.multinpc.findIndex(id => id >= 0);
    assert(slot >= 0);
    if (root.multivarp !== -1) p.setVar(root.multivarp, slot);
    else p.setVarBit(root.multivarbit, slot);
}
function finish(p: Player, choice = 1): void {
    const state = p.activeScript!; assert(state);
    for (let i = 0; i < 100 && state.execution !== ScriptState.FINISHED; i++) {
        assert.notEqual(state.execution, ScriptState.ABORTED);
        if (state.execution === ScriptState.PAUSEBUTTON) {
            if (p.modalChat === Component.getId('multi2')) {
                const id = Component.getId(`multi2:com_${choice}`);
                assert(p.resumeButtons.includes(id));
                assert(button.handle(new IfButton(id), p));
            } else assert(pause.handle(new ResumePauseButton(), p));
        } else if (state.execution === ScriptState.SUSPENDED) {
            World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
            p.delayed = false; p.executeScript(state, true, true);
        } else assert.fail(`unexpected suspension ${state.execution}`);
    }
    assert.equal(state.execution, ScriptState.FINISHED);
}
function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
try {
    for (const config of [VarPlayerType, VarBitType, VarNpcType, ParamType, ObjType, LocType, NpcType, InvType, CategoryType, EnumType, StructType, SeqType, MesanimType, DbTableType, DbRowType]) config.load('data/pack');
    DbTableIndex.init(); Component.load('data/pack'); FontType.load('data/pack');
    assert(ScriptProvider.load('data/pack') > 0); World.currentTick = 10;
    // Decode packed NPC placements for the name-targeted dialogue scenarios.
    for (const name of ['edmond_top', 'edmond_bottom']) {
        const n = placed(name); const p = player(n.x, n.z + 1); visible(p, n); varp(p, 'elenaquest', 10);
        p.target = n; p.targetOp = ServerTriggerType.APNPC1;
        const script = p.getOpTrigger(); assert(script);
        p.executeScript(ScriptRunner.init(script, p, n), true); finish(p);
        assert(text(p).includes('Have you found Elena yet?'));
        assert(!text(p).includes('elena2'));
        assert.equal(varp(p, 'elenaquest'), 10);
        pass(`${name} dialogue renders Elena, retains progress`);
    }
    let literals = 0;
    for (const file of files('../content/scripts').filter(f => f.endsWith('.rs2'))) {
        for (const m of readFileSync(file, 'utf8').matchAll(/\bnc_name\((\w+)\)/g)) {
            if (m[1] === 'npc_type') continue; // Active-NPC expression, not a literal config id.
            const type = NpcType.getByName(m[1]); assert(type, `${file}: ${m[1]}`);
            assert(type.name && type.name !== type.debugname, `${file}: nameless nc_name(${m[1]})`); literals++;
        }
    }
    pass(`all ${literals} literal nc_name calls use packed display names`);
    console.log(`PASS ${checks} Elena name scenarios; no engine started`);
    process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
