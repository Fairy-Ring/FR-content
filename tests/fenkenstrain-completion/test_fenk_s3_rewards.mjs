/**
 * Compiled production-handler regression for Silver Casting preview inventories.
 * Run after npm run build in the sibling engine:
 *   node --import tsx ../content/tests/fenkenstrain-completion/test_fenk_s3_rewards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.join(ENGINE_DIR, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

if (!fs.existsSync(SCRIPT_DAT)) {
  console.error(`FAIL missing compiled script.dat at ${SCRIPT_DAT} — run npm run build in the sibling engine`);
  process.exit(1);
}

const eng = (rel) => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);
const World = (await eng('src/engine/World.ts')).default;
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
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');

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
assert.ok(FontType.get(3), 'FontType q8_full (id 3) missing — need ISO data/pack/client/title');
Component.load(PACK_DIR);
assert.ok(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider.load returned no compiled scripts');

function packMap(rel, name) {
  const text = fs.readFileSync(path.join(CONTENT_DIR, rel), 'utf8');
  const match = text.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
  assert.ok(match, `${rel} missing ${name}`);
  return Number(match[1]);
}

function inventoryOf(player, id) {
  const inventory = player.getInventory(id);
  assert.ok(inventory, `inventory ${id} is missing`);
  return inventory;
}

const ID = {
  inventory: packMap('pack/inv.pack', 'inv'),
  silverBar: packMap('pack/obj.pack', 'silver_bar'),
  holyMould: packMap('pack/obj.pack', 'holy_symbol_mould'),
  furnace: packMap('pack/loc.pack', 'furnace')
};
const products = [
  ['silvercast_holysymbol', 'nostringstar', 'silver_casting:com_91'],
  ['silvercast_unholysymbol', 'nostringsnake', 'silver_casting:com_98'],
  ['silvercast_sickle', 'silver_sickle', 'silver_casting:com_105'],
  ['silvercast_lightning', 'fenk_conductor', 'silver_casting:com_112'],
  ['silvercast_tiara', 'tiara', 'silver_casting:com_119'],
  ['silvercast377_commandrod', 'burgh_rod_command1', 'silver_casting:com_126'],
  ['silvercast_agrith', 'agrith_sigil', 'silver_casting:com_134']
].map(([inventory, item, component]) => ({
  inventory: packMap('pack/inv.pack', inventory),
  item: packMap('pack/obj.pack', item),
  component: packMap('pack/interface.pack', component),
  inventoryName: inventory,
  itemName: item
}));

const player = new Player('silver_casting_test', 0n, 0n);
player.uid = 1;
player.pid = 1;
player.staffModLevel = 0;
player.messages = [];
player.packets = [];
player.lastMovement = 0;
player.write = message => player.packets.push(message);
player.messageGame = message => player.messages.push(message);
player.wrappedMessageGame = message => player.messages.push(message);
inventoryOf(player, ID.inventory).add(ID.silverBar, 1);
inventoryOf(player, ID.inventory).add(ID.holyMould, 1);
player.lastUseItem = ID.silverBar;
player.lastUseSlot = 0;

const furnaceType = LocType.get(ID.furnace);
assert.ok(furnaceType, 'Furnace LocType missing');
const furnace = new Loc(0, 3272, 3185, furnaceType.width, furnaceType.length, EntityLifeCycle.RESPAWN, ID.furnace, 10, 0);
const script = ScriptProvider.getByName('[oplocu,_smithing_furnace]');
assert.ok(script, 'compiled [oplocu,_smithing_furnace] missing');
const state = ScriptRunner.init(script, player, furnace);
const execution = player.runScript(state, true, true);
assert.equal(
  execution,
  ScriptState.FINISHED,
  `furnace handler did not finish; messages=${player.messages.join(' | ')}`
);

for (const product of products) {
  const listener = player.invListeners.find(entry => entry.com === product.component);
  assert.ok(listener, `${product.inventoryName} was not transmitted to ${product.component}`);
  assert.equal(listener.type, product.inventory, `${product.inventoryName} should be sent to its interface component`);
  const inventory = inventoryOf(player, product.inventory);
  assert.equal(inventory.capacity, 1, `${product.inventoryName} should be a size-one preview inventory`);
  assert.deepEqual(
    inventory.get(0),
    { id: product.item, count: 1 },
    `${product.inventoryName} slot 0 should contain ${product.itemName}`
  );
}

const closeScript = ScriptProvider.getByName('[if_close,silver_casting]');
assert.ok(closeScript, 'compiled [if_close,silver_casting] missing');
const closeState = ScriptRunner.init(closeScript, player);
assert.equal(player.runScript(closeState, false, true), ScriptState.FINISHED, 'Silver Casting close handler should finish');
for (const product of products) {
  assert.ok(
    !player.invListeners.some(entry => entry.com === product.component),
    `${product.inventoryName} listener should stop on interface close`
  );
}

console.log('RESULT PASS (all seven transmitted Silver Casting inventories use slot 0 and stop on close)');
process.exit(0);
