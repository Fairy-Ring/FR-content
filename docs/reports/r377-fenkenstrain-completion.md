# Creature of Fenkenstrain — completion report (r377 / t_d99d6bbc)

Date stamp: 2026-09-09  
Branch/worktree: `codex/r377-fenkenstrain-completion` / `r377-fenkenstrain-content`  
Contracts: `.tmp/r377-fenkenstrain-m1-2026-09-09/` (root-precontract, full-source-contract, receipts)

## Summary

Implemented exclusive CoF quest writers and required shared joins for signpost → hire → body parts → sewing → memorial/cavern → conductor → lightning → creature → pickpocket complete → journal/QP/colour.

Lifecycle: gardener cleanup on **logout + death** (`~fenk_on_player_cleanup`) and **login queue** (`fenk_on_login_cleanup`). **No `pet.rs2` hook** (cat hunger/shoo surface). Softtimer follow-watch queues protected cleanup (needs `p_active_player`).

Charos unlock memory: dedicated perm varp `%fenk_charos_unlocked_mem` (pack id **764**) — **not** `fenk_digresult=7`. Follower session: temp `%fenk_follower_uid` (pack id **763**, `protect=no` for softtimer reads).

Offline acceptance test `tests/fenkenstrain-completion/test_fenk_offline.py` **PASS**. Isolated scripts-only compile under `.tmp/fenk-iso-compile-r422/` **exit 0**; shared `vendor/content/pack/script.pack` checksum unchanged.

Root fox proof on shared server23 remains out of this worker scope (no live pack/build/reload/services).

## Files touched

### Exclusive (quest tree)

| Path | Role |
|------|------|
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_quest.constant` | Stage ladder 0/1/2/3/4/8 |
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_follower.varp` | NONHISTORICAL temp `%fenk_follower_uid` + perm `%fenk_charos_unlocked_mem` |
| `scripts/.../fenk_signpost.rs2` | Signpost read bit only (no stage write) |
| `scripts/.../fenk_dr_talk.rs2` | Hire interview, parts/needle/thread hand-in, stage advances |
| `scripts/.../fenk_gardener.rs2` | Ghostspeak + follower lifecycle; authorized cleanup; voice/leash honesty |
| `scripts/.../fenk_graves.rs2` | Poor/island Dig yields; independent of follower |
| `scripts/.../fenk_items_bookcases.rs2` | Brain+head, bookcases, star amulet |
| `scripts/.../fenk_brain_take.rs2` | Table Take → Roavar specialty path |
| `scripts/.../fenk_memorial.rs2` | Star on coffin + Push topology pair (ladder_1757 convention) |
| `scripts/.../fenk_doors_experiment.rs2` | Shed/tower/cavern doors; experiment key drop in ai_queue3 |
| `scripts/.../fenk_shed_conductor.rs2` | Brush/canes/wire Craft 20, mould, conductor repair |
| `scripts/.../fenk_tower_complete.rs2` | Creature talk, pickpocket, complete once, Charos recovery, journal, clock |

### Shared joins (authorized / root-noted)

| Path | Change |
|------|--------|
| `scripts/ladders+stairs/scripts/stairs.rs2` | `fenk_stairs_lv1` / `_top` coord cases (L0↔L1 castle) |
| `scripts/skill_crafting/scripts/jewellery/jewellery.rs2` | Conductor mould IF hide + `craft_fenk_conductor` (50 XP) |
| `scripts/areas/area_canafis/scripts/werewolfinnkeeper.rs2` | `roavar_brain_take` 50gp specialty |
| `scripts/general/configs/quest.constant` | `^creatureoffenkenstrain_complete=8`, `_questpoints=2` only |
| `scripts/general/scripts/quests.rs2` | QP total + `questlist:creatureoffenkenstrain` colour |
| `scripts/login_logout/scripts/logout.rs2` | `~fenk_on_player_cleanup` after follower_logout |
| `scripts/login_logout/scripts/login.rs2` | `queue(fenk_on_login_cleanup, 0, 0)` after follower_login |
| `scripts/player/scripts/death.rs2` | `~fenk_on_player_cleanup` after follower_death |
| `scripts/_unpack/377/all.npc` | Experiment combat ints + named attack/defend/death seq params |
| `pack/varp.pack` | `763=fenk_follower_uid`, `764=fenk_charos_unlocked_mem` |

## Acceptance matrix (A–G)

| ID | Criterion | Status | Notes |
|----|-----------|--------|-------|
| A1 | Signpost bit only | PASS | Offline; no `%fenk_quest` write |
| A2 | Hire interview Braindead/Grave-digging once | PASS | Offline |
| A3 | Stages 0→1 hire, multi 8 complete | PASS | Offline constants + multi |
| B1 | Partial body hand-in bits | PASS | Offline |
| B2 | Needle once + thread cumulative ≤5 | PASS | Offline |
| B3 | Ghostspeak + follower cleanup | PASS | logout/death/login; **not** pet.rs2; softtimer→queue |
| B4 | Dig independent of follower; island map | PASS | Offline coords |
| C1 | Brain 50gp + telegrab alternate (generic) | PASS | Take→Roavar; telegrab not free Take |
| C2 | Bookcases + star combine | PASS | Offline |
| D1 | Star on east coffin + Push | PASS | Topology pair CANDIDATE: movecoord ±6400 west stand; ladder_1757 convention; stand collision UNKNOWN |
| D2 | Experiment key once-per-need | PASS | Drop in ai_queue3 with `npc_coord` (no queue losing active_npc) |
| D3 | Door unlock bits + open | PASS | Offline |
| E1 | Brush Craft 20; 3 cane + 3 wire | PASS | Offline |
| E2 | Correct fireplace mould | PASS | L1 west 1_55_55_24_35 |
| E3 | Conductor silver cast 50 XP + repair hammer | PASS | Offline; IF com_113 |
| F1 | Creature talk → counter; pickpocket Thieving 25 | PASS | Offline |
| F2 | Complete once: 2 QP + 1000 Thieving + ring | PASS | Offline; scroll `\\n` house form |
| F3 | Lost-ring post-complete recovery no XP/QP | PASS | Tip.it 2006-06-16 CANDIDATE; `%fenk_charos_unlocked_mem` durable; both Charos variants guarded |
| G1 | Questlist colour + journal button | PASS | Offline |
| G2 | Optional clock letter | PASS | Present |

## Lost-ring recovery (operator correction)

Evidence: Tip.it post elComment_776260 Majin_Numark 16 Jun 2006 — recover by pickpocketing doctor on castle top floor; if previously (u), recovered remains (u). Receipt: `.tmp/.../receipts/charos-recovery-20060616.json`.

Implementation:

- Duplicate guard: `ring_of_charos` **and** `ring_of_charos_unlocked` in inv/worn/bank.
- Post-complete pickpocket: item only via `~fenk_give_charos_recovery` — **no** `stat_advance` / complete queue.
- Unlock memory: **`%fenk_charos_unlocked_mem`** (NONHISTORICAL perm varp, pack **764**) set by `~fenk_note_charos_unlocked` when unlocked is observed; recovery yields unlocked if memory set, else base.
- **`fenk_digresult` (bits 17–19) left free** — not used for unlock memory.
- Garden unlock conversion should set `%fenk_charos_unlocked_mem = 1` when base→(u) is implemented (out of CoF exclusive scope).

## Lifecycle / gardener honesty

| Concern | Decision |
|---------|----------|
| Cleanup surface | logout.rs2 + death.rs2 `~fenk_on_player_cleanup`; login `queue(fenk_on_login_cleanup)` |
| pet.rs2 | **Not hooked** — cat hunger/shoo would fire on CoF cleanup |
| Softtimer writes | Softtimer has `active_player` only; protected `%fenk_gardener_directions` (fenk_flags) cleared via queue |
| Follower uid | `protect=no` so softtimer can read session uid |
| Following voice | Restates south Haunted Forest head path — no free compass prose |
| Tile leash | **UNKNOWN** — plane-change + duration only; no invented distance |

## Config audit (pack-side)

| Item | Status |
|------|--------|
| `%fenk_quest` / fenk_flags bits | Existing 377 PERM varp + varbits |
| `%fenk_follower_uid` | NONHISTORICAL temp; pack 763; type=npc_uid; protect=no |
| `%fenk_charos_unlocked_mem` | NONHISTORICAL perm; pack 764 |
| Experiment combat ints | CANDIDATE later-data inject lineage; labeled in all.npc |
| Experiment attack/defend/death seqs | Named fills: `homolupus_*`, `waa_homo_arachnus_*`, `waa_ovinocanus_*` — defs present in all.seq |
| Server-only pack | varp/varbit/npc packable server-side for compile |
| Client varbit JAG | New **varbit** basevar bits need **paired client config** on root integration (server debugname alone leaves client basevar=-1). This unit uses a **perm varp** for Charos mem to avoid that split for the memory bit. ISO pack did **not** mutate live cache. |

Root owns any missing movement/timer/map instance wiring and full client+server config pack for eventual integration. Worker does not claim live pack completeness.

## CANDIDATE / gap ledger

| Item | Label | Mitigation |
|------|-------|------------|
| Follower duration ~10 min | CANDIDATE Tip.it | `^fenk_follow_ticks = 1000` |
| Memorial push stand tile | CANDIDATE | movecoord(loc, -1, 0, ±6400); collision stand UNKNOWN |
| Conductor 50 Craft XP | CANDIDATE Transcript | Hardcoded tenths 500 |
| Experiment combat stats | CANDIDATE later-data | hp/att/str/def filled; not period-verified unpack |
| Experiment combat seq family | CANDIDATE pack-named | Matches walk/ready family names |
| Gardener ownership pointer | NONHISTORICAL temp uid | Private `%fenk_follower_uid` |
| Charos (u) durable memory | NONHISTORICAL perm varp | `%fenk_charos_unlocked_mem`; garden should set on unlock |
| Exact tile leash | UNKNOWN | Plane + duration only |
| Stairs stand tiles | CANDIDATE | Adjacent N of L1 tops / S of L0 bottoms |
| Shared pack/reload | Out of scope | Root fox on server23 |

## Tests run

```
python3 tests/fenkenstrain-completion/test_fenk_offline.py
→ PASS (10 fenk scripts + lifecycle + combat seq + pack ids + stairs/jewellery/roavar/quests joins)

Isolated compile (.tmp/fenk-iso-compile-r422/):
  BUILD_SRC_DIR=<iso>/content  npx tsx tools/compile-scripts-only.ts
→ exit 0; shared vendor/content/pack/script.pack sha256 unchanged
  (ISO engine data/pack only; server varp/varbit/npc packed in sandbox first)
```

No live client / shared pack / server proof in this worker.

## Reviewer focus

1. `quest.constant` only two CoF lines; unique names; HM constants preserved.
2. `quests.rs2` colour + QP join; HM join preserved.
3. Lifecycle: logout/death/login only — **pet.rs2 clean**.
4. Charos recovery: `%fenk_charos_unlocked_mem` not digresult=7; no XP/QP on recovery path.
5. Softtimer queues cleanup (p_active_player); follower uid protect=no.
6. Memorial pairing honesty (CANDIDATE topology, not live-proved PASS).
7. Scroll title uses house `\\n` (two backslash bytes before n).
8. Jewellery conductor path does not break holy/unholy/sickle IF.
9. Stairs cases only for fenk_stairs locs.
10. Pack IDs 763/764 registered; root must pack server varp.dat (+ client if any client-facing bits) on integration — ISO proved scripts compile with isolated pack only.
11. CANDIDATE labels honest in script headers / this report.
