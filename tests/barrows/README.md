# Barrows checks

Run the registered check from the sibling engine:

```sh
node ../content/tests/barrows/test_config.mjs --content-root ../content
```

The test reads config names, types and values. It does not use generated enum or parameter IDs. Original cache identities still come from tracked packs.

The four mapped corner ladders and the chest define the tunnel room centres. Each placed door's coordinates select its two adjacent rooms, or its room and outside direction. The test compares these measured edges with the lock enum and the parent's lock varbit and parameter. Both halves and all placements contribute to the comparison. No lock-to-edge expectation table supplies the result.

Each negative control must exit 1. Add `--mutant NAME` to the command:

- `wrong-brother-join`: change the Ahrim sarcophagus enum join.
- `reversed-lock-polarity`: reverse the lock-state enum.
- `wrong-door-lock`: assign parent `barrows_door_e_r` to lock F in both its `multivar` and lock parameter. Its map-derived edge must reject that assignment.
- `swapped-parent-polarity`: swap the two `multiloc` children on parent `barrows_door_e_r`.

Mutants change only text in memory. They do not modify content files.

## Durable core (S01)

Build the sibling engine packs, then run:

```sh
node --import tsx ../content/tests/barrows/test_core.mjs
```

This check executes the packed run procs through the production script runner. It covers masked state, phases, generation changes, owner-only actor removal, the non-suspending Search latch/reset, initial locked doors and saved countdown fields. The Search latch has no player trigger or reward grant in this build group. S07 replaces the all-locked layout initializer. S06 and S13 attach their effects to the shared saved-countdown primitives.
