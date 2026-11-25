import '#/engine/World.js';

const [contentRoot, outputDirectory] = process.argv.slice(2);
if (!contentRoot || !outputDirectory) {
  throw new Error('Usage: audit-bootstrap.mts <content-root> <output-directory>');
}

const { runAudit } = await import('./audit.mts');
await runAudit(contentRoot, outputDirectory);
process.exit(0);
