import assert from 'node:assert/strict';
import nativeTest, { after } from 'node:test';
import { setImmediate } from 'node:timers/promises';

const counts = { declared: 0, completed: 0, passed: 0, sealed: false };
let receiptFlushed = false;

export function assertCompletion({ declared, completed, passed, sealed }) {
  assert(sealed, 'lifecycle case registration must finish');
  assert(declared > 0, 'the lifecycle suite must declare cases');
  assert.equal(completed, declared, 'every declared lifecycle case must complete');
  assert.equal(passed, declared, 'every declared lifecycle case must pass');
}

export function lifecycleTest(name, body) {
  assert(!counts.sealed, 'no lifecycle case may be added after registration closes');
  counts.declared++;
  return nativeTest(name, async context => {
    try {
      await body(context);
      counts.passed++;
    } finally {
      counts.completed++;
      // These native-world cases are synchronous and CPU-heavy. Give the test
      // reporter an event-loop turn after each case, without advancing game time.
      await setImmediate();
    }
  });
}

export function sealLifecycle() { counts.sealed = true; }

// Node's --test-force-exit can discard a pipe's buffered reporter output.
// Never let an early exit or an undrained final receipt look like a full pass.
process.on('exit', () => {
  if (!receiptFlushed || process.stdout.writableLength !== 0 || process.stderr.writableLength !== 0) {
    process.exitCode = 1;
  }
});

after(async () => {
  assertCompletion(counts);
  await setImmediate();
  await new Promise((resolve, reject) => {
    process.stdout.write(`FEUD lifecycle COMPLETE: declared=${counts.declared} completed=${counts.completed} passed=${counts.passed}\n`, error => {
      if (error) reject(error);
      else resolve();
    });
  });
  receiptFlushed = true;
});
