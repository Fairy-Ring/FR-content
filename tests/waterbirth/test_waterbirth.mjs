import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const file of ['test_pressure.mjs', 'test_supports.mjs', 'traversal.mjs']) {
  execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit', env: process.env });
}
