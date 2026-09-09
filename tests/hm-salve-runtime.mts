/**
 * Bootstrap: evaluate World before other engine modules to avoid ESM TDZ
 * (Obj extends NonPathingEntity while World is still initializing).
 */
import World from '#/engine/World.js';

void World.currentTick;
await import('./hm-salve-runtime-body.mts');
