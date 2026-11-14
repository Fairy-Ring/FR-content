import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const skills = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'magic'];
const namePattern = /^[a-z0-9_]+$/;
const factPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const sourcePattern = /^src\.[a-z0-9]+(?:[._-][a-z0-9]+)*(?:#[^\s]+)?$/;
const commitPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const unitPattern = /^(?!T0$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const fieldRefs = {
    category: 'category', huntmode: 'hunt', readyanim: 'seq', walkanim: 'seq',
    walkanim_b: 'seq', walkanim_l: 'seq', walkanim_r: 'seq', multinpc: 'npc',
    multivarp: 'varp', multivarbit: 'varbit'
};
const paramRefs = new Set(['enum', 'obj', 'loc', 'component', 'struct', 'category', 'spotanim',
    'npc', 'inv', 'synth', 'seq', 'interface', 'midi']);

function need(condition, kind, message) {
    if (!condition) throw new Error(`[${kind}] ${message}`);
}
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function keys(value, allowed, context) {
    need(object(value), 'schema', `${context} must be an object`);
    for (const key of Object.keys(value)) need(allowed.includes(key), 'schema', `${context}: unknown key ${key}`);
}
function same(actual, expected, kind, context) {
    need(isDeepStrictEqual(actual, expected), kind,
        `${context}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function identityShape(value) {
    keys(value, ['debugname', 'id'], 'identity');
    need(namePattern.test(value.debugname) && typeof value.debugname === 'string', 'identity', 'invalid NPC debugname');
    need(Number.isInteger(value.id) && value.id >= 0, 'identity', 'invalid original 377 id');
}
function evidence(value, context) {
    keys(value, ['facts', 'label', 'researchCommit', 'sources', 'sourcePriorityException'], `${context} evidence`);
    need(Array.isArray(value.facts) && value.facts.length > 0 && value.facts.every(id =>
        typeof id === 'string' && factPattern.test(id)), 'evidence', `${context}: missing or malformed fact id in ${JSON.stringify(value.facts)}`);
    need(new Set(value.facts).size === value.facts.length, 'evidence', `${context}: duplicate fact id`);
    need(['VERIFIED', 'CANDIDATE'].includes(value.label), 'evidence', `${context}: missing or invalid label`);
    need(typeof value.researchCommit === 'string' && commitPattern.test(value.researchCommit),
        'evidence', `${context}: researchCommit must be a full lowercase commit`);
    need(Array.isArray(value.sources) && value.sources.length > 0, 'evidence', `${context}: missing source hashes`);
    const sources = new Set();
    for (const source of value.sources) {
        keys(source, ['id', 'sha256'], `${context} source`);
        need(typeof source.id === 'string' && sourcePattern.test(source.id), 'evidence', `${context}: malformed source id`);
        need(typeof source.sha256 === 'string' && hashPattern.test(source.sha256), 'evidence', `${context}: malformed source hash`);
        need(!sources.has(source.id), 'evidence', `${context}: duplicate source ${source.id}`);
        sources.add(source.id);
    }
    if (value.sourcePriorityException !== undefined) {
        const exception = value.sourcePriorityException;
        keys(exception, ['kind', 'preferred', 'overridden', 'reason'], `${context} source-priority exception`);
        need(exception.kind === 'source-priority' && text(exception.reason), 'evidence', `${context}: source-priority exception needs kind and reason`);
        need(sources.has(exception.preferred), 'evidence', `${context}: preferred source must have a hash`);
        need(Array.isArray(exception.overridden) && exception.overridden.length > 0 &&
            exception.overridden.every(id => typeof id === 'string' && sourcePattern.test(id) && id !== exception.preferred),
        'evidence', `${context}: source-priority exception needs overridden source ids`);
    }
}

export function combatLevel(vector) {
    const { attack, defence, strength, hitpoints, ranged, magic } = vector;
    return Math.floor((10 * (defence + hitpoints) + 13 * Math.max(attack + strength,
        Math.floor(3 * ranged / 2), Math.floor(3 * magic / 2))) / 40);
}

export async function loadPack(contentDir, engineDir, packDir) {
    const engineImport = relative => import(pathToFileURL(path.join(engineDir, relative)).href);
    const NpcType = (await engineImport('src/cache/config/NpcType.ts')).default;
    const ParamType = (await engineImport('src/cache/config/ParamType.ts')).default;
    const { ParamHelper } = await engineImport('src/cache/config/ParamHelper.ts');
    NpcType.load(packDir);
    ParamType.load(packDir);
    need(NpcType.count > 0 && ParamType.count > 0, 'pack', 'native NPC and parameter packs must be present');
    const maps = new Map();
    function nameMap(kind) {
        if (!maps.has(kind)) {
            const names = new Map();
            const ids = new Map();
            for (const line of fs.readFileSync(path.join(contentDir, 'pack', `${kind}.pack`), 'utf8').split(/\r?\n/)) {
                const match = /^(\d+)=(.+)$/.exec(line);
                if (!match) continue;
                const id = Number(match[1]);
                need(!names.has(match[2]) && !ids.has(id), 'pack', `duplicate ${kind} identity`);
                names.set(match[2], id);
                ids.set(id, match[2]);
            }
            need(names.size > 0, 'pack', `empty ${kind} name map`);
            maps.set(kind, { names, ids });
        }
        return maps.get(kind);
    }
    function refId(kind, name) {
        need(typeof name === 'string' && name.length > 0, 'field', 'reference name is required');
        const id = nameMap(kind).names.get(name);
        need(id !== undefined, 'field', `missing ${kind} reference ${name}`);
        return id;
    }
    function npcFor(identity) {
        identityShape(identity);
        const npc = NpcType.getByName(identity.debugname);
        need(npc, 'missing-type', `missing packed NPC ${identity.debugname}`);
        same(npc.id, identity.id, 'identity', identity.debugname);
        same(nameMap('npc').names.get(identity.debugname), identity.id, 'identity', `${identity.debugname} content map`);
        return npc;
    }
    function fieldKind(field) {
        if (!field.startsWith('param:')) return fieldRefs[field];
        const param = ParamType.getByName(field.slice(6));
        need(param, 'field', `missing packed parameter ${field.slice(6)}`);
        const kind = param.getType() === 'namedobj' ? 'obj' : param.getType();
        return paramRefs.has(kind) ? kind : undefined;
    }
    function rawField(npc, field) {
        const stat = skills.indexOf(field);
        if (stat !== -1) return npc.stats[stat];
        if (field.startsWith('param:')) {
            const param = ParamType.getByName(field.slice(6));
            need(param, 'field', `missing packed parameter ${field.slice(6)}`);
            return param.isString() ? ParamHelper.getStringParam(param.id, npc, param.defaultString)
                : ParamHelper.getIntParam(param.id, npc, param.defaultInt);
        }
        need(!['id', 'debugname', 'stats', 'params'].includes(field) && Object.hasOwn(npc, field),
            'field', `unknown NPC field ${field}`);
        return ArrayBuffer.isView(npc[field]) ? Array.from(npc[field]) : npc[field];
    }
    function resolve(value, kind) {
        if (Array.isArray(value)) return value.map(item => resolve(item, kind));
        if (!object(value)) return value;
        keys(value, ['ref', 'name'], 'reference');
        need(kind !== undefined && value.ref === kind, 'field', `wrong reference kind ${value.ref}, expected ${kind}`);
        return refId(kind, value.name);
    }
    function normalize(value, kind) {
        if (Array.isArray(value)) return value.map(item => normalize(item, kind));
        if (!kind || value === -1 || value === null) return value;
        const name = nameMap(kind).ids.get(value);
        need(name !== undefined, 'pack', `unnamed ${kind} id ${value}`);
        return { ref: kind, name };
    }
    function fieldsFor(npc) {
        const fields = Object.keys(npc).filter(key => !['id', 'debugname', 'stats', 'params'].includes(key));
        fields.push(...skills);
        for (const id of npc.params.keys()) {
            const param = ParamType.get(id);
            need(param?.debugname, 'pack', `unnamed parameter ${id}`);
            fields.push(`param:${param.debugname}`);
        }
        return fields.sort();
    }
    function capture(identity, contentCommit) {
        need(typeof contentCommit === 'string' && commitPattern.test(contentCommit), 'schema', 'snapshot contentCommit must be a full lowercase commit');
        const npc = npcFor(identity);
        return { identity, contentCommit, fields: Object.fromEntries(fieldsFor(npc).map(field =>
            [field, normalize(rawField(npc, field), fieldKind(field))])) };
    }
    function expectField(npc, field, value, context) {
        let actual;
        let expected;
        try {
            actual = rawField(npc, field);
            expected = resolve(value, fieldKind(field));
        } catch (error) {
            error.message = `${context}/${field}: ${error.message}`;
            throw error;
        }
        same(actual, expected, 'expected-field', `${context}/${field}`);
    }
    let routingRuntime;
    async function checkRouting(routing, entry) {
        keys(routing, ['spawnedParent', 'resolvedForm', 'selector', 'stats', 'params', 'hasop', 'resolvedOptions', 'evidence'], 'routing');
        evidence(routing.evidence ?? entry.evidence, `${entry.identity.debugname} routing`);
        const parent = npcFor(routing.spawnedParent);
        const form = npcFor(routing.resolvedForm);
        need(parent.id !== form.id && [parent.id, form.id].includes(entry.identity.id), 'routing', 'entry must name one endpoint of a distinct parent/form pair');
        keys(routing.selector, ['kind', 'name', 'value'], 'routing selector');
        const selector = routing.selector;
        need(['varp', 'varbit'].includes(selector.kind) && Number.isInteger(selector.value), 'routing', 'selector needs varp/varbit and integer value');
        const selectorId = refId(selector.kind, selector.name);
        same(selector.kind === 'varp' ? parent.multivarp : parent.multivarbit, selectorId, 'routing', 'parent selector');
        need(selector.kind !== 'varbit' || parent.multivarp === -1, 'routing', 'varp takes precedence over varbit');
        need(selector.value >= 0 && selector.value < parent.multinpc.length && parent.multinpc[selector.value] === form.id,
            'routing', 'selector must select the declared form');
        if (!routingRuntime) {
            for (const name of ['VarNpcType', 'VarPlayerType', 'VarBitType']) {
                const type = (await engineImport(`src/cache/config/${name}.ts`)).default;
                type.load(packDir);
            }
            // Match the existing native runtime tests' import order across the entity/World cycle.
            await engineImport('src/engine/World.ts');
            routingRuntime = {
                Npc: (await engineImport('src/engine/entity/Npc.ts')).default,
                ScriptFile: (await engineImport('src/engine/script/ScriptFile.ts')).default,
                ScriptState: (await engineImport('src/engine/script/ScriptState.ts')).default,
                NpcOps: (await engineImport('src/engine/script/handlers/NpcOps.ts')).default,
                ScriptOpcode: (await engineImport('src/engine/script/ScriptOpcode.ts')).ScriptOpcode,
                resolveNpcType: (await engineImport('src/engine/entity/resolveNpcType.ts')).default,
                EntityLifeCycle: (await engineImport('src/engine/entity/EntityLifeCycle.ts')).EntityLifeCycle
            };
        }
        const { Npc, ScriptFile, ScriptState, NpcOps, ScriptOpcode, resolveNpcType, EntityLifeCycle } = routingRuntime;
        // The resolver consumes only this selected var value. No world or player is mutated.
        const selectedValue = id => {
            same(id, selectorId, 'routing', 'resolver selector id');
            return selector.value;
        };
        same(resolveNpcType(parent, { getVar: selectedValue, getVarBit: selectedValue }).id, form.id, 'routing', 'native resolved form');
        same(form.op, routing.resolvedOptions, 'routing', 'resolved options');
        const npc = new Npc(0, 0, 0, parent.size, parent.size, EntityLifeCycle.FOREVER, 1, parent.id, parent.blockwalk);
        const invoke = (opcode, argument, string = false) => {
            const script = new ScriptFile(-1);
            script.intOperands = [0];
            const state = new ScriptState(script);
            state.pc = 0;
            state.activeNpc = npc;
            state.pushInt(argument);
            NpcOps[ScriptOpcode[opcode]](state);
            return string ? state.popString() : state.popInt();
        };
        keys(routing.stats, skills, 'routing stats');
        same(Object.keys(routing.stats).sort(), [...skills].sort(), 'routing', 'routing needs all six spawned-parent stats');
        for (const skill of skills) same(invoke('NPC_STAT', skills.indexOf(skill)), routing.stats[skill], 'routing', `spawned NPC_STAT ${skill}`);
        need(object(routing.params) && Object.keys(routing.params).length > 0, 'routing', 'routing needs parameter expectations');
        for (const [name, expected] of Object.entries(routing.params)) {
            const param = ParamType.getByName(name);
            need(param, 'field', `missing routing parameter ${name}`);
            same(invoke('NPC_PARAM', param.id, param.isString()), resolve(expected, fieldKind(`param:${name}`)), 'routing', `spawned NPC_PARAM ${name}`);
        }
        need(object(routing.hasop) && Object.keys(routing.hasop).length > 0, 'routing', 'routing needs hasop expectations');
        for (const [op, expected] of Object.entries(routing.hasop)) {
            need(/^[1-5]$/.test(op) && typeof expected === 'boolean', 'routing', 'hasop needs option 1..5 and boolean');
            same(invoke('NPC_HASOP', Number(op)), expected ? 1 : 0, 'routing', `spawned NPC_HASOP ${op}`);
        }
    }
    return { NpcType, ParamType, npcFor, fieldsFor, fieldKind, rawField, resolve, normalize, capture, expectField, checkRouting };
}

export async function checkManifest(manifest, snapshots, pack) {
    keys(manifest, ['version', 'entries'], 'manifest');
    keys(snapshots, ['version', 'types'], 'snapshots');
    need(manifest.version === 1 && snapshots.version === 1 && Array.isArray(manifest.entries) && Array.isArray(snapshots.types),
        'schema', 'expected version 1 and entry/snapshot arrays');
    const baseline = new Map();
    for (const snapshot of snapshots.types) {
        keys(snapshot, ['identity', 'contentCommit', 'fields'], 'snapshot');
        identityShape(snapshot.identity);
        need(!baseline.has(snapshot.identity.debugname), 'schema', `${snapshot.identity.debugname}: duplicate snapshot`);
        need(typeof snapshot.contentCommit === 'string' && commitPattern.test(snapshot.contentCommit) && object(snapshot.fields),
            'schema', `${snapshot.identity.debugname}: snapshot needs commit and fields`);
        baseline.set(snapshot.identity.debugname, snapshot);
    }
    const seen = new Set();
    const levels = [];
    let fieldCount = 0;
    let routeCount = 0;
    for (const entry of manifest.entries) {
        keys(entry, ['identity', 'unit', 'fields', 'evidence', 'levelException', 'routing'], 'entry');
        const npc = pack.npcFor(entry.identity);
        const context = entry.identity.debugname;
        need(!seen.has(context), 'identity', `duplicate entry ${context}`);
        seen.add(context);
        need(typeof entry.unit === 'string' && unitPattern.test(entry.unit), 'schema', `${context}: invalid build unit`);
        need(object(entry.fields) && Object.keys(entry.fields).length > 0, 'schema', `${context}: fields must not be empty`);
        if (entry.evidence !== undefined) evidence(entry.evidence, context);
        if (entry.levelException !== undefined) {
            keys(entry.levelException, ['kind', 'reason'], `${context} level exception`);
            need(entry.levelException.kind === 'formula-mismatch' && text(entry.levelException.reason), 'level-exception', `${context}: level exception needs kind and reason`);
        }
        const snapshot = baseline.get(context);
        need(snapshot, 'stale', `${context}: missing pre-build snapshot`);
        same(snapshot.identity, entry.identity, 'identity', `${context} snapshot`);
        const currentFields = pack.fieldsFor(npc);
        const coreFields = currentFields.filter(field => !field.startsWith('param:'));
        same(Object.keys(snapshot.fields).filter(field => !field.startsWith('param:')).sort(), coreFields,
            'stale', `${context}: snapshot must include every decoded native field`);
        for (const [field, expectation] of Object.entries(entry.fields)) {
            keys(expectation, ['value', 'evidence', 'unit'], `${context}/${field}`);
            if (expectation.unit !== undefined) {
                need(typeof expectation.unit === 'string' && unitPattern.test(expectation.unit), 'schema', `${context}/${field}: invalid build unit`);
                evidence(expectation.evidence, `${context}/${field}`);
            }
            need(Object.hasOwn(expectation, 'value'), 'schema', `${context}/${field}: missing value`);
            evidence(expectation.evidence ?? entry.evidence, `${context}/${field}`);
            pack.expectField(npc, field, expectation.value, context);
            fieldCount++;
        }
        const allFields = new Set([...currentFields, ...Object.keys(snapshot.fields)]);
        for (const field of allFields) {
            if (Object.hasOwn(entry.fields, field)) continue;
            need(currentFields.includes(field) && Object.hasOwn(snapshot.fields, field), 'stale', `${context}/${field}: unlisted added or removed field`);
            same(pack.rawField(npc, field), pack.resolve(snapshot.fields[field], pack.fieldKind(field)), 'stale', `${context}/${field}: unlisted drift`);
        }
        const wholeVector = ['attack', 'defence', 'hitpoints', 'strength'].every(skill => Object.hasOwn(entry.fields, skill));
        if (wholeVector || entry.levelException !== undefined) {
            const vector = Object.fromEntries(skills.map(skill => [skill, pack.rawField(npc, skill)]));
            const formula = combatLevel(vector);
            const mismatch = npc.vislevel > 0 && formula !== npc.vislevel;
            levels.push({ npc: context, formula, visible: npc.vislevel,
                status: npc.vislevel <= 0 ? 'hidden' : !mismatch ? 'match'
                    : entry.levelException ? 'mismatch-exception' : 'mismatch',
                exception: entry.levelException ?? null });
            const staleException = entry.levelException !== undefined && (!wholeVector || !mismatch);
            if (staleException || (mismatch && !entry.levelException)) {
                const kind = staleException ? 'level-exception' : 'level';
                const reason = staleException ? 'stale formula-mismatch exception requires a visible whole-vector mismatch'
                    : 'visible whole-vector mismatch requires a formula-mismatch exception with a reason';
                throw Object.assign(new Error(`[${kind}] ${context}: formula=${formula} cache=${npc.vislevel}: ${reason}`), { levels });
            }
        }
        if (entry.routing !== undefined) {
            await pack.checkRouting(entry.routing, entry);
            routeCount++;
        }
    }
    for (const name of baseline.keys()) need(seen.has(name), 'missing-entry', `${name}: snapshot has no built entry`);
    return { entries: seen.size, fields: fieldCount, routes: routeCount, levels };
}
