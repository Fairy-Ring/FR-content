#!/usr/bin/env node
/** Run the packed Smoke start proc with absent and already-running real timers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('uncaughtException', error => {
  console.error(error);
  process.exit(1);
});
process.on('unhandledRejection', error => {
  console.error(error);
  process.exit(1);
});

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT, '../engine');
const PACK = path.join(ENGINE, 'data/pack');
assert(fs.existsSync(path.join(PACK, 'server/script.dat')), 'pack the sibling engine before this test');
const eng = relative => import(pathToFileURL(path.join(ENGINE, relative)).href);
const World = (await eng('src/engine/World.ts')).default;
const VarPlayerType = (await eng('src/cache/config/VarPlayerType.ts')).default;
const VarBitType = (await eng('src/cache/config/VarBitType.ts')).default;
const InvType = (await eng('src/cache/config/InvType.ts')).default;
const ScriptProvider = (await eng('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await eng('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await eng('src/engine/script/ScriptState.ts')).default;
const Player = (await eng('src/engine/entity/Player.ts')).default;

VarPlayerType.load(PACK);
VarBitType.load(PACK);
InvType.load(PACK);
assert(ScriptProvider.load(PACK) > 0, 'compiled scripts must load');
const start = ScriptProvider.getByName('[proc,dt_smoke_start]');
const damage = ScriptProvider.getByName('[timer,dt_smoke_damage]');
assert(start && damage, 'compiled S2 Smoke start proc and damage timer must exist');

function runStart(player) {
  const execution = player.runScript(ScriptRunner.init(start, player), true, true);
  assert.equal(execution, ScriptState.FINISHED, 'compiled Smoke start proc must finish');
}

// A timer created at world tick 0 is still present: test the sentinel, not truthiness.
for (const clock of [0, 100]) {
  const player = new Player(`dts2_timer_${clock}`, 0n, 0n);
  player.uid = 1;
  player.pid = 1;
  player.x = 3206;
  player.z = 9379;
  player.level = 0;
  World.currentTick = clock;
  assert.equal(player.timers.has(damage.id), false, 'fixture starts with the Smoke timer absent');
  runStart(player);
  const timer = player.timers.get(damage.id);
  assert(timer, `absent timer must be armed at world tick ${clock}`);
  assert.equal(timer.interval, 20, 'the real timer uses the configured 20-tick interval');
  assert.equal(timer.clock, clock, 'the timer starts on this world tick');

  World.currentTick = clock + 5;
  runStart(player);
  assert.strictEqual(player.timers.get(damage.id), timer, 'a present timer must not be replaced');
  assert.equal(timer.clock, clock, 'a present timer must not be re-armed or postponed');
  console.log(`PASS compiled Smoke timer: absent arms; present clock ${clock} is preserved`);
}

// World imports create workers; this offline test starts no network listener.
process.exit(0);
