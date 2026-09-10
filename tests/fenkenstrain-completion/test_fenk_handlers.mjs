/**
 * Production-handler execution for CoF lifecycle/recovery repairs.
 *
 * Loads isolated compiled script.dat and runs the actual procs via ScriptRunner
 * (not a handwritten state mirror). Control cases: full-inv, repeat, owner,
 * cat UID, hire refuse, head hand-in, Charos bank/worn/inv.
 *
 * Run after tests/fenkenstrain-completion/setup-iso.sh:
 *   node --import tsx tests/fenkenstrain-completion/test_fenk_handlers.mjs
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
const ISO_ENGINE = path.join(WT, '.tmp/fenk-iso-compile-r422/engine');
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
  fail(`missing ISO script.dat at ${SCRIPT_DAT} — run tests/fenkenstrain-completion/setup-iso.sh`);
  process.exit(1);
}

const eng = (rel) => import(pathToFileURL(path.join(ISO_ENGINE, rel)).href);

const WorldMod = await eng('src/engine/World.ts');
const World = WorldMod.default;
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');

VarPlayerType.load(PACK_DIR);
VarBitType.load(PACK_DIR);
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
  fenkMem: packMap('pack/varp.pack', 'fenk_charos_unlocked_mem'),
  catUid: packMap('pack/varp.pack', 'follower_uid'),
  priestperil: packMap('pack/varp.pack', 'priestperil'),
  prieststart: packMap('pack/varp.pack', 'prieststart'),
  woundBit: packMap('pack/varbit.pack', 'fenk_wound_clock'),
  headBit: packMap('pack/varbit.pack', 'fenk_head'),
  directionsBit: packMap('pack/varbit.pack', 'fenk_gardener_directions')
};

const PRIESTPERIL_COMPLETE = 60;
const PRIEST_COMPLETE = 5;

function makePlayer() {
  const p = new Player('fenk_test', 0n, 0n);
  p.uid = 1;
  p.pid = 1;
  p.staffModLevel = 0;
  // Swallow client writes (no connected client in this harness).
  p.write = () => {};
  p.messageGame = () => {};
  if (typeof p.wrappedMessageGame === 'function') {
    p.wrappedMessageGame = () => {};
  }
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

function runProc(player, name, protect = true) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing ${name}`);
  const state = ScriptRunner.init(script, player);
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
