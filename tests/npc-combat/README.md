# Built NPC combat vectors

T0 supplies test infrastructure only. Both inventories start empty. It builds no monster data.

Run from the sibling engine after a full `npm run build`:

```sh
node --import tsx ../content/tests/npc-combat/test_npc_combat.mjs
```

The registered command checks the native `NpcType` and `ParamType` pack. It also runs the checker's self-tests with temporary JSON copies. It starts no server and reads no git history or vault files. `HARNESS_ENGINE_DIR`, `HARNESS_PACK_DIR`, and `--pack` can select another engine or pack. `--manifest`, `--snapshots`, and `--report` select JSON input and report files. Use the checked-out content's matching pack and generated name maps. Self-tests use `RUNNER_TEMP` or the operating system's temporary directory, never the content tree.

Whole-vector checks print `LEVEL` lines with both the formula result and the cache level. `--report report.json` writes a JSON report on PASS and FAIL. A level failure includes both numbers in that report.

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

The command emits one JSON record to stdout. Do not replace a snapshot with the post-edit pack to clear a failure.

### Change an already registered type

This procedure also applies to a non-monster unit that changes a description, model, option, or quest parameter.

1. Register the changed field's facts under the subject that owns those facts.
2. Keep the original snapshot and its `contentCommit` unchanged. Do not capture another snapshot at the later unit's pre-edit commit.
3. Extend the existing entry. Preserve every earlier field assertion that your unit does not change.
4. For each added or changed assertion, set its `unit` to your unit identifier and supply its complete `evidence`.
5. Replace that field's expected value with the new approved value. Do not change the entry-wide unit or evidence for unrelated fields.
6. Build the content and run the registered command.

For example, a later unit can record `"desc": { "value": "Approved description", "unit": "U-NPC-EXAMINE", "evidence": { ... } }`.
The evidence uses that subject's fact ids, commit, labels, and source hashes. Partial evidence objects do not inherit entry-wide members.

There must still be one entry and one original snapshot per type after merging parallel units. Consolidate their field assertions, not duplicate entries.
If units captured different pre-edit commits, retain the snapshot from before the first change. Verify it with the recipe below.
Never edit snapshot fields to accommodate a later change. List the changed field with its effective expected value instead.

### Verify a snapshot

Review must check the snapshot against its stated `contentCommit`. CI checks only the commit's format.
Use an isolated content/engine pair, with the pinned engine and the content at that exact commit.
Do not replace the current worktree or its pack. Supply the normal engine build prerequisites.

From that isolated engine, build and capture the type:

```sh
npm run build
node --import tsx ../content/tests/npc-combat/test_npc_combat.mjs \
  --snapshot NPC_DEBUGNAME --snapshot-commit FULL_RECORDED_CONTENT_COMMIT > captured.json
```

Use the current checker if the recorded content predates T0. Set `HARNESS_ENGINE_DIR` to the isolated engine.
Its generated name maps must match the snapshot build. Copy the checker beside those maps if necessary.

Extract the committed record from the manifest under review, with the same deterministic formatting:

```sh
node --input-type=module -e '
  import fs from "node:fs";
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const record = data.types.find(type => type.identity.debugname === process.argv[2]);
  if (!record) throw new Error("Missing snapshot");
  console.log(JSON.stringify(record, null, 2));
' CURRENT_SNAPSHOTS_JSON NPC_DEBUGNAME > registered.json
cmp captured.json registered.json
```

`cmp` must exit zero. A difference requires correction of the proposed registration, not an automatic snapshot refresh.

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
- `unit`: the original build unit, such as `S01` or `A5`. Other units may use their own identifier. Identifiers contain alphanumeric segments separated by `.`, `_`, or `-`. `T0` is forbidden because it builds no monster data. A field's optional `unit` attributes a later change to that unit and requires complete field-level evidence.
- `fields`: exact expectations for every field the unit sets, including unchanged-but-explicit skills. Use `attack`, `defence`, `strength`, `hitpoints`, `ranged`, and `magic`, not a `stats` array. Other decoded properties include `huntmode`, `huntrange`, `wanderrange`, `maxrange`, `respawnrate`, `attackrange`, `regenrate`, and `op`. Values are decoded values, including derived `maxrange`, not raw source tokens.
- `param:DEBUGNAME`: a native parameter lookup. It checks the effective explicit or default value. A missing parameter definition fails. Numeric bonuses use numbers. Strings use strings. Boolean params use their native integer encoding.
- To remove a source field or explicit parameter, list its effective packed default. For example, a removed `respawnrate` may assert `100`, and a removed `param:attackrate` may assert `4`. Check the native default for that type and parameter, rather than assuming these examples apply universally. Do not delete the assertion.
- A reference uses `{ "ref": "hunt", "name": "HUNT_DEBUGNAME" }`, or the corresponding native kind. Use named references for generated category, enum, and hunt ids. Sequence and sound ids can use exact numbers or `seq`/`synth` references. References resolve through the matching content name maps. Raw numeric expectations compare exact ids.
- `evidence`: entry-wide evidence. A field can supply its own complete `evidence` object instead. Fields do not merge partial evidence with the entry. Every expectation needs one nonempty fact list, a VERIFIED or CANDIDATE label, a full research commit, and source ids with SHA-256 hashes.

Fact ids accept any registered subject's prefix, not only `monster-combat-data.`. The research method uses `<kebab-case-subject>.<kebab-slug>`, for example `npc-examine.chicken-description`. The checker also accepts segmented lowercase alphanumeric suffixes separated by `.`, `_`, or `-`. Source ids start with `src.` and may have a non-space fragment. Commits have 40 lowercase hexadecimal characters. SHA-256 hashes have 64. CI checks presence and format, not subject registration, fact membership, historical authenticity, or whether a source supports the field. Review must check those claims. Use only the label the cited facts carry.

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

`tests/cfg-npc` is the only backstop for unregistered types in this infrastructure. Its SHA-256 pins cover the complete client `npc.dat` and `npc.idx` bytes. Thus they cover every client-encoded NPC field, including name, description, models, options, visible level, size, ready/walk animations, recolours, resize, and multi-form selectors. See the client writes in the engine's `tools/pack/config/NpcConfig.ts`.

Its server manifest contains 222 rows for 127 NPCs, not all fields of all types. Those rows include 31 respawn rates, 22 wander ranges, 21 hunt ranges, 14 max ranges, 13 hunt modes, and 38 defend sounds. They contain no six-skill assertions. Skills, most hunt/range/respawn fields, and most parameters of unregistered types have no backstop. Keep applicable `cfg-npc` pins intact. An approved client-field change needs that test's separate pin-review procedure.

## Combat level

An entry sets a whole vector when it lists attack, defence, hitpoints, and strength. Listing all six skills also qualifies.
The formula uses the packed ranged and magic values even when the entry does not list them.
List those skills too when the unit sets them. The checker calculates:

```text
floor((10*(defence+hitpoints) +
       13*max(attack+strength, floor(3*ranged/2), floor(3*magic/2))) / 40)
```

This is the census formula with NPC Prayer zero. It is non-unique and blind to non-dominant skills.
A visible-level whole-vector mismatch fails unless the entry carries a reasoned exception:

```json
{ "levelException": { "kind": "formula-mismatch", "reason": "Explain why the sourced vector does not reproduce the cache level." } }
```

The exception exists for correct vectors that the formula does not reproduce. It is not a tolerance.
Never change the cache level or solve missing skills to make it agree.
An exception on a matching level, a hidden level, or an entry without a whole vector fails as stale.
An empty or missing reason also fails. Both numbers remain visible, including when a mismatch fails.

The native pack encodes `vislevel=hide` as zero (`tools/pack/config/NpcConfig.ts:156-158`).
Zero and the decoder's unset sentinel `-1` need no equality assertion. Hidden entries without an exception report `hidden`.

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
