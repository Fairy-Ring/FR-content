// Match the existing packed-runtime convention: initialize World before handlers.
import "#/engine/World.js";
try {
  await import("./s5_death_runtime.mts");
  // Engine module imports retain housekeeping timers without a server.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
