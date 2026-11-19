import '#/engine/World.js';

const [content, output] = process.argv.slice(2);
if (!content || !output) throw new Error('Usage: audit-bootstrap.mts <content-root> <output-directory>');
const { runAudit } = await import('./audit.mts');
runAudit(content, output);
process.exit(0);
