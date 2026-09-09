# Creature of Fenkenstrain — completion report (r377 / t_d99d6bbc)

Date stamp: 2026-09-09  
Branch/worktree: `codex/r377-fenkenstrain-completion` / `r377-fenkenstrain-content`  
Contracts: `.tmp/r377-fenkenstrain-m1-2026-09-09/` (root-precontract, full-source-contract, receipts)

## Summary

Implemented exclusive CoF quest writers and required shared joins for signpost → hire → body parts → sewing → memorial/cavern → conductor → lightning → creature → pickpocket complete → journal/QP/colour. Offline acceptance test `tests/fenkenstrain-completion/test_fenk_offline.py` **PASS**.

Root fox proof on shared server23 remains out of this worker scope (no pack/build/reload/services).

## Files touched

### Exclusive (quest tree)

| Path | Role |
|------|------|
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_quest.constant` | Stage ladder 0/1/2/3/4/8 |
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_follower.varp` | NONHISTORICAL temp `%fenk_follower_uid` |
| `scripts/.../fenk_signpost.rs2` | Signpost read bit only (no stage write) |
| `scripts/.../fenk_dr_talk.rs2` | Hire interview, parts/needle/thread hand-in, stage advances |
| `scripts/.../fenk_gardener.rs2` | Ghostspeak + follower lifecycle (~10 min CANDIDATE) |
| `scripts/.../fenk_graves.rs2` | Poor/island Dig yields; independent of follower |
| `scripts/.../fenk_items_bookcases.rs2` | Brain+head, bookcases, star amulet |
| `scripts/.../fenk_brain_take.rs2` | Table Take → Roavar specialty path |
| `scripts/.../fenk_memorial.rs2` | Star on coffin + Push + island return |
| `scripts/.../fenk_doors_experiment.rs2` | Shed/tower/cavern doors; experiment key drop |
| `scripts/.../fenk_shed_conductor.rs2` | Brush/canes/wire Craft 20, mould, conductor repair |
| `scripts/.../fenk_tower_complete.rs2` | Creature talk, pickpocket, complete once, recovery, journal, clock |

### Shared joins (authorized / root-noted)

| Path | Change |
|------|--------|
| `scripts/ladders+stairs/scripts/stairs.rs2` | `fenk_stairs_lv1` / `_top` coord cases (L0↔L1 castle) |
| `scripts/skill_crafting/scripts/jewellery/jewellery.rs2` | Conductor mould IF hide + `craft_fenk_conductor` (50 XP) |
| `scripts/areas/area_canafis/scripts/werewolfinnkeeper.rs2` | `roavar_brain_take` 50gp specialty |
| `scripts/general/configs/quest.constant` | `^creatureoffenkenstrain_complete=8`, `_questpoints=2` only (root authorized 2026-09-09 mid-run) |
| `scripts/general/scripts/quests.rs2` | QP total + `questlist:creatureoffenkenstrain` colour |

## Acceptance matrix (A–G)

| ID | Criterion | Status | Notes |
|----|-----------|--------|-------|
| A1 | Signpost bit only | PASS | Offline |
| A2 | Hire interview Braindead/Grave-digging once | PASS | Offline |
| A3 | Stages 0→1 hire, multi 8 complete | PASS | Offline |
| B1 | Partial body hand-in bits | PASS | Offline |
| B2 | Needle once + thread cumulative ≤5 | PASS | Offline |
| B3 | Ghostspeak + follower cleanup | PASS | Offline; ownership via temp uid NONHISTORICAL |
| B4 | Dig independent of follower; island map | PASS | Offline coords |
| C1 | Brain 50gp + telegrab alternate (generic) | PASS | Take→Roavar; telegrab not free Take |
| C2 | Bookcases + star combine | PASS | Offline |
| D1 | Star on east coffin + Push | PASS | Dest CANDIDATE band |
| D2 | Experiment key once-per-need | PASS | Offline |
| D3 | Door unlock bits + open | PASS | Offline |
| E1 | Brush Craft 20; 3 cane + 3 wire | PASS | Offline |
| E2 | Correct fireplace mould | PASS | L1 west 1_55_55_24_35 |
| E3 | Conductor silver cast 50 XP + repair hammer | PASS | Offline; IF com_113 |
| F1 | Creature talk → counter; pickpocket Thieving 25 | PASS | Offline |
| F2 | Complete once: 2 QP + 1000 Thieving + ring | PASS | Offline; scroll `\\n` house form |
| F3 | Lost-ring post-complete recovery no XP/QP | PASS | Tip.it 2006-06-16 CANDIDATE; both Charos variants guarded |
| G1 | Questlist colour + journal button | PASS | Offline |
| G2 | Optional clock letter | PASS | Present |

## Lost-ring recovery (operator correction)

Evidence: Tip.it post elComment_776260 Majin_Numark 16 Jun 2006 — recover by pickpocketing doctor on castle top floor; if previously (u), recovered remains (u). Receipt: `.tmp/.../receipts/charos-recovery-20060616.json`.

Implementation:

- Duplicate guard: `ring_of_charos` **and** `ring_of_charos_unlocked` in inv/worn/bank.
- Post-complete pickpocket: item only via `~fenk_give_charos_recovery` — **no** `stat_advance` / complete queue.
- Unlock memory: `%fenk_digresult = 7` (NONHISTORICAL spare digresult) set by `~fenk_note_charos_unlocked` when unlocked is observed; recovery yields unlocked if memory set, else base.
- Garden unlock conversion should also set digresult=7 when base→(u) is implemented (out of CoF exclusive scope).

## CANDIDATE / gap ledger

| Item | Label | Mitigation |
|------|-------|------------|
| Follower duration ~10 min | CANDIDATE Tip.it | `^fenk_follow_ticks = 1000` |
| Memorial push stand tile | CANDIDATE | Ladder-band dest 0_55_154_58_7 |
| Conductor 50 Craft XP | CANDIDATE Transcript | Hardcoded tenths 500 (no jewelry struct on obj) |
| Experiment combat stats | Pack-grounded unpack | hp40 att40 str50 def50; no derived-from-51 claim |
| Gardener ownership pointer | NONHISTORICAL temp uid | Private `%fenk_follower_uid`; not packed 377 |
| Charos (u) durable memory | NONHISTORICAL digresult=7 | Garden should set on unlock |
| Stairs stand tiles | CANDIDATE | Adjacent N of L1 tops / S of L0 bottoms |
| Broom cupboard open duration | CANDIDATE | loc_change 500 ticks |
| Roavar text_gender nested quotes | House pattern | Matches genie-style tags |
| Shared pack/reload | Out of scope | Root fox on server23 |

## Config audit (pack-side)

Exclusive scripts assume existing `fenk_*` obj/loc/npc/varp names from 377 leftover. No new packed type IDs invented in this unit beyond:

- `fenk_follower.varp` — **NONHISTORICAL** temp player var (private runtime ownership).
- Stage constants in exclusive `fenk_quest.constant` + authorized shared `quest.constant` pair.

Root owns any missing movement/timer/combat param fills and map instance wiring. Worker does not claim pack completeness.

## Tests run

```
python3 tests/fenkenstrain-completion/test_fenk_offline.py
→ PASS (10 fenk scripts + stairs/jewellery/roavar/quests joins)
```

No live client / pack / server proof in this worker.

## Reviewer focus

1. `quest.constant` only two CoF lines; unique names; HM constants preserved.
2. `quests.rs2` colour + QP join; HM join preserved.
3. Pickpocket recovery: no XP/QP on complete path; both Charos variants.
4. Scroll title uses house `\\n` (two backslash bytes before n).
5. Jewellery conductor path does not break holy/unholy/sickle IF.
6. Stairs cases only for fenk_stairs locs; no unrelated stair edits.
7. CANDIDATE labels honest in script headers / this report.
