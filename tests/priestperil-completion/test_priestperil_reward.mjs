#!/usr/bin/env node
/**
 * Execute the compiled Priest in Peril completion queue and assert its Prayer
 * reward in server tenths. Run from the sibling engine after a full pack:
 *   NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx ../content/tests/priestperil-completion/test_priestperil_reward.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(WT, '../engine');
const PACK_DIR = path.join(ENGINE, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

assert(fs.existsSync(SCRIPT_DAT), `missing compiled script.dat at ${SCRIPT_DAT} — run npm run build in the sibling engine`);

const eng = rel => import(pathToFileURL(path.join(ENGINE, rel)).href);
const World = (await eng('src/engine/World.ts')).default;
const VarPlayerType = (await eng('src/cache/config/VarPlayerType.ts')).default;
const VarBitType = (await eng('src/cache/config/VarBitType.ts')).default;
const VarNpcType = (await eng('src/cache/config/VarNpcType.ts')).default;
const NpcType = (await eng('src/cache/config/NpcType.ts')).default;
const LocType = (await eng('src/cache/config/LocType.ts')).default;
const SeqType = (await eng('src/cache/config/SeqType.ts')).default;
const InvType = (await eng('src/cache/config/InvType.ts')).default;
const ObjType = (await eng('src/cache/config/ObjType.ts')).default;
const FontType = (await eng('src/cache/config/FontType.ts')).default;
const Component = (await eng('src/cache/config/Component.ts')).default;
const ScriptProvider = (await eng('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await eng('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await eng('src/engine/script/ScriptState.ts')).default;
const Player = (await eng('src/engine/entity/Player.ts')).default;
const PlayerStat = (await eng('src/engine/entity/PlayerStat.js')).PlayerStat;
const Environment = (await eng('src/util/Environment.ts')).default;

assert.equal(Environment.NODE_XPRATE, 1, 'run with NODE_XPRATE=1 so the test measures the script argument directly');
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
assert(FontType.get(3), 'FontType q8_full (id 3) missing — need packed client/title data');
Component.load(PACK_DIR);
assert(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider did not load compiled scripts');

const player = new Player('pip_reward_test', 0n, 0n);
player.uid = 1;
player.pid = 1;
player.staffModLevel = 0;
player.write = () => {};
player.messageGame = () => {};
player.wrappedMessageGame = () => {};
const before = player.stats[PlayerStat.PRAYER];
const script = ScriptProvider.getByName('[queue,priestperil_complete]');
assert(script, 'compiled [queue,priestperil_complete] missing');
const state = ScriptRunner.init(script, player);
const execution = player.runScript(state, true, true);
assert.notEqual(execution, -1, 'completion queue did not obtain protected access');
assert.notEqual(execution, ScriptState.ABORTED, 'completion queue aborted');
assert.equal(execution, ScriptState.FINISHED, 'completion queue did not finish');

const delta = player.stats[PlayerStat.PRAYER] - before;
assert.equal(delta, 14060, `compiled completion queue Prayer award must be 14060 tenths; got ${delta}`);
console.log(`PASS compiled Priest in Peril completion awards ${delta} Prayer tenths`);
