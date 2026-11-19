import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
export const pack = path.join(engine, 'data/pack');
const load = async file => import(pathToFileURL(path.join(engine, 'src', `${file}.ts`)).href);
export const World = (await load('engine/World')).default;
export const Runner = (await load('engine/script/ScriptRunner')).default;
export const State = (await load('engine/script/ScriptState')).default;
export const Provider = (await load('engine/script/ScriptProvider')).default;
export const Trigger = (await load('engine/script/ServerTriggerType')).default;
export const Player = (await load('engine/entity/Player')).default;
export const Loc = (await load('engine/entity/Loc')).default;
export const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle');
export const JavaRandom = (await load('util/JavaRandom')).default;
export const Environment = (await load('util/Environment')).default;
export const OpLoc = (await load('network/game/client/model/OpLoc')).default;
export const OpLocHandler = (await load('network/game/client/handler/OpLocHandler')).default;
export const IfButton = (await load('network/game/client/model/IfButton')).default;
export const IfButtonHandler = (await load('network/game/client/handler/IfButtonHandler')).default;
export const ResumePCountDialog = (await load('network/game/client/model/ResumePCountDialog')).default;
export const ResumePCountDialogHandler = (await load('network/game/client/handler/ResumePCountDialogHandler')).default;
export const map = await load('engine/GameMap');
export const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'Component', 'FontType']) {
    types[name] = (await load(`cache/config/${name}`)).default;
    types[name].load(pack);
}
(await load('cache/config/DbTableIndex')).default.init();
assert(Provider.load(pack) > 0, 'full compiled pack required');
export const audit = await import('../loc-option-audit/audit.mts');
export const placements = audit.readPlacements(pack).placements;
World.gameMap.init();
World.currentTick = 100;
export const id = (kind, name) => {
    const value = types[kind].getId(name);
    assert(value >= 0, `packed ${kind}: ${name}`);
    return value;
};
export const inv = id('InvType', 'inv');
let serial = 0;
export function fixture(name, placement = null) {
    const type = types.LocType.get(id('LocType', name));
    const row = placement ?? placements.find(p => p.type === type.id);
    assert(row, `original placement: ${name}`);
    let loc = World.getLoc(row.x, row.z, row.level, type.id);
    if (!loc && row.type !== type.id) {
        loc = World.getLoc(row.x, row.z, row.level, row.type);
        assert(loc, 'synthetic form starts from its original map root');
        World.changeLoc(loc, type.id, row.shape, row.angle, 500);
    }
    assert(loc, `loaded original loc: ${name}`);
    const p = new Player(`proposal${++serial}`, BigInt(serial), BigInt(serial));
    p.uid = BigInt(serial); p.pid = p.slot = serial;
    p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(0);
    p.setVar(id('VarPlayerType', 'tutorial'), 1000);
    p.setVar(id('VarPlayerType', 'viking'), 10);
    p.level = row.level;
    p.x = p.originX = row.x - 1; p.z = p.originZ = row.z;
    p.lastMovement = 0;
    const events = [];
    const f = { p, loc, row, events, start: World.currentTick };
    const event = (kind, value) => events.push([World.currentTick - f.start, kind, value]);
    p.messageGame = p.wrappedMessageGame = text => event('game', String(text));
    p.write = packet => {
        if (packet.constructor.name === 'IfSetText') event('interface', [types.Component.get(packet.component).comName, packet.text]);
        if (packet.constructor.name === 'SynthSound') event('sound', [packet.synth, packet.loops, packet.delay]);
    };
    const animate = p.playAnimation.bind(p);
    p.playAnimation = (seq, delay) => { event('animation', [types.SeqType.get(seq)?.debugname ?? seq, delay]); return animate(seq, delay); };
    p.getInventory(inv);
    return f;
}
export function select(f, slot) {
    const original = World.getLoc;
    World.getLoc = (...args) => args[0] === f.loc.x && args[1] === f.loc.z && args[2] === f.loc.level && args[3] === f.loc.type ? f.loc : original.apply(World, args);
    try {
        assert(new OpLocHandler().handle(new OpLoc(slot, f.loc.x, f.loc.z, f.loc.type), f.p));
        assert.equal(f.p.target, f.loc);
        return f.p.getOpTrigger();
    } finally { World.getLoc = original; }
}
export function use(f, item, add = 1) {
    if (add) f.p.invAdd(inv, id('ObjType', item), add);
    f.p.lastUseItem = id('ObjType', item);
    f.p.lastUseSlot = f.p.getInventory(inv).items.findIndex(i => i?.id === id('ObjType', item));
    f.p.target = f.loc; f.p.targetOp = Trigger.APLOCU;
    const script = f.p.getOpTrigger();
    assert(script, `native item-on-loc dispatch: ${types.LocType.get(f.loc.type).debugname}`);
    return script;
}
export function snapshot(f) {
    return {
        tick: World.currentTick - f.start,
        execution: f.p.activeScript?.execution ?? null,
        delay: Math.max(0, f.p.delayedUntil - World.currentTick),
        inventory: f.p.getInventory(inv).items.map(i => i === null ? null : [types.ObjType.get(i.id).debugname, i.count]),
        xp: [...f.p.stats],
        events: f.events.splice(0)
    };
}
export function execute(f, script, args = []) {
    const state = Runner.init(script, f.p, f.loc, args);
    f.p.executeScript(state, true, true);
    return state;
}
export function settle(f, bound = 128) {
    const trace = [snapshot(f)];
    for (let tick = 0; tick < bound; tick++) {
        const execution = f.p.activeScript?.execution;
        if (execution === State.PAUSEBUTTON || execution === State.COUNTDIALOG || execution === State.FINISHED || (!f.p.activeScript && !f.p.delayed && !f.p.weakQueue.head())) return trace;
        World.currentTick++;
        if (World.currentTick >= f.p.delayedUntil) f.p.delayed = false;
        if (!f.p.delayed && f.p.activeScript?.execution === State.SUSPENDED) f.p.executeScript(f.p.activeScript, true, true);
        f.p.processQueues();
        trace.push(snapshot(f));
    }
    assert.fail('native action exceeds its fixture bound');
}
export function withRandom(value, action) {
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => value;
    try { return action(); } finally { JavaRandom.nextDouble = original; }
}
