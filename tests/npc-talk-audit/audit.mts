import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import CategoryType from '#/cache/config/CategoryType.js';
import Component from '#/cache/config/Component.js';
import DbRowType from '#/cache/config/DbRowType.js';
import DbTableIndex from '#/cache/config/DbTableIndex.js';
import DbTableType from '#/cache/config/DbTableType.js';
import EnumType from '#/cache/config/EnumType.js';
import FontType from '#/cache/config/FontType.js';
import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import MesanimType from '#/cache/config/MesanimType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import SeqType from '#/cache/config/SeqType.js';
import StructType from '#/cache/config/StructType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import VarNpcType from '#/cache/config/VarNpcType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import { BlockWalk } from '#/engine/entity/BlockWalk.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Npc from '#/engine/entity/Npc.js';
import Player from '#/engine/entity/Player.js';
import resolveNpcType from '#/engine/entity/resolveNpcType.js';
import ScriptFile from '#/engine/script/ScriptFile.js';
import ScriptProvider from '#/engine/script/ScriptProvider.js';
import { ScriptOpcode, ScriptOpcodeNameMap } from '#/engine/script/ScriptOpcode.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import World from '#/engine/World.js';
import OpNpcHandler from '#/network/game/client/handler/OpNpcHandler.js';
import OpNpc from '#/network/game/client/model/OpNpc.js';
import * as rsbuf from '#/network/rsbuf/index.js';

export type MapNpcPlacement = {
  mapFile: string;
  line: number;
  regionX: number;
  regionZ: number;
  plane: number;
  localX: number;
  localZ: number;
  npcId: number;
  worldX: number;
  worldZ: number;
  coord: string;
};

export type MapNpcScan = {
  mapFiles: string[];
  npcSections: number;
  mapFilesWithoutNpcSection: string[];
  placements: MapNpcPlacement[];
  malformedRows: string[];
};

type MapLabel = {
  id: number;
  name: string;
  x: number;
  z: number;
};

type Area = {
  label: string;
  distance: number | null;
  projectedZ: number;
  projection: 'surface' | 'below';
  nearestLabel: string;
};

type Route = {
  trigger: ServerTriggerType;
  script: ScriptFile | null;
  rule: string;
};

type Dispatch = {
  state: string;
  option: string;
  slot: number;
  ap: Route;
  op: Route;
};

type MissingOption = {
  slot: number;
  option: string;
  apRoutes: Route[];
  opRoutes: Route[];
};

type FormReport = {
  root: NpcType;
  visible: NpcType;
  states: Set<string>;
  dispatches: Map<number, Map<string, Dispatch>>;
};

type ChatSite = {
  key: string;
  source: string;
  line: number;
  procedure: string;
  literalText: boolean;
};

type ScriptAnalysis = {
  scripts: ScriptFile[];
  chatSites: ChatSite[];
  opcodeNames: string[];
  genericOpcodeNames: string[];
  incomplete: boolean;
  deferredCalls: string[];
};

type SourceDeadNpcOption = {
  visibleTypeId: number;
  optionSlot: number;
  optionText: string;
  sourceIdentity: string;
  basis: string;
};

const SOURCE_DEAD_NPC_OPTIONS: SourceDeadNpcOption[] = [
  {
    visibleTypeId: 1867,
    optionSlot: 3,
    optionText: 'Trade',
    sourceIdentity: 'Old School RuneScape Wiki: Ali the Camel Man, revisions 214367 and 15196390; original revision-377 NPC 1867 option 3; retained U-BETA-1117/q075/camel-man-osrs-complete-history-20261119.json',
    basis: 'CANDIDATE: revision 214367 says the Trade option does nothing; revision 15196390 says it reports “nothing interesting happens” during and after the quest. The complete retained article history and change notes date Trade to 15 August 2005 and the later renamed form to 9 November 2022.',
  },
];

const configs = [
  VarPlayerType,
  VarBitType,
  VarNpcType,
  ParamType,
  ObjType,
  LocType,
  NpcType,
  InvType,
  CategoryType,
  EnumType,
  StructType,
  SeqType,
  MesanimType,
  DbTableType,
  DbRowType,
];

export function loadPackedConfigs(packDir = 'data/pack'): void {
  for (const config of configs) config.load(packDir);
  DbTableIndex.init();
  Component.load(packDir);
  FontType.load(packDir);
  assert(ScriptProvider.load(packDir) > 0, `no packed scripts loaded from ${packDir}`);
  World.currentTick = 10;
}

export function readMapNpcPlacements(contentRoot: string): MapNpcScan {
  const mapDir = path.join(contentRoot, 'maps');
  const mapFiles = fs.readdirSync(mapDir)
    .filter(file => /^m\d+_\d+\.jm2$/.test(file))
    .sort(numericMapSquareCompare);
  const placements: MapNpcPlacement[] = [];
  const malformedRows: string[] = [];
  const mapFilesWithoutNpcSection: string[] = [];
  let npcSections = 0;

  for (const mapFile of mapFiles) {
    const [, regionXText, regionZText] = mapFile.match(/^m(\d+)_(\d+)\.jm2$/)!;
    const regionX = Number(regionXText);
    const regionZ = Number(regionZText);
    const source = fs.readFileSync(path.join(mapDir, mapFile), 'utf8');
    const lines = source.split(/\r?\n/);
    let inNpc = false;
    let sawNpcSection = false;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();
      if (trimmed.startsWith('==== ')) {
        inNpc = trimmed === '==== NPC ====';
        if (inNpc) {
          npcSections++;
          sawNpcSection = true;
        }
        continue;
      }
      if (!inNpc || !trimmed || trimmed.startsWith('//')) continue;

      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+):\s+(-?\d+)(?:\s+.*)?$/);
      if (!match) {
        malformedRows.push(`${mapFile}:${index + 1}: ${line}`);
        continue;
      }

      const plane = Number(match[1]);
      const localX = Number(match[2]);
      const localZ = Number(match[3]);
      const npcId = Number(match[4]);
      if (npcId < 0) {
        malformedRows.push(`${mapFile}:${index + 1}: negative NPC config id ${npcId}`);
        continue;
      }
      placements.push({
        mapFile,
        line: index + 1,
        regionX,
        regionZ,
        plane,
        localX,
        localZ,
        npcId,
        worldX: regionX * 64 + localX,
        worldZ: regionZ * 64 + localZ,
        coord: `${plane}_${regionX}_${regionZ}_${localX}_${localZ}`,
      });
    }
    if (!sawNpcSection) mapFilesWithoutNpcSection.push(mapFile);
  }

  return { mapFiles, npcSections, mapFilesWithoutNpcSection, placements, malformedRows };
}

export function npcFormStates(root: NpcType): (number | null)[] {
  if (root.multivarp === -1 && root.multivarbit === -1) return [null];
  if (!root.multinpc.length) return [null];
  return root.multinpc.map((_, index) => index);
}

export function setNpcFormState(player: Player, root: NpcType, state: number | null): void {
  if (state === null) return;
  if (root.multivarp !== -1) {
    player.setVar(root.multivarp, state);
  } else if (root.multivarbit !== -1) {
    player.setVarBit(root.multivarbit, state);
  }
}

function readMapLabels(contentRoot: string): MapLabel[] {
  const labelsPath = path.join(contentRoot, 'maps', 'labels.txt');
  const labels: MapLabel[] = [];
  for (const line of fs.readFileSync(labelsPath, 'utf8').split(/\r?\n/)) {
    const marker = line.startsWith('=') ? line.slice(1).split(',') : [];
    if (marker.length < 3) continue;
    const x = Number(marker[1]);
    const z = Number(marker[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    labels.push({ id: labels.length, name: marker[0], x, z });
  }
  return labels;
}

// UNKNOWN engineering grouping radius: one map-square width, not a place boundary.
const MAX_LABEL_DISTANCE_TILES = 64;
// Current map pairs and ladders.rs2:86-97 establish the conventional +6400 layout.
const UNDERGROUND_Z_OFFSET = 6400;

function nearestArea(labels: MapLabel[], x: number, z: number, mapFile: string): Area {
  const projection = z >= UNDERGROUND_Z_OFFSET ? 'below' : 'surface';
  const projectedZ = projection === 'below' ? z - UNDERGROUND_Z_OFFSET : z;
  const unlabelled = `unlabelled (${mapFile.replace(/\.jm2$/, '')})`;
  if (!labels.length) return { label: unlabelled, distance: null, projectedZ, projection, nearestLabel: '' };
  let nearest = labels[0];
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const label of labels) {
    const distanceSquared = (label.x - x) ** 2 + (label.z - projectedZ) ** 2;
    if (distanceSquared < nearestDistanceSquared || (distanceSquared === nearestDistanceSquared && label.id < nearest.id)) {
      nearest = label;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return {
    label: nearestDistanceSquared <= MAX_LABEL_DISTANCE_TILES ** 2
      ? `${nearest.name}${projection === 'below' ? ' (below)' : ''}` : unlabelled,
    distance: Math.round(Math.sqrt(nearestDistanceSquared) * 10) / 10,
    projectedZ,
    projection,
    nearestLabel: nearest.name,
  };
}

function enumTrigger(name: string): ServerTriggerType {
  const value = (ServerTriggerType as unknown as Record<string, number>)[name];
  assert(Number.isInteger(value), `missing engine trigger ${name}`);
  return value as ServerTriggerType;
}

function directRoute(trigger: ServerTriggerType, type: NpcType): { script: ScriptFile | null; rule: string } {
  const exact = ScriptProvider.getByTriggerSpecific(trigger, type.id, -1);
  if (exact) return { script: exact, rule: `exact:${type.id}` };
  if (type.category !== -1) {
    const category = ScriptProvider.getByTriggerSpecific(trigger, -1, type.category);
    if (category) return { script: category, rule: `category:${type.category}` };
  }
  const global = ScriptProvider.getByTriggerSpecific(trigger);
  if (global) return { script: global, rule: 'default/global' };
  return { script: null, rule: 'none' };
}

function actualRoute(
  trigger: ServerTriggerType,
  otherTrigger: ServerTriggerType,
  active: NpcType,
  root: NpcType,
  actual: ScriptFile | null,
): Route {
  if (!actual) return { trigger, script: null, rule: 'none' };
  const activeRule = directRoute(trigger, active);
  if (activeRule.script === actual) return { trigger, script: actual, rule: activeRule.rule };

  if (active.id !== root.id && !directRoute(otherTrigger, active).script) {
    const rootRule = directRoute(trigger, root);
    if (rootRule.script === actual) {
      return { trigger, script: actual, rule: `base-fallback:${rootRule.rule}` };
    }
  }

  return { trigger, script: actual, rule: 'Player dispatch (rule unresolved)' };
}

function formProbe(root: NpcType, state: number | null, nextNpcId: number): { visible: NpcType; dispatches: Dispatch[] } {
  const player = new Player('talkaudit', 1n, 1n);
  player.pid = 1;
  player.uid = 1;
  player.slot = 1;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  setNpcFormState(player, root, state);
  const visible = resolveNpcType(root, player);
  assert(visible, `NPC ${root.id} resolves to a missing form in state ${state}`);

  const npc = new Npc(
    0,
    8,
    8,
    1,
    1,
    EntityLifeCycle.FOREVER,
    nextNpcId,
    root.id,
    BlockWalk.NONE,
  );
  npc.isActive = true;
  player.write = () => {};

  const originalGetNpc = World.getNpc;
  let playerAdded = false;
  let npcAdded = false;
  try {
    World.getNpc = ((slot: number) => slot === npc.nid ? npc : null) as typeof World.getNpc;
    rsbuf.addPlayer(player.slot);
    playerAdded = true;
    rsbuf.addNpc(npc.nid, npc.type);
    npcAdded = true;
    rsbuf.computeNpc(
      npc.x, npc.z, npc.level, npc.nid, npc.type,
      false, false, -1, -1, true, 0, -1, -1, -1, -1, -1,
      0, 0, 0, 0, 1, 1, -1, 0, null, -1, 0, 0,
    );
    rsbuf.npcInfo(0, player.slot, 0, 0, false);
    assert.equal(rsbuf.hasNpc(player.slot, npc.nid), true, `NPC ${root.id} missing from visible NPC list`);

    const click = new OpNpcHandler();
    const dispatches: Dispatch[] = [];
    const stateName = state === null ? 'base' : String(state);
    for (let index = 0; index < 5; index++) {
      const option = visible.op?.[index] ?? null;
      if (!option || option === 'hidden') continue;
      player.clearInteraction();
      const accepted = click.handle(new OpNpc(index + 1, npc.nid), player);
      assert.equal(accepted, true, `production OpNpcHandler rejected packed option ${index + 1}=${option} on ${visible.debugname}`);
      const apTrigger = enumTrigger(`APNPC${index + 1}`);
      const opTrigger = enumTrigger(`OPNPC${index + 1}`);
      const apActual = player.getApTrigger();
      const opActual = player.getOpTrigger();
      dispatches.push({
        state: stateName,
        slot: index + 1,
        option,
        ap: actualRoute(apTrigger, opTrigger, visible, root, apActual ?? null),
        op: actualRoute(opTrigger, apTrigger, visible, root, opActual ?? null),
      });
    }
    return { visible, dispatches };
  } finally {
    World.getNpc = originalGetNpc;
    if (npcAdded) rsbuf.removeNpc(npc.nid);
    if (playerAdded) rsbuf.removePlayer(player.slot);
  }
}

function sourcePath(script: ScriptFile): string {
  return String(script.info?.sourceFilePath ?? script.fileName ?? '').replaceAll('\\', '/');
}

const sourceCache = new Map<string, string[]>();
function sourceLines(contentRoot: string, file: string): string[] {
  if (sourceCache.has(file)) return sourceCache.get(file)!;
  const sourcePathValue = path.join(contentRoot, file);
  const lines = fs.existsSync(sourcePathValue) ? fs.readFileSync(sourcePathValue, 'utf8').split(/\r?\n/) : [];
  sourceCache.set(file, lines);
  return lines;
}

const fixedQueueIntArguments = new Map([
  ['QUEUE', 3],
  ['STRONGQUEUE', 3],
  ['WEAKQUEUE', 3],
  ['LONGQUEUE', 4],
]);
const varargQueueIntPrefixes = new Map([
  ['QUEUEVARARG', 2],
  ['STRONGQUEUEVARARG', 2],
  ['WEAKQUEUEVARARG', 2],
  ['LONGQUEUEVARARG', 3],
  ['SETTIMER', 2],
  ['SOFTTIMER', 2],
]);
const directContinuationNames = new Set([
  ...fixedQueueIntArguments.keys(),
  ...varargQueueIntPrefixes.keys(),
  'WALKTRIGGER',
]);
const npcQueueNames = new Set(['NPC_QUEUE', 'NPC_WALKTRIGGER']);

const chatHeadSourceFile = 'scripts/interface_chat/scripts/chat.rs2';

function chatProcedureName(script: ScriptFile): string {
  return script.name.match(/^\[(?:proc|label),([^\]]+)\]$/)?.[1] ?? script.name;
}

function isChatHeadProcedure(script: ScriptFile): boolean {
  return sourcePath(script) === chatHeadSourceFile
    && /^(?:\.?chat(?:npc|player)|\.?mesbox|(?:double)?objbox|p_choice|multi[2-5]|multiobj|skill_?multi)/.test(chatProcedureName(script));
}

function constantIntArgumentsBefore(script: ScriptFile, pc: number, count: number): number[] | null {
  if (count <= 0 || pc < count) return null;
  const values: number[] = [];
  for (let index = pc - count; index < pc; index++) {
    if (script.opcodes[index] !== ScriptOpcode.PUSH_CONSTANT_INT) return null;
    values.push(script.intOperands[index]);
  }
  return values;
}

function continuationScriptId(script: ScriptFile, pc: number, opcodeName: string): number | null {
  const fixedCount = fixedQueueIntArguments.get(opcodeName);
  if (fixedCount !== undefined) {
    return constantIntArgumentsBefore(script, pc, fixedCount)?.[0] ?? null;
  }
  if (opcodeName === 'WALKTRIGGER') {
    return constantIntArgumentsBefore(script, pc, 1)?.[0] ?? null;
  }
  const prefixCount = varargQueueIntPrefixes.get(opcodeName);
  if (prefixCount === undefined || pc === 0 || script.opcodes[pc - 1] !== ScriptOpcode.PUSH_CONSTANT_STRING) return null;
  const types = script.stringOperands[pc - 1];
  if (typeof types !== 'string') return null;
  const intArgumentCount = [...types].filter(type => type !== 's').length;
  const stringArgumentCount = [...types].filter(type => type === 's').length;
  const intValues: number[] = [];
  const stringValues: string[] = [];
  for (let index = pc - 2; index >= 0; index--) {
    const opcode = script.opcodes[index];
    if (opcode === ScriptOpcode.PUSH_CONSTANT_INT) intValues.push(script.intOperands[index]);
    else if (opcode === ScriptOpcode.PUSH_CONSTANT_STRING) stringValues.push(script.stringOperands[index] ?? '');
    else break;
  }
  if (intValues.length !== prefixCount + intArgumentCount || stringValues.length !== stringArgumentCount) return null;
  return intValues[intValues.length - 1] ?? null;
}

function npcQueueId(script: ScriptFile, pc: number, opcodeName: string): number | null {
  const count = opcodeName === 'NPC_QUEUE' ? 3 : opcodeName === 'NPC_WALKTRIGGER' ? 2 : 0;
  return constantIntArgumentsBefore(script, pc, count)?.[0] ?? null;
}

function scriptAnalysisKey(script: ScriptFile, npcType?: NpcType): string {
  return `${npcType?.id ?? -1}:${script.id}`;
}

function scriptAnalysis(
  script: ScriptFile,
  contentRoot: string,
  analysisCache: Map<string, ScriptAnalysis>,
  npcType?: NpcType,
): ScriptAnalysis {
  const key = scriptAnalysisKey(script, npcType);
  let analysis = analysisCache.get(key);
  if (!analysis) {
    analysis = analyzeScript(script, contentRoot, npcType);
    analysisCache.set(key, analysis);
  }
  return analysis;
}

function literalChatArgument(contentRoot: string, source: string, line: number, procedure: string): boolean {
  if (line <= 0) return false;
  const text = sourceLines(contentRoot, source)[line - 1] ?? '';
  const escaped = procedure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`\\b${escaped}\\s*\\((.*)\\)`));
  return Boolean(match && /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/.test(match[1]));
}

function analyzeScript(script: ScriptFile, contentRoot: string, npcType?: NpcType): ScriptAnalysis {
  const visited = new Map<number, ScriptFile>();
  const queue = [script];
  const chatSites = new Map<string, ChatSite>();
  const opcodeNames = new Set<string>();
  const genericOpcodeNames = new Set<string>();
  const deferredCalls = new Set<string>();
  let incomplete = false;

  const addContinuation = (current: ScriptFile, opcodeName: string, pc: number, target: ScriptFile | undefined, line: number, targetLabel: string): void => {
    if (target) {
      if (isChatHeadProcedure(target) && sourcePath(current) !== chatHeadSourceFile) {
        const key = `${current.id}:${pc}`;
        chatSites.set(key, {
          key,
          source: sourcePath(current),
          line,
          procedure: chatProcedureName(target),
          literalText: literalChatArgument(contentRoot, sourcePath(current), line, chatProcedureName(target)),
        });
      }
      queue.push(target);
      return;
    }
    incomplete = true;
    deferredCalls.add(`${opcodeName} ${sourcePath(current)}:${line || '?'} ${targetLabel}`);
  };

  while (queue.length) {
    const current = queue.pop()!;
    if (visited.has(current.id)) continue;
    visited.set(current.id, current);
    const currentSource = sourcePath(current);
    for (let pc = 0; pc < current.opcodes.length; pc++) {
      const opcode = current.opcodes[pc];
      const opcodeName = ScriptOpcodeNameMap.get(opcode) ?? String(opcode);
      opcodeNames.add(opcodeName);
      if (currentSource !== chatHeadSourceFile) genericOpcodeNames.add(opcodeName);
      const line = current.lineNumber(pc);

      if (directContinuationNames.has(opcodeName)) {
        const targetId = continuationScriptId(current, pc, opcodeName);
        if (targetId === null) {
          incomplete = true;
          deferredCalls.add(`${opcodeName} ${currentSource}:${line || '?'} target is not recoverable from constant compiled operands`);
        } else if (opcodeName !== 'WALKTRIGGER' || targetId !== -1) {
          addContinuation(current, opcodeName, pc, ScriptProvider.get(targetId), line, `compiled script id ${targetId} is not loaded`);
        }
      } else if (npcQueueNames.has(opcodeName)) {
        const queueId = npcQueueId(current, pc, opcodeName);
        if (queueId === null) {
          incomplete = true;
          deferredCalls.add(`${opcodeName} ${currentSource}:${line || '?'} queue id is not recoverable from constant compiled operands`);
        } else if (!npcType) {
          incomplete = true;
          deferredCalls.add(`${opcodeName} ${currentSource}:${line || '?'} queue id ${queueId} requires NPC type context`);
        } else if (queueId < 1 || queueId > 20) {
          incomplete = true;
          deferredCalls.add(`${opcodeName} ${currentSource}:${line || '?'} queue id ${queueId} is outside AI_QUEUE1..AI_QUEUE20`);
        } else {
          const trigger = (ServerTriggerType.AI_QUEUE1 + queueId - 1) as ServerTriggerType;
          const target = ScriptProvider.getByTrigger(trigger, npcType.id, npcType.category);
          if (target) addContinuation(current, opcodeName, pc, target, line, `AI_QUEUE${queueId} handler is not loaded`);
        }
      } else if (opcodeName === 'NPC_SETTIMER') {
        const interval = constantIntArgumentsBefore(current, pc, 1)?.[0];
        const timerScript = npcType
          ? ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, npcType.id, npcType.category)
          : undefined;
        if (!timerScript) continue;
        if (interval === undefined) {
          incomplete = true;
          deferredCalls.add(`NPC_SETTIMER ${currentSource}:${line || '?'} interval is not recoverable from constant compiled operands`);
        } else if (interval > 0) {
          addContinuation(current, opcodeName, pc, timerScript, line, 'AI_TIMER handler is not loaded');
        }
      }

      let calledId: number | undefined;
      if (opcode === ScriptOpcode.GOSUB_WITH_PARAMS || opcode === ScriptOpcode.JUMP_WITH_PARAMS) {
        calledId = current.intOperands[pc];
      } else if (opcode === ScriptOpcode.GOSUB || opcode === ScriptOpcode.JUMP) {
        if (pc > 0 && current.opcodes[pc - 1] === ScriptOpcode.PUSH_CONSTANT_INT) {
          calledId = current.intOperands[pc - 1];
        } else {
          incomplete = true;
          deferredCalls.add(`${opcodeName} ${currentSource}:${line || '?'} target is not recoverable from constant compiled operands`);
        }
      }
      if (calledId !== undefined) {
        addContinuation(current, opcodeName, pc, ScriptProvider.get(calledId), line, `compiled script id ${calledId} is not loaded`);
      }
    }
  }

  return {
    scripts: [...visited.values()],
    chatSites: [...chatSites.values()],
    opcodeNames: [...opcodeNames].sort(),
    genericOpcodeNames: [...genericOpcodeNames].sort(),
    incomplete,
    deferredCalls: [...deferredCalls].sort(),
  };
}

const genericSafeOpcodes = new Set([
  'PUSH_CONSTANT_INT', 'PUSH_CONSTANT_STRING',
  'PUSH_INT_LOCAL', 'PUSH_STRING_LOCAL', 'POP_INT_LOCAL', 'POP_STRING_LOCAL',
  'POP_INT_DISCARD', 'POP_STRING_DISCARD', 'JOIN_STRING',
  'BRANCH', 'BRANCH_NOT', 'BRANCH_EQUALS', 'BRANCH_LESS_THAN',
  'BRANCH_GREATER_THAN', 'BRANCH_LESS_THAN_OR_EQUALS',
  'BRANCH_GREATER_THAN_OR_EQUALS', 'SWITCH',
  'JUMP', 'JUMP_WITH_PARAMS', 'GOSUB', 'GOSUB_WITH_PARAMS', 'RETURN',
]);

function handlerLine(script: ScriptFile): string {
  const file = sourcePath(script);
  const line = script.lineNumber(0);
  return `${file}${line > 0 ? `:${line}` : ''}`;
}

function routeLabel(route: Route): string {
  const script = route.script;
  return `${route.rule} -> ${script ? `${script.name} [${handlerLine(script)}]` : 'none'}`;
}

function describeOps(type: NpcType): string {
  return (type.op ?? [])
    .map((option, index) => option ? `${index + 1}=${option}` : '')
    .filter(Boolean)
    .join('; ');
}

function numericMapSquareCompare(left: string, right: string): number {
  const a = left.match(/^m(\d+)_(\d+)\.jm2$/)!;
  const b = right.match(/^m(\d+)_(\d+)\.jm2$/)!;
  return Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]);
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(outDir: string, name: string, columns: string[], rows: Record<string, unknown>[]): void {
  const body = [columns.map(csvCell).join(',')];
  for (const row of rows) body.push(columns.map(column => csvCell(row[column])).join(','));
  fs.writeFileSync(path.join(outDir, name), `${body.join('\n')}\n`);
}

function optionsForRoot(root: NpcType, nextNpcId: number): Map<number, FormReport> {
  const forms = new Map<number, FormReport>();
  for (const state of npcFormStates(root)) {
    if (state !== null) {
      const selectedId = root.multinpc[state];
      if (selectedId >= 0 && !NpcType.get(selectedId)) continue;
    }
    const { visible, dispatches } = formProbe(root, state, nextNpcId++);
    let form = forms.get(visible.id);
    if (!form) {
      form = { root, visible, states: new Set(), dispatches: new Map() };
      forms.set(visible.id, form);
    }
    form.states.add(state === null ? 'base' : String(state));
    for (const dispatch of dispatches) {
      let stateRows = form.dispatches.get(dispatch.slot);
      if (!stateRows) {
        stateRows = new Map();
        form.dispatches.set(dispatch.slot, stateRows);
      }
      stateRows.set(dispatch.state, dispatch);
    }
  }
  return forms;
}

export type NoRouteTalkWitness = {
  placedTypeId: number;
  visibleTypeId: number;
  talkSlot: number;
};

export function isTalkOption(option: string | null | undefined): boolean {
  // Observed packed spellings are Talk-to, Talk-To, Talk and Talk to.
  const key = option?.toLowerCase().replace(/\s+/g, '-');
  return key === 'talk' || key === 'talk-to';
}
function sourceDeadNpcOptionFor(visibleTypeId: number, optionSlot: number, optionText: string): SourceDeadNpcOption | undefined {
  return SOURCE_DEAD_NPC_OPTIONS.find(exception => exception.visibleTypeId === visibleTypeId
    && exception.optionSlot === optionSlot
    && exception.optionText === optionText);
}

function assertSourceDeadNpcOptions(): void {
  for (const exception of SOURCE_DEAD_NPC_OPTIONS) {
    const config = NpcType.get(exception.visibleTypeId);
    assert(config, `source-dead NPC exception type ${exception.visibleTypeId} no longer exists`);
    assert.equal(config.op?.[exception.optionSlot - 1], exception.optionText,
      `source-dead NPC exception ${exception.visibleTypeId}/${exception.optionSlot} no longer has option ${exception.optionText}`);
  }
}


export function findNoRouteTalkWitnesses(contentRoot: string, count: number): NoRouteTalkWitness[] {
  assert(Number.isInteger(count) && count > 0, `invalid witness count ${count}`);
  assertSourceDeadNpcOptions();
  const rootIds = new Set(readMapNpcPlacements(contentRoot).placements.map(placement => placement.npcId));
  const candidates = new Map<string, NoRouteTalkWitness>();
  let nextNpcId = 1;

  for (const placedTypeId of [...rootIds].sort((left, right) => left - right)) {
    const root = NpcType.get(placedTypeId);
    if (!root) continue;
    const forms = optionsForRoot(root, nextNpcId);
    nextNpcId += Math.max(1, npcFormStates(root).length);

    for (const form of forms.values()) {
      const talkSlots = (form.visible.op ?? []).map((option, index) => isTalkOption(option) ? index + 1 : 0).filter(Boolean);
      for (const talkSlot of talkSlots) {
        const routes = [...routeForState(form, talkSlot, 'ap'), ...routeForState(form, talkSlot, 'op')];
        if (!routes.length || routes.some(route => route.script)) continue;
        const witness = { placedTypeId, visibleTypeId: form.visible.id, talkSlot };
        candidates.set(`${placedTypeId}:${form.visible.id}:${talkSlot}`, witness);
      }
    }
  }

  return [...candidates.values()]
    .sort((left, right) => left.visibleTypeId - right.visibleTypeId || left.placedTypeId - right.placedTypeId || left.talkSlot - right.talkSlot)
    .slice(0, count);
}

function routeForState(form: FormReport, slot: number, phase: 'ap' | 'op'): Route[] {
  const rows = form.dispatches.get(slot);
  if (!rows) return [];
  const routes = new Map<string, Route>();
  for (const dispatch of rows.values()) {
    const route = dispatch[phase];
    const key = `${route.script?.id ?? 'none'}:${route.rule}`;
    routes.set(key, route);
  }
  return [...routes.values()];
}

function missingOptionsForForm(form: FormReport): MissingOption[] {
  const missing: MissingOption[] = [];
  for (let index = 0; index < 5; index++) {
    const option = form.visible.op?.[index] ?? '';
    if (!option || ['attack', 'hidden'].includes(option.toLowerCase())) continue;
    const slot = index + 1;
    const apRoutes = routeForState(form, slot, 'ap');
    const opRoutes = routeForState(form, slot, 'op');
    if ([...apRoutes, ...opRoutes].some(route => route.script)) continue;
    missing.push({ slot, option, apRoutes, opRoutes });
  }
  return missing;
}

function selfTestMissingOptions(outDir: string): void {
  const visible = new NpcType(-1);
  visible.op = ['Synthetic missing first action', 'Attack', null, 'hidden', 'Synthetic missing fifth action'];
  const dispatches = new Map<number, Map<string, Dispatch>>();
  for (const slot of [1, 5]) {
    dispatches.set(slot, new Map([['synthetic', {
      state: 'synthetic', option: visible.op[slot - 1]!, slot,
      ap: { trigger: enumTrigger(`APNPC${slot}`), script: null, rule: 'none' },
      op: { trigger: enumTrigger(`OPNPC${slot}`), script: null, rule: 'none' },
    }]]));
  }
  const form: FormReport = { root: visible, visible, states: new Set(['synthetic']), dispatches };
  const rows = missingOptionsForForm(form).map(row => ({ optionSlot: row.slot, optionText: row.option }));
  const unrelated = rows[0];
  assert.equal(sourceDeadNpcOptionFor(visible.id, unrelated.optionSlot, unrelated.optionText), undefined,
    'an unrelated missing handler must remain an unknown gap');
  assert.equal(sourceDeadNpcOptionFor(1867, 3, 'Trade'), SOURCE_DEAD_NPC_OPTIONS[0]);
  assert.equal(sourceDeadNpcOptionFor(1867, 2, 'Trade'), undefined);
  assert.equal(sourceDeadNpcOptionFor(1868, 3, 'Trade'), undefined);
  assert.equal(sourceDeadNpcOptionFor(1867, 3, 'Talk-to'), undefined);
  const name = `audit-options-selftest-${process.pid}.csv`;
  const file = path.join(outDir, name);
  assert(!fs.existsSync(file), 'refusing to overwrite a pre-existing self-test file');
  try {
    writeCsv(outDir, name, ['optionSlot', 'optionText'], rows);
    assert.equal(fs.readFileSync(file, 'utf8'), 'optionSlot,optionText\n1,Synthetic missing first action\n5,Synthetic missing fifth action\n');
  } finally {
    fs.rmSync(file, { force: true });
  }
  assert(isTalkOption('Talk-to') && isTalkOption('Talk-To') && isTalkOption('Talk') && isTalkOption('Talk to'));
  assert(!isTalkOption('Listen-to') && !isTalkOption('Attack'));
  const labels: MapLabel[] = [{ id: 0, name: 'Synthetic label', x: 10, z: 10 }];
  assert.equal(nearestArea(labels, 10, 6410, 'm0_100.jm2').label, 'Synthetic label (below)');
  assert.equal(nearestArea(labels, 500, 500, 'm7_7.jm2').label, 'unlabelled (m7_7)');
  console.log('AUDIT_SELFTEST missing first/fifth actions appear in CSV; talk spellings and bounded underground labels pass');
}

function allRouteStates(form: FormReport, slot: number): Dispatch[] {
  return [...(form.dispatches.get(slot)?.values() ?? [])];
}

type QuestStages = { terminals: Map<string, number>; values: Map<string, Set<number>>; constants: Map<string, number> };
type EntryGuard = { guard: string; defects: string[] };

function questEntryGuard(script: ScriptFile, contentRoot: string, stages: QuestStages): EntryGuard | null {
  if (!sourcePath(script).startsWith('scripts/quests/')) return null;
  const lines = sourceLines(contentRoot, sourcePath(script));
  let first = Math.min(script.lineNumber(0) - 1, lines.length - 1);
  while (first >= 0 && !lines[first].trimStart().startsWith('[')) first--;
  if (first < 0) return null;
  let last = first + 1;
  while (last < lines.length && !lines[last].trimStart().startsWith('[')) last++;
  const body = lines.slice(first + 1, last).join('\n');
  const mask = body.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*/g, text => text.replace(/[^\n]/g, ' '));
  const close = (start: number, open: string, end: string): number => {
    let depth = 0;
    for (let index = start; index < mask.length; index++) {
      if (mask[index] === open) depth++;
      if (mask[index] === end && --depth === 0) return index;
    }
    return -1;
  };
  let cursor = 0;
  const skip = (): void => { while (/\s/.test(mask[cursor] ?? '') && cursor < mask.length) cursor++; };
  const conditions: string[] = [];
  const defects: string[] = [];
  const earlierAlternatives = new Set<string>();
  let elseIf = false;
  while (true) {
    skip();
    if (!/^if\b/.test(mask.slice(cursor))) return null;
    cursor += 2;
    skip();
    if (mask[cursor] !== '(') return null;
    const conditionEnd = close(cursor, '(', ')');
    if (conditionEnd < 0) return null;
    const condition = body.slice(cursor + 1, conditionEnd).trim();
    const alternatives = condition.replace(/\s+/g, '').split('|');
    if (!elseIf) earlierAlternatives.clear();
    else if (alternatives.every(alternative => earlierAlternatives.has(alternative))) {
      const line = first + 2 + (mask.slice(0, cursor).match(/\n/g)?.length ?? 0);
      defects.push(`${sourcePath(script)}:${line}: unreachable else-if (${condition}); every alternative already occurs in an earlier branch of this chain`);
    }
    for (const alternative of alternatives) earlierAlternatives.add(alternative);
    conditions.push(condition);
    cursor = conditionEnd + 1;
    skip();
    if (mask[cursor] !== '{') return null;
    const blockEnd = close(cursor, '{', '}');
    if (blockEnd < 0) return null;
    cursor = blockEnd + 1;
    skip();
    if (/^else\b/.test(mask.slice(cursor))) {
      cursor += 4;
      skip();
      if (/^if\b/.test(mask.slice(cursor))) {
        elseIf = true;
        continue;
      }
      if (mask[cursor] !== '{') return null;
      const otherwiseEnd = close(cursor, '{', '}');
      if (otherwiseEnd < 0 || !/^\s*(?:return\s*;)?\s*$/.test(mask.slice(cursor + 1, otherwiseEnd))) return null;
      cursor = otherwiseEnd + 1;
      skip();
    }
    if (/^if\b/.test(mask.slice(cursor))) {
      elseIf = false;
      continue;
    }
    if (!/^\s*(?:return\s*;)?\s*$/.test(mask.slice(cursor))) return null;
    break;
  }
  const comparisons: { variable: string; operator: string; value: number }[][][] = [];
  for (const condition of conditions) {
    const alternatives: { variable: string; operator: string; value: number }[][] = [];
    for (const alternative of condition.split('|')) {
      const conjunction: { variable: string; operator: string; value: number }[] = [];
      for (const atom of alternative.split('&')) {
        const match = atom.trim().match(/^%(\w+)\s*(<=|>=|!=|!|=|<|>)\s*(-?\d+|\^\w+)$/);
        if (!match) return null;
        const value = match[3].startsWith('^') ? stages.constants.get(match[3].slice(1)) : Number(match[3]);
        if (value === undefined || !Number.isSafeInteger(value)) return null;
        conjunction.push({ variable: match[1], operator: match[2], value });
      }
      alternatives.push(conjunction);
    }
    comparisons.push(alternatives);
  }
  const atoms = comparisons.flat(2);
  const variable = atoms[0]?.variable;
  if (!variable || atoms.some(atom => atom.variable !== variable)) return null;
  const samples = stages.values.get(variable);
  if (!samples?.size) return null;
  const matches = (stage: number): boolean => comparisons.some(alternatives => alternatives.some(conjunction => conjunction.every(atom => {
    switch (atom.operator) {
      case '=': return stage === atom.value;
      case '!': case '!=': return stage !== atom.value;
      case '<': return stage < atom.value;
      case '<=': return stage <= atom.value;
      case '>': return stage > atom.value;
      case '>=': return stage >= atom.value;
      default: return false;
    }
  })));
  if (![...samples].some(matches) || [...samples].every(matches)) return null;
  return { guard: conditions.map(condition => `(${condition})`).join(' OR '), defects };
}

const messageOnlyOpcodes = new Set([...genericSafeOpcodes, 'MES', 'NPC_SAY', 'NPC_NAME', 'P_NAME', 'DISPLAYNAME']);

function otherResponseKind(analysis: ScriptAnalysis): string {
  if (analysis.opcodeNames.some(name => name.startsWith('IF_OPEN'))) return 'opens an interface';
  if (analysis.incomplete || analysis.deferredCalls.length) return 'other';
  if (analysis.opcodeNames.every(name => genericSafeOpcodes.has(name))) return 'handler that only returns';
  if (analysis.opcodeNames.some(name => name === 'MES' || name === 'NPC_SAY')
    && analysis.opcodeNames.every(name => messageOnlyOpcodes.has(name))) return 'message-only reply';
  return 'other';
}

function talkClassification(
  routes: Route[],
  contentRoot: string,
  analysisCache: Map<string, ScriptAnalysis>,
  chatTypeUse: Map<string, Set<number>>,
  stages: QuestStages,
  npcType: NpcType,
): { classification: string; analysis: ScriptAnalysis | null; outsideStageOutcome: string; contentDefect?: string } {
  const scripts = [...new Map(routes.filter(route => route.script).map(route => [route.script!.id, route.script!])).values()];
  if (!scripts.length) {
    return {
      classification: 'no handler (engine default refusal)',
      analysis: null,
      outsideStageOutcome: 'default refusal: Nothing interesting happens. on OP; the no-approach phase is silent',
    };
  }

  const analyses = scripts.map(script => scriptAnalysis(script, contentRoot, analysisCache, npcType));
  const combined = combineAnalyses(analyses);
  const incomplete = combined.incomplete;
  const deferred = combined.deferredCalls.length > 0;
  const answering = scripts.filter((_, index) => analyses[index].chatSites.length > 0);
  const guards = answering.map(script => questEntryGuard(script, contentRoot, stages));
  const silentApproach = analyses.every(analysis => analysis.chatSites.length > 0
    || (!analysis.incomplete && !analysis.deferredCalls.length && analysis.opcodeNames.every(name =>
      genericSafeOpcodes.has(name) || ['NPC_RANGE', 'P_APRANGE', 'COORD'].includes(name))));
  const silentInSomeQuestStages = answering.length > 0 && guards.every(Boolean) && silentApproach;
  const entryGuards = guards.filter((guard): guard is EntryGuard => Boolean(guard));
  const questOutsideStageOutcome = `nothing: the existing handler returns without dialogue outside ${entryGuards.map(guard => guard.guard).join(' AND ')}; candidate source-stage guard, using new-player zero, registry completion and literal source assignments`;

  if (silentInSomeQuestStages) {
    const contentDefect = uniqueStrings(entryGuards.flatMap(guard => guard.defects)).join('; ');
    const details = [incomplete || deferred ? 'partial closure' : '', contentDefect ? 'content defect' : ''].filter(Boolean).join('; ');
    return {
      classification: `silent in some quest stages${details ? ` (${details})` : ''}`,
      analysis: combined,
      contentDefect,
      outsideStageOutcome: questOutsideStageOutcome,
    };
  }

  const sharedOneLine = combined.chatSites.length === 1
    && combined.chatSites[0].literalText
    && !combined.chatSites[0].procedure.startsWith('p_choice')
    && !incomplete
    && !deferred
    && combined.genericOpcodeNames.every(name => genericSafeOpcodes.has(name))
    && (chatTypeUse.get(combined.chatSites[0].key)?.size ?? 0) > 1;
  if (sharedOneLine) return { classification: 'generic only (shared one-line handler)', analysis: combined, outsideStageOutcome: '' };
  if (combined.chatSites.length) {
    return {
      classification: incomplete || deferred ? 'ordinary dialogue (partial call/continuation closure)' : 'ordinary dialogue',
      analysis: combined,
      outsideStageOutcome: '',
    };
  }
  return { classification: `other handler response: ${otherResponseKind(combined)}`, analysis: combined, outsideStageOutcome: '' };
}

function mergeAnalyses(
  analyses: ScriptAnalysis[],
  scripts: ScriptFile[],
  chatSites: ScriptAnalysis['chatSites'],
  incomplete: boolean,
  deferred: boolean,
): ScriptAnalysis {
  return {
    scripts,
    chatSites,
    opcodeNames: uniqueStrings(analyses.flatMap(analysis => analysis.opcodeNames)),
    genericOpcodeNames: uniqueStrings(analyses.flatMap(analysis => analysis.genericOpcodeNames)),
    incomplete,
    deferredCalls: uniqueStrings(analyses.flatMap(analysis => analysis.deferredCalls)),
  };
}

function combineAnalyses(analyses: ScriptAnalysis[]): ScriptAnalysis {
  const scripts = [...new Map(analyses.flatMap(analysis => analysis.scripts).map(script => [script.id, script])).values()];
  const chatSites = [...new Map(analyses.flatMap(analysis => analysis.chatSites).map(site => [site.key, site])).values()];
  return mergeAnalyses(
    analyses,
    scripts,
    chatSites,
    analyses.some(analysis => analysis.incomplete),
    analyses.some(analysis => analysis.deferredCalls.length > 0),
  );
}

function priorityForOption(option: string, slot: number): { rank: number; bucket: string; basis: string } {
  const words = option.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matches = (items: string[]) => items.find(item => words.includes(item));
  const service = matches(['bank', 'trade', 'shop', 'travel', 'transport', 'sail', 'boat', 'charter', 'teleport', 'fly']);
  if (service) {
    const bucket = service === 'bank' ? 'bank option' : ['trade', 'shop'].includes(service) ? 'shop/trade option' : 'transport option';
    return { rank: 0, bucket, basis: `literal packed op${slot} label '${option}' contains '${service}'` };
  }
  const quest = matches(['quest']);
  if (quest) return { rank: 0, bucket: 'quest-start label candidate', basis: `literal packed op${slot} label '${option}' contains 'quest'` };
  return { rank: 1, bucket: 'other non-Attack option', basis: `literal packed op${slot} label '${option}'` };
}

function priorityForOptions(options: Array<string | null | undefined>): { rank: number; bucket: string; basis: string; option: string; slot: number } | null {
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (!option || option === 'Attack' || option === 'Talk-to' || option === 'hidden') continue;
    const priority = priorityForOption(option, index + 1);
    if (priority.rank === 0) return { ...priority, option, slot: index + 1 };
  }
  return null;
}

function getCategoryName(type: NpcType): string {
  if (type.category === -1) return '';
  return CategoryType.get(type.category)?.debugname ?? `category_${type.category}`;
}

function handlerReport(
  route: Route,
  contentRoot: string,
  analysisCache: Map<string, ScriptAnalysis>,
  npcType?: NpcType,
): ScriptAnalysis | null {
  if (!route.script) return null;
  return scriptAnalysis(route.script, contentRoot, analysisCache, npcType);
}

function exactStateRouteLabel(form: FormReport, slot: number, phase: 'ap' | 'op'): string {
  const rows = allRouteStates(form, slot);
  if (!rows.length) return 'no configured/dispatchable option';
  return rows
    .sort((left, right) => left.state.localeCompare(right.state))
    .map(dispatch => `${dispatch.state}: ${routeLabel(dispatch[phase])}`)
    .join(' | ');
}


function formatChatEvidence(analysis: ScriptAnalysis | null): string {
  if (!analysis) return '';
  return analysis.chatSites
    .map(site => `${site.source}:${site.line} -> ${site.procedure}`)
    .join(' | ');
}

function formatName(type: NpcType | undefined, id: number): string {
  if (!type) return `npc_${id}`;
  return type.debugname ?? `npc_${id}`;
}

function formatDisplay(type: NpcType | undefined): string {
  return type?.name ?? '';
}

function formatMapSquares(placements: MapNpcPlacement[]): string {
  return uniqueStrings(placements.map(placement => placement.mapFile)).sort(numericMapSquareCompare).join('; ');
}

function formatTile(placement: MapNpcPlacement): string {
  return `${placement.coord} (x=${placement.worldX},z=${placement.worldZ})`;
}

export async function runAudit(contentRootInput: string, outDirInput: string): Promise<void> {
  const contentRoot = path.resolve(contentRootInput);
  const outDir = path.resolve(outDirInput);
  assert(fs.existsSync(path.join(contentRoot, 'maps')), `missing content map directory: ${contentRoot}`);
  assert(fs.existsSync('data/pack/server/npc.dat'), 'missing built engine data/pack; run the final engine build first');
  fs.mkdirSync(outDir, { recursive: true });
  loadPackedConfigs('data/pack');
  assertSourceDeadNpcOptions();
  selfTestMissingOptions(outDir);
  const op1Spellings = new Map<string, number>();
  for (const type of NpcType.configs) {
    if (!type) continue;
    const spelling = type.op?.[0] || '<none>';
    op1Spellings.set(spelling, (op1Spellings.get(spelling) ?? 0) + 1);
  }
  const registry = await import(pathToFileURL(path.join(contentRoot, 'tests/quest-points/registry.mjs')).href) as {
    constants: Map<string, number>;
    quests: { fixture: [string, number][]; colours: { progress: string }[]; blocks: { condition: string }[] }[];
  };
  const stages: QuestStages = { terminals: new Map(), values: new Map(), constants: registry.constants };
  const ambiguousStages = new Set<string>();
  for (const quest of registry.quests) {
    if (quest.fixture.length !== 1) continue;
    const [variable, terminal] = quest.fixture[0];
    const direct = quest.colours.some(row => row.progress === `%${variable}`)
      || quest.blocks.some(row => new RegExp(`^%${variable} (?:=|>=) \\^\\w+$`).test(row.condition));
    if (!direct || ambiguousStages.has(variable)) continue;
    const previous = stages.terminals.get(variable);
    if (previous !== undefined && previous !== terminal) {
      stages.terminals.delete(variable);
      ambiguousStages.add(variable);
    } else {
      stages.terminals.set(variable, terminal);
    }
  }
  for (const [variable, terminal] of stages.terminals) stages.values.set(variable, new Set([0, terminal]));
  const sourceDirectories = [path.join(contentRoot, 'scripts')];
  while (sourceDirectories.length) {
    const directory = sourceDirectories.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) sourceDirectories.push(file);
      else if (entry.isFile() && entry.name.endsWith('.rs2')) {
        const source = fs.readFileSync(file, 'utf8').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*/g, text => text.replace(/[^\n]/g, ' '));
        for (const match of source.matchAll(/%(\w+)\s*=\s*(\^\w+|-?\d+)\s*;/g)) {
          const values = stages.values.get(match[1]);
          if (!values) continue;
          const value = match[2].startsWith('^') ? stages.constants.get(match[2].slice(1)) : Number(match[2]);
          if (value !== undefined && Number.isSafeInteger(value)) values.add(value);
        }
      }
    }
  }

  const scan = readMapNpcPlacements(contentRoot);
  const labels = readMapLabels(contentRoot);
  const areaForPlacement = new Map<MapNpcPlacement, Area>();
  for (const placement of scan.placements) areaForPlacement.set(placement, nearestArea(labels, placement.worldX, placement.worldZ, placement.mapFile));
  const placementsByRoot = new Map<number, MapNpcPlacement[]>();
  const missingNpcConfigs = new Set<number>();
  for (const placement of scan.placements) {
    const rows = placementsByRoot.get(placement.npcId) ?? [];
    rows.push(placement);
    placementsByRoot.set(placement.npcId, rows);
    if (!NpcType.get(placement.npcId)) missingNpcConfigs.add(placement.npcId);
  }
  const missingNpcConfigRoots = new Map<number, Set<number>>();
  for (const rootId of placementsByRoot.keys()) {
    const root = NpcType.get(rootId);
    if (!root) continue;
    for (const childId of root.multinpc) {
      if (childId < 0 || NpcType.get(childId)) continue;
      missingNpcConfigs.add(childId);
      const roots = missingNpcConfigRoots.get(childId) ?? new Set<number>();
      roots.add(rootId);
      missingNpcConfigRoots.set(childId, roots);
    }
  }

  const rootReports = new Map<number, Map<number, FormReport>>();
  const dispatchErrors: string[] = [];
  let nextNpcId = 1;
  for (const rootId of [...placementsByRoot.keys()].sort((a, b) => a - b)) {
    const root = NpcType.get(rootId);
    if (!root) continue;
    const forms = optionsForRoot(root, nextNpcId);
    nextNpcId += Math.max(1, npcFormStates(root).length);
    rootReports.set(rootId, forms);
    for (const form of forms.values()) {
      for (const [slot, stateRows] of form.dispatches) {
        for (const dispatch of stateRows.values()) {
          if (dispatch.ap.rule === 'Player dispatch (rule unresolved)' || dispatch.op.rule === 'Player dispatch (rule unresolved)') {
            dispatchErrors.push(`${rootId}/${form.visible.id}/op${slot}/${dispatch.state}`);
          }
        }
      }
    }
  }

  const talkEntries: { rootId: number; form: FormReport; talkSlot: number; routes: Route[]; area: string; placements: MapNpcPlacement[] }[] = [];
  const missingOptionEntries: (MissingOption & { rootId: number; form: FormReport; area: string; placements: MapNpcPlacement[] })[] = [];
  const byRootArea = new Map<number, Map<string, MapNpcPlacement[]>>();
  for (const [rootId, rootPlacements] of placementsByRoot) {
    const areas = new Map<string, MapNpcPlacement[]>();
    for (const placement of rootPlacements) {
      const area = areaForPlacement.get(placement)?.label ?? 'UNLABELED';
      const rows = areas.get(area) ?? [];
      rows.push(placement);
      areas.set(area, rows);
    }
    byRootArea.set(rootId, areas);

    const forms = rootReports.get(rootId);
    if (!forms) continue;
    for (const form of forms.values()) {
      const talkSlots = (form.visible.op ?? []).map((option, index) => isTalkOption(option) ? index + 1 : 0).filter(Boolean);
      const slotsToReport = talkSlots.length ? talkSlots : [0];
      for (const talkSlot of slotsToReport) {
        for (const [area, areaPlacements] of areas) {
          const routes = talkSlot === 0 ? [] : [...routeForState(form, talkSlot, 'ap'), ...routeForState(form, talkSlot, 'op')];
          talkEntries.push({ rootId, form, talkSlot, routes, area, placements: areaPlacements });
        }
      }

      for (const missing of missingOptionsForForm(form)) {
        for (const [area, areaPlacements] of areas) {
          missingOptionEntries.push({ ...missing, rootId, form, area, placements: areaPlacements });
        }
      }
    }
  }

  const analysisCache = new Map<string, ScriptAnalysis>();
  const chatTypeUse = new Map<string, Set<number>>();
  for (const entry of talkEntries) {
    for (const route of entry.routes) {
      const analysis = handlerReport(route, contentRoot, analysisCache, NpcType.get(entry.rootId));
      if (!analysis) continue;
      for (const site of analysis.chatSites) {
        const usedBy = chatTypeUse.get(site.key) ?? new Set<number>();
        usedBy.add(entry.form.visible.id);
        chatTypeUse.set(site.key, usedBy);
      }
    }
  }

  const rootAllMapSquares = new Map<number, string>();
  for (const [rootId, rootPlacements] of placementsByRoot) rootAllMapSquares.set(rootId, formatMapSquares(rootPlacements));

  const talkRows: Record<string, unknown>[] = [];
  for (const entry of talkEntries) {
    const root = NpcType.get(entry.rootId);
    const dispatchRoutes = entry.routes;
    const talkResult = entry.talkSlot === 0
      ? { classification: 'no Talk-to option (no client dispatch)', analysis: null, outsideStageOutcome: '', contentDefect: '' }
      : talkClassification(dispatchRoutes, contentRoot, analysisCache, chatTypeUse, stages, root!);
    const { classification, analysis, outsideStageOutcome, contentDefect = '' } = talkResult;
    const area = entry.area;
    const areaTiles = entry.placements.slice().sort((a, b) => numericMapSquareCompare(a.mapFile, b.mapFile) || a.line - b.line);
    const sample = areaTiles[0];
    const op1Option = entry.form.visible.op?.[0] ?? '';
    const op1Ap = exactStateRouteLabel(entry.form, 1, 'ap');
    const op1Op = exactStateRouteLabel(entry.form, 1, 'op');
    const servicePriority = priorityForOptions(entry.form.visible.op ?? []);
    const priority = classification === 'no handler (engine default refusal)'
      ? {
        rank: servicePriority?.rank === 0 ? 0 : 2,
        bucket: servicePriority ? `no Talk-to handler; ${servicePriority.bucket}` : 'no Talk-to handler; intent not inferable from absence',
        basis: servicePriority?.basis ?? 'no service/quest intent inferred from a blank dispatch',
      }
      : { rank: 3, bucket: classification, basis: classification };

    talkRows.push({
      placedTypeId: entry.rootId,
      placedInternalName: formatName(root, entry.rootId),
      placedDisplayName: formatDisplay(root),
      visibleTypeId: entry.form.visible.id,
      visibleInternalName: formatName(entry.form.visible, entry.form.visible.id),
      visibleDisplayName: formatDisplay(entry.form.visible),
      visibleStates: uniqueStrings(entry.form.states).join('; '),
      categoryId: entry.form.visible.category,
      categoryName: getCategoryName(entry.form.visible),
      talkSlot: entry.talkSlot,
      talkOption: entry.talkSlot ? entry.form.visible.op?.[entry.talkSlot - 1] ?? '' : '',
      ops: describeOps(entry.form.visible),
      op1Option,
      op1ApproachDispatch: op1Ap,
      op1OperationDispatch: op1Op,
      talkApproachDispatch: entry.talkSlot ? exactStateRouteLabel(entry.form, entry.talkSlot, 'ap') : 'not exposed by packed NPC options',
      talkOperationDispatch: entry.talkSlot ? exactStateRouteLabel(entry.form, entry.talkSlot, 'op') : 'not exposed by packed NPC options',
      outsideStageOutcome,
      classification,
      contentDefect,
      otherResponseKind: classification.startsWith('other handler response: ') ? classification.slice('other handler response: '.length) : '',
      chatHeadProcCount: analysis?.chatSites.length ?? 0,
      chatHeadProcNames: uniqueStrings(analysis?.chatSites.map(site => site.procedure) ?? []).join('; '),
      chatHeadProcEvidence: formatChatEvidence(analysis),
      unresolvedContinuationEdges: analysis?.deferredCalls.join('; ') ?? '',
      reachableOpcodes: analysis?.opcodeNames.join('; ') ?? '',
      staticClosureComplete: analysis ? !analysis.incomplete && !analysis.deferredCalls.length : true,
      area,
      nearestLabelDistanceTiles: sample ? areaForPlacement.get(sample)?.distance ?? '' : '',
      projectedZ: sample ? areaForPlacement.get(sample)?.projectedZ ?? '' : '',
      labelProjection: sample ? areaForPlacement.get(sample)?.projection ?? '' : '',
      nearestLabel: sample ? areaForPlacement.get(sample)?.nearestLabel ?? '' : '',
      placementCount: areaTiles.length,
      mapSquaresInArea: formatMapSquares(areaTiles),
      allMapSquaresForPlacedType: rootAllMapSquares.get(entry.rootId) ?? '',
      sampleTile: sample ? formatTile(sample) : '',
      priorityRank: priority.rank,
      priorityBucket: priority.bucket,
      priorityEvidence: priority.basis,
      serviceOption: servicePriority?.option ?? '',
      serviceOptionSlot: servicePriority?.slot ?? '',
    });
  }

  const missingOptionRows: Record<string, unknown>[] = missingOptionEntries.map(entry => {
    const root = NpcType.get(entry.rootId);
    const servicePriority = priorityForOptions(entry.form.visible.op ?? []);
    const optionPriority = servicePriority ?? priorityForOption(entry.option, entry.slot);
    const sourceDead = sourceDeadNpcOptionFor(entry.form.visible.id, entry.slot, entry.option);
    const triggers = [enumTrigger(`APNPC${entry.slot}`), enumTrigger(`OPNPC${entry.slot}`)];
    const categories = [...new Set([root.category, entry.form.visible.category])].filter(category => category !== -1);
    const categoryHandlerExists = categories.some(category => triggers.some(trigger => Boolean(ScriptProvider.getByTriggerSpecific(trigger, -1, category))));
    const globalHandlerExists = triggers.some(trigger => Boolean(ScriptProvider.getByTriggerSpecific(trigger)));
    const sample = entry.placements.slice().sort((a, b) => numericMapSquareCompare(a.mapFile, b.mapFile) || a.line - b.line)[0];
    return {
      placedTypeId: entry.rootId,
      placedInternalName: formatName(root, entry.rootId),
      placedDisplayName: formatDisplay(root),
      visibleTypeId: entry.form.visible.id,
      visibleInternalName: formatName(entry.form.visible, entry.form.visible.id),
      visibleDisplayName: formatDisplay(entry.form.visible),
      visibleStates: uniqueStrings(entry.form.states).join('; '),
      categoryId: entry.form.visible.category,
      categoryName: getCategoryName(entry.form.visible),
      optionSlot: entry.slot,
      optionText: entry.option,
      categoryHandlerExists,
      globalHandlerExists,
      categoryOrGlobalHandlerExists: categoryHandlerExists || globalHandlerExists,
      ops: describeOps(entry.form.visible),
      operationDispatch: entry.opRoutes.map(routeLabel).join(' | ') || 'none',
      approachDispatch: entry.apRoutes.map(routeLabel).join(' | ') || 'none',
      placementCount: entry.placements.length,
      area: entry.area,
      mapSquaresInArea: formatMapSquares(entry.placements),
      allMapSquaresForPlacedType: rootAllMapSquares.get(entry.rootId) ?? '',
      sampleTile: sample ? formatTile(sample) : '',
      priorityRank: optionPriority.rank,
      priorityBucket: optionPriority.bucket,
      priorityEvidence: optionPriority.basis,
      serviceOption: servicePriority?.option ?? '',
      serviceOptionSlot: servicePriority?.slot ?? '',
      sourceDisposition: sourceDead ? 'dead by source' : 'unknown gap',
      sourceIdentity: sourceDead?.sourceIdentity ?? '',
      sourceBasis: sourceDead?.basis ?? '',
    };
  });

  const handlerUsage = new Map<string, { trigger: ServerTriggerType; script: ScriptFile; forms: Set<number>; roots: Set<number>; placementKeys: Set<string>; rules: Set<string> }>();
  for (const entry of talkEntries) {
    const rows = allRouteStates(entry.form, entry.talkSlot);
    for (const dispatch of rows) {
      for (const route of [dispatch.ap, dispatch.op]) {
        if (!route.script) continue;
        const key = `${Number(route.trigger)}:${route.script.id}`;
        let usage = handlerUsage.get(key);
        if (!usage) {
          usage = { trigger: route.trigger, script: route.script, forms: new Set(), roots: new Set(), placementKeys: new Set(), rules: new Set() };
          handlerUsage.set(key, usage);
        }
        usage.forms.add(entry.form.visible.id);
        usage.roots.add(entry.rootId);
        usage.rules.add(route.rule);
        for (const placement of entry.placements) usage.placementKeys.add(`${placement.mapFile}:${placement.line}`);
      }
    }
  }

  const handlerRows: Record<string, unknown>[] = [...handlerUsage.values()].map(usage => {
    const analyses = [...usage.roots]
      .map(rootId => scriptAnalysis(usage.script, contentRoot, analysisCache, NpcType.get(rootId)));
    const analysis = combineAnalyses(analyses);
    const generic = analysis.chatSites.length === 1
      && analysis.chatSites[0].literalText
      && !analysis.chatSites[0].procedure.toLowerCase().startsWith('p_choice')
      && !analysis.incomplete
      && !analysis.deferredCalls.length
      && analysis.genericOpcodeNames.every(name => genericSafeOpcodes.has(name))
      && (chatTypeUse.get(analysis.chatSites[0].key)?.size ?? 0) > 1;
    return {
      trigger: ServerTriggerType[usage.trigger],
      scriptId: usage.script.id,
      scriptName: usage.script.name,
      source: handlerLine(usage.script),
      matchedRules: uniqueStrings(usage.rules).join('; '),
      classification: generic
        ? 'generic only (shared one-line handler)'
        : analysis.chatSites.length
          ? analysis.incomplete || analysis.deferredCalls.length ? 'ordinary dialogue (partial call/continuation closure)' : 'ordinary dialogue'
          : `other handler response: ${otherResponseKind(analysis)}`,
      npcTypeCount: usage.forms.size,
      placedTypeCount: usage.roots.size,
      placementCount: usage.placementKeys.size,
      chatHeadProcCount: analysis.chatSites.length,
      chatHeadProcNames: uniqueStrings(analysis.chatSites.map(site => site.procedure)).join('; '),
      chatHeadProcLiteralArguments: Boolean(analysis.chatSites.length && analysis.chatSites.every(site => site.literalText)),
      chatHeadProcEvidence: formatChatEvidence(analysis),
      unresolvedContinuationEdges: analysis.deferredCalls.join('; '),
      reachableOpcodes: analysis.opcodeNames.join('; '),
      staticClosureComplete: !analysis.incomplete && !analysis.deferredCalls.length,
    };
  }).sort((left, right) => String(left.trigger).localeCompare(String(right.trigger)) || Number(right.npcTypeCount) - Number(left.npcTypeCount) || String(left.scriptName).localeCompare(String(right.scriptName)));

  const defaultRows: Record<string, unknown>[] = [];
  const globalUsage = new Map<string, { forms: Set<number>; roots: Set<number>; placementKeys: Set<string> }>();
  for (const [rootId, forms] of rootReports) {
    const placements = placementsByRoot.get(rootId) ?? [];
    for (const form of forms.values()) {
      for (const stateRows of form.dispatches.values()) {
        for (const dispatch of stateRows.values()) {
          for (const route of [dispatch.ap, dispatch.op]) {
            if (!route.script || !route.rule.includes('default/global')) continue;
            const key = `${Number(route.trigger)}:${route.script.id}`;
            const usage = globalUsage.get(key) ?? { forms: new Set<number>(), roots: new Set<number>(), placementKeys: new Set<string>() };
            usage.forms.add(form.visible.id);
            usage.roots.add(rootId);
            for (const placement of placements) usage.placementKeys.add(`${placement.mapFile}:${placement.line}`);
          }
        }
      }
    }
  }
  for (let slot = 1; slot <= 5; slot++) {
    for (const phase of ['AP', 'OP'] as const) {
      const trigger = enumTrigger(`${phase}NPC${slot}`);
      const script = ScriptProvider.getByTriggerSpecific(trigger);
      const usage = script ? globalUsage.get(`${Number(trigger)}:${script.id}`) : undefined;
      const analysis = script
        ? combineAnalyses(usage
          ? [...usage.roots].map(rootId => scriptAnalysis(script, contentRoot, analysisCache, NpcType.get(rootId)))
          : [scriptAnalysis(script, contentRoot, analysisCache)])
        : null;
      defaultRows.push({
        trigger: ServerTriggerType[trigger],
        registeredGlobalScript: script ? script.name : 'none',
        source: script ? handlerLine(script) : 'none',
        classification: script
          ? analysis?.chatSites.length
            ? analysis.incomplete || analysis.deferredCalls.length
              ? 'global handler with dialogue (partial call/continuation closure)'
              : analysis.chatSites.length === 1
                ? 'one-chat-head global handler; inspect text/effects'
                : 'global handler with multiple chat heads'
            : analysis?.incomplete || analysis?.deferredCalls.length
              ? 'global handler with unresolved continuation'
              : 'global handler without observed chat-head dialogue'
          : phase === 'OP' ? 'engine default refusal' : 'engine default approach; no response',
        exampleResponse: script ? formatChatEvidence(analysis) : phase === 'OP' ? 'Nothing interesting happens.' : 'no chat output; approach range is cleared',
        unresolvedContinuationEdges: analysis?.deferredCalls.join('; ') ?? '',
        mappedNpcTypeCount: usage?.forms.size ?? 0,
        mappedPlacementCount: usage?.placementKeys.size ?? 0,
      });
    }
  }

  talkRows.sort((left, right) => Number(left.priorityRank) - Number(right.priorityRank)
    || String(left.area).localeCompare(String(right.area))
    || Number(right.placementCount) - Number(left.placementCount)
    || Number(left.placedTypeId) - Number(right.placedTypeId)
    || Number(left.visibleTypeId) - Number(right.visibleTypeId));
  missingOptionRows.sort((left, right) => Number(left.priorityRank) - Number(right.priorityRank)
    || String(left.area).localeCompare(String(right.area))
    || Number(right.placementCount) - Number(left.placementCount)
    || Number(left.visibleTypeId) - Number(right.visibleTypeId));
  const sourceDeadOptionRows = missingOptionRows.filter(row => row.sourceDisposition === 'dead by source');
  const unknownMissingOptionRows = missingOptionRows.filter(row => row.sourceDisposition !== 'dead by source');

  const namesByPlacements = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
    const nameGroups = new Map<string, {
      placedTypeIds: Set<number>;
      visibleTypeIds: Set<number>;
      areas: Set<string>;
      placements: Map<string, MapNpcPlacement>;
    }>();
    for (const row of rows) {
      const displayName = String(row.visibleDisplayName ?? '');
      const rootId = Number(row.placedTypeId);
      const area = String(row.area);
      const group = nameGroups.get(displayName) ?? {
        placedTypeIds: new Set<number>(),
        visibleTypeIds: new Set<number>(),
        areas: new Set<string>(),
        placements: new Map<string, MapNpcPlacement>(),
      };
      group.placedTypeIds.add(rootId);
      group.visibleTypeIds.add(Number(row.visibleTypeId));
      group.areas.add(area);
      for (const placement of placementsByRoot.get(rootId) ?? []) {
        if (areaForPlacement.get(placement)?.label !== area) continue;
        group.placements.set(`${placement.mapFile}:${placement.line}`, placement);
      }
      nameGroups.set(displayName, group);
    }
    return [...nameGroups.entries()].map(([displayName, group]) => {
      const placements = [...group.placements.values()].sort((left, right) => numericMapSquareCompare(left.mapFile, right.mapFile) || left.line - right.line);
      const firstTileByArea = new Map<string, string>();
      for (const placement of placements) {
        const area = areaForPlacement.get(placement)?.label ?? '';
        if (!firstTileByArea.has(area)) firstTileByArea.set(area, formatTile(placement));
      }
      return {
        visibleDisplayName: displayName,
        spawnCount: placements.length,
        visibleTypeIds: [...group.visibleTypeIds].sort((left, right) => left - right).join('; '),
        placedTypeIds: [...group.placedTypeIds].sort((left, right) => left - right).join('; '),
        areas: [...group.areas].sort((left, right) => left.localeCompare(right)).join('; '),
        mapSquares: formatMapSquares(placements),
        sampleTiles: [...firstTileByArea.values()].join('; '),
      };
    })
    .sort((left, right) => Number(right.spawnCount) - Number(left.spawnCount)
      || String(left.visibleDisplayName).localeCompare(String(right.visibleDisplayName)));
  };
  const noHandlerByNameRows = namesByPlacements(talkRows.filter(row => row.classification === 'no handler (engine default refusal)'));
  const otherResponseRows = talkRows.filter(row => row.otherResponseKind);
  const noResponseByNameRows: Record<string, unknown>[] = [
    ...noHandlerByNameRows.map(row => ({ ...row, responseKind: 'no handler' })),
    ...namesByPlacements(otherResponseRows.filter(row => row.otherResponseKind === 'handler that only returns'))
      .map(row => ({ ...row, responseKind: 'handler that only returns' })),
  ];
  noResponseByNameRows.sort((left, right) => Number(right.spawnCount) - Number(left.spawnCount)
    || String(left.visibleDisplayName).localeCompare(String(right.visibleDisplayName))
    || String(left.responseKind).localeCompare(String(right.responseKind)));

  const spawnRows: Record<string, unknown>[] = scan.placements.map(placement => {
    const root = NpcType.get(placement.npcId);
    const area = areaForPlacement.get(placement)!;
    const forms = rootReports.get(placement.npcId);
    const visibleForms = [...(forms?.values() ?? [])]
      .map(form => `${form.visible.id}:${formatName(form.visible, form.visible.id)} [${formatDisplay(form.visible)}]`)
      .sort();
    return {
      mapFile: placement.mapFile,
      sourceLine: placement.line,
      regionX: placement.regionX,
      regionZ: placement.regionZ,
      plane: placement.plane,
      localX: placement.localX,
      localZ: placement.localZ,
      worldX: placement.worldX,
      worldZ: placement.worldZ,
      cacheCoord: placement.coord,
      placedTypeId: placement.npcId,
      placedInternalName: formatName(root, placement.npcId),
      placedDisplayName: formatDisplay(root),
      categoryId: root?.category ?? '',
      categoryName: root ? getCategoryName(root) : '',
      possibleVisibleForms: visibleForms.join('; '),
      nearestAreaLabel: area.label,
      projectedZ: area.projectedZ,
      labelProjection: area.projection,
      nearestLabel: area.nearestLabel,
      nearestLabelDistanceTiles: area.distance ?? '',
    };
  });

  const areaSummary = new Map<string, {
    spawnKeys: Set<string>;
    mapSquares: Set<string>;
    roots: Set<number>;
    talkRows: Record<string, unknown>[];
    missingOptions: Record<string, unknown>[];
  }>();
  for (const placement of scan.placements) {
    const area = areaForPlacement.get(placement)!.label;
    const summary = areaSummary.get(area) ?? { spawnKeys: new Set<string>(), mapSquares: new Set<string>(), roots: new Set<number>(), talkRows: [], missingOptions: [] };
    summary.spawnKeys.add(`${placement.mapFile}:${placement.line}`);
    summary.mapSquares.add(placement.mapFile);
    summary.roots.add(placement.npcId);
    areaSummary.set(area, summary);
  }
  for (const row of talkRows) {
    const area = String(row.area);
    const summary = areaSummary.get(area) ?? { spawnKeys: new Set<string>(), mapSquares: new Set<string>(), roots: new Set<number>(), talkRows: [], missingOptions: [] };
    summary.talkRows.push(row);
    areaSummary.set(area, summary);
  }
  for (const row of missingOptionRows) {
    const area = String(row.area);
    const summary = areaSummary.get(area) ?? { spawnKeys: new Set<string>(), mapSquares: new Set<string>(), roots: new Set<number>(), talkRows: [], missingOptions: [] };
    summary.missingOptions.push(row);
    areaSummary.set(area, summary);
  }
  const areaRows: Record<string, unknown>[] = [...areaSummary.entries()].map(([area, summary]) => ({
    area,
    mapSquares: [...summary.mapSquares].sort(numericMapSquareCompare).join('; '),
    spawnCount: summary.spawnKeys.size,
    placedNpcTypeCount: summary.roots.size,
    talkFormAreaRows: summary.talkRows.length,
    noTalkHandlerFormPlacements: summary.talkRows.filter(row => row.classification === 'no handler (engine default refusal)').reduce((sum, row) => sum + Number(row.placementCount), 0),
    noTalkOptionFormPlacements: summary.talkRows.filter(row => row.classification === 'no Talk-to option (no client dispatch)').reduce((sum, row) => sum + Number(row.placementCount), 0),
    genericOnlyFormPlacements: summary.talkRows.filter(row => String(row.classification).startsWith('generic only')).reduce((sum, row) => sum + Number(row.placementCount), 0),
    silentQuestStageFormPlacements: summary.talkRows.filter(row => String(row.classification).startsWith('silent in some quest stages')).reduce((sum, row) => sum + Number(row.placementCount), 0),
    ordinaryDialogueFormPlacements: summary.talkRows.filter(row => /^(?:ordinary dialogue|generic only)/.test(String(row.classification))).reduce((sum, row) => sum + Number(row.placementCount), 0),
    missingOptionFormPlacements: summary.missingOptions.reduce((sum, row) => sum + Number(row.placementCount), 0),
    sourceDeadOptionFormPlacements: summary.missingOptions.filter(row => row.sourceDisposition === 'dead by source').reduce((sum, row) => sum + Number(row.placementCount), 0),
    unknownMissingOptionFormPlacements: summary.missingOptions.filter(row => row.sourceDisposition !== 'dead by source').reduce((sum, row) => sum + Number(row.placementCount), 0),
    unresolvedContinuationFormPlacements: summary.talkRows.filter(row => Boolean(row.unresolvedContinuationEdges)).reduce((sum, row) => sum + Number(row.placementCount), 0),
  })).sort((left, right) => String(left.area).localeCompare(String(right.area))
    || Number(right.spawnCount) - Number(left.spawnCount));

  const missingConfigsRows = [...missingNpcConfigs].sort((a, b) => a - b).map(id => ({
    npcConfigId: id,
    placementCount: placementsByRoot.get(id)?.length ?? 0,
    referencedByPlacedTypeIds: uniqueStrings([...(missingNpcConfigRoots.get(id) ?? [])].map(String)).join('; '),
    mapSquares: formatMapSquares(placementsByRoot.get(id) ?? []),
  }));

  const topServiceGaps = missingOptionRows
    .filter(row => Number(row.priorityRank) === 0 && row.sourceDisposition !== 'dead by source')
    .map(row => ({
      ...row,
      missingRoute: `op${row.optionSlot} (no AP/OP handler)`,
      missingOption: String(row.optionText),
    }))
    .sort((left, right) => Number(left.priorityRank) - Number(right.priorityRank)
      || Number(right.placementCount) - Number(left.placementCount)
      || String(left.area).localeCompare(String(right.area))
      || String(left.placedInternalName).localeCompare(String(right.placedInternalName)))
    .slice(0, 25);

  writeCsv(outDir, 'audit-npc-spawns.csv', [
    'mapFile', 'sourceLine', 'regionX', 'regionZ', 'plane', 'localX', 'localZ', 'worldX', 'worldZ', 'cacheCoord',
    'placedTypeId', 'placedInternalName', 'placedDisplayName', 'categoryId', 'categoryName', 'possibleVisibleForms',
    'nearestAreaLabel', 'nearestLabelDistanceTiles', 'projectedZ', 'labelProjection', 'nearestLabel',
  ], spawnRows);
  writeCsv(outDir, 'audit-npc-talk.csv', [
    'placedTypeId', 'placedInternalName', 'placedDisplayName', 'visibleTypeId', 'visibleInternalName', 'visibleDisplayName',
    'visibleStates', 'categoryId', 'categoryName', 'talkSlot', 'talkOption', 'ops', 'op1Option', 'op1ApproachDispatch', 'op1OperationDispatch',
    'talkApproachDispatch', 'talkOperationDispatch', 'outsideStageOutcome', 'classification', 'contentDefect', 'otherResponseKind', 'chatHeadProcCount',
    'chatHeadProcNames', 'chatHeadProcEvidence', 'unresolvedContinuationEdges',
    'reachableOpcodes', 'staticClosureComplete', 'area', 'nearestLabelDistanceTiles', 'projectedZ', 'labelProjection', 'nearestLabel', 'placementCount', 'mapSquaresInArea',
    'allMapSquaresForPlacedType', 'sampleTile', 'priorityRank', 'priorityBucket', 'priorityEvidence', 'serviceOption',
    'serviceOptionSlot',
  ], talkRows);
  writeCsv(outDir, 'audit-npc-options-missing.csv', [
    'placedTypeId', 'placedInternalName', 'placedDisplayName', 'visibleTypeId', 'visibleInternalName', 'visibleDisplayName',
    'visibleStates', 'categoryId', 'categoryName', 'optionSlot', 'optionText', 'ops', 'operationDispatch', 'approachDispatch',
    'categoryHandlerExists', 'globalHandlerExists', 'categoryOrGlobalHandlerExists',
    'placementCount', 'area', 'mapSquaresInArea', 'allMapSquaresForPlacedType', 'sampleTile', 'priorityRank',
    'priorityBucket', 'priorityEvidence', 'sourceDisposition', 'sourceIdentity', 'sourceBasis',
  ], missingOptionRows);
  writeCsv(outDir, 'audit-npc-options-dead-by-source.csv', [
    'placedTypeId', 'placedInternalName', 'visibleTypeId', 'visibleDisplayName', 'optionSlot', 'optionText',
    'placementCount', 'area', 'mapSquaresInArea', 'sampleTile', 'sourceIdentity', 'sourceBasis',
  ], sourceDeadOptionRows);
  writeCsv(outDir, 'audit-npc-area-summary.csv', [
    'area', 'mapSquares', 'spawnCount', 'placedNpcTypeCount', 'talkFormAreaRows', 'noTalkHandlerFormPlacements',
    'genericOnlyFormPlacements', 'silentQuestStageFormPlacements', 'ordinaryDialogueFormPlacements', 'missingOptionFormPlacements',
    'noTalkOptionFormPlacements',
    'unresolvedContinuationFormPlacements',
  ], areaRows);
  writeCsv(outDir, 'audit-npc-no-handler-by-name.csv', [
    'visibleDisplayName', 'spawnCount', 'responseKind', 'visibleTypeIds', 'placedTypeIds', 'areas', 'mapSquares', 'sampleTiles',
  ], noResponseByNameRows);
  writeCsv(outDir, 'audit-npc-other-responses.csv', [
    'placedTypeId', 'placedInternalName', 'visibleTypeId', 'visibleInternalName', 'visibleDisplayName',
    'area', 'placementCount', 'otherResponseKind', 'talkApproachDispatch', 'talkOperationDispatch',
    'reachableOpcodes', 'staticClosureComplete', 'unresolvedContinuationEdges', 'mapSquaresInArea', 'sampleTile',
  ], otherResponseRows);
  writeCsv(outDir, 'audit-npc-content-defects.csv', [
    'placedTypeId', 'visibleTypeId', 'visibleDisplayName', 'classification', 'contentDefect',
    'area', 'placementCount', 'mapSquaresInArea', 'sampleTile',
  ], talkRows.filter(row => Boolean(row.contentDefect)));
  writeCsv(outDir, 'audit-npc-service-gaps.csv', [
    'missingRoute', 'missingOption', 'serviceOption', 'serviceOptionSlot', 'priorityBucket', 'priorityEvidence',
    'placedTypeId', 'placedInternalName', 'placedDisplayName', 'visibleTypeId', 'visibleDisplayName',
    'area', 'placementCount', 'mapSquaresInArea', 'allMapSquaresForPlacedType', 'sampleTile',
  ], topServiceGaps);
  writeCsv(outDir, 'audit-npc-handlers.csv', [
    'trigger', 'scriptId', 'scriptName', 'source', 'matchedRules', 'classification', 'npcTypeCount', 'placedTypeCount',
    'placementCount', 'chatHeadProcCount', 'chatHeadProcNames', 'chatHeadProcLiteralArguments', 'chatHeadProcEvidence',
    'reachableOpcodes', 'staticClosureComplete', 'unresolvedContinuationEdges',
  ], handlerRows);
  writeCsv(outDir, 'audit-npc-defaults.csv', [
    'trigger', 'registeredGlobalScript', 'source', 'classification', 'exampleResponse', 'mappedNpcTypeCount', 'mappedPlacementCount',
    'unresolvedContinuationEdges',
  ], defaultRows);
  writeCsv(outDir, 'audit-npc-unresolved.csv', ['npcConfigId', 'placementCount', 'referencedByPlacedTypeIds', 'mapSquares'], missingConfigsRows);

  const countsByClassification = Object.fromEntries([...new Set(talkRows.map(row => String(row.classification)))].sort().map(classification => [
    classification,
    talkRows.filter(row => row.classification === classification).length,
  ]));
  const manifest = {
    title: 'Compiled NPC placement and Talk-to dispatch census',
    input: {
      mapsDirectory: 'maps/',
      builtPackDirectory: 'engine/data/pack/',
      mapFilesRead: scan.mapFiles.length,
      mapNpcSections: scan.npcSections,
      mapFilesWithoutNpcSection: scan.mapFilesWithoutNpcSection.length,
      mapFilesWithoutNpcSectionFiles: scan.mapFilesWithoutNpcSection,
      placedNpcInstances: scan.placements.length,
      distinctPlacedNpcConfigIds: placementsByRoot.size,
      distinctTalkFormAreaRows: talkRows.length,
      packedOp1Spellings: [...op1Spellings].sort(([left], [right]) => left.localeCompare(right)).map(([optionText, configCount]) => ({ optionText, configCount })),
      missingOptionRows: missingOptionRows.length,
      missingOptionFormPlacements: missingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
      missingNonTalkOp1Forms: new Set(missingOptionRows.filter(row => Number(row.optionSlot) === 1 && !isTalkOption(String(row.optionText))).map(row => `${row.placedTypeId}:${row.visibleTypeId}`)).size,
      missingNonTalkOp1FormPlacements: missingOptionRows.filter(row => Number(row.optionSlot) === 1 && !isTalkOption(String(row.optionText))).reduce((sum, row) => sum + Number(row.placementCount), 0),
      sourceDeadOptionRows: sourceDeadOptionRows.length,
      sourceDeadOptionFormPlacements: sourceDeadOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
      unknownMissingOptionRows: unknownMissingOptionRows.length,
      unknownMissingOptionFormPlacements: unknownMissingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
      unresolvedNpcConfigIds: missingConfigsRows,
      malformedMapNpcRows: scan.malformedRows,
      dispatchRuleConflicts: dispatchErrors,
      scriptCompilerVersion: ScriptProvider.COMPILER_VERSION,
    },
    optionDispositions: {
      sourceDeadExceptions: SOURCE_DEAD_NPC_OPTIONS,
      rawMissingOptionRows: missingOptionRows.length,
      rawMissingOptionFormPlacements: missingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
      sourceDeadRows: sourceDeadOptionRows.length,
      sourceDeadOptionFormPlacements: sourceDeadOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
      unknownGapRows: unknownMissingOptionRows.length,
      unknownGapOptionFormPlacements: unknownMissingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0),
    },
    classifications: countsByClassification,
    dispatch: {
      sourceHandler: 'OpNpcHandler.handle -> Player.getApTrigger/getOpTrigger -> ScriptProvider.getByTrigger',
      lookupOrder: ['exact NPC type', 'category', 'global/default'],
      multiFormFallback: 'observed through Player.getApTrigger/getOpTrigger; parent rule recorded when returned by Player dispatch',
      sourceEvidence: [
        'engine/src/network/game/client/handler/OpNpcHandler.ts:40-51',
        'engine/src/engine/entity/Player.ts:1077-1116',
        'engine/src/engine/script/ScriptProvider.ts:113-134',
        'engine/src/engine/entity/Player.ts:1213-1237,1313-1322',
      ],
    },
    areaMethod: {
      surfaceLabels: 'maps/labels.txt; trailing field ignored because its meaning is not established',
      undergroundProjection: 'subtract 6400 from z once; label a nearby surface coordinate with (below)',
      projectionSource: 'scripts/ladders+stairs/scripts/ladders.rs2:86-97; paired 1754/1755 map placements',
      maxLabelDistanceTiles: MAX_LABEL_DISTANCE_TILES,
      radiusStatus: 'UNKNOWN engineering grouping radius, not a place boundary',
      farOrMissingLabel: 'unlabelled (actual map square)',
      mapSquares: 'retained on every placement, grouped talk/option row, name list and area row',
    },
    talkClassificationMethod: [
      'Talk spellings: the built pack contains Talk-to, Talk-To, Talk and Talk to. Case and whitespace separators are normalised by one shared predicate.',
      'No handler: actual Player AP and OP dispatch both return no ScriptFile; the engine fallback is reported separately.',
      'No Talk-to option: the packed visible form has no Talk-to action, so no player dispatch or default refusal is inferred.',
      'Silent in some quest stages requires a source entry-stage guard with no outside dialogue branch; the guard and silent outcome are retained. Quest-directory membership alone is not a stage guard. Identical alternatives shadowed within an else-if chain are recorded as content defects, not fixed.',
      'Generic only: one literal chat-head call site shared by multiple visible types, with a complete closure and no non-text/control effects outside the chat-head implementation.',
      'Ordinary dialogue: the compiled closure reaches the chat-head procedures and variants in scripts/interface_chat/scripts/chat.rs2; this establishes dialogue presence, not every quest-state branch.',
      'Other handler response: a present handler without an observed chat-head path, subdivided into return-only, message-only, opens an interface, or other. Unresolved closure stays explicit; this is not forced into the three area counts.',
      'Direct GOSUB/JUMP and recoverable queue/timer targets contribute to closure. Unresolved targets and handlers without an observed chat-head path remain explicit.',
    ],
    priorityMethod: {
      highPriority: 'A missing non-Attack option in any slot with a literal bank/shop/trade/transport/quest token in any packed option; the missing route, service option and matched token are retained.',
      questIntentLimit: 'No quest-start role is inferred from NPC names or an absent handler. A blank Talk-to dispatch alone cannot identify a quest starter.',
      topExplicitServiceGaps: topServiceGaps,
    },
    outputs: [
      'audit-npc-spawns.csv',
      'audit-npc-talk.csv',
      'audit-npc-options-missing.csv',
      'audit-npc-area-summary.csv',
      'audit-npc-no-handler-by-name.csv',
      'audit-npc-other-responses.csv',
      'audit-npc-content-defects.csv',
      'audit-npc-service-gaps.csv',
      'audit-npc-handlers.csv',
      'audit-npc-defaults.csv',
      'audit-npc-unresolved.csv',
      'audit-npc-options-dead-by-source.csv',
      'audit-npc-talk.json',
      'audit-npc-talk.md',
    ],
    limits: [
      'Chat-head call sites are structural evidence, not proof of every state branch or wording authenticity. Ordinary-dialogue classification means presence in the closure, not an unconditional answer in every state.',
      'GOSUB/JUMP, WALKTRIGGER, NPC_QUEUE, NPC_SETTIMER and recoverable queue/timer calls contribute to closure; dynamic targets remain explicit and queued behavior is not executed.',
      'Each placed root type is resolved across packed multinpc selector slots; quest state and other player varps are not exhaustively explored.',
      'Silent in some quest stages is a structural inference for simple complete entry guards on a canonical stage variable, with an answering and a silent state among new-player zero, registry completion or literal assignments in the checked-out RuneScript. No hypothetical intermediate stage is added. Unsupported or deeper guards remain dialogue-presence results; ordinary does not assert unconditional availability.',
      'Map labels are bounded nearest-coordinate annotations. Below labels use one conventional -6400 z projection; far or unmatched rows retain the actual map square without an invented place name.',
      'Only the checked-out maps/*.jm2 placements and matching final built pack are in scope; dynamic spawns and instanced runtime NPCs are excluded.',
    ],
  };
  fs.writeFileSync(path.join(outDir, 'audit-npc-talk.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const classificationLines = Object.entries(countsByClassification).map(([name, count]) => `- ${name}: ${count} placed-form/area rows`).join('\n');
  const serviceLines = topServiceGaps.length
    ? topServiceGaps.map(row => `- ${row.area}: ${row.visibleDisplayName || row.placedInternalName} (${row.visibleTypeId}), missing ${row.missingOption}; service op${row.serviceOptionSlot} '${row.serviceOption}', ${row.placementCount} form placements; ${row.priorityEvidence}.`).join('\n')
    : '- No missing non-Attack option with an explicit packed service option was found.';
  const sourceDeadLines = sourceDeadOptionRows.length
    ? sourceDeadOptionRows.map(row => `- ${String(row.visibleDisplayName)} (${String(row.visibleTypeId)}), slot ${String(row.optionSlot)} ${String(row.optionText)}: ${String(row.sourceBasis)} Source: ${String(row.sourceIdentity)}.`).join('\n')
    : '- No source-dead options matched the current census.';
  const globalLines = defaultRows.map(row => `- ${row.trigger}: ${row.registeredGlobalScript}; ${row.classification}; ${row.exampleResponse || 'no literal response recorded'}`).join('\n');
  const report = [
    '# Compiled NPC Talk-to audit',
    '',
    '## Explicitly evidenced service gaps first',
    '',
    serviceLines,
    '',
    'Priority uses literal service labels in all packed options. A quest-start role is not guessed from an NPC name or absent dispatch.',
    '',
    '## Coverage',
    '',
    `Read ${scan.mapFiles.length} map squares, ${scan.npcSections} with an NPC section, and ${scan.placements.length} placed NPC rows across ${placementsByRoot.size} distinct placed config ids. ${missingConfigsRows.length} placed config ids are unresolved in the built pack.`,
    '',
    'The complete placement inventory is `audit-npc-spawns.csv`. `audit-npc-talk.csv` retains every root/form and area, actual map squares, the sample tile, visible operations, AP/OP dispatch and unresolved continuations. `audit-npc-options-missing.csv` is the single gap inventory for every exposed non-Attack option in slots 1–5, including Talk variants. A gap requires both AP and OP routes to lack a script. Category/global-handler checks are explicit columns.',
    '',
    '## Talk classifications',
    '',
    classificationLines || '- No placed Talk-to forms.',
    '',
    '## Dead by source',
    '',
    'This separate classification covers only exact registered type/slot/text matches. The complete raw no-handler inventory remains in `audit-npc-options-missing.csv`; its original missing-option totals are unchanged, with source-dead rows distinguished from the residual unknown gaps by `sourceDisposition`. The source-dead subset is also written to `audit-npc-options-dead-by-source.csv`.',
    '',
    `Raw missing-option rows/form placements: ${missingOptionRows.length}/${missingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0)}. Source-dead: ${sourceDeadOptionRows.length}/${sourceDeadOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0)}. Residual unknown gaps: ${unknownMissingOptionRows.length}/${unknownMissingOptionRows.reduce((sum, row) => sum + Number(row.placementCount), 0)}.`,
    '',
    sourceDeadLines,
    '',
    'The runtime fallback for a missing operation handler is `Nothing interesting happens.` from `Player.defaultOp`; the no-approach-handler phase itself produces no chat. Compiled global AP/OP handlers and these engine fallbacks are listed in `audit-npc-defaults.csv`.',
    '',
    '## Per-area triage',
    '',
    '| Map-label group | No handler | Silent in some quest stages | Ordinary dialogue |',
    '| --- | ---: | ---: | ---: |',
    ...areaRows.map(row => `| ${String(row.area).replaceAll('|', '/')} | ${row.noTalkHandlerFormPlacements} | ${row.silentQuestStageFormPlacements} | ${row.ordinaryDialogueFormPlacements} |`),
    '',
    'Counts are placed-form occurrences, not necessarily simultaneous NPCs. Ordinary includes the separately marked generic-only subtype. No-Talk-to forms and other handler responses are not forced into these three columns. Nearest labels are annotations, not town boundaries.',
    '',
    '## Other handler responses and silent names',
    '',
    '`audit-npc-other-responses.csv` separates return-only handlers, message-only replies, interface openers and other effects. Each row retains actual dispatch and closure completeness. An unresolved continuation is not proof that no later dialogue exists.',
    '',
    '`audit-npc-no-handler-by-name.csv` counts return-only handlers beside absent handlers, sorted by physical placement count and distinguished by response kind. Each name deduplicates map-file/source-line placements across forms and areas. The Talk CSV retains the strict absent-dispatch classification separately.',
    '',
    '## Source content defects',
    '',
    '`audit-npc-content-defects.csv` records shadowed source branches without changing gameplay. Silence can occur during a quest as well as before it.',
    ...talkRows.filter(row => Boolean(row.contentDefect)).map(row => `- ${row.visibleDisplayName} (${row.visibleTypeId}): ${row.contentDefect}.`),
    '',
    '## Default handlers',
    '',
    globalLines,
    '',
    '## Method and limits',
    '',
    '- Source placement dispatch is observed by calling production `OpNpcHandler.handle`, then `Player.getApTrigger()` and `Player.getOpTrigger()` on each packed visible NPC form; those Player methods own exact/category/global lookup and parent-form fallback.',
    '- Dialogue presence follows compiled calls to the chat-head procedures in `scripts/interface_chat/scripts/chat.rs2`, including direct label jumps and recoverable continuations. Ordinary means a dialogue path exists in the closure, not that every quest state answers.',
    `- Surface labels are used only within ${MAX_LABEL_DISTANCE_TILES} tiles. Conventional underground rows project z - ${UNDERGROUND_Z_OFFSET} and add (below). Other rows read unlabelled (their map square). This UNKNOWN engineering radius does not define a town boundary.`,
    '- The up-to-ten-witness runtime command is `bash tests/npc-talk-audit/runtime.sh <engine-dir> [content-root]`. It selects only current gaps and passes with fewer or none, calls production OpNpcHandler, checks absent AP/OP routes, then records production Player.defaultOp response packets.',
    '- Dynamic continuation targets, dynamic spawns, instanced runtime NPCs, and text authenticity are not proven by this census; unresolved continuation edges are listed instead of omitted.',
    '',
    '## Output files',
    '',
    manifest.outputs.map(file => `- ${file}`).join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'audit-npc-talk.md'), report);

  console.log(`AUDIT maps=${scan.mapFiles.length} npcSections=${scan.npcSections} placements=${scan.placements.length} placedTypes=${placementsByRoot.size} talkRows=${talkRows.length} missingOptions=${missingOptionRows.length} unresolvedConfigs=${missingConfigsRows.length}`);
  console.log(`AUDIT outputs=${manifest.outputs.join(',')}`);
  if (scan.malformedRows.length || dispatchErrors.length || missingConfigsRows.length) {
    throw new Error(`audit is partial: malformed map rows=${scan.malformedRows.length}, unresolved dispatch rules=${dispatchErrors.length}, missing NPC configs=${missingConfigsRows.length}`);
  }
}
