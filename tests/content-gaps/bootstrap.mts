// Break the World -> ScriptRunner -> handler -> World import cycle before loading scripts.
import '#/engine/World.js';
await import('./packed.mts');
