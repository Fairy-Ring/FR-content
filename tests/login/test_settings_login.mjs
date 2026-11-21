#!/usr/bin/env node
import assert from 'node:assert/strict';
import { load, loginMinute, logoutAndLoad, player, types, v } from './runtime.mjs';

const { default: VarpSmall } = await load('network/game/server/model/VarpSmall.ts');
const { default: VarpLarge } = await load('network/game/server/model/VarpLarge.ts');
const packets = p => p.packets.filter(packet => packet instanceof VarpSmall || packet instanceof VarpLarge);
const declared = prefix => Array.from({ length: types.VarPlayerType.count }, (_, id) => types.VarPlayerType.get(id))
  .filter(type => type.debugname?.startsWith(prefix));
// Symbolic setting contract, not a recording of unrelated login packets or generated IDs.
const savedSettings = {
  option_brightness: [1, 3], option_music: [0, 4], option_sounds: [4, 0],
  option_mouse: [1, 0], option_chat: [0, 1], option_pm: [1, 0],
  option_aid: [0, 1], option_nodef: [1, 0]
};
const temporarySettings = ['option_jingles', 'option_run'];
assert.deepEqual(declared('option_').map(type => type.debugname).sort(),
  [...Object.keys(savedSettings), ...temporarySettings].sort(), 'fixture covers every option setting');
for (const column of [0, 1]) {
  const p = player();
  for (const [name, values] of Object.entries(savedSettings)) p.setVar(v(name), values[column]);
  for (const name of temporarySettings) p.setVar(v(name), 1);
  const loaded = logoutAndLoad(p);
  for (const [name, values] of Object.entries(savedSettings)) assert.equal(loaded.getVar(v(name)), values[column], `${name}: actual save/load keeps the setting`);
  for (const name of temporarySettings) assert.equal(loaded.getVar(v(name)), 0, `${name}: session setting resets rather than being saved`);
  loaded.onLogin();
  for (const [name, expected] of [
    ...Object.entries(savedSettings).map(([name, values]) => [name, values[column]]),
    ...temporarySettings.map(name => [name, 0])
  ]) {
    const received = packets(loaded).filter(packet => packet.varp === v(name));
    assert(received.length > 0, `${name}: login sends the setting to the client`);
    assert(received.every(packet => packet.value === expected), `${name}: every login update carries the saved value or documented session default`);
    assert.equal(loaded.getVar(v(name)), expected, `${name}: compiled login preserves the saved setting`);
  }
  console.log(`PASS compiled saved settings login: layout=${column}, settings=${declared('option_').length}`);
}

// Zero brightness selects the compiled first-login defaults, even when the
// saved volume settings were nonzero. Observe both the server writes and wire.
{
  const p = player();
  const defaults = { option_brightness: 2, option_music: 2, option_sounds: 2 };
  for (const [name, value] of Object.entries({ option_brightness: 0, option_music: 4, option_sounds: 1 })) p.setVar(v(name), value);
  const loaded = logoutAndLoad(p);
  assert.equal(loaded.getVar(v('option_brightness')), 0, 'zero brightness survives actual save/load');
  loaded.onLogin();
  for (const [name, expected] of Object.entries(defaults)) {
    assert.equal(loaded.getVar(v(name)), expected, `${name}: compiled zero-brightness branch writes default 2`);
    const received = packets(loaded).filter(packet => packet.varp === v(name));
    assert(received.length > 0, `${name}: login transmits the default`);
    assert.equal(received.at(-1).value, expected, `${name}: final login update carries default 2`);
  }
  console.log('PASS compiled zero-brightness login defaults and transmission');
}

const bankNames = declared('bankpin_').map(type => type.debugname);
assert(bankNames.includes('bankpin_delay_days') && bankNames.includes('bankpin_state'));
for (const fixture of [
  { name: 'active-three-day', state: 2, ready: 0, delay: 3, nextState: 2, nextDelay: 3, nextValue: 1234 },
  { name: 'pending-future', state: 1, ready: loginMinute + 1, delay: 7, nextState: 1, nextDelay: 7, nextValue: 1234 },
  { name: 'pending-due', state: 1, ready: loginMinute, delay: 3, nextState: 2, nextDelay: 3, nextValue: 1234 },
  { name: 'recover-future', state: 3, ready: loginMinute + 1, delay: 7, nextState: 3, nextDelay: 7, nextValue: 1234 },
  { name: 'recover-due', state: 3, ready: loginMinute, delay: 3, nextState: 0, nextDelay: 3, nextValue: 0 },
  { name: 'unset-delay-default', state: 0, ready: 0, delay: 0, nextState: 0, nextDelay: 7, nextValue: 1234 }
]) {
  const p = player();
  const saved = { bankpin_state: fixture.state, bankpin_ready: fixture.ready, bankpin_delay_days: fixture.delay, bankpin_value: 1234 };
  for (const [name, value] of Object.entries(saved)) p.setVar(v(name), value);
  p.setVar(v('bankpin_session'), 1);
  const loaded = logoutAndLoad(p);
  for (const [name, value] of Object.entries(saved)) assert.equal(loaded.getVar(v(name)), value, `${fixture.name}/${name}: actual save/load preserves bank state`);
  loaded.onLogin();
  assert.equal(loaded.getVar(v('bankpin_session')), 0, 'login requires fresh PIN authentication');
  for (const [name, expected] of Object.entries({ bankpin_state: fixture.nextState, bankpin_ready: fixture.ready, bankpin_delay_days: fixture.nextDelay, bankpin_value: fixture.nextValue })) {
    assert.equal(loaded.getVar(v(name)), expected, `${fixture.name}/${name}: compiled login normalization`);
  }
  const bankIds = new Set(bankNames.map(v));
  assert.deepEqual(packets(loaded).filter(packet => bankIds.has(packet.varp)), [], 'all bank-PIN vars remain server-only in ordinary login');
  console.log(`PASS compiled server-only bank PIN login: ${fixture.name}`);
}
process.exit(0);
