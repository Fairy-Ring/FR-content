// Break World -> ScriptRunner -> handler -> World's import cycle.
import '#/engine/World.js';
await import('./runtime.mts');
