# Mort Myre creature packed test

Use the engine pinned by `.github/fr-engine-ref`. Build the sibling engine, then run from its directory:

```sh
npm run build
node --import tsx ../content/tests/mortmyre-creatures/test_mortmyre_creatures.mjs
```

If `HARNESS_ENGINE_DIR` selects another engine tree, run from that engine's directory too. The TypeScript module aliases and the loaded config pack must use the same engine instance.

The test loads the real server config and compiled scripts, executes them on engine NPC/player entities, and controls only the random source and test fixtures. It never starts a world or reads git history. Config IDs are resolved by name from the current pack.

Coverage includes the 27 audited identities, species dispatch and a cow non-leakage control; all nine snail corpse/shell pairs, every spit damage outcome, all nine helmets and no helmet, prayer and combat guards; both vampires' dust-only default drop; vampire table boundaries, clue and shared jewel/rare-table paths; all 23 uncommon seed members and their cumulative boundaries over 998 rolls; the caller's watermelon quantity 2 versus the shared quantity 1; the unchanged general seed table and lizard drops; both vampire attack branches, holy-symbol equality gates and inherited message, bite damage/drain/healing with and without prayer; both random outcomes for each of 20 leech skills, Farming exclusion and prayer; spider proximity dispatch, cooldown and the real flyer's owner, life, mode and landing animation.

Every spit outcome also asserts the player's unarmed defend animation and its projectile-duration delay. Every uncommon-seed roll from 0 to 997 executes, not only each member's boundaries.

The dust defaults implement Ruling 14: period pages identify the level 61 juvenile and level 72 flyer and list vampire dust. The juvenile's server param overrides the inherited bones default; the common script still reads `npc_param(death_drop)`.

These are behavioral regression expectations, not independent historical proof. VERIFIED and CANDIDATE source decisions are recorded in the Mort Myre research subject. A headed live cell separately exercises the placed content without NPC or drop seeding.
