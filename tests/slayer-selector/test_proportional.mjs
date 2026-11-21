#!/usr/bin/env node
// Registered entry point for the exact proportional selector proof.
process.argv.push('--mode', 'proportional');
await import('./test_slayer_selector.mjs');
