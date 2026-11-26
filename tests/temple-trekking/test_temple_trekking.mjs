import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, ScriptProvider, ScriptState, ServerTriggerType as T, PlayerStat, types, engineModule, id, obj, inv, worn, player, seed, count, inventory, execute, button, tile, useLoc as nativeUseLoc, held, use, settle, interactionTick, map } from '../swamp-caves/runtime.mjs';

const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Pointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const shown = (p, n) => resolveNpcType(types.NpcType.get(n.type), p);
const vp = name => id('VarPlayerType', name);
const vb = name => id('VarBitType', name);
const nv = name => id('VarNpcType', name);
const get = (p, name) => p.getVarBit(vb(name));
const set = (p, name, value) => p.setVarBit(vb(name), value);
const proc = (p, name, args = [], target = null) => execute(`[proc,${name}]`, p, args, { target });
const names = ['templetrek_retired_soldier_easy', 'templetrek_retired_man_easy', 'templetrek_woman_med', 'templetrek_man_med', 'templetrek_oldman_hard', 'templetrek_child_hard'];
const tokens = ['templetrek_blue_token', 'templetrek_yellow_token', 'templetrek_red_token'];
const fixtures = [];
function fixture(complete = true) {
    const p = player();
    p.teleport(3479, 3241, 0);
    set(p, 'myreque_2_quest', complete ? 421 : 420);
    proc(p, 'templetrek_login');
    if (complete) set(p, 'burgh_bank_booth_open', 1);
    fixtures.push(p);
    return p;
}
function createNpc(name, p) {
    const cfg = types.NpcType.getByName(name);
    assert(cfg, name);
    const n = new Npc(p.level, p.x + 1, p.z, cfg.size, cfg.size, EntityLifeCycle.DESPAWN, World.getNextNid(), cfg.id, cfg.blockwalk);
    World.addNpc(n, 0x7fffffff);
    return n;
}
function dispatch(p, trigger, entity, args = []) {
    const kind = trigger.includes('NPC') ? 'NpcType' : 'LocType';
    const cfg = kind === 'NpcType' ? shown(p, entity) : types.LocType.get(entity.type);
    const script = ScriptProvider.getByTrigger(T[trigger], cfg.id, cfg.category);
    assert(script, `${trigger} dispatch for visible ${cfg.debugname}`);
    if (trigger === 'OPNPCU' && cfg.debugname.startsWith('templetrek_ghast_invis_')) {
        const state = Runner.init(script, p, entity, args);
        state.pointerAdd(Pointer.ProtectedActivePlayer);
        p.executeScript(state, true, true);
        assert.equal(state.execution, ScriptState.NPC_SUSPENDED, 'real pouch reveal transfers to the native NPC queue');
        for (let tick = 0; tick < 16 && state.execution === ScriptState.NPC_SUSPENDED; tick++) {
            World.currentTick++;
            World.processNpcEventQueue();
            entity.turn();
            p.processQueues();
        }
        assert.equal(state.execution, ScriptState.FINISHED, 'native delayed ghast reveal finishes');
        return state;
    }
    return execute(script.name, p, args, { target: entity });
}
function moveForLoc(p, target) {
    if (p.inOperableDistance(target)) return;
    const cfg = types.LocType.get(target.type);
    const route = [...map.findPathToLoc(p.level, p.x, p.z, target.x, target.z, p.width, target.width, target.length, target.angle, target.shape, cfg.forceapproach)]
        .map(coord => {
            const { x, z } = CoordGrid.unpackCoord(coord);
            return { x, z };
        });
    if (route.length) assert(moveHandler.handle(new MoveClick(route, 0, true), p), 'native MOVE_OPCLICK accepted');
}
function operateLoc(p, target, option) {
    p.originX = p.x;
    p.originZ = p.z;
    moveForLoc(p, target);
    assert(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p), 'native loc packet accepted');
    for (let tick = 0; tick < 80 && p.hasInteraction(); tick++) interactionTick(p);
    settle(p);
    assert.equal(p.hasInteraction(), false, 'native loc approach settles');
}
function useNpc(p, item, target) {
    const slot = inventory(p).findIndex(row => row?.name === item);
    assert(slot >= 0, `held ${item} selected for NPC`);
    p.lastUseItem = obj(item);
    p.lastUseSlot = slot;
    return dispatch(p, 'OPNPCU', target);
}
function ai(n, trigger, p = null, args = []) {
    const cfg = types.NpcType.get(n.type);
    const script = trigger.startsWith('[proc,') ? ScriptProvider.getByName(trigger) : ScriptProvider.getByTrigger(T[trigger], cfg.id, cfg.category);
    assert(script, `${trigger} for ${cfg.debugname}`);
    const state = Runner.init(script, n, p, args);
    if (p) state.pointerAdd(Pointer.ProtectedActivePlayer);
    n.executeScript(state);
    assert.notEqual(state.execution, ScriptState.ABORTED, script.name);
    return state;
}
function clear(p) {
    if (get(p, 'templetrek_temp_var_25_25')) proc(p, 'templetrek_leave', [0]);
    p.clearInteraction();
    p.closeModal();
}
function choose(p, companion = 0, route = 1) {
    const n = createNpc(names[companion], p);
    dispatch(p, 'OPNPC1', n);
    assert.equal(p.modalMain, 341, 'original route341 root opened');
    assert.equal(get(p, 'templetrek_debug_room_id'), companion + 1);
    assert.equal(button(p, `choose_a_route:com_${[0, 21, 25, 29][route]}`), true, 'real route component accepted');
    assert.equal(get(p, 'templetrek_temp_var_25_25'), 1, 'route click owns a native instance');
    assert.equal(get(p, 'templetrek_temp_var_11_12'), route);
    assert.equal(get(p, 'templetrek_temp_var_22_24'), companion + 1);
    assert.equal(proc(p, 'templetrek_owned').popInt(), 1);
    World.removeNpc(n, -1);
    return p;
}
function useLoc(p, item, target) {
    p.originX = p.x;
    p.originZ = p.z;
    moveForLoc(p, target);
    const accepted = nativeUseLoc(p, item, target);
    if (accepted) {
        for (let tick = 0; tick < 80 && p.hasInteraction(); tick++) interactionTick(p);
        settle(p);
        assert.equal(p.hasInteraction(), false, 'native item-on-loc approach settles');
    }
    return accepted;
}
function room(p, source) {
    const instance = World.instances.findInstanceByCoord(p);
    assert(instance, 'fixture resolves the real owned native instance');
    const template = CoordGrid.unpackCoord(source);
    return { level: instance.sw.level + template.level, x: instance.sw.x + (template.x & 63), z: instance.sw.z + (template.z & 63) };
}
const packed = (level, mx, mz, x, z) => CoordGrid.packCoord(level, mx * 64 + x, mz * 64 + z);
function loc(p, name, source) {
    const at = room(p, source);
    const result = World.getLoc(at.x, at.z, at.level, id('LocType', name));
    assert(result, `real copied/spawned ${name} at ${JSON.stringify(at)}`);
    return result;
}
function actors(p) {
    return [...World.npcs].filter(n => n.isActive && n.level === p.level && (n.x >> 6) === (p.x >> 6) && (n.z >> 6) === (p.z >> 6) && n.getVar(nv('npc_attacking_uid')) === p.uid);
}
function hostile(p) {
    return actors(p).filter(n => {
        const cfg = shown(p, n);
        return cfg.op?.includes('Attack') || cfg.debugname.startsWith('templetrek_ghast_invis_');
    });
}
function kill(p, n) {
    const corpse = () => types.NpcType.get(n.type).debugname === 'templetrek_snake_dead';
    n.heroPoints.addHero(p.hash64, 10000);
    ai(n, '[proc,npc_default_damage]', p, [10000]);
    for (let tick = 0; tick < 20 && n.isActive && !corpse(); tick++) {
        World.currentTick++;
        World.processNpcEventQueue();
        n.turn();
        p.processQueues();
    }
    p.processQueues();
    assert(!n.isActive || corpse(), 'native damage/death deletes the foe or exposes its original Skin corpse');
}
function pathOut(level, x, z, label) {
    assert.equal(map.isMapBlocked(x, z, level), false, `${label}: packed collision walkable`);
    let found = false;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        if (map.isMapBlocked(x + dx, z + dz, level)) continue;
        const path = map.findPath(level, x, z, x + dx, z + dz);
        if (path.length) { found = true; break; }
    }
    assert(found, `${label}: non-empty real findPath departure`);
}
function draws(values, action) {
    const original = JavaRandom.nextDouble;
    let cursor = 0;
    JavaRandom.nextDouble = () => {
        assert(cursor < values.length, 'only the declared native RNG draws are used');
        return values[cursor++];
    };
    try {
        const result = action();
        assert.equal(cursor, values.length, 'declared native RNG draws consumed');
        return result;
    } finally {
        JavaRandom.nextDouble = original;
    }
}
function approach(p, target) {
    const cfg = types.LocType.get(target.type);
    const width = target.angle & 1 ? cfg.length : cfg.width;
    const length = target.angle & 1 ? cfg.width : cfg.length;
    for (let dx = -1; dx <= width; dx++) for (let dz = -1; dz <= length; dz++) {
        const x = target.x + dx, z = target.z + dz;
        if (map.isMapBlocked(x, z, target.level)) continue;
        if (!map.reachedLoc(target.level, x, z, target.x, target.z, width, length, 1, target.angle, target.shape, cfg.forceapproach)) continue;
        p.teleport(x, z, target.level);
        p.closeModal();
        return;
    }
    assert.fail(`real packed approach to ${cfg.debugname}`);
}
function itemOnBooth(p, token, booth) {
    approach(p, booth);
    assert(useLoc(p, token, booth), 'native token-on-original-booth packet accepted');
}

// Independent area coordinates, not values read back from product constants.
pathOut(0, 3479, 3241, 'Burgh failure/logout surface');
pathOut(0, 3406, 3489, 'Paterdomus arrival');
assert.equal(map.findPath(0, 3406, 3489, 3387, 3484).at(-1), CoordGrid.packCoord(0, 3387, 3484), 'arrival reaches the independently walkable Misthalin link');
assert.equal(types.VarPlayerType.getId('templetrek_main_var'), 700);
assert.equal(types.VarPlayerType.getId('templetrek_temp_var'), 702);
assert.equal(types.VarPlayerType.get(vp('templetrek_main_var')).scope, 1, 'points saved across logout');
const blocked = fixture(false);
const refused = createNpc(names[0], blocked);
dispatch(blocked, 'OPNPC1', refused);
assert.equal(get(blocked, 'templetrek_button_control'), 0, 'unfinished Myreque refused');
assert.equal(get(blocked, 'templetrek_npcs_visible'), 0);
assert.equal(blocked.modalMain, -1);
for (let companion = 0; companion < names.length; companion++) for (let route = 1; route <= 3; route++) {
    const p = fixture();
    assert.equal(get(p, 'templetrek_npcs_visible'), 1);
    choose(p, companion, route);
    proc(p, 'templetrek_enter_event', [4]);
    assert.equal(hostile(p).length, [3, 3, 4, 4, 5, 5][companion], 'follower strength, not route, controls the normal group size');
    pathOut(p.level, p.x, p.z, `companion${companion + 1}/route${route} entry`);
    clear(p);
    assert.deepEqual(tile(p), [0, 3479, 3241]);
    assert.equal(p.getVar(vp('templetrek_temp_var')), 0, 'failure releases all run fields');
}
console.log('PASS prerequisite, six original companions, all route buttons and repeat-safe entry/escape');

// Encounter setup calls compiled product entry, never writes its result counters.
const combat = fixture();
choose(combat, 0, 3);
for (let event = 1; event <= 6; event++) {
    proc(combat, 'templetrek_enter_event', [event]);
    assert.equal(get(combat, 'templetrek_last_event'), event);
    pathOut(combat.level, combat.x, combat.z, `event${event} entry`);
    const enemies = hostile(combat);
    assert(enemies.length > 0, `event${event} spawns original hostile NPCs`);
    assert.equal(get(combat, 'templetrek_temp_var_13_18'), enemies.length);
    for (const n of enemies) {
        assert.equal(n.getVar(nv('npc_attacking_uid')), combat.uid);
        assert(map.findPathToLoc(combat.level, combat.x, combat.z, n.x, n.z, 1, n.width, n.length, 0, -1, 0).length || Math.max(Math.abs(combat.x - n.x), Math.abs(combat.z - n.z)) <= 1, `event${event} hostile is reachable from the actual entry`);
    }
    if (event === 2) {
        assert.equal(ai(enemies[0], '[proc,npc_max_dealt]', combat, [100, 0]).popInt(), 0, 'ordinary unarmed melee cannot damage juvinates');
        seed(combat, ['burgh_rod_command_final_10']);
        assert(held(combat, 'burgh_rod_command_final_10', 2));
        settle(combat);
        assert(ai(enemies[0], '[proc,npc_max_dealt]', combat, [100, 0]).popInt() > 0, 'native equipped Ivandis weapon permits melee');
        assert.equal(ai(enemies[0], '[proc,npc_max_dealt]', combat, [100, 1]).popInt(), 0, 'a silver melee weapon does not permit spell damage');
    }
    const prayerBefore = combat.stats[PlayerStat.PRAYER];
    if (event === 1) {
        combat.invAdd(inv, obj('druid_pouch'), enemies.length);
        for (const n of enemies) {
            assert.equal(ai(n, '[proc,npc_max_dealt]', combat, [100, 0]).popInt(), 0, 'invisible ghasts are invulnerable before pouch use');
            useNpc(combat, 'druid_pouch', n);
            assert(types.NpcType.get(n.type).op.includes('Attack'), 'the real pouch reveals the attackable original form');
            assert(ai(n, '[proc,npc_max_dealt]', combat, [100, 0]).popInt() > 0, 'revealed ghast accepts damage');
        }
        assert.equal(count(combat, 'druid_pouch'), 0, 'each reveal consumes one real pouch charge');
    }
    const head = enemies.find(n => types.NpcType.get(n.type).debugname === 'templetrek_tentacle_head');
    if (head) assert.equal(ai(head, '[proc,npc_max_dealt]', combat, [100, 0]).popInt(), 0, 'arms gate head damage before XP');
    for (const n of enemies.filter(n => n !== head)) kill(combat, n);
    if (head) {
        assert(ai(head, '[proc,npc_max_dealt]', combat, [100, 0]).popInt() > 0, 'defeating all four arms exposes the head');
        kill(combat, head);
    }
    if (event === 1) assert.equal(combat.stats[PlayerStat.PRAYER] - prayerBefore, enemies.length * 1400, 'route-three ghasts award source-listed Prayer XP in tenths');
    assert.equal(get(combat, 'templetrek_temp_var_13_18'), 0, 'native deaths exhaust encounter once');
    assert(get(combat, 'templetrek_npc_point_value') > 0, 'owner earns encounter credit');
    if (event === 4) {
        const carcass = actors(combat).find(n => types.NpcType.get(n.type).debugname === 'templetrek_snake_dead');
        assert(carcass, 'native snake death leaves the original Skin corpse');
        seed(combat, ['knife']);
        draws([0], () => useNpc(combat, 'knife', carcass));
        assert.equal(count(combat, 'templetrek_swamp_snake_hide'), 2, 'knife-on-original-corpse yields source-listed hides');
        assert.equal(carcass.isActive, false, 'a corpse is skinned only once');
    }
}
clear(combat);
console.log('PASS all six authentic combat events, native damage/death credit, head/arm gate and owned spawn reachability');

// Completion is reached through three product Continue transitions after clears.
const finish = fixture();
choose(finish, 5, 1);
for (let stage = 0; stage < 3; stage++) {
    proc(finish, 'templetrek_enter_event', [4]);
    for (const n of hostile(finish)) kill(finish, n);
    const exit = loc(finish, 'templetrek_swamp_success_path', packed(0, 31, 78, 15, 59));
    dispatch(finish, 'OPLOC2', exit);
}
assert.deepEqual(tile(finish), [0, 3406, 3489]);
assert.equal(get(finish, 'templetrek_temp_var_25_25'), 0);
assert.equal(count(finish, tokens[0]), 1, 'completed trek awards original token');
const rewardPoints = get(finish, 'templetrek_npc_point_value');
proc(finish, 'templetrek_login');
assert.equal(get(finish, 'templetrek_npc_point_value'), rewardPoints, 'login preserves earned token points');
console.log('PASS product encounter chain reaches destination and token points survive login');

// The real token prevents a second run until redeemed at the original Burgh booth.
const refusedRepeat = createNpc(names[0], finish);
dispatch(finish, 'OPNPC1', refusedRepeat);
if (finish.modalMain === 341) button(finish, 'choose_a_route:com_21');
assert.equal(get(finish, 'templetrek_temp_var_25_25'), 0);
assert.equal(count(finish, tokens[0]), 1);
assert.equal(get(finish, 'templetrek_npc_point_value'), rewardPoints);
World.removeNpc(refusedRepeat, -1);

// A full bag must preserve the completed instance and points until Continue is retried.
for (const route of [2, 3]) {
    const full = fixture();
    choose(full, 0, route);
    let exit;
    for (let stage = 0; stage < 3; stage++) {
        proc(full, 'templetrek_enter_event', [4]);
        for (const n of hostile(full)) kill(full, n);
        exit = loc(full, 'templetrek_swamp_success_path', packed(0, 31, 78, 15, 59));
        if (stage === 2) while (inventory(full).some(row => row === null)) seed(full, ['logs']);
        dispatch(full, 'OPLOC2', exit);
    }
    assert.equal(get(full, 'templetrek_temp_var_25_25'), 1, 'full bag retains completed owned trek');
    assert.equal(count(full, tokens[route - 1]), 0);
    assert(get(full, 'templetrek_npc_point_value') > 0, 'full bag retains earned reward points');
    full.invDel(inv, obj('logs'), 1);
    dispatch(full, 'OPLOC2', exit);
    assert.equal(get(full, 'templetrek_temp_var_25_25'), 0);
    assert.equal(count(full, tokens[route - 1]), 1, 'retry grants correct route-coloured token once');
    assert.deepEqual(tile(full), [0, 3406, 3489]);
}
console.log('PASS unredeemed-token repeat gate and full-bag completion retry for yellow/red routes');

// Real item-on-loc packets exercise tools, consumption, visible loc transitions
// and all three original obstacle families on their actual copied landscapes.
const puzzle = fixture();
choose(puzzle, 0, 3);
proc(puzzle, 'templetrek_enter_event', [7]);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 37, 47], 'bridge begins on the original western bank');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'bridge entry');
seed(puzzle, ['hammer', 'logs', 'logs', 'logs']);
let at = room(puzzle, packed(0, 32, 78, 41, 47));
puzzle.teleport(at.x, at.z, at.level);
for (const form of ['templetrek_bridge_broken', 'templetrek_bridge_fixed_1', 'templetrek_bridge_fixed_2']) {
    assert(useLoc(puzzle, 'logs', loc(puzzle, form, packed(0, 32, 78, 42, 47))));
    settle(puzzle);
}
assert.equal(count(puzzle, 'logs'), 0);
assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 3, 'three logs produce fixed bridge');
dispatch(puzzle, 'OPLOC2', loc(puzzle, 'templetrek_bridge_fixed_3', packed(0, 32, 78, 42, 47)));
assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 15);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 48, 47], 'bridge lands across the original gap');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'bridge far-bank landing');
proc(puzzle, 'templetrek_enter_event', [8]);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 12, 9], 'bog begins on original southern bank');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'bog entry');
const originalBogModels = readFileSync(new URL('../../pack/model.pack', import.meta.url), 'utf8');
assert.deepEqual(Array.from(originalBogModels.matchAll(/^\d+=(templetrek_route_direction(?:_\w+)?)$/gm), match => match[1]), ['templetrek_route_direction_0'], 'the original Bog model exists only as ground decoration');
for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 2; column++) {
        const patch = loc(puzzle, 'templetrek_route_direction', packed(0, 32, 78, 11 + column, 13 + row));
        assert.equal(patch.shape, 22, 'every native Bog patch uses its original renderable model shape');
    }
}
seed(puzzle, ['knife']);
at = room(puzzle, packed(0, 32, 78, 13, 11));
puzzle.teleport(at.x, at.z, at.level);
assert(useLoc(puzzle, 'knife', loc(puzzle, 'templetrek_leaflessbush', packed(0, 32, 78, 14, 10))));
settle(puzzle);
const branches = count(puzzle, 'templetrek_swamptree_branch');
assert(branches >= 2 && branches <= 4, 'sharp tool yields source-listed two to four branches');
const soft = loc(puzzle, 'templetrek_route_direction', packed(0, 32, 78, 12, 13));
for (let probe = 1; probe <= 2; probe++) {
    assert(useLoc(puzzle, 'templetrek_swamptree_branch', soft));
    settle(puzzle);
    assert.equal(count(puzzle, 'templetrek_swamptree_branch'), branches - probe, 'same soft patch always catches another branch');
}
operateLoc(puzzle, soft, 1);
assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 0, 'soft bog resets progress');
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 12, 11], 'soft bog returns to its southern dry bank');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'bog sink return');
for (let row = 0; row < 5; row++) {
    if (row > 0) {
        // Lose the tool at every intermediate forced position, then recover by
        // the real soft-patch return and bush, with no state or position seed.
        puzzle.invDel(inv, obj('templetrek_swamptree_branch'), count(puzzle, 'templetrek_swamptree_branch'));
        operateLoc(puzzle, loc(puzzle, 'templetrek_route_direction', packed(0, 32, 78, 12, 12 + row)), 1);
        assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 0, `native soft return stage${row}; tile=${puzzle.x & 63},${puzzle.z & 63}; packets=${JSON.stringify(puzzle.packets.slice(-6))}`);
        pathOut(puzzle.level, puzzle.x, puzzle.z, `bog lost-tool return at stage${row}`);
    }
    if (!count(puzzle, 'templetrek_swamptree_branch')) {
        assert(useLoc(puzzle, 'knife', loc(puzzle, 'templetrek_leaflessbush', packed(0, 32, 78, 14, 10))));
        settle(puzzle);
        assert(count(puzzle, 'templetrek_swamptree_branch') >= 2, `lost branches recover without resetting the trek at stage${row}; knife=${count(puzzle, 'knife')}; tile=${puzzle.x & 63},${puzzle.z & 63}; messages=${puzzle.packets.slice(-5).map(packet => packet.text ?? packet.constructor.name).join(' / ')}`);
    }
    for (let previous = 0; previous < row; previous++) {
        operateLoc(puzzle, loc(puzzle, 'templetrek_route_direction', packed(0, 32, 78, 11, 13 + previous)), 1);
    }
    const firm = loc(puzzle, 'templetrek_route_direction', packed(0, 32, 78, 11, 13 + row));
    const beforeProbe = count(puzzle, 'templetrek_swamptree_branch');
    assert(useLoc(puzzle, 'templetrek_swamptree_branch', firm));
    settle(puzzle);
    assert.equal(count(puzzle, 'templetrek_swamptree_branch'), beforeProbe, 'firm ground does not consume a branch');
    assert(puzzle.inOperableDistance(firm) || map.isApproached(puzzle.level, puzzle.x, puzzle.z, firm.x, firm.z, puzzle.width, puzzle.length, firm.width, firm.length), `native bog OP/AP reachability at stage${row} from ${puzzle.x & 63},${puzzle.z & 63} to ${firm.x & 63},${firm.z & 63}`);
    operateLoc(puzzle, firm, 1);
    assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), row === 4 ? 15 : row + 1, `native firm step stage${row}; tile=${puzzle.x & 63},${puzzle.z & 63}; packets=${JSON.stringify(puzzle.packets.slice(-6))}`);
    const safeSave = World.instances.getSaveCoord({ level: puzzle.level, x: puzzle.x, z: puzzle.z }, null);
    assert.deepEqual(safeSave, { level: 0, x: 3479, z: 3241 }, 'even forced bog positions save only the safe Burgh exit');
}
assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 15);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 12, 20], 'bog finishes on original northern dry bank');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'bog far-bank landing');
proc(puzzle, 'templetrek_enter_event', [9]);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 44, 11], 'river begins on its original southern bank');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'river entry');
puzzle.invDel(inv, obj('knife'), 1);
at = room(puzzle, packed(0, 32, 78, 44, 14));
puzzle.teleport(at.x, at.z, at.level);
dispatch(puzzle, 'OPLOC1', loc(puzzle, 'templetrek_swing_rucksack', packed(0, 32, 78, 44, 15)));
assert.equal(count(puzzle, 'knife'), 1, 'river supplies its own recoverable knife');
at = room(puzzle, packed(0, 32, 78, 46, 19));
puzzle.teleport(at.x, at.z, at.level);
for (const form of ['templetrek_swamptree_small_vines', 'templetrek_swamptree_small_1', 'templetrek_swamptree_small_2']) {
    assert(useLoc(puzzle, 'knife', loc(puzzle, form, packed(0, 32, 78, 47, 18))));
    settle(puzzle);
}
assert.equal(count(puzzle, 'templetrek_short_vine'), 3);
let vineSlots = inventory(puzzle).flatMap((item, slot) => item?.name === 'templetrek_short_vine' ? [slot] : []);
assert(use(puzzle, 'templetrek_short_vine', 'templetrek_short_vine', { useSlot: vineSlots[0], targetSlot: vineSlots[1] }));
settle(puzzle);
assert.equal(count(puzzle, 'templetrek_long_vine'), 1, 'three real vines combine');
// Drop/loss recovery: even the emptied original tree supplies fresh vines.
puzzle.invDel(inv, obj('templetrek_long_vine'), 1);
for (let cut = 0; cut < 3; cut++) {
    const point = room(puzzle, packed(0, 32, 78, 47, 18));
    const tree = ['templetrek_swamptree_small_empty', 'templetrek_swamptree_small_1', 'templetrek_swamptree_small_2', 'templetrek_swamptree_small_vines']
        .map(name => World.getLoc(point.x, point.z, point.level, id('LocType', name))).find(Boolean);
    assert(tree, 'recoverable vine tree remains present');
    assert(useLoc(puzzle, 'knife', tree));
    settle(puzzle);
}
vineSlots = inventory(puzzle).flatMap((item, slot) => item?.name === 'templetrek_short_vine' ? [slot] : []);
assert(use(puzzle, 'templetrek_short_vine', 'templetrek_short_vine', { useSlot: vineSlots[0], targetSlot: vineSlots[1] }));
settle(puzzle);
at = room(puzzle, packed(0, 32, 78, 44, 21));
puzzle.teleport(at.x, at.z, at.level);
assert(useLoc(puzzle, 'templetrek_long_vine', loc(puzzle, 'templetrek_swamptree_branch', packed(0, 32, 78, 45, 22))));
settle(puzzle);
assert.equal(count(puzzle, 'templetrek_long_vine'), 0);
dispatch(puzzle, 'OPLOC2', loc(puzzle, 'templetrek_swamptree_branch_vine', packed(0, 32, 78, 45, 22)));
assert.equal(get(puzzle, 'templetrek_temp_var_7_10'), 15);
assert.deepEqual([puzzle.level, puzzle.x & 63, puzzle.z & 63], [0, 44, 26], 'vine swing lands north of the original river');
pathOut(puzzle.level, puzzle.x, puzzle.z, 'river swing far bank');
clear(puzzle);
console.log('PASS bridge repair, bog soft/firm forced crossing, river vine swing, tool and drop recovery');

// Native health is authoritative across event copies, not a fresh NPC's cap.
const health = fixture();
choose(health, 0, 1);
proc(health, 'templetrek_enter_event', [4]);
let escort = actors(health).find(n => names.includes(shown(health, n).debugname));
assert(escort, 'owned escort exists');
assert.equal(escort.baseLevels[3], 100);
escort.levels[3] = 51; // Fixture damage, never a survival outcome.
proc(health, 'templetrek_enter_event', [5]);
escort = actors(health).find(n => names.includes(shown(health, n).debugname));
assert.equal(escort.levels[3], 51, 'event transition synchronizes real HP before replacing the companion');
seed(health, ['lobster']);
useNpc(health, 'lobster', escort);
assert.equal(count(health, 'lobster'), 0, 'source-listed food is actually consumed');
assert.equal(escort.levels[3], 51, 'feeding stores supplies rather than inventing an immediate heal');
assert.equal(get(health, 'templetrek_multi_npc_food_give'), 1);
escort.levels[3] = 44; // Disclosed wounded follower input for native auto-eating.
const attacker = hostile(health)[0];
const pairScript = ScriptProvider.getByTrigger(T.AI_OPNPC2, attacker.type, types.NpcType.get(attacker.type).category);
assert(pairScript);
draws([0, 0], () => {
    const state = Runner.init(pairScript, attacker, escort);
    attacker.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'real owner-bound NPC-to-NPC attack completes');
});
assert.equal(escort.levels[3], 54, 'companion eats one stored supply after the native attack');
assert.equal(get(health, 'templetrek_multi_npc_food_give'), 0);
assert.equal(get(health, 'templetrek_temp_var_0_6'), 54, 'native auto-eating synchronizes the health mirror');
const stranger = fixture();
seed(stranger, ['lobster']);
useNpc(stranger, 'lobster', escort);
assert.equal(count(stranger, 'lobster'), 1, 'another account cannot feed or alter the owned companion');
proc(health, 'templetrek_enter_event', [10]);
escort = actors(health).find(n => names.includes(shown(health, n).debugname));
const abidor = actors(health).find(n => shown(health, n).debugname === 'templetrek_good_samaritan');
assert(abidor, 'original Abidor is spawned in the friendly event');
seed(health, ['rotten_food', 'rotten_food']);
health.levels[PlayerStat.HITPOINTS] = 20;
health.levels[PlayerStat.DEFENCE] = 10;
dispatch(stranger, 'OPNPC1', abidor);
assert.equal(health.levels[PlayerStat.HITPOINTS], 20, 'another account cannot claim an owned Abidor');
dispatch(health, 'OPNPC1', abidor);
assert.equal(escort.levels[3], 100);
assert(health.levels[PlayerStat.HITPOINTS] > health.baseLevels[PlayerStat.HITPOINTS]);
assert(health.levels[PlayerStat.DEFENCE] > health.baseLevels[PlayerStat.DEFENCE]);
assert.equal(count(health, 'rotten_food'), 0);
assert.equal(count(health, 'stew'), 2, 'Abidor converts every rotten-food item');
kill(health, escort);
assert.deepEqual(tile(health), [0, 3479, 3241], 'companion death cleanly returns the owner');
assert.equal(health.getVar(vp('templetrek_temp_var')), 0);
console.log('PASS native follower health, stored supplies/auto-eating, Abidor, ownership and companion death failure');

// Route-specific evasion is independent of killing and awards no kill credit.
for (const route of [1, 2, 3]) {
    const evade = fixture();
    choose(evade, 0, route);
    proc(evade, 'templetrek_enter_event', [4]);
    const exit = loc(evade, 'templetrek_swamp_evade_path', packed(0, 31, 78, 25, 50));
    const generation = World.instances.getSaveCoord({ level: evade.level, x: evade.x, z: evade.z }, null);
    dispatch(evade, 'OPLOC2', exit);
    if (route === 1) {
        assert.equal(get(evade, 'templetrek_temp_var_19_21'), 1, 'easy route can evade without kills');
        assert.equal(get(evade, 'templetrek_npc_point_value'), 0);
    } else {
        assert.equal(get(evade, 'templetrek_temp_var_19_21'), 0, 'medium/hard cannot evade a fresh hostile group');
        assert.deepEqual(World.instances.getSaveCoord({ level: evade.level, x: evade.x, z: evade.z }, null), generation);
        const enemies = hostile(evade);
        for (const target of enemies.slice(0, Math.ceil(enemies.length / 2))) kill(evade, target);
        dispatch(evade, 'OPLOC2', exit);
        assert.equal(get(evade, 'templetrek_temp_var_19_21'), route === 2 ? 1 : 0, 'medium needs half defeated; hard never evades');
    }
    clear(evade);
}
console.log('PASS all route evade gates');

// The narrow committed-teleport hook never changes ordinary travel, and an
// actual dangerous death still keeps three valuable items and drops the rest.
const ordinary = fixture();
seed(ordinary, ['rune_sword', 'adamant_sword', 'mithril_sword', 'logs']);
const beforeOrdinary = tile(ordinary);
proc(ordinary, 'templetrek_teleport_release', [packed(0, 50, 50, 21, 18)]);
assert.deepEqual(tile(ordinary), beforeOrdinary, 'hook does not perform ordinary teleport movement');
assert.equal(ordinary.getVar(vp('templetrek_temp_var')), 0);
execute('[queue,player_death_default]', ordinary);
assert.equal(count(ordinary, 'rune_sword'), 1);
assert.equal(count(ordinary, 'adamant_sword'), 1);
assert.equal(count(ordinary, 'mithril_sword'), 1);
assert.equal(count(ordinary, 'logs'), 0, 'ordinary dangerous death still drops the fourth item');
assert(ordinary.x >= 3219 && ordinary.x <= 3223 && ordinary.z >= 3216 && ordinary.z <= 3220, 'ordinary Lumbridge respawn remains unchanged');
pathOut(ordinary.level, ordinary.x, ordinary.z, 'ordinary death landing');
const dying = fixture();
choose(dying, 0, 1);
seed(dying, ['rune_sword', 'adamant_sword', 'mithril_sword', 'logs']);
execute('[queue,player_death_default]', dying);
assert.equal(dying.getVar(vp('templetrek_temp_var')), 0, 'ordinary death releases owned trek state');
assert.equal(count(dying, 'logs'), 0, 'trek death is dangerous, not a safe minigame exception');
assert.equal(count(dying, 'rune_sword'), 1);
pathOut(dying.level, dying.x, dying.z, 'trek dangerous-death landing');
const logout = fixture();
choose(logout, 0, 1);
proc(logout, 'templetrek_enter_event', [8]);
for (let row = 0; row < 2; row++) operateLoc(logout, loc(logout, 'templetrek_route_direction', packed(0, 32, 78, 11, 13 + row)), 1);
assert.equal(get(logout, 'templetrek_temp_var_7_10'), 2, 'logout begins at a genuinely reached intermediate bog step');
assert(map.isMapBlocked(logout.x, logout.z, logout.level), 'intermediate f1 bog position is forced movement only');
proc(logout, 'templetrek_logout');
assert.deepEqual(tile(logout), [0, 3479, 3241]);
assert.equal(logout.getVar(vp('templetrek_temp_var')), 0);
proc(logout, 'templetrek_login');
assert.equal(get(logout, 'templetrek_npcs_visible'), 1);
choose(logout, 0, 1);
const teleportDestination = packed(0, 50, 50, 21, 18);
const beforeDeniedTeleport = tile(logout);
logout.levels[PlayerStat.HITPOINTS] = 0; // Native teleport refusal input.
proc(logout, 'p_telejump_safe', [teleportDestination]);
assert.equal(get(logout, 'templetrek_temp_var_25_25'), 1, 'a failed native teleport check never clears owned trek state');
assert.deepEqual(tile(logout), beforeDeniedTeleport);
logout.levels[PlayerStat.HITPOINTS] = 99;
proc(logout, 'p_telejump_safe', [teleportDestination]);
assert.equal(logout.getVar(vp('templetrek_temp_var')), 0, 'committed external teleport releases owned trek state');
assert.deepEqual(tile(logout), [0, 3221, 3218], 'committed ordinary teleport reaches its independently specified destination');
pathOut(logout.level, logout.x, logout.z, 'committed teleport landing');
console.log('PASS ordinary/trek dangerous death, logout recovery, committed travel and repeat entry');

const tomes = types.ObjType.configs.filter(cfg => cfg?.debugname?.startsWith('templetrek_') && cfg.iop?.includes('Read'));
assert.equal(tomes.length, 21, 'all original seven-skill, three-tier tomes are present');
for (const name of [...tokens, 'templetrek_swamptree_branch', 'templetrek_short_vine', 'templetrek_long_vine', ...tomes.map(cfg => cfg.debugname)]) {
    assert.equal(types.ObjType.get(obj(name)).tradeable, false, `private trek item ${name} is untradeable in packed config`);
}
console.log('PASS private-item tradeability audit and original tome catalogue');

const boothBase = id('LocType', 'burgh_bank_booth_multiloc');
let booth;
for (let x = 3456; x < 3520 && !booth; x++) for (let z = 3200; z < 3264 && !booth; z++) booth = World.getLoc(x, z, 0, boothBase);
assert(booth, 'original packed Burgh de Rott booth exists');
draws([0, 0, 0], () => itemOnBooth(finish, tokens[0], booth));
assert.equal(count(finish, tokens[0]), 0, 'earned token is redeemed by native item-on-booth dispatch');
assert.equal(count(finish, 'cert_coal'), 5);
assert.equal(count(finish, 'cert_iron_ore'), 5, 'coal reward includes iron, not either/or');
assert.equal(get(finish, 'templetrek_npc_point_value'), 0);
choose(finish, 0, 1);
clear(finish);

// Reward table fixtures control only the input token, saved points and RNG stream.
const categories = [
    { category: 0, extra: [0, 0], result: [['cert_coal', 5], ['cert_iron_ore', 5]] },
    { category: 1, extra: [0], result: [['cert_bow_string', 9]] },
    { category: 2, extra: [0], result: [['cert_silver_bar', 6]] },
    { category: 3, extra: [0, 0], result: [['cert_blankrune', 27]] },
    { category: 3, extra: [0.75, 0], result: [['cert_blankrune_high', 27]] },
    { category: 4, extra: [0], result: [['wildblood_hop_seed', 3]] },
    { category: 5, extra: [0], result: [['cert_raw_lobster', 3]] },
    { category: 6, extra: [0, 0], result: [['cert_unidentified_toadflax', 4]] },
    { category: 6, extra: [0.5, 0, 0], result: [['cert_unidentified_harralander', 4]] },
    { category: 6, extra: [0.5, 0.75, 0], result: [['cert_unidentified_tarromin', 4]] }
];
for (let route = 1; route <= 3; route++) {
    for (const row of categories) {
        const p = fixture();
        seed(p, [tokens[route - 1]]);
        set(p, 'templetrek_npc_point_value', 8000); // Reward-table input fixture, not a completion result.
        draws([(row.category + 0.25) / 8, ...row.extra], () => itemOnBooth(p, tokens[route - 1], booth));
        assert.equal(count(p, tokens[route - 1]), 0);
        assert.equal(get(p, 'templetrek_npc_point_value'), 0);
        assert.deepEqual(inventory(p).filter(Boolean).map(item => [item.name, item.count]).sort(), row.result.toSorted(), 'native redemption matches the complete source category');
    }
    for (let skill = 0; skill < 7; skill++) {
        const p = fixture();
        seed(p, [tokens[route - 1]]);
        draws([7.25 / 8, (skill + 0.25) / 7], () => itemOnBooth(p, tokens[route - 1], booth));
        const expected = ['agility', 'firemaking', 'fishing', 'mining', 'slayer', 'thieving', 'woodcutting'][skill];
        assert.equal(count(p, `templetrek_tome_${expected}_level_${route}`), 1, 'each original tier/skill tome is a reachable reward');
    }
}
for (const [minimum, maximum] of [[5, 145], [5, 72], [9, 242], [6, 153], [27, 666], [3, 79], [3, 80], [4, 101]]) {
    assert.equal(draws([0], () => proc(finish, 'templetrek_reward_amount', [minimum, maximum, 8000, 3]).popInt()), minimum);
    assert.equal(draws([0.999999], () => proc(finish, 'templetrek_reward_amount', [minimum, maximum, 8000, 3]).popInt()), maximum);
}
const bag = fixture();
seed(bag, [tokens[0], ...Array(27).fill('logs')]);
set(bag, 'templetrek_npc_point_value', 8000);
draws([], () => itemOnBooth(bag, tokens[0], booth));
assert.equal(count(bag, tokens[0]), 1, 'full-bag refusal keeps token without RNG reroll');
assert.equal(get(bag, 'templetrek_npc_point_value'), 8000);
bag.invDel(inv, obj('logs'), 1);
draws([0, 0, 0], () => itemOnBooth(bag, tokens[0], booth));
assert.equal(count(bag, tokens[0]), 0);
assert.equal(count(bag, 'cert_coal'), 5);
assert.equal(count(bag, 'cert_iron_ore'), 5);
assert.equal(inventory(bag).filter(Boolean).length, 28, 'token slot plus one free slot holds both noted stacks');
console.log('PASS native Burgh token redemption, every material/essence/herb/tome category, quantity bounds and atomic full-bag retry');

for (const cfg of tomes) {
    const match = /^templetrek_tome_(\w+)_level_([123])$/.exec(cfg.debugname);
    assert(match);
    const skill = PlayerStat[match[1].toUpperCase()];
    const [minimum, maximum] = [[550, 1100], [990, 2035], [990, 4015]][Number(match[2]) - 1];
    for (const [draw, expected] of [[0, minimum], [0.999999, maximum]]) {
        const p = fixture();
        seed(p, [cfg.debugname]);
        const before = [...p.stats];
        draws([draw], () => { assert(held(p, cfg.debugname, 1)); settle(p); });
        assert.equal(count(p, cfg.debugname), 0, 'reading consumes the original tome');
        for (let stat = 0; stat < before.length; stat++) assert.equal(p.stats[stat] - before[stat], stat === skill ? expected * 10 : 0, 'only the named skill gets source-bound XP in tenths');
    }
}
console.log('PASS all twenty-one native tome Read handlers at both source XP endpoints');

for (const p of fixtures) clear(p);
console.log('PASS Temple Trekking compiled regression');
process.exit(0);
