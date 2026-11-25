import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { ScriptProvider, contentRoot } from '../swamp-caves/runtime.mjs';

const audit = JSON.parse(readFileSync(new URL('./removed-dialogue.json', import.meta.url), 'utf8'));
const normalize = text => text.replace(/<p,[^>]*>/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

export function assertOlderDialogueCutover() {
  assert.equal(audit.schema, 1);
  assert.equal(audit.removed.filter(row => row.class === 'O').length, 46);
  assert.equal(audit.removed.filter(row => row.class === 'J').length, 1);
  for (const name of audit.requiredScripts) {
    assert(ScriptProvider.getByName(name), `${name}: retained Feud entry exists in the built pack`);
  }
  for (const name of audit.removedEntries) {
    assert.equal(ScriptProvider.getByName(name), undefined, `${name}: removed optional scene must not remain compiled`);
  }

  // Read the built pack's own bound, not a generated ID or a private provider field.
  const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
  const descriptor = openSync(path.join(engineRoot, 'data/pack/server/script.dat'), 'r');
  const header = Buffer.alloc(4);
  try {
    assert.equal(readSync(descriptor, header, 0, header.length, 0), header.length);
  } finally {
    closeSync(descriptor);
  }
  const entries = header.readInt32BE(0);
  assert(entries > 0, 'the built script pack declares entries');
  const speeches = [];
  for (let id = 0; id < entries; id++) {
    const script = ScriptProvider.get(id);
    if (script?.fileName.startsWith('feud_')) {
      speeches.push({ name: script.name, text: normalize(script.stringOperands.filter(Boolean).join('\n')) });
    }
  }
  assert(speeches.length >= audit.requiredScripts.length, 'the loaded Feud pack is not an empty oracle');

  for (const row of audit.removed) {
    const text = normalize(row.text);
    const own = speeches.find(speech => speech.name === row.script);
    assert(!own?.text.includes(text), `${row.occurrence}: removed ${row.class} wording reappeared in ${row.script}`);
    // Common short replies and the two retained repeat-trial replies are scoped
    // to their removed occurrence; unique longer speeches are also banned across
    // the entire built Feud unit, including newly named scenes.
    if (text.length >= 40 && !row.sharedWithRetainedOccurrence) {
      for (const speech of speeches) {
        assert(!speech.text.includes(text), `${row.occurrence}: removed ${row.class} speech reappeared in ${speech.name}`);
      }
    }
  }
}
