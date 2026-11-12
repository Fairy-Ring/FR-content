// Packed configuration and trigger integration checks. This does not start a server.
import assert from 'node:assert/strict';
import CategoryType from '#/cache/config/CategoryType.js';
import DbRowType from '#/cache/config/DbRowType.js';
import DbTableType from '#/cache/config/DbTableType.js';
import EnumType from '#/cache/config/EnumType.js';
import LocType from '#/cache/config/LocType.js';
import NpcType from '#/cache/config/NpcType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import { ScriptOpcodeNameMap } from '#/engine/script/ScriptOpcode.js';

for (const config of [ParamType, CategoryType, LocType, NpcType, ObjType, EnumType, DbTableType, DbRowType, VarPlayerType]) config.load('data/pack');
assert(ScriptProvider.load('data/pack') > 0);
let checks = 0;
function pass(message: string): void { console.log(`PASS ${++checks}: ${message}`); }
const druidquestId = VarPlayerType.getId('druidquest');
assert.notEqual(druidquestId, -1);
const cauldronUse = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPLOCU, LocType.getId('cauldron_of_thunder'));
assert(cauldronUse, 'compiled Cauldron item-use trigger');
assert.equal(cauldronUse.fileName, 'quest_druid.rs2');
const opcodeName = (pc: number) => ScriptOpcodeNameMap.get(cauldronUse.opcodes[pc]);
const guardPc = cauldronUse.opcodes.findIndex(
    (opcode, pc) => ScriptOpcodeNameMap.get(opcode) === 'PUSH_VARP' && cauldronUse.intOperands[pc] === druidquestId
);
assert.notEqual(guardPc, -1, 'compiled Cauldron guard reads druidquest');
assert.equal(opcodeName(guardPc + 1), 'PUSH_CONSTANT_INT');
assert.equal(cauldronUse.intOperands[guardPc + 1], 2);
const rejectPc = guardPc + 2;
assert.equal(opcodeName(rejectPc), 'BRANCH_NOT');
const rejectTarget = rejectPc + 1 + cauldronUse.intOperands[rejectPc];
assert.equal(opcodeName(rejectTarget), 'PUSH_CONSTANT_INT');
assert.equal(cauldronUse.intOperands[rejectTarget], 0);
const refusalCallPc = rejectTarget + 1;
assert.equal(opcodeName(refusalCallPc), 'GOSUB_WITH_PARAMS');
assert.equal(ScriptProvider.get(cauldronUse.intOperands[refusalCallPc])?.name, '[proc,displaymessage]');
const refusalReturnPc = refusalCallPc + 1;
assert.equal(opcodeName(refusalReturnPc), 'RETURN');
const arriveDelayPc = cauldronUse.opcodes.findIndex(opcode => ScriptOpcodeNameMap.get(opcode) === 'P_ARRIVEDELAY');
assert.notEqual(arriveDelayPc, -1, 'compiled Cauldron transform keeps its arrival delay');
assert.ok(refusalReturnPc < arriveDelayPc, 'non-stage-2 refusal returns before arrival delay');
const stage2JumpPc = rejectPc + 1;
assert.equal(opcodeName(stage2JumpPc), 'BRANCH');
assert.equal(stage2JumpPc + 1 + cauldronUse.intOperands[stage2JumpPc], arriveDelayPc);
pass('compiled Cauldron guard refuses non-stage-2 use before arrival delay');
function param(holder: { params: Map<number, number | string> }, name: string): number | string | undefined {
    const id = ParamType.getId(name); assert(id >= 0, name);
    return holder.params.get(id);
}
function column(row: DbRowType, name: string): (number | string)[] {
    const table = DbTableType.get(row.tableId);
    const index = table.columnNames.indexOf(name); assert(index >= 0, name);
    return row.getValue(index, 0);
}
const mineRows = DbRowType.getInTable(DbTableType.getId('mining_table'));
const ores: [number, string, string, number, number][] = [
    [14850, 'coal', 'coal', 30, 500],
    [14853, 'mithril', 'mithril_ore', 55, 800],
    [14856, 'iron', 'iron_ore', 15, 350],
    [14859, 'runite', 'runite_ore', 85, 1250],
    [14862, 'adamantite', 'adamantite_ore', 70, 950]
];
for (const [first, ore, output, level, xp] of ores) {
    const expected = DbRowType.getByName(`${ore}_rock_table`); assert(expected);
    for (let shape = 0; shape < 3; shape++) {
        const id = first + shape;
        const matches = mineRows.filter(row => row.columnValues[0].includes(id));
        assert.equal(matches.length, 1, `unique ore row for ${id}`);
        assert.equal(matches[0], expected);
        assert.deepEqual(column(expected, 'rock_output'), [ObjType.getId(output)]);
        assert.deepEqual(column(expected, 'rock_level'), [level]);
        assert.deepEqual(column(expected, 'rock_exp'), [xp]);
        const rock = LocType.get(id);
        assert.equal(rock.debugname, `rocks_${id}`);
        assert.equal(rock.category, CategoryType.getId(ore === 'iron' ? 'mining_rock_fast' : 'mining_rock_normal'));
        assert.equal(param(rock, 'next_loc_stage_mining'), 14832 + shape);
        for (const op of [ServerTriggerType.OPLOC1, ServerTriggerType.OPLOC2]) {
            assert(ScriptProvider.getByTrigger(op, id, rock.category), `mine/prospect dispatch for ${id}`);
        }
    }
    pass(`${ore}: all three shapes share the existing ore rules and depleted stages`);
}
for (let id = 14832; id <= 14834; id++) {
    assert.equal(param(LocType.get(id), 'mining_rock_empty'), 1);
    assert.equal(LocType.get(id).category, CategoryType.getId('mining_rock_normal'));
}
pass('all three depleted stages use the existing empty-rock handler');

const hard = EnumType.getByName('trail_hard_enum'); assert(hard);
assert.equal(hard.values.size, 34);
assert.deepEqual([...hard.values.keys()], Array.from({ length: 34 }, (_, i) => i));
const guardian = NpcType.getByName('trail_hard2'); assert(guardian);
for (const [index, clueId, casketId, x, z] of [[31, 3560, 3561, 2209, 3161], [32, 3562, 3563, 2181, 3206]]) {
    assert.equal(hard.values.get(index), clueId);
    const clue = ObjType.get(clueId);
    assert.equal(param(clue, 'trail_coord'), (x << 14) | z);
    assert.equal(param(clue, 'trail_guardian'), guardian.id);
    assert.equal(param(clue, 'trail_casket'), casketId);
    assert.equal(ObjType.get(casketId).category, CategoryType.getId('trail_casket_hard'));
}
assert.equal(hard.values.get(33), 3564);
assert.equal(ObjType.get(3565).category, CategoryType.getId('trail_puzzle'));
const iorwerth = NpcType.getByName('lord_iorwerth'); assert(iorwerth);
assert(ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPNPC1, iorwerth.id, iorwerth.category));
pass('three Isafdar enum entries retain their complete coordinate/casket or Iorwerth puzzle units');
for (const trigger of [ServerTriggerType.OPNPC2, ServerTriggerType.APNPC2, ServerTriggerType.AI_QUEUE1, ServerTriggerType.AI_APPLAYER2, ServerTriggerType.AI_OPPLAYER2, ServerTriggerType.AI_TIMER, ServerTriggerType.AI_QUEUE3]) {
    assert(ScriptProvider.getByTriggerSpecific(trigger, guardian.id, guardian.category), `Saradomin guardian trigger ${trigger}`);
}
const spell = DbRowType.getByName('magic_spell_saradomin_strike_npc'); assert(spell);
assert.deepEqual(column(spell, 'spell'), [104]);
assert.deepEqual(column(spell, 'maxhit'), [20]);
assert.deepEqual(column(spell, 'levelrequired'), [0]);
const statColumn = DbTableType.get(spell.tableId).columnNames.indexOf('stat_change');
assert(!spell.columnValues[statColumn]?.length, 'NPC spell does not inherit player-spell prayer drain');
pass('Saradomin guardian combat/death triggers and NPC-only spell are packed');
console.log(`PASS ${checks} packed content checks; no engine started`);
process.exit(0);
