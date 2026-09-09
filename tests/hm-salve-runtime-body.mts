/**
 * Isolated compiled-script runtime for Salve melee (4081).
 * Loaded after World via hm-salve-runtime.mts so #/ aliases resolve.
 * RNG: JavaRandom.nextDouble forced high (diagnostic) so randominc(n) == n.
 */
import CategoryType from '#/cache/config/CategoryType.js';
import FontType from '#/cache/config/FontType.js';
import Component from '#/cache/config/Component.js';
import DbRowType from '#/cache/config/DbRowType.js';
import DbTableType from '#/cache/config/DbTableType.js';
import EnumType from '#/cache/config/EnumType.js';
import HuntType from '#/cache/config/HuntType.js';
import IdkType from '#/cache/config/IdkType.js';
import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import MesanimType from '#/cache/config/MesanimType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import SeqType from '#/cache/config/SeqType.js';
import SpotanimType from '#/cache/config/SpotanimType.js';
import StructType from '#/cache/config/StructType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import VarNpcType from '#/cache/config/VarNpcType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarSharedType from '#/cache/config/VarSharedType.js';
import { BlockWalk } from '#/engine/entity/BlockWalk.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Npc from '#/engine/entity/Npc.js';
import { NpcStat } from '#/engine/entity/NpcStat.js';
import Player from '#/engine/entity/Player.js';
import { PlayerStat } from '#/engine/entity/PlayerStat.js';
import ScriptPointer from '#/engine/script/ScriptPointer.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import ScriptRunner from '#/engine/script/ScriptRunner.js';
import ScriptState from '#/engine/script/ScriptState.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import World from '#/engine/World.js';
import JavaRandom from '#/util/JavaRandom.js';

const PACK = 'data/pack';
const WEARPOS_FRONT = 2;
const WEARPOS_RHAND = 3;
const STAB = 0;
const SLASH = 1;
const CRUSH = 2;
const RANGED = 3;
const MAGIC = 4;

type Result = { ok: boolean; value: number; execution: number; error: string | null };

const failed: string[] = [];
const passed: string[] = [];
const unavailable: string[] = [];

function assert(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed.push(name);
        console.log(`PASS ${name}${detail ? ` ${detail}` : ''}`);
    } else {
        failed.push(name);
        console.log(`FAIL ${name}${detail ? ` ${detail}` : ''}`);
    }
}

function noteUnavailable(name: string, reason: string): void {
    unavailable.push(`${name}: ${reason}`);
    console.log(`UNAVAILABLE ${name}: ${reason}`);
}

function loadConfigs(): number {
    VarPlayerType.load(PACK);
    VarBitType.load(PACK);
    ParamType.load(PACK);
    ObjType.load(PACK);
    LocType.load(PACK);
    NpcType.load(PACK);
    IdkType.load(PACK);
    SeqType.load(PACK);
    SpotanimType.load(PACK);
    CategoryType.load(PACK);
    EnumType.load(PACK);
    StructType.load(PACK);
    InvType.load(PACK);
    MesanimType.load(PACK);
    DbTableType.load(PACK);
    DbRowType.load(PACK);
    HuntType.load(PACK);
    VarNpcType.load(PACK);
    VarSharedType.load(PACK);
    Component.load(PACK);
    FontType.load(PACK);
    return ScriptProvider.load(PACK);
}

function requireId(kind: string, id: number, name: string): number {
    if (id < 0) {
        throw new Error(`missing ${kind} ${name}`);
    }
    return id;
}

function varp(player: Player, name: string, value?: number): number {
    const id = requireId('varp', VarPlayerType.getId(name), name);
    if (value !== undefined) {
        player.vars[id] = value;
    }
    return player.vars[id];
}

function makePlayer(): Player {
    const player = new Player('salve_test', 1n, 1n);
    player.uid = 1;
    player.isActive = true;
    player.gender = 0;
    player.baseLevels.fill(50);
    player.levels.fill(50);
    player.stats.fill(100_000);
    player.baseLevels[PlayerStat.HITPOINTS] = 99;
    player.levels[PlayerStat.HITPOINTS] = 99;
    varp(player, 'tutorial', 1000);
    varp(player, 'com_maxhit', 18);
    varp(player, 'com_stabattack', 600);
    varp(player, 'com_slashattack', 600);
    varp(player, 'com_crushattack', 600);
    varp(player, 'com_rangeattack', 600);
    varp(player, 'com_magicattack', 600);
    varp(player, 'com_stabdef', 100);
    varp(player, 'com_slashdef', 100);
    varp(player, 'com_crushdef', 100);
    varp(player, 'com_rangedef', 100);
    varp(player, 'com_magicdef', 100);
    varp(player, 'damagetype', STAB);
    varp(player, 'damagestyle', 0);
    varp(player, 'action_delay', 0);
    varp(player, 'sa_energy', 0);
    player.getInventory(requireId('inv', InvType.getId('worn'), 'worn'));
    player.getInventory(requireId('inv', InvType.getId('inv'), 'inv'));
    player.wrappedMessageGame = (msg: string) => {
        console.log(`mes ${msg}`);
    };
    return player;
}

function makeNpc(debugname: string): Npc {
    const type = requireId('npc', NpcType.getId(debugname), debugname);
    const npcType = NpcType.get(type);
    const npc = new Npc(0, 3094, 3106, npcType.size, npcType.size, EntityLifeCycle.DESPAWN, 1, type, BlockWalk.NONE);
    npc.isActive = true;
    npc.levels[NpcStat.HITPOINTS] = 200;
    npc.baseLevels[NpcStat.HITPOINTS] = 200;
    npc.levels[NpcStat.DEFENCE] = 1;
    npc.baseLevels[NpcStat.DEFENCE] = 1;
    npc.levels[NpcStat.MAGIC] = 1;
    npc.baseLevels[NpcStat.MAGIC] = 1;
    return npc;
}

function wear(player: Player, slot: number, objName: string | null): void {
    const worn = player.getInventory(requireId('inv', InvType.getId('worn'), 'worn'));
    if (!worn) {
        throw new Error('worn inv missing');
    }
    if (objName === null) {
        worn.set(slot, null);
        return;
    }
    worn.set(slot, { id: requireId('obj', ObjType.getId(objName), objName), count: 1 });
}

function invAdd(player: Player, objName: string): void {
    const inv = player.getInventory(requireId('inv', InvType.getId('inv'), 'inv'));
    if (!inv) {
        throw new Error('inv missing');
    }
    inv.set(0, { id: requireId('obj', ObjType.getId(objName), objName), count: 1 });
}

function runNamed(name: string, self: Player, npc: Npc | null, args: number[] = [], other: Player | null = null): Result {
    const script = ScriptProvider.getByName(name);
    if (!script) {
        return { ok: false, value: 0, execution: ScriptState.ABORTED, error: `missing script ${name}` };
    }
    const target = other ?? npc;
    const state = ScriptRunner.init(script, self, target, args);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    if (other) {
        state.pointerAdd(ScriptPointer.ProtectedActivePlayer2);
    }
    try {
        let execution = ScriptRunner.execute(state);
        let resumes = 0;
        while ((execution === ScriptState.SUSPENDED || execution === ScriptState.NPC_SUSPENDED) && resumes < 8) {
            self.delayed = false;
            if (npc) {
                npc.delayed = false;
            }
            World.currentTick += 1;
            execution = ScriptRunner.execute(state);
            resumes++;
        }
        if (execution !== ScriptState.FINISHED) {
            return { ok: false, value: 0, execution, error: `execution=${execution} resumes=${resumes}` };
        }
        const value = state.isp > 0 ? state.popInt() : 0;
        return { ok: true, value, execution, error: null };
    } catch (err) {
        return { ok: false, value: 0, execution: ScriptState.ABORTED, error: err instanceof Error ? err.message : String(err) };
    }
}

function queuedDamage(npc: Npc): number[] {
    const out: number[] = [];
    for (const req of npc.queue.all()) {
        if (req.queueId === ServerTriggerType.AI_QUEUE2) {
            out.push(req.lastInt);
        }
    }
    return out;
}

function clearQueue(npc: Npc): void {
    npc.queue.clear();
}

const EXTRAS = [
    'slayer_abberant_spectre_1',
    'slayer_abberant_spectre_2',
    'slayer_abberant_spectre_3',
    'slayer_abberant_spectre_4',
    'slayer_banshee_1',
    'slayer_crawling_hand_1',
    'slayer_crawling_hand_2',
    'slayer_crawling_hand_3',
    'slayer_crawling_hand_4',
    'slayer_crawling_hand_5',
    'slayer_crawling_hand_big_1',
    'slayer_crawling_hand_big_2',
    'slayer_crawling_hand_big_3',
    'slayer_crawling_hand_big_4',
    'slayer_crawling_hand_big_5',
    'ahoy_undead_cow',
    'ahoy_undead_chicken',
    'ahoy_tortured_soul',
    'deserttreasure_mummy_1',
    'deserttreasure_mummy_2',
    'deserttreasure_mummy_3',
    'deserttreasure_mummy_4',
    'deserttreasure_mummy_5',
    'deserttreasure_mummy_1_on_fire',
    'deserttreasure_mummy_2_on_fire',
    'deserttreasure_mummy_3_on_fire',
    'deserttreasure_mummy_4_on_fire',
    'deserttreasure_mummy_5_on_fire',
    'barrows_skeleton_unarmed',
    'barrows_skeleton_armed',
    'skeletal_miner',
    'zogre_1',
    'zogre_2',
    'zogre_3',
    'zogre_4',
    'zogre_5',
    'zogre_6',
    'zogre_skele',
    'zogre_slash_bash'
];

const EXCLUSIONS = [
    'barrows_ahrim',
    'barrows_dharok',
    'barrows_guthan',
    'barrows_karil',
    'barrows_torag',
    'barrows_verac',
    'ghoul',
    'count_draynor',
    'count_draynor_coffin',
    'vampire_leech',
    'vampire_flyer',
    'vampire_misty',
    'vampire_juve',
    'vampire_juve_hound',
    'vampire_count',
    'possessed_pickaxe',
    'possessed_pickaxe_stationary',
    'tree_spirit'
];

function forceMaxRandom(): void {
    JavaRandom.nextDouble = () => 0.999999999;
}

function main(): void {
    forceMaxRandom();
    const loaded = loadConfigs();
    console.log(`loaded scripts=${loaded}`);
    if (loaded <= 0) {
        throw new Error('ScriptProvider.load failed');
    }

    const player = makePlayer();
    const undead = makeNpc('hauntedmine_boss_ghost');
    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');

    const scaleCases: Array<[number, number]> = [
        [18, 21],
        [19, 22],
        [20, 23],
        [24, 28]
    ];
    for (const [input, expect] of scaleCases) {
        const r = runNamed('[proc,player_npc_salve_scale]', player, undead, [input]);
        assert(`scale7/6 ${input}->${expect}`, r.ok && r.value === expect, r.ok ? `got=${r.value}` : (r.error ?? ''));
        const alt = ((115 * input) / 100) | 0;
        console.log(`note AlternativeA scale(115,100,${input})=${alt} (JS integer, not production helper)`);
    }

    const active = runNamed('[proc,player_npc_salve_active]', player, undead);
    assert('worn 4081 + eligible npc active', active.ok && active.value === 1, active.error ?? `v=${active.value}`);

    wear(player, WEARPOS_FRONT, null);
    invAdd(player, 'crystalshard_necklace');
    const invOnly = runNamed('[proc,player_npc_salve_scale]', player, undead, [18]);
    assert('inv-only 4081 unscaled', invOnly.ok && invOnly.value === 18, invOnly.error ?? `v=${invOnly.value}`);

    wear(player, WEARPOS_FRONT, 'magic_emerald_necklace');
    const otherNeck = runNamed('[proc,player_npc_salve_scale]', player, undead, [18]);
    assert('other neck unscaled', otherNeck.ok && otherNeck.value === 18, otherNeck.error ?? `v=${otherNeck.value}`);

    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');
    const goblin = makeNpc('goblin');
    const goblinScale = runNamed('[proc,player_npc_salve_scale]', player, goblin, [18]);
    assert('goblin ineligible unscaled', goblinScale.ok && goblinScale.value === 18, goblinScale.error ?? `v=${goblinScale.value}`);

    for (const name of EXTRAS) {
        const npc = makeNpc(name);
        const elig = runNamed('[proc,npc_salve_eligible]', player, npc);
        assert(`extra eligible ${name}`, elig.ok && elig.value === 1, elig.error ?? `v=${elig.value}`);
        const scaled = runNamed('[proc,player_npc_salve_scale]', player, npc, [18]);
        assert(`extra scale ${name}`, scaled.ok && scaled.value === 21, scaled.error ?? `v=${scaled.value}`);
    }
    for (const name of EXCLUSIONS) {
        const npc = makeNpc(name);
        const elig = runNamed('[proc,npc_salve_eligible]', player, npc);
        assert(`exclusion ${name}`, elig.ok && elig.value === 0, elig.error ?? `v=${elig.value}`);
        const scaled = runNamed('[proc,player_npc_salve_scale]', player, npc, [18]);
        assert(`exclusion unscaled ${name}`, scaled.ok && scaled.value === 18, scaled.error ?? `v=${scaled.value}`);
    }

    const faded = makeNpc('hauntedmine_boss_ghost_faded');
    const fadedElig = runNamed('[proc,npc_salve_eligible]', player, faded);
    assert('faded Treus ineligible (no op2)', fadedElig.ok && fadedElig.value === 0, fadedElig.error ?? `v=${fadedElig.value}`);

    const cacheBefore = varp(player, 'com_maxhit');
    for (const style of [STAB, SLASH, CRUSH]) {
        varp(player, 'damagetype', style);
        const meleeRoll = runNamed('[proc,player_npc_melee_hit_roll]', player, undead, [style]);
        assert(`melee hit-roll style ${style}`, meleeRoll.ok, meleeRoll.error ?? `v=${meleeRoll.value}`);
        const attack = runNamed('[proc,player_attack_roll_specific]', player, undead, [style]);
        const scaledAttack = runNamed('[proc,player_npc_salve_scale]', player, undead, [attack.value]);
        assert(
            `melee style ${style} attack cache unscaled vs salve`,
            attack.ok && scaledAttack.ok && attack.value === 600 && scaledAttack.value === ((7 * 600) / 6) | 0,
            `atk=${attack.value} scaled=${scaledAttack.value}`
        );
    }

    const unscaledHit = runNamed('[proc,player_npc_hit_roll]', player, undead, [STAB]);
    const scaledHit = runNamed('[proc,player_npc_melee_hit_roll]', player, undead, [STAB]);
    assert(
        'accuracy boundary: unscaled miss vs salve hit (600 vs 700 over ~640 def)',
        unscaledHit.ok && scaledHit.ok && unscaledHit.value === 0 && scaledHit.value === 1,
        `unscaled=${unscaledHit.value}/${unscaledHit.error ?? 'ok'} scaled=${scaledHit.value}/${scaledHit.error ?? 'ok'}`
    );
    goblin.levels[NpcStat.DEFENCE] = 99;
    goblin.baseLevels[NpcStat.DEFENCE] = 99;
    goblin.levels[NpcStat.MAGIC] = 99;
    goblin.baseLevels[NpcStat.MAGIC] = 99;
    const rangedHit = runNamed('[proc,player_npc_hit_roll]', player, goblin, [RANGED]);
    assert('ranged player_npc_hit_roll misses without salve', rangedHit.ok && rangedHit.value === 0, rangedHit.error ?? `v=${rangedHit.value}`);
    const magicHit = runNamed('[proc,player_npc_hit_roll]', player, goblin, [MAGIC]);
    assert('magic player_npc_hit_roll misses without salve', magicHit.ok && magicHit.value === 0, magicHit.error ?? `v=${magicHit.value}`);
    const rangedAtk = runNamed('[proc,player_attack_roll_specific]', player, undead, [RANGED]);
    assert('ranged attack roll ignores salve', rangedAtk.ok && rangedAtk.value === 600, `v=${rangedAtk.value}`);

    const cacheAfterStyles = varp(player, 'com_maxhit');
    assert('com_maxhit cache unchanged after helper rolls', cacheAfterStyles === cacheBefore, `before=${cacheBefore} after=${cacheAfterStyles}`);

    const living = makeNpc('goblin');
    const vsLiving = runNamed('[proc,player_npc_salve_scale]', player, living, [18]);
    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');
    const vsUndeadAgain = runNamed('[proc,player_npc_salve_scale]', player, undead, [18]);
    assert('target switch living then undead reevaluates', vsLiving.ok && vsLiving.value === 18 && vsUndeadAgain.ok && vsUndeadAgain.value === 21, `living=${vsLiving.value} undead=${vsUndeadAgain.value}`);

    player.levels[PlayerStat.ATTACK] = 60;
    player.baseLevels[PlayerStat.ATTACK] = 50;
    player.levels[PlayerStat.STRENGTH] = 60;
    player.baseLevels[PlayerStat.STRENGTH] = 50;
    const combatStat = runNamed('[proc,player_combat_stat]', player, undead);
    assert('player_combat_stat executes from stats/prayer/equip', combatStat.ok, combatStat.error ?? '');
    const computedMax = varp(player, 'com_maxhit');
    const computedStab = varp(player, 'com_stabattack');
    const salveOnCache = runNamed('[proc,player_npc_salve_scale]', player, undead, [computedMax]);
    assert(
        'salve multiplies computed cache without replacing it',
        salveOnCache.ok && salveOnCache.value === (((7 * computedMax) / 6) | 0) && varp(player, 'com_maxhit') === computedMax,
        `cache=${computedMax} scaled=${salveOnCache.value} after=${varp(player, 'com_maxhit')}`
    );

    const leye = makeNpc('rd_combat_npc_room_3');
    player.gender = 0;
    const leyeCap = runNamed('[proc,npc_max_dealt]', player, leye, [salveOnCache.value, 0]);
    assert('male Leye npc_max_dealt still 0 after salve maxhit', leyeCap.ok && leyeCap.value === 0, leyeCap.error ?? `v=${leyeCap.value}`);
    varp(player, 'com_maxhit', 18);
    varp(player, 'com_stabattack', 600);
    varp(player, 'com_slashattack', 600);
    varp(player, 'com_crushattack', 600);

    function runSpec(label: string, weapon: string, npc: Npc, expectDamage: number): void {
        wear(player, WEARPOS_RHAND, weapon);
        varp(player, 'sa_energy', 0);
        varp(player, 'com_maxhit', 18);
        varp(player, 'damagetype', STAB);
        varp(player, 'action_delay', 0);
        clearQueue(npc);
        npc.levels[NpcStat.HITPOINTS] = 200;
        const r = runNamed(label, player, npc);
        assert(`${label} finished`, r.ok, r.error ?? '');
        if (!r.ok) {
            return;
        }
        const hits = queuedDamage(npc);
        assert(`${label} damage ${expectDamage}`, hits.length >= 1 && hits.every(v => v === expectDamage), `queued=${JSON.stringify(hits)}`);
    }

    const kurask = makeNpc('slayer_kursk_1');
    wear(player, WEARPOS_RHAND, null);
    varp(player, 'com_maxhit', 18);
    varp(player, 'damagetype', STAB);
    varp(player, 'action_delay', 0);
    clearQueue(kurask);
    kurask.levels[NpcStat.HITPOINTS] = 200;
    const ordinaryKurask = runNamed('[label,player_melee_attack]', player, kurask);
    assert('ordinary melee vs kurask finished', ordinaryKurask.ok, ordinaryKurask.error ?? '');
    assert('kurask ordinary still 0 after Salve', queuedDamage(kurask).length >= 1 && queuedDamage(kurask).every(v => v === 0), `queued=${JSON.stringify(queuedDamage(kurask))}`);

    runSpec('[proc,pvm_dragon_dagger_spec_hit]', 'dragon_dagger', undead, 24);
    wear(player, WEARPOS_RHAND, 'dragon_dagger');
    varp(player, 'sa_energy', 0);
    varp(player, 'com_maxhit', 18);
    varp(player, 'action_delay', 0);
    clearQueue(undead);
    undead.levels[NpcStat.HITPOINTS] = 200;
    const daggerLabel = runNamed('[label,pvm_dragon_dagger_sa]', player, undead);
    assert('dagger label finished', daggerLabel.ok, daggerLabel.error ?? '');
    assert(
        'dagger label two once-scaled hits',
        queuedDamage(undead).length === 2 && queuedDamage(undead)[0] === 24 && queuedDamage(undead)[1] === 24,
        `queued=${JSON.stringify(queuedDamage(undead))}`
    );

    runSpec('[label,pvm_dragon_longsword_sa]', 'dragon_longsword', undead, 26);
    runSpec('[label,pvm_dragon_mace_sa]', 'dragon_mace', undead, 31);
    runSpec('[label,pvm_abyssal_whip_sa]', 'abyssal_whip', undead, 21);
    runSpec('[label,pvm_rune_claws_sa]', 'rune_claws', undead, 23);

    varp(player, 'com_maxhit', 19);
    wear(player, WEARPOS_RHAND, 'dragon_mace');
    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');
    clearQueue(undead);
    undead.levels[NpcStat.HITPOINTS] = 200;
    const mace19 = runNamed('[label,pvm_dragon_mace_sa]', player, undead);
    assert('mace floor order finished', mace19.ok, mace19.error ?? '');
    assert('mace Salve-then-special floor 19->33 not 32', queuedDamage(undead).length === 1 && queuedDamage(undead)[0] === 33, `queued=${JSON.stringify(queuedDamage(undead))}`);
    varp(player, 'com_maxhit', 18);

    const cacheAfterSpecs = varp(player, 'com_maxhit');
    assert('com_maxhit cache unchanged after specs', cacheAfterSpecs === 18, `v=${cacheAfterSpecs}`);
    assert('com_stabattack cache unchanged after specs', varp(player, 'com_stabattack') === 600, `v=${varp(player, 'com_stabattack')}`);

    const ordinary = makeNpc('hauntedmine_boss_ghost');
    ordinary.levels[NpcStat.HITPOINTS] = 200;
    ordinary.baseLevels[NpcStat.HITPOINTS] = 200;
    wear(player, WEARPOS_RHAND, 'dragon_dagger');
    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');
    varp(player, 'com_maxhit', 18);
    varp(player, 'damagetype', STAB);
    varp(player, 'action_delay', 0);
    clearQueue(ordinary);
    const melee = runNamed('[label,player_melee_attack]', player, ordinary);
    assert('ordinary melee attack finished', melee.ok, melee.error ?? '');
    assert('ordinary melee maxhit scaled 18->21', queuedDamage(ordinary).length === 1 && queuedDamage(ordinary)[0] === 21, `queued=${JSON.stringify(queuedDamage(ordinary))}`);
    assert('ordinary melee did not poison com_maxhit', varp(player, 'com_maxhit') === 18, `v=${varp(player, 'com_maxhit')}`);

    const p2 = makePlayer();
    p2.uid = 2;
    p2.username = 'salve_p2';
    p2.levels[PlayerStat.HITPOINTS] = 99;
    varp(player, 'com_maxhit', 18);
    varp(p2, 'com_stabdef', 100);
    const pvpRollWorn = runNamed('[proc,pvp_hit_roll]', player, null, [STAB], p2);
    wear(player, WEARPOS_FRONT, null);
    const pvpRollBare = runNamed('[proc,pvp_hit_roll]', player, null, [STAB], p2);
    wear(player, WEARPOS_FRONT, 'crystalshard_necklace');
    assert(
        'pvp_hit_roll worn vs unworn same outcome',
        pvpRollWorn.ok && pvpRollBare.ok && pvpRollWorn.value === pvpRollBare.value,
        `worn=${pvpRollWorn.value} bare=${pvpRollBare.value} err=${pvpRollWorn.error ?? ''}/${pvpRollBare.error ?? ''}`
    );
    varp(player, 'action_delay', 0);
    const pvpMelee = runNamed('[label,pvp_melee_attack]', player, null, [], p2);
    assert('pvp ordinary melee finished', pvpMelee.ok, pvpMelee.error ?? '');
    assert('pvp ordinary melee did not poison com_maxhit', varp(player, 'com_maxhit') === 18, `v=${varp(player, 'com_maxhit')}`);
    wear(player, WEARPOS_RHAND, 'dragon_dagger');
    varp(player, 'sa_energy', 0);
    const pvpDagger = runNamed('[label,pvp_dragon_dagger_sa]', player, null, [], p2);
    assert('pvp dagger spec finished', pvpDagger.ok, pvpDagger.error ?? '');
    assert('pvp dagger spec did not poison com_maxhit', varp(player, 'com_maxhit') === 18, `v=${varp(player, 'com_maxhit')}`);

    // Compare actual queued PvP damage, not merely script termination/cache state.
    const pvpDamageScript = ScriptProvider.getByName('[queue,pvp_damage]');
    if (!pvpDamageScript) throw new Error('missing pvp_damage queue');
    for (const salveWorn of [false, true]) {
        for (const [label, expected] of [
            ['[label,pvp_melee_attack]', [18]],
            ['[label,pvp_dragon_dagger_sa]', [20, 20]]
        ] as Array<[string, number[]]>) {
            const attacker = makePlayer();
            const defender = makePlayer();
            defender.uid = 2;
            defender.username = 'salve_damage_control';
            wear(attacker, WEARPOS_RHAND, 'dragon_dagger');
            wear(attacker, WEARPOS_FRONT, salveWorn ? 'crystalshard_necklace' : null);
            const prepared = runNamed('[proc,player_combat_stat]', attacker, null);
            assert(`PvP fixture cache initialized ${label} salve=${salveWorn}`, prepared.ok, prepared.error ?? '');
            varp(attacker, 'com_maxhit', 18);
            varp(attacker, 'com_stabattack', 600);
            varp(attacker, 'sa_energy', 1000);
            varp(attacker, 'action_delay', 0);
            const result = runNamed(label, attacker, null, [], defender);
            const requests = [...defender.queue.all()].filter(q => q.script.id === pvpDamageScript.id);
            const damages = requests.map(q => Number(q.args[0]));
            assert(`PvP damage ${label} salve=${salveWorn}`, result.ok && JSON.stringify(damages) === JSON.stringify(expected), `damage=${JSON.stringify(damages)} error=${result.error ?? ''}`);
            assert(`PvP caches ${label} salve=${salveWorn}`, varp(attacker, 'com_maxhit') === 18 && varp(attacker, 'com_stabattack') === 600);
        }
    }

    // Exercise the actual special labels at accuracy thresholds that distinguish
    // an unscaled miss from a Salve hit (fixed RNG is diagnostic only).
    for (const [label, weapon, defence, expected] of [
        ['[label,pvm_dragon_dagger_sa]', 'dragon_dagger', 2, [24, 24]],
        ['[label,pvm_dragon_longsword_sa]', 'dragon_longsword', 1, [26]],
        ['[label,pvm_dragon_mace_sa]', 'dragon_mace', 3, [31]],
        ['[label,pvm_abyssal_whip_sa]', 'abyssal_whip', 3, [21]],
        ['[label,pvm_rune_claws_sa]', 'rune_claws', 1, [23]]
    ] as Array<[string, string, number, number[]]>) {
        for (const salveWorn of [false, true]) {
            const attacker = makePlayer();
            const target = makeNpc('hauntedmine_boss_ghost');
            target.levels[NpcStat.DEFENCE] = defence;
            target.baseLevels[NpcStat.DEFENCE] = defence;
            wear(attacker, WEARPOS_RHAND, weapon);
            wear(attacker, WEARPOS_FRONT, salveWorn ? 'crystalshard_necklace' : null);
            varp(attacker, 'sa_energy', 1000);
            const defenceRoll = runNamed('[proc,npc_defence_roll_specific]', attacker, target, [weapon === 'dragon_mace' ? CRUSH : SLASH]);
            assert(`special fixture defence ${weapon} salve=${salveWorn}`, defenceRoll.ok && defenceRoll.value === (defence + 9) * 69, `roll=${defenceRoll.value}`);
            const result = runNamed(label, attacker, target);
            const damages = queuedDamage(target);
            const want = salveWorn ? expected : expected.map(() => 0);
            assert(`special accuracy boundary ${weapon} salve=${salveWorn}`, result.ok && JSON.stringify(damages) === JSON.stringify(want), `damage=${JSON.stringify(damages)} error=${result.error ?? ''}`);
        }
    }

    const whipKurask = makeNpc('slayer_kursk_1');
    wear(player, WEARPOS_RHAND, 'abyssal_whip');
    varp(player, 'com_maxhit', 18);
    varp(player, 'action_delay', 0);
    clearQueue(whipKurask);
    whipKurask.levels[NpcStat.HITPOINTS] = 200;
    const whipK = runNamed('[label,pvm_abyssal_whip_sa]', player, whipKurask);
    assert('whip vs kurask finished', whipK.ok, whipK.error ?? '');
    assert('whip kurask still 0 after Salve', queuedDamage(whipKurask).length >= 1 && queuedDamage(whipKurask).every(v => v === 0), `queued=${JSON.stringify(queuedDamage(whipKurask))}`);

    const lsKurask = makeNpc('slayer_kursk_1');
    wear(player, WEARPOS_RHAND, 'dragon_longsword');
    clearQueue(lsKurask);
    lsKurask.levels[NpcStat.HITPOINTS] = 200;
    const lsK = runNamed('[label,pvm_dragon_longsword_sa]', player, lsKurask);
    assert('longsword vs kurask finished', lsK.ok, lsK.error ?? '');
    assert('longsword kurask still 0 after Salve', queuedDamage(lsKurask).length >= 1 && queuedDamage(lsKurask).every(v => v === 0), `queued=${JSON.stringify(queuedDamage(lsKurask))}`);

    const spear = makeNpc('hauntedmine_boss_ghost');
    wear(player, WEARPOS_RHAND, 'dragon_spear');
    clearQueue(spear);
    const spearR = runNamed('[label,pvm_dragon_spear_sa]', player, spear);
    assert('spear spec finished', spearR.ok, spearR.error ?? '');
    assert('spear spec queues no AI_QUEUE2 damage', queuedDamage(spear).length === 0, `queued=${JSON.stringify(queuedDamage(spear))}`);

    console.log(`\npassed=${passed.length} failed=${failed.length}`);
    if (failed.length) {
        console.log('failures:');
        for (const f of failed) {
            console.log(`  ${f}`);
        }
        process.exit(1);
    }
    process.exit(0);
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exit(1);
}
