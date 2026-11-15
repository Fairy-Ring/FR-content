# Killerwatt encounter

Run from the sibling engine after a full content build:

```sh
node --import tsx ../content/tests/monster-s02/test_monster_s02.mjs
```

The test uses the native config loaders, static map, player save/load and packed RuneScript VM. It starts no server. RNG is controlled only for explicit hit and miss boundaries.

The unrelated-NPC cases check only S02's invariants inside the current run. Absent control names are skipped. At least three independent NPC controls must run, so unrelated name changes do not remove the shared-branch check. After each shared admission or spell check, the NPC type, S02 awake clock and native timer must remain unchanged. The quested and unquested staircase cases compare their destinations and messages with each other. They differ only in portal bit 0. No stored snapshot pins another unit's behaviour.

The runtime cases cover both skill vectors, Slayer 36/37, refusal without transformation, activation through the owned OP/AP paths and the shared manual-spell admission, missing ammunition, missing runes, and ordinary-NPC first-attack scheduling. The unarmed AP phase only requests approach range, as the published handler does. It does not perform or delay an attack.

The encounter cases cover near/far styles, boots worn/carried/absent, the item's own base-Slayer 36/37 wear gate, maximum damage, protection prayers and the attack interval. Accuracy draws in protected rows would hit without the prayer. Distance attacks use Magic defence and Protect from Missiles, not Protect from Magic. A real `npc_poison_start` and native NPC turns compare an awake killerwatt with an ordinary man. Poison survives both form changes and keeps its original damage deadline. The form-return queue survives native combat resets and does not own the poison timer.

The cannon cases refuse base setup at the plane's centre and its Portal Home edge, both legal setup centres before the ban. They assert no base loc, unchanged carried base and unset ownership. The same quest-complete account then sets up at a legal mainland tile, checked by its base loc, owned origin and consumed base. The quest completion constant and Slayer refusal wording come from the checked-out tree. Natural balls cannot retaliate without selection now that the cannon is refused, so there is no ball-specific queue-2 wake hook or artificial cannon/recoil wake fixture. Poison on a previously selected biped survives return and still directly damages the sleeping ball; it does not wake it. First-attack comparisons exclude only S02's form-check queue, not a combat queue. Access cases cover the quest-controlled cache multiloc, ordinary upstairs climb, S02's portal-bit write after the published Ernest completion scene, strobe suppression, all boots-warning choices, return portal and native persistence of both bits. The Ernest scene itself belongs to `tests/varp-morph-transmit/test_ernest_scene.mjs`.

Historical fact IDs are in the three research subjects: `monster-combat-data`, `slayer` and `draynor-village`. Exact skill numbers are packed-only. Live receipts belong to the evidence directory, not this test directory.
