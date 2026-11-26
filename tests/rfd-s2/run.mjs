import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of ['test_guide.mjs', 'test_dave.mjs', 'test_skrach.mjs', 'test_hub.mjs']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, file)], {
    stdio: 'inherit', env: { ...process.env, NODE_MEMBERS: 'true', NODE_XPRATE: '1' }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${file} failed${result.signal ? ` (${result.signal})` : ''}`);
}
console.log('PASS all RFD Slice 2 compiled cases');
