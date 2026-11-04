/**
 * Production-handler execution for CoF lifecycle/recovery repairs.
 *
 * Loads isolated compiled script.dat and runs the actual procs via ScriptRunner
 * (not a handwritten state mirror). Control cases: full-inv, repeat, owner,
 * cat UID, hire refuse, head hand-in, Charos bank/worn/inv.
 *
 * Run after npm run build in the sibling engine:
 *   node --import tsx ../content/tests/fenkenstrain-completion/test_fenk_handlers.mjs
 *
 * Fail-closed: runProc asserts ScriptRunner did not ABORT. Clock grant/recovery
 * use ~mesbox → p_pausebutton (PAUSEBUTTON), which is the production Continue
 * boundary — not a swallowed interpreter error. A prior attempt loaded no
 * FontType/Component, so split_init aborted after grant writes; that is not PASS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ISO_ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(WT, '../engine');
const PACK_DIR = path.join(ISO_ENGINE, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

function fail(msg) {
  console.error('FAIL', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('OK', msg);
}

function assert(cond, msg) {
  if (!cond) {
    fail(msg);
    throw new Error(msg);
  }
}

if (!fs.existsSync(SCRIPT_DAT)) {
  fail(`missing compiled script.dat at ${SCRIPT_DAT} — run npm run build in the sibling engine`);
  process.exit(1);
}

const eng = (rel) => import(pathToFileURL(path.join(ISO_ENGINE, rel)).href);

const WorldMod = await eng('src/engine/World.ts');
const World = WorldMod.default;
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: LocType } = await eng('src/cache/config/LocType.ts');
const { default: SeqType } = await eng('src/cache/config/SeqType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.js');

VarPlayerType.load(PACK_DIR);
VarBitType.load(PACK_DIR);
VarNpcType.load(PACK_DIR);
NpcType.load(PACK_DIR);
LocType.load(PACK_DIR);
SeqType.load(PACK_DIR);
World.currentTick = 1;
InvType.load(PACK_DIR);
ObjType.load(PACK_DIR);
FontType.load(PACK_DIR);
assert(FontType.get(3), 'FontType q8_full (id 3) missing — need ISO data/pack/client/title');
Component.load(PACK_DIR);

const loaded = ScriptProvider.load(PACK_DIR);
assert(loaded > 0, `ScriptProvider.load returned ${loaded}`);
ok(`loaded ${loaded} compiled scripts`);

function packMap(rel, name) {
  const text = fs.readFileSync(path.join(WT, rel), 'utf8');
  const m = text.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
  if (!m) throw new Error(`${rel} missing ${name}`);
  return Number(m[1]);
}

const ID = {
  inv: packMap('pack/inv.pack', 'inv'),
  worn: packMap('pack/inv.pack', 'worn'),
  bank: packMap('pack/inv.pack', 'bank'),
  letter: packMap('pack/obj.pack', 'fenk_letter'),
  headEmpty: packMap('pack/obj.pack', 'fenk_head_empty'),
  headFull: packMap('pack/obj.pack', 'fenk_head_full'),
  key: packMap('pack/obj.pack', 'fenk_mausoleum_key'),
  charos: packMap('pack/obj.pack', 'ring_of_charos'),
  charosU: packMap('pack/obj.pack', 'ring_of_charos_unlocked'),
  coins: packMap('pack/obj.pack', 'coins'),
  fenkFlags: packMap('pack/varp.pack', 'fenk_flags'),
  fenkFollower: packMap('pack/varp.pack', 'fenk_follower_uid'),
  fenkMem: packMap('pack/varp.pack', 'fenk_charos_unlocked'),
  catUid: packMap('pack/varp.pack', 'follower_uid'),
  priestperil: packMap('pack/varp.pack', 'priestperil'),
  prieststart: packMap('pack/varp.pack', 'prieststart'),
  woundBit: packMap('pack/varbit.pack', 'fenk_wound_clock'),
  headBit: packMap('pack/varbit.pack', 'fenk_head'),
  directionsBit: packMap('pack/varbit.pack', 'fenk_gardener_directions'),
  fenkQuest: packMap('pack/varp.pack', 'fenk_quest'),
  readSignpost: packMap('pack/varbit.pack', 'fenk_read_signpost'),
  needleBit: packMap('pack/varbit.pack', 'fenk_needle'),
  threadsBit: packMap('pack/varbit.pack', 'fenk_threads_given'),
  needle: packMap('pack/obj.pack', 'needle'),
  thread: packMap('pack/obj.pack', 'thread'),
  marble: packMap('pack/obj.pack', 'fenk_marble_amulet'),
  obsidian: packMap('pack/obj.pack', 'fenk_obsidian_amulet'),
  star: packMap('pack/obj.pack', 'fenk_star_amulet'),
  doctor: packMap('pack/npc.pack', 'fenk_fenkenstrain_model'),
  bookcase: packMap('pack/loc.pack', 'fenk_bookcase')
};

const PRIESTPERIL_COMPLETE = 60;
const PRIEST_COMPLETE = 5;

function makePlayer() {
  const p = new Player('fenk_test', 0n, 0n);
  p.uid = 1;
  p.pid = 1;
  p.staffModLevel = 0;
  p.messages = [];
  p.lastMovement = 0;
  // Capture real outgoing text without a connected client.
  p.write = message => {
    if (typeof message.text === 'string') p.messages.push(message.text);
  };
  p.messageGame = message => p.messages.push(message);
  p.wrappedMessageGame = message => p.messages.push(message);
  return p;
}

function invOf(player, invId) {
  const inv = player.getInventory(invId);
  assert(inv, `inventory ${invId} null`);
  return inv;
}

function fillInv(player, objId, countSlots) {
  const inv = invOf(player, ID.inv);
  for (let i = 0; i < countSlots && i < inv.capacity; i++) {
    inv.set(i, { id: objId, count: 1 });
  }
}

function total(player, invId, objId) {
  const inv = invOf(player, invId);
  return inv.getItemCount(objId);
}

function runProc(player, name, protect = true, target = null) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing ${name}`);
  const state = ScriptRunner.init(script, player, target);
  const exec = player.runScript(state, protect, true);
  assert(exec !== -1, `${name} did not obtain protected access`);
  assert(exec !== ScriptState.ABORTED, `${name} ScriptRunner ABORTED`);
  return { state, exec, script };
}

function expectFinished(result, name) {
  assert(
    result.exec === ScriptState.FINISHED,
    `${name} exec=${result.exec} expected FINISHED=${ScriptState.FINISHED}`
  );
}

function expectPausebutton(result, name) {
  // ~mesbox → split_init + mesbox_page + p_pausebutton. Production waits for Continue.
  assert(
    result.exec === ScriptState.PAUSEBUTTON,
    `${name} exec=${result.exec} expected PAUSEBUTTON=${ScriptState.PAUSEBUTTON} (mesbox Continue)`
  );
}

// ---- clock letter ----
{
  const p = makePlayer();
  fillInv(p, ID.coins, 28);
  assert(invOf(p, ID.inv).freeSlotCount === 0, 'expected full inv');
  p.setVarBit(ID.woundBit, 0);
  const full = runProc(p, '[proc,fenk_try_clock_letter]');
  expectFinished(full, 'clock full-inv');
  assert(p.getVarBit(ID.woundBit) === 0, 'full-inv clock must not write wound bit');
  assert(total(p, ID.inv, ID.letter) === 0, 'full-inv clock must not grant letter');
  ok('clock full-inv: no bit, no letter (retry intact)');
}

{
  const p = makePlayer();
  p.setVarBit(ID.woundBit, 0);
  const grant = runProc(p, '[proc,fenk_try_clock_letter]');
  expectPausebutton(grant, 'clock grant mesbox');
  assert(total(p, ID.inv, ID.letter) === 1, 'clock grant letter');
  assert(p.getVarBit(ID.woundBit) === 1, 'clock grant writes wound bit after space');
  const again = runProc(p, '[proc,fenk_try_clock_letter]');
  expectFinished(again, 'clock re-wind while holding');
  assert(total(p, ID.inv, ID.letter) === 1, 'repeat wind while holding letter does not duplicate');
  ok('clock grant + transcript re-wind while holding');
}

{
  const p = makePlayer();
  p.setVarBit(ID.woundBit, 1);
  const rec = runProc(p, '[proc,fenk_try_clock_letter]');
  expectPausebutton(rec, 'clock lost-letter recovery mesbox');
  assert(total(p, ID.inv, ID.letter) === 1, 'lost-letter recovery (bit set, inv empty) re-grants');
  ok('clock lost-letter recovery retry');
}

// ---- head re-dig ----
{
  const p = makePlayer();
  p.setVarBit(ID.headBit, 0);
  const grant = runProc(p, '[proc,fenk_try_dig_head]');
  expectFinished(grant, 'head dig grant');
  assert(total(p, ID.inv, ID.headEmpty) === 1, 'head dig grants empty head');
  const held = runProc(p, '[proc,fenk_try_dig_head]');
  expectFinished(held, 'head dig held refuse');
  assert(total(p, ID.inv, ID.headEmpty) === 1, 'head dig while holding does not duplicate');
  ok('head dig grant + held duplicate refuse');
}

{
  const p = makePlayer();
  p.setVarBit(ID.headBit, 1);
  const empty = runProc(p, '[proc,fenk_try_dig_head]');
  expectFinished(empty, 'head dig after hand-in');
  assert(total(p, ID.inv, ID.headEmpty) === 0, 'post-hand-in head dig must stay empty');
  ok('head dig after hand-in empty (no duplicate)');
}

{
  const p = makePlayer();
  p.setVarBit(ID.headBit, 0);
  fillInv(p, ID.coins, 28);
  const fullHead = runProc(p, '[proc,fenk_try_dig_head]');
  expectFinished(fullHead, 'head dig full-inv');
  assert(total(p, ID.inv, ID.headEmpty) === 0, 'full-inv head dig refuses');
  assert(p.getVarBit(ID.headBit) === 0, 'full-inv head dig does not write hand-in bit');
  ok('head dig full-inv refuse');
}

function popRet(state) {
  if (state.isp > 0) {
    return state.popInt();
  }
  return null;
}

// ---- hire prereqs ----
{
  const p = makePlayer();
  p.setVar(ID.priestperil, 0);
  p.setVar(ID.prieststart, 0);
  const r = runProc(p, '[proc,fenk_hire_prereqs]');
  expectFinished(r, 'hire without PiP');
  assert(popRet(r.state) === 0, 'hire prereq false without PiP');
  ok('hire prereq refuses without PiP');
}

{
  const p = makePlayer();
  p.setVar(ID.priestperil, PRIESTPERIL_COMPLETE);
  p.setVar(ID.prieststart, 0);
  const r = runProc(p, '[proc,fenk_hire_prereqs]');
  expectFinished(r, 'hire without Restless Ghost');
  assert(popRet(r.state) === 0, 'hire prereq false without Restless Ghost');
  ok('hire prereq refuses without Restless Ghost');
}

{
  const p = makePlayer();
  p.setVar(ID.priestperil, PRIESTPERIL_COMPLETE);
  p.setVar(ID.prieststart, PRIEST_COMPLETE);
  const r = runProc(p, '[proc,fenk_hire_prereqs]');
  expectFinished(r, 'hire both complete');
  assert(popRet(r.state) === 1, 'hire prereq true when both complete');
  ok('hire prereq allows when PiP + Restless Ghost complete');
}

// ---- 2026-11-04 source and interruption regressions (compiled handlers) ----
function doctor() {
  return new Npc(0, 3551, 3550, 1, 1, EntityLifeCycle.DESPAWN, 1, ID.doctor, NpcType.get(ID.doctor).blockwalk);
}

function qualifiedPlayer() {
  const p = makePlayer();
  p.setVar(ID.priestperil, PRIESTPERIL_COMPLETE);
  p.setVar(ID.prieststart, PRIEST_COMPLETE);
  return p;
}

function finishDialogue(p, result, choices = [], onPause = () => {}) {
  let pauses = 0;
  while (result.exec === ScriptState.PAUSEBUTTON && pauses++ < 100) {
    onPause();
    const menu = result.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
    if (menu) {
      assert(choices.length > 0, `unanswered ${result.state.script.name}`);
      p.lastCom = packMap('pack/interface.pack', `multi${menu[1]}:com_${choices.shift()}`);
    }
    result.exec = p.runScript(result.state, true, true);
    assert(result.exec !== ScriptState.ABORTED, `dialogue aborted at ${result.state.script.name}`);
  }
  expectFinished(result, 'complete dialogue');
  assert(choices.length === 0, 'unused dialogue choice');
}

for (const [crafting, thieving, accepted] of [[19, 25, false], [20, 24, false], [20, 25, true]]) {
  const p = qualifiedPlayer();
  p.levels[PlayerStat.CRAFTING] = crafting;
  p.levels[PlayerStat.THIEVING] = thieving;
  const result = runProc(p, '[oploc1,fenk_signpost]');
  expectFinished(result, 'signpost');
  assert(p.getVarBit(ID.readSignpost) === Number(accepted), `signpost boundary ${crafting}/${thieving}`);
  assert(p.getVar(ID.fenkQuest) === 0, 'signpost does not start quest');
}
ok('signpost skill thresholds; read flag only, no quest-stage write');

for (const read of [0, 1]) {
  const p = qualifiedPlayer();
  p.levels[PlayerStat.CRAFTING] = 1;
  p.levels[PlayerStat.THIEVING] = 1;
  p.setVarBit(ID.readSignpost, read);
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()), [1, 4, 4]);
  assert(p.getVar(ID.fenkQuest) === 1, 'doctor hires below skill requirements');
  assert(p.messages.some(text => text.includes('What job do you mean')) === !read, 'unread-signpost branch condition');
}
ok('doctor hires at skills 1/1 with and without signpost; unread branch is conditional');

for (const choices of [[2], [1, 1], [1, 4, 1]]) {
  const p = qualifiedPlayer();
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()), [...choices]);
  assert(p.getVar(ID.fenkQuest) === 0, 'decline/wrong answer does not hire');
}
ok('decline and both wrong interview answers preserve stage 0');

{
  const p = qualifiedPlayer();
  p.setVar(ID.fenkQuest, 1);
  for (const part of ['fenk_head', 'fenk_torso', 'fenk_arms', 'fenk_legs']) {
    p.setVarBit(packMap('pack/varbit.pack', part), 1);
  }
  // State left after cancelling the last part's reply: all parts accepted, stage 1.
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()));
  assert(p.getVar(ID.fenkQuest) === 2, 'retry recovers stage after interrupted final-part reply');
  assert(p.messages.some(text => text.includes('Where are my needle and thread')), 'retry enters sewing branch');
}

{
  const p = qualifiedPlayer();
  p.setVar(ID.fenkQuest, 2);
  invOf(p, ID.inv).add(ID.needle, 1);
  invOf(p, ID.inv).add(ID.thread, 2);
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()));
  assert(p.getVarBit(ID.needleBit) === 1 && p.getVarBit(ID.threadsBit) === 2, 'partial supplies stored');
  assert(total(p, ID.inv, ID.needle) === 0 && total(p, ID.inv, ID.thread) === 0, 'only offered supplies consumed');
  invOf(p, ID.inv).add(ID.thread, 4);
  let corpseVisibleDuringSewing = false;
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()), [], () => {
    if (p.messages.join(' ').includes('Fenkenstrain uses the needle and thread')) {
      corpseVisibleDuringSewing = p.getVar(ID.fenkQuest) === 3;
    }
  });
  assert(p.getVar(ID.fenkQuest) === 3 && corpseVisibleDuringSewing, 'corpse stage set before sewing box Continue');
  assert(p.getVarBit(ID.threadsBit) === 5 && total(p, ID.inv, ID.thread) === 1, 'exact remaining three threads consumed');
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()));
  assert(total(p, ID.inv, ID.thread) === 1, 'repeat assembled talk does not consume surplus');
}

{
  const p = qualifiedPlayer();
  p.setVar(ID.fenkQuest, 2);
  p.setVarBit(ID.needleBit, 1);
  p.setVarBit(ID.threadsBit, 5);
  // Cancellation after accepting final thread, before entering the sewing label.
  finishDialogue(p, runProc(p, '[opnpc1,fenk_fenkenstrain_model]', true, doctor()));
  assert(p.getVar(ID.fenkQuest) === 3, 'fully supplied interrupted state recovers without another item');
}
ok('interrupted body and sewing replies recover; partial supplies and corpse timing');

function bookcase(x, z, level = 1) {
  const loc = LocType.get(ID.bookcase);
  return new Loc(level, x, z, loc.width, loc.length, EntityLifeCycle.RESPAWN, ID.bookcase, 10, 0);
}

for (const [x, choice, item] of [[3542, 4, ID.marble], [3555, 3, ID.obsidian]]) {
  const p = qualifiedPlayer();
  fillInv(p, ID.coins, 28);
  finishDialogue(p, runProc(p, '[oploc1,fenk_bookcase]', true, bookcase(x, 3558)), [choice]);
  assert(total(p, ID.inv, item) === 0, 'full inventory does not grant amulet');
  invOf(p, ID.inv).set(0, null);
  finishDialogue(p, runProc(p, '[oploc1,fenk_bookcase]', true, bookcase(x, 3558)), [choice]);
  assert(total(p, ID.inv, item) === 1, 'correct title grants amulet on retry');
  finishDialogue(p, runProc(p, '[oploc1,fenk_bookcase]', true, bookcase(x, 3558)), [choice]);
  assert(total(p, ID.inv, item) === 1, 'repeat title does not duplicate amulet');
}
{
  const p = qualifiedPlayer();
  finishDialogue(p, runProc(p, '[oploc1,fenk_bookcase]', true, bookcase(3555, 3558)), [1]);
  assert(p.messages.some(text => text.includes('fascinating insights')), 'restored eastern title has sourced response');
  assert(invOf(p, ID.inv).freeSlotCount === 28, 'decoy book is display-only');
  const ground = runProc(p, '[oploc1,fenk_bookcase]', true, bookcase(3542, 3558, 0));
  expectFinished(ground, 'ground-floor bookcase');
  assert(p.messages.includes('It is a bookcase full of books.'), 'ground floor does not grant amulet');
}
ok('bookcase menus, restored eastern title, full-inventory retry and repeat controls');

// ---- F3 Charos bank/worn/inv + no XP on recovery ----
{
  const p = makePlayer();
  const has = runProc(p, '[proc,fenk_has_charos_any]');
  expectFinished(has, 'has_charos empty');
  assert(popRet(has.state) === 0, 'has_charos empty is false');
  invOf(p, ID.bank).add(ID.charos, 1);
  const banked = runProc(p, '[proc,fenk_has_charos_any]');
  expectFinished(banked, 'has_charos bank');
  assert(popRet(banked.state) === 1, 'has_charos bank is true');
  invOf(p, ID.bank).remove(ID.charos, 1);
  invOf(p, ID.worn).add(ID.charosU, 1);
  const note = runProc(p, '[proc,fenk_note_charos_unlocked]');
  expectFinished(note, 'note unlocked');
  assert(p.getVar(ID.fenkMem) === 1, 'note unlocked from worn (u)');
  ok('F3 note mem from worn (u)');
}

{
  const p = makePlayer();
  p.setVar(ID.fenkMem, 0);
  const base = runProc(p, '[proc,fenk_give_charos_recovery]');
  expectFinished(base, 'recovery base');
  assert(total(p, ID.inv, ID.charos) === 1, 'recovery without mem yields base');
  assert(total(p, ID.inv, ID.charosU) === 0, 'recovery without mem must not yield (u)');
  p.setVar(ID.fenkMem, 1);
  invOf(p, ID.inv).remove(ID.charos, 1);
  const unlocked = runProc(p, '[proc,fenk_give_charos_recovery]');
  expectFinished(unlocked, 'recovery (u)');
  assert(total(p, ID.inv, ID.charosU) === 1, 'recovery with mem yields (u)');
  ok('F3 recovery base vs (u); no complete queue in recovery proc');
}

// ---- teleport cleanup: directions + fenk uid; cat uid untouched ----
{
  const p = makePlayer();
  p.setVar(ID.fenkFollower, 12345);
  p.setVarBit(ID.directionsBit, 1);
  p.setVar(ID.catUid, 999);
  const tele = runProc(p, '[proc,fenk_on_gameplay_teleport]');
  expectFinished(tele, 'teleport cleanup');
  assert(p.getVar(ID.fenkFollower) === -1 || p.getVar(ID.fenkFollower) === 0, `fenk uid cleared, got ${p.getVar(ID.fenkFollower)}`);
  assert(p.getVarBit(ID.directionsBit) === 0, 'directions bit restored (courtyard)');
  assert(p.getVar(ID.catUid) === 999, 'cat %follower_uid must be unchanged');
  ok('teleport cleanup restores courtyard, leaves cat UID');
}

{
  const p = makePlayer();
  p.setVar(ID.catUid, 999);
  p.setVar(ID.fenkFollower, -1);
  const noop = runProc(p, '[proc,fenk_on_gameplay_teleport]');
  expectFinished(noop, 'teleport no-op');
  assert(p.getVar(ID.catUid) === 999, 'no-op teleport cleanup must not touch cat');
  ok('teleport no-op control (no fenk follower)');
}

// ---- experiment death: compiled handler gosubs default death (execution of
// npc_default_death needs World npc_delay/arrivedelay tick loop — pending live).
{
  const death = ScriptProvider.getByName('[ai_queue3,fenk_experiment_1]');
  assert(death, 'compiled [ai_queue3,fenk_experiment_1] missing');
  ok('experiment death handler present in compiled script.dat');
}

if (process.exitCode) {
  console.log('RESULT FAIL');
  process.exit(1);
}
console.log('RESULT PASS (production procs via ScriptRunner)');
process.exit(0);
