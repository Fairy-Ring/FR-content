#!/usr/bin/env node
/** Every packed multi NPC/loc selector must reach a transmitted base varp. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async name => (await import(pathToFileURL(path.join(engine, `src/cache/config/${name}.ts`)).href)).default;
const [VarPlayerType, VarBitType, NpcType, LocType] = await Promise.all(
    ['VarPlayerType', 'VarBitType', 'NpcType', 'LocType'].map(load)
);
for (const type of [VarPlayerType, VarBitType, NpcType, LocType]) {
    type.load(pack);
    assert(type.count > 0, 'build the tested sibling engine pack first');
}

const failures = [];
const bases = new Set();
let definitions = 0;
let direct = 0;
let varbits = 0;
for (const [kind, type, children] of [['npc', NpcType, 'multinpc'], ['loc', LocType, 'multiloc']]) {
    for (let id = 0; id < type.count; id++) {
        const config = type.get(id);
        if (!config[children].length) continue;
        definitions++;
        const label = `${kind} ${id} [${config.debugname}]`;
        let base = config.multivarp;
        if (config.multivarbit !== -1) {
            varbits++;
            const bit = VarBitType.get(config.multivarbit);
            if (!bit || bit.basevar < 0) {
                failures.push(`${label}: missing selector varbit ${config.multivarbit}`);
                continue;
            }
            base = bit.basevar;
        } else {
            direct++;
        }
        const varp = base >= 0 ? VarPlayerType.get(base) : null;
        if (!varp) {
            failures.push(`${label}: missing selector base varp ${base}`);
        } else {
            bases.add(base);
            if (!varp.transmit) failures.push(`${label}: base varp ${base} [${varp.debugname}] is not transmitted`);
        }
    }
}
assert(definitions > 0, 'the tested pack contains no multi definitions');
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`${failures.length ? 'FAIL' : 'PASS'} packed morph transmission: ${definitions} definitions, ${direct} direct selectors, ${varbits} varbit selectors, ${bases.size} base varps, ${failures.length} failures`);
process.exitCode = failures.length ? 1 : 0;
