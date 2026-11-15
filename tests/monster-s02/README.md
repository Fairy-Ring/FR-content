# Killerwatt encounter

Run from the sibling engine after a full content build:

```sh
node --import tsx ../content/tests/monster-s02/test_monster_s02.mjs
```

The test uses the native config loaders, static map, player save/load and packed RuneScript VM. It starts no server. RNG is controlled only for explicit hit and miss boundaries.

The unrelated-NPC cases check only S02's invariants inside the current run. After each shared admission or spell check, the NPC type, S02 awake clock and native timer must remain unchanged. The quested and unquested staircase cases compare their destinations and messages with each other. They differ only in portal bit 0. No stored snapshot pins another unit's behaviour.

The runtime cases cover both skill vectors, Slayer 36/37, refusal without transformation, activation through the owned OP/AP paths and the shared manual-spell admission, missing ammunition, missing runes, and ordinary-NPC first-attack scheduling. The unarmed AP phase only requests approach range, as the published handler does. It does not perform or delay an attack.

The encounter cases cover near/far styles, boots worn/carried/absent, the item's own base-Slayer 36/37 wear gate, maximum damage, protection prayers and the attack interval. Accuracy draws in protected rows would hit without the prayer. Distance attacks use Magic defence and Protect from Missiles, not Protect from Magic. A real `npc_poison_start` and native NPC turns compare an awake killerwatt with an ordinary man. Poison survives both form changes and keeps its original damage deadline. The form-return queue survives native combat resets and does not own the poison timer.

The cannon cases run the published base-setup handler on the plane, then the real cannon hit proc and native damage queue. First positive non-selection damage wakes the ball without changing the damage. First-attack comparisons exclude only S02's form-check queue, not a combat queue. Access cases cover the quest-controlled cache multiloc, ordinary upstairs climb, S02's portal-bit write after the published Ernest completion scene, strobe suppression, all boots-warning choices, return portal and native persistence of both bits. The Ernest scene itself belongs to `tests/varp-morph-transmit/test_ernest_scene.mjs`.

Historical fact IDs are in the three research subjects: `monster-combat-data`, `slayer` and `draynor-village`. Exact skill numbers are packed-only. Live receipts belong to the evidence directory, not this test directory.
