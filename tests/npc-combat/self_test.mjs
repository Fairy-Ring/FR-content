import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkManifest, combatLevel, skills } from './packed.mjs';

export async function runSelfTests(pack, tempRoot) {
    fs.mkdirSync(tempRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(tempRoot, 'npc-combat-'));
    let cases = 0;
    // Synthetic metadata belongs only to temporary test fixtures, never to the built manifest.
    const fixtureEvidence = {
        facts: ['monster-combat-data.self-test'], label: 'CANDIDATE', researchCommit: '1'.repeat(40),
        sources: [{ id: 'src.self-test', sha256: '2'.repeat(64) }]
    };
    function fixture(npc) {
        const identity = { debugname: npc.debugname, id: npc.id };
        const snapshot = pack.capture(identity, '3'.repeat(40));
        const fields = Object.fromEntries(skills.map(skill => [skill, { value: pack.rawField(npc, skill) }]));
        fields['param:attack_anim'] = { value: pack.rawField(npc, 'param:attack_anim') };
        // Model a pre-build strength different from the vector under test.
        snapshot.fields.strength++;
        return {
            manifest: { version: 1, entries: [{ identity, unit: 'S01', fields, evidence: structuredClone(fixtureEvidence) }] },
            snapshots: { version: 1, types: [snapshot] }
        };
    }
    async function checkFiles(data) {
        const manifestFile = path.join(dir, 'built-vectors.json');
        const snapshotsFile = path.join(dir, 'snapshots.json');
        fs.writeFileSync(manifestFile, JSON.stringify(data.manifest));
        fs.writeFileSync(snapshotsFile, JSON.stringify(data.snapshots));
        return checkManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
            JSON.parse(fs.readFileSync(snapshotsFile, 'utf8')), pack);
    }
    const chicken = pack.NpcType.getByName('chicken');
    assert(chicken, 'self-test needs packed chicken');
    const valid = fixture(chicken);
    async function rejects(name, kind, mutate) {
        const data = structuredClone(valid);
        mutate(data.manifest.entries[0], data);
        await assert.rejects(() => checkFiles(data), error => error.message.includes(`[${kind}]`), name);
        console.log(`PASS self-test rejects ${name}`);
        cases++;
    }
    try {
        const result = await checkFiles(valid);
        assert.equal(result.fields, 7);
        assert.equal(result.levels.length, 1);
        cases++;
        await rejects('changed expected field', 'expected-field', entry => entry.fields.attack.value++);
        await rejects('missing fact id', 'evidence', entry => delete entry.evidence.facts);
        await rejects('malformed fact id', 'evidence', entry => entry.evidence.facts = ['not-a-fact']);
        await rejects('missing label', 'evidence', entry => delete entry.evidence.label);
        await rejects('invalid label', 'evidence', entry => entry.evidence.label = 'UNKNOWN');
        await rejects('missing research commit', 'evidence', entry => delete entry.evidence.researchCommit);
        await rejects('missing source hashes', 'evidence', entry => entry.evidence.sources = []);
        await rejects('malformed source hash', 'evidence', entry => entry.evidence.sources[0].sha256 = 'bad');
        await rejects('stale unlisted skill', 'stale', entry => delete entry.fields.strength);
        await rejects('missing entry', 'missing-entry', (_entry, data) => data.manifest.entries = []);
        await rejects('missing snapshot', 'stale', (_entry, data) => data.snapshots.types = []);
        await rejects('incomplete snapshot', 'stale', (_entry, data) => delete data.snapshots.types[0].fields.huntrange);
        await rejects('wrong identity', 'identity', entry => entry.identity.id++);
        await rejects('missing NPC type', 'missing-type', entry => entry.identity.debugname = 'npc_combat_self_test_missing');
        await rejects('missing native field', 'field', entry => entry.fields.nonexistent_field = { value: 0 });
        await rejects('missing packed parameter', 'field', entry => entry.fields['param:npc_combat_self_test_missing'] = { value: 0 });
        await rejects('level exception without reason', 'level-exception', entry => entry.levelException = { kind: 'formula-mismatch' });
        await rejects('source-priority exception without reason', 'evidence', entry => entry.evidence.sourcePriorityException = {
            kind: 'source-priority', preferred: 'src.self-test', overridden: ['src.other-test']
        });
        const perField = structuredClone(valid);
        const entry = perField.manifest.entries[0];
        for (const field of Object.values(entry.fields)) field.evidence = structuredClone(entry.evidence);
        delete entry.evidence;
        await checkFiles(perField);
        cases++;
        const mismatchNpc = pack.NpcType.configs.find(npc => npc.debugname && npc.vislevel > 0 &&
            combatLevel(Object.fromEntries(skills.map(skill => [skill, pack.rawField(npc, skill)]))) !== npc.vislevel);
        assert(mismatchNpc, 'self-test needs a visible formula mismatch');
        const mismatch = fixture(mismatchNpc);
        mismatch.manifest.entries[0].levelException = { kind: 'formula-mismatch', reason: 'Synthetic test of the recorded diagnostic, not a historical claim.' };
        const diagnostic = await checkFiles(mismatch);
        assert.equal(diagnostic.levels[0].status, 'mismatch-diagnostic');
        assert.notEqual(diagnostic.levels[0].formula, diagnostic.levels[0].visible);
        console.log(`PASS self-test level diagnostic: ${diagnostic.levels[0].npc} formula=${diagnostic.levels[0].formula} cache=${diagnostic.levels[0].visible}`);
        cases++;
        const hiddenNpc = pack.NpcType.configs.find(npc => npc.debugname && npc.vislevel === 0);
        assert(hiddenNpc, 'self-test needs a hidden level');
        assert.equal((await checkFiles(fixture(hiddenNpc))).levels[0].status, 'hidden');
        cases++;
        // Odd ranged/magic values require the inner floor, not a floating-point shortcut.
        assert.equal(combatLevel({ attack: 1, defence: 1, strength: 1, hitpoints: 2, ranged: 9, magic: 1 }), 4);
        assert.equal(combatLevel({ attack: 1, defence: 1, strength: 1, hitpoints: 2, ranged: 1, magic: 9 }), 4);
        cases++;
        const parent = pack.NpcType.getByName('feud_arabian_guard_multi');
        assert(parent, 'self-test needs the packed Feud multi parent');
        const form = pack.NpcType.get(parent.multinpc.find(id => id >= 0));
        assert(form?.debugname, 'self-test needs a named resolved form');
        const multi = fixture(parent);
        const multiEntry = multi.manifest.entries[0];
        multiEntry.unit = 'A5';
        const kind = parent.multivarp !== -1 ? 'varp' : 'varbit';
        const selectorId = kind === 'varp' ? parent.multivarp : parent.multivarbit;
        const selectorName = pack.normalize(selectorId, kind).name;
        multiEntry.routing = {
            spawnedParent: multiEntry.identity, resolvedForm: { debugname: form.debugname, id: form.id },
            selector: { kind, name: selectorName, value: parent.multinpc.indexOf(form.id) },
            stats: Object.fromEntries(skills.map(skill => [skill, pack.rawField(parent, skill)])),
            params: { attack_anim: pack.rawField(parent, 'param:attack_anim') },
            hasop: Object.fromEntries([1, 2, 3, 4, 5].map(op => [op, Boolean(parent.op?.[op - 1])])),
            resolvedOptions: form.op
        };
        assert.equal((await checkFiles(multi)).routes, 1);
        console.log(`PASS self-test native routing: spawned=${parent.debugname}:${parent.id} resolved=${form.debugname}:${form.id}`);
        cases++;
        for (const [name, mutate] of [
            ['wrong routed stat', route => route.stats.attack++],
            ['wrong routed parameter', route => route.params.attack_anim++],
            ['wrong routed hasop', route => route.hasop['2'] = !route.hasop['2']],
            ['wrong resolved options', route => route.resolvedOptions = ['not-an-option', null, null, null, null]],
            ['wrong resolved identity', route => route.resolvedForm.id++]
        ]) {
            const data = structuredClone(multi);
            mutate(data.manifest.entries[0].routing);
            await assert.rejects(() => checkFiles(data), undefined, name);
            console.log(`PASS self-test rejects ${name}`);
            cases++;
        }
        const reference = structuredClone(valid);
        reference.manifest.entries[0].fields['param:attack_anim'].value =
            pack.normalize(pack.rawField(chicken, 'param:attack_anim'), 'seq');
        await checkFiles(reference);
        cases++;
        console.log(`npc-combat self-tests: ${cases} cases PASS`);
        return cases;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
