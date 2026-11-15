#!/usr/bin/env node
// Compile the current shared scripts plus test-only tuple consumers. No source,
// name map or pack in either checked-out repository is modified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const output = process.argv[2];
if (!output || !fs.statSync(output).isDirectory()) throw new Error('Pass an existing temporary output directory');
const temporaryContent = path.join(output, 'content');
const temporaryEngine = path.join(output, 'engine');
fs.mkdirSync(temporaryContent);
fs.mkdirSync(temporaryEngine);
fs.cpSync(path.join(content, 'scripts'), path.join(temporaryContent, 'scripts'), { recursive: true, preserveTimestamps: true });
fs.cpSync(path.join(content, 'pack'), path.join(temporaryContent, 'pack'), { recursive: true, preserveTimestamps: true });
fs.copyFileSync(path.join(here, 'outcome_callers.rs2'), path.join(temporaryContent, 'scripts/skill_combat/scripts/npc/bc00_test_callers.rs2'));
fs.cpSync(path.join(engine, 'data/pack'), path.join(temporaryEngine, 'data/pack'), { recursive: true, preserveTimestamps: true });
for (const name of ['script.dat', 'script.idx']) fs.rmSync(path.join(temporaryEngine, 'data/pack/server', name));
process.env.BUILD_SRC_DIR = temporaryContent;
process.env.BUILD_VERIFY = 'false';
process.chdir(temporaryEngine);
const { ScriptPack } = await import(pathToFileURL(path.join(engine, 'tools/pack/PackFile.ts')).href);
ScriptPack.reload();
const { runServerCompiler } = await import(pathToFileURL(path.join(engine, 'tools/pack/Compiler.ts')).href);
await runServerCompiler();
for (const name of ['script.dat', 'script.idx']) {
  const file = path.join(temporaryEngine, 'data/pack/server', name);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`Missing compiled ${name}`);
}
console.log('PASS test-only callers compiled with the current shared scripts');
