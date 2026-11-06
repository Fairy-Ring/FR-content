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
import { isApproached, isLineOfSight } from '#/engine/GameMap.js';

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
    for (let i = 0; i < 16384; i++) {
        const n = World.getNpc(i);
        if (n?.type === NpcType.getId(name)) return n;
    }
    assert.fail(`no packed spawn ${name}`);
}
function visible(p: Player, n: Npc): void {
    const root = NpcType.get(n.type);
    const slot = root.multinpc.findIndex(id => id >= 0);
    assert(slot >= 0);
    if (root.multivarp !== -1) p.setVar(root.multivarp, slot);
    else p.setVarBit(root.multivarbit, slot);
}
function talk(p: Player, n: Npc): void {
    assert(p.setInteraction(Interaction.ENGINE, n, ServerTriggerType.APNPC1));
    for (let i = 0; i < 30 && !p.activeScript; i++) {
        p.resetEntity(false);
        p.processInteraction(); World.currentTick++;
    }
    assert(p.activeScript, `no dialogue ${JSON.stringify({ player: [p.x, p.z], npc: [n.x, n.z], target: p.target?.type, valid: n.isValid(p.hash64), access: p.canAccess(), op: p.getOpTrigger()?.name, ap: p.getApTrigger()?.name, range: p.apRange, waypoints: p.waypointIndex, packets: packets.get(p) })}`);
    assert.notEqual(p.activeScript.execution, ScriptState.ABORTED);
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
    // Decode real terrain, locs and NPC placements. This does not call World.start/init.
    const maps = unzipSync(readFileSync('data/pack/.cache/maps-server.zip'), { filter: e => /^[mln](40_52|39_151|39_152)$/.test(e.name) });
    const map = World.gameMap as any;
    map.zonemap.beginInitialization();
    for (const [mx, mz] of [[40, 52], [39, 151], [39, 152]]) {
        const key = `${mx}_${mz}`;
        assert(maps[`m${key}`]?.length && maps[`l${key}`]?.length && maps[`n${key}`]?.length);
        map.loadPackedMapsquare({ m: maps[`m${key}`], l: maps[`l${key}`], n: maps[`n${key}`], o: new Uint8Array() }, mx * 64, mz * 64);
    }
    map.zonemap.endInitialization();
    const cell = placed('elenap');
    for (const hasKey of [false, true]) {
        const p = player(2539, 9671); visible(p, cell); varp(p, 'elenaquest', 27);
        if (hasKey) p.invAdd(InvType.getId('inv'), ObjType.getId('elenakey'), 1);
        assert(!p.inOperableDistance(cell), 'cell fixture must be outside bars');
        talk(p, cell); finish(p);
        assert(p.x <= 2539, 'player crossed the bars');
        assert(text(p).includes('Hey get me out of here please!'));
        assert.equal(varp(p, 'elenaquest'), 27, 'across-bars talk must not rescue');
        assert.equal(p.invTotal(InvType.getId('inv'), ObjType.getId('elenakey')), Number(hasKey));
        if (!hasKey) {
            assert(text(p).includes("I would do but I don't have a key."));
            assert(text(p).includes('No, I have none of the symptoms.'));
        } else assert(!text(p).includes("I don't have a key"));
        pass(`cell AP outside bars key=${hasKey}: dialogue without rescue or item change`);
    }
    // Inside placement is a separate runtime fixture, not a live traversal claim.
    {
        const p = player(cell.x - 1, cell.z); visible(p, cell); varp(p, 'elenaquest', 27);
        assert(p.inOperableDistance(cell), 'inside fixture must reach the rescue OP');
        talk(p, cell); finish(p);
        assert.equal(varp(p, 'elenaquest'), 28);
        assert(text(p).includes('Thank you, being kidnapped was so inconvenient.'));
        pass('inside cell OP retains rescue dialogue and progress 27->28');
    }
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
    const house = placed('elena2');
    // NPC position fixture: observed live wandering tile, not a new spawn.
    house.teleport(2592, 3338, 0);
    const approachTiles: { x: number; z: number; lineOfSight: boolean; approached: boolean }[] = [];
    for (let x = 2588; x <= 2596; x++) {
        for (let z = 3332; z <= 3342; z++) {
            if (x > 2589 && x < 2595 && z > 3333 && z < 3339) continue;
            approachTiles.push({ x, z, lineOfSight: isLineOfSight(0, x, z, house.x, house.z), approached: isApproached(0, x, z, house.x, house.z, 1, 1, 1, 1) });
        }
    }
    console.log(`HOUSE_APPROACH_TILES ${JSON.stringify(approachTiles)}`);
    assert(approachTiles.every(tile => !tile.lineOfSight && !tile.approached));
    pass('closed original house perimeter has no exterior LOS to Elena at 2592,3338');
    {
        const p = player(2591, 3338); visible(p, house); varp(p, 'elenaquest', 29);
        assert(p.inOperableDistance(house));
        talk(p, house);
        assert(text(p).includes('Good day to you Elena.'));
        finish(p);
        assert.equal(varp(p, 'biohazard'), 1);
        assert.equal(varp(p, 'elenaquest'), 29);
        pass('inside house OP renders Elena and retains Biohazard start 0->1');
    }
    console.log(`PASS ${checks} Elena packed scenarios; no engine started`);
    process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
