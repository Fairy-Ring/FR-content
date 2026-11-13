import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectUnsupportedCharacters, scanContent } from './check_string_charset.mjs';

const detect = (source, file = 'example.rs2') => detectUnsupportedCharacters(source, file);
const points = (source, file) => detect(source, file).map(hit => hit.codePoint);

test('checks outer and recursively nested interpolation literals, not expression text', () => {
  assert.deepEqual(points('mes("outer… <text_gender("m…n", "women")> end—");'), [0x2026, 0x2026, 0x2014]);
  assert.deepEqual(points('mes("<f("a")…>");'), []);
  assert.deepEqual(points('mes("<f("inner <g("…")>")>");'), [0x2026]);
  assert.deepEqual(points('mes("<f(1 >= 0, "…")>");'), [0x2026]);
});

test('comments are hidden only in expression/code mode; block comments do not nest', () => {
  assert.deepEqual(points('/* mes("…"); */\nmes("ok"); // mes("…");\n// …'), []);
  assert.deepEqual(points('mes("http://example/… /* … */");'), [0x2026, 0x2026]);
  assert.deepEqual(points('/* outer /* inner */ mes("…"); */'), [0x2026]);
  assert.deepEqual(points('mes("<f(/* "…" */ "…" // "…"\n)> end…");'), [0x2026, 0x2026]);
});

test('compiler string escapes are backslash, quote and less-than, not Unicode escapes', () => {
  assert.deepEqual(points(String.raw`mes("escaped \"…\" end");`), [0x2026]);
  assert.deepEqual(points(String.raw`mes("\\")…;`), []);
  assert.deepEqual(points(String.raw`mes("\<…");`), [0x2026]);
  assert.deepEqual(points(String.raw`mes("\u2026");`), []);
  assert.deepEqual(points(`mes('"'); mes("…");`), [0x2026]);
});

test('newlines are compiler errors, but do not exit its string mode', () => {
  const hits = detect('mes("start\r\n… still");\nmes("—");');
  assert.deepEqual(hits.map(hit => [hit.line, hit.codePoint]), [[2, 0x2026], [3, 0x2014]]);
});

test('font tags remain literal, including partial and paragraph tags', () => {
  assert.deepEqual(points('mes("<col=…>a</col><p,…><col=<$x>>…");'), [0x2026, 0x2026, 0x2026]);
  assert.deepEqual(points('mes("<img=…\"…> end");'), [0x2026, 0x2026]);
  assert.deepEqual(points('mes("<col=bad\nvalue>");'), [0x0a]);
});

test('allows printable ASCII and pound only; rejects controls and other Latin-1', () => {
  assert.deepEqual(points('mes("£ ASCII ~");'), []);
  assert.deepEqual(points('mes("\u0085\u00a0éÿ\u007f\u0000\t😀");'), [0x85, 0xa0, 0xe9, 0xff, 0x7f, 0, 9, 0x1f600]);
});

test('checks every client text config key, not server-only strings', () => {
  for (const file of ['example.obj', 'example.npc', 'example.loc']) {
    for (const key of ['name', 'desc', 'op1', 'op2', 'op3', 'op4', 'op5', ...(file.endsWith('.obj') ? ['iop1', 'iop2', 'iop3', 'iop4', 'iop5'] : [])]) {
      assert.deepEqual(points(`[entry]\n${key}=Bad…`, file), [0x2026], `${file} ${key}`);
    }
    assert.deepEqual(points('param=server_only,"…"\n// name=…\nname=Good', file), []);
    assert.deepEqual(points('name=Good // …', file), [0x2026]);
  }
  for (const key of ['text', 'activetext', 'option', 'option1', 'option2', 'option3', 'option4', 'option5', 'tooltip', 'action', 'actionverb', 'graphic', 'activegraphic', 'slot1', 'slot20']) {
    assert.deepEqual(points(`[entry]\n${key}=Bad…`, 'example.if'), [0x2026], key);
  }
  assert.deepEqual(points('text=URL // …', 'example.if'), [0x2026]);
  assert.deepEqual(points('[floor…]\ncolour=0xffffff', 'example.flo'), [0x2026]);
  assert.deepEqual(points('[entry]\nparam=server_only,"…"', 'example.struct'), []);
});

test('reports exact source lines and Unicode code points once each', () => {
  assert.deepEqual(detect('[entry]\nname=Bad…😀', 'example.npc').map(({ line, codePoint, character }) => ({ line, codePoint, character })), [
    { line: 2, codePoint: 0x2026, character: '…' },
    { line: 2, codePoint: 0x1f600, character: '😀' },
  ]);
});

test('walker skips historical unpack and unrelated source types; import has no CLI effects', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'string-charset-'));
  try {
    mkdirSync(path.join(root, 'scripts/_unpack/377'), { recursive: true });
    writeFileSync(path.join(root, 'scripts/_unpack/377/bad.rs2'), 'mes("…");');
    writeFileSync(path.join(root, 'scripts/ignored.py'), 'mes("…");');
    writeFileSync(path.join(root, 'scripts/bad.rs2'), 'mes("…");');
    assert.equal(scanContent(root).length, 1);
    assert.equal(scanContent(root)[0].file, 'scripts/bad.rs2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
