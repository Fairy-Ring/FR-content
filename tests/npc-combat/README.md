# Built NPC combat vectors

T0 supplies test infrastructure only. Both inventories start empty. It builds no monster data.

Run from the sibling engine after a full `npm run build`:

```sh
node --import tsx ../content/tests/npc-combat/test_npc_combat.mjs
```

The registered command checks the native `NpcType` and `ParamType` pack. It also runs the checker's self-tests with temporary JSON copies. It starts no server and reads no git history or vault files. `HARNESS_ENGINE_DIR`, `HARNESS_PACK_DIR`, and `--pack` can select another engine or pack. `--manifest`, `--snapshots`, and `--report` select JSON input and report files. Use the checked-out content's matching pack and generated name maps.

## Add a built type

1. Register the facts before building. Use only the types and fields your unit actually builds.
2. Build the pre-edit content. Capture that type's decoded snapshot with the command below.
3. Append the emitted record to `snapshots.json`'s `types` array. Keep existing snapshots unchanged.
4. Add one entry to `built-vectors.json`'s `entries` array. Check the debugname and original 377 id against the period identity.
5. Set every approved field in the product. Build again and run the registered command.

Snapshot capture uses an explicit full pre-edit content commit, not git history:

```sh
node --import tsx ../content/tests/npc-combat/test_npc_combat.mjs \
  --snapshot slayer_dustdevil --snapshot-commit FULL_PRE_EDIT_CONTENT_COMMIT
```

The command emits one JSON record to stdout. Do not replace a snapshot with the post-edit pack to clear a failure. For an already registered type, extend its existing entry instead.

### Entry shape

This example describes the shape. Its placeholders are not accepted values and are not monster facts.

```json
{
  "identity": { "debugname": "slayer_dustdevil", "id": 1624 },
  "unit": "S01",
  "evidence": {
    "facts": ["monster-combat-data.FACT_SUFFIX"],
    "label": "CANDIDATE",
    "researchCommit": "FULL_LOWERCASE_RESEARCH_COMMIT",
    "sources": [{ "id": "src.SOURCE_ID", "sha256": "LOWERCASE_SHA256" }]
  },
  "fields": {
    "attack": { "value": 105 },
    "param:attack_anim": { "value": { "ref": "seq", "name": "SEQUENCE_DEBUGNAME" } }
  }
}
```

- `identity`: debugname and original 377 id. Both must match the native pack and content name map.
- `unit`: the owning `S01`-style or `A1`–`A14` build unit. No T0 monster entries are permitted.
- `fields`: exact expectations for every field the unit sets, including unchanged-but-explicit skills. Use `attack`, `defence`, `strength`, `hitpoints`, `ranged`, and `magic`, not a `stats` array. Other decoded properties include `huntmode`, `huntrange`, `wanderrange`, `maxrange`, `respawnrate`, `attackrange`, `regenrate`, and `op`. Values are decoded values, including derived `maxrange`, not raw source tokens.
- `param:DEBUGNAME`: a native parameter lookup. It checks the effective explicit or default value. A missing parameter definition fails. Numeric bonuses use numbers. Strings use strings. Boolean params use their native integer encoding.
- A reference uses `{ "ref": "hunt", "name": "HUNT_DEBUGNAME" }`, or the corresponding native kind. Use named references for generated category, enum, and hunt ids. Sequence and sound ids can use exact numbers or `seq`/`synth` references. References resolve through the matching content name maps. Raw numeric expectations compare exact ids.
- `evidence`: entry-wide evidence. A field can supply its own complete `evidence` object instead. Fields do not merge partial evidence with the entry. Every expectation needs one nonempty fact list, a VERIFIED or CANDIDATE label, a full research commit, and source ids with SHA-256 hashes.

Fact ids must start with `monster-combat-data.` and contain lowercase alphanumeric segments separated by `.`, `_`, or `-`. Source ids start with `src.` and may have a non-space fragment. Commits have 40 lowercase hexadecimal characters. SHA-256 hashes have 64. CI checks presence and format, not vault membership, historical authenticity, or whether a source supports the field. Review must check those claims.

When the selected value departs from the plan's source order, add this member to the applicable evidence:

```json
{
  "sourcePriorityException": {
    "kind": "source-priority",
    "preferred": "src.PREFERRED_SOURCE",
    "overridden": ["src.HIGHER_PRIORITY_SOURCE"],
    "reason": "State why this field uses the selected source instead."
  }
}
```

The preferred source must have a hash in `sources`. The checker cannot discover an undeclared departure from source order.

## Missing and stale entries

The snapshot and entry identity sets must match. Removing an entry alone fails. Each snapshot contains every decoded native own field, six named skills, and all explicit params for that type. Every unlisted field must equal its pre-build snapshot. Added or removed explicit params must have a listed assertion. All listed fields must equal the expected value. Misspelled or absent native fields fail.

Snapshots normalize generated references by name. They are drift guards, not period facts or whole-tree baselines. Unregistered types, implicit unlisted parameter defaults, scripts, and runtime stat changes are outside this check. A coordinated deletion or rewrite of both inventories requires review. CI cannot prove a snapshot's stated commit without history. Never use snapshot edits to conceal unlisted changes.

## Combat level

An entry sets a whole vector when it lists all six skills. The checker reports:

```text
floor((10*(defence+hitpoints) +
       13*max(attack+strength, floor(3*ranged/2), floor(3*magic/2))) / 40)
```

This is the census formula with NPC Prayer zero. It is non-unique and blind to non-dominant skills. A visible-level mismatch is an exact recorded diagnostic, not a failure or tolerance. Never change the cache level or solve missing skills to make it agree. The native pack encodes `vislevel=hide` as zero (`tools/pack/config/NpcConfig.ts:156-158`). Zero and the decoder's unset sentinel `-1` need no equality assertion. An optional `levelException` records `{ "kind": "formula-mismatch", "reason": "..." }`. An empty or missing reason fails. The exception never hides the diagnostic.

## Multi-form parents

An entry can add `routing`. It uses the entry's evidence unless it supplies its own complete evidence:

```text
routing = {
  spawnedParent: { debugname, id },
  resolvedForm: { debugname, id },
  selector: { kind: "varp" or "varbit", name, value },
  stats: { attack, defence, strength, hitpoints, ranged, magic },
  params: { PARAM_DEBUGNAME: expected_value, ... },
  hasop: { "1": false, "2": false },
  resolvedOptions: [null, "Attack", null, null, null]
}
```

The entry must name one endpoint. The selector must select the other declared form. `stats`, `params`, and `hasop` assert what native opcodes read from a fresh spawned parent. `resolvedOptions` asserts the selected form's complete options separately. These expectations use the same exact values and reference syntax as fields.

At the pinned engine, `Npc.ts:76-93` initializes levels from the spawned type. `NpcOps.ts:281-285` reads those levels for `NPC_STAT`. `NpcOps.ts:178-187` reads params from `activeNpc.type`. `NpcOps.ts:579-591` reads that type's options for `NPC_HASOP`. `resolveNpcType.ts:4-17` selects a visual form, and `OpNpcHandler.ts:40-45` checks its options. The checker executes the real resolver and three opcode handlers offline. It changes no routing. Explicit `changeType` can change the runtime type and levels (`Npc.ts:444-461`). This check does not prove a quest's natural transformation or access route.

## Proof limits

Exact skill and sequence assertions are packed-only. A generic fight proves none of them. The checker does not prove live HP-XP, prayer style, equipment mechanics, natural access, quest transformation, or drop weights. Later units must supply the plan's applicable live and compiled-runtime proofs separately.
