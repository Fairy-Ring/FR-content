// Break the engine's World -> ScriptRunner -> handler -> World import cycle.
import "#/engine/World.js";
await import("./runtime.mts");
