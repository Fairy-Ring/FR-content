# Creature of Fenkenstrain — completion report (r377 / t_3d84d490)

## 4 November 2026 unit update

The doctor now uses the operator-selected RS3 speech, including the unread-signpost branch, without Quest Overview or tool-belt systems. The signpost checks Crafting 20 and Thieving 25; the doctor retains no skill start gate. Both upstairs bookcases present sourced four-title menus, including the eastern title removed from OSRS in 2024. Ordinary castle doors and the no-follower-gate Dig rule are unchanged.

Body-part bits and sewing supplies now recover interrupted hand-ins, and stage 3 is written before the sewing box so the corpse appears with it. Server varp 764 is named `fenk_charos_unlocked`; its ID and persistence are unchanged. The detailed source records, September E–G diagnosis, offline checks and required live checks are in the vault's Fenkenstrain subject and the external `FENK-UNIT-1104/report.md`. This update does not claim a live E–G pass.

The sections below retain the September implementation evidence.

Date stamp: 2026-09-10 (behavior-repair after integration APPROVE residuals)  
Branch/worktree: `codex/r377-fenk-behavior-repair` / `r377-fenk-behavior-repair` @ 100ad6f4 + this commit  
Contracts: root `.tmp/r377-fenkenstrain-m1-2026-09-09/` (full-source-contract, root-precontract, integration-review, retained transcript)

## R5 behavior repairs (this card)

Integration APPROVE listed residuals that did **not** remove original quest requirements. This unit implements the six required repairs. Exact leash distance remains **UNKNOWN**. Product not bent to fit a smoke.

### Repair map (requirement / source / handler test / evidence)

| ID | Requirement | Source | Production handler | Test | Evidence |
|----|-------------|--------|--------------------|------|----------|
| 1 | Same-plane teleport ends gardener follow + restores courtyard; not every walk; no invented leash | Contract §3.2 loss on teleport (C guide); engine PLAYERFOLLOW has no maxrange (U leash) | Stock owner `scripts/skill_magic/scripts/spells/teleport.rs2` `[proc,p_telejump_safe]` (magic/jewellery/`~player_teleport_normal`) calls `~fenk_on_gameplay_teleport`. Memorial Push (exclusive `p_telejump`) also calls it. **Not** hooked on `p_teleport` (stairs / death dest). | `test_fenk_handlers.mjs` executes `[proc,fenk_on_gameplay_teleport]`: clears `%fenk_follower_uid`, restores directions bit, **cat `%follower_uid` unchanged**. Offline: stairs must not call the hook; `p_telejump_safe` must not call `~follower_death`. | Isolated compile `ISOLATED_OK` script.dat 8706927. Gardener movement proof retained. Live same-plane tele still pending root live proof. |
| 2 | experiment_1 bones + key once-per-need | 377 `param=death_drop,bones`; `[ai_queue3,_]` = `npc_default_death`; chicken pattern after `npc_del` | `[ai_queue3,fenk_experiment_1]` `gosub(npc_default_death)` then key `obj_add(npc_coord, …)` if inv lacks key. Killer via `npc_findhero`. | Compiled trigger present. **Constraint:** executing `npc_default_death` needs World `npc_delay`/`arrivedelay` tick loop — pending live. Offline asserts `gosub(npc_default_death)` not `gosub(npc_death)`. | Standard helper restored; key once-per-need preserved. |
| 3 | Clock full-inv must not lose letter; Read not invented | Transcript 268–273 (wind tbox + re-wind while holding). Letter **body UNKNOWN**. 377 cache `desc=A letter, clearly hastily written.` | `[proc,fenk_try_clock_letter]`: holding letter → `You wind the old clock.`; full inv → refuse **before** wound bit; else bit+grant+transcript tbox. Read = cache desc only. | Handler: full-inv FINISHED no bit/no letter; grant PAUSEBUTTON; re-wind FINISHED no duplicate; lost-letter retry PAUSEBUTTON. Offline: bit after freespace; no invented Read. | FontType+Component loaded. Live Read/wind still pending. |
| 4 | Head re-dig after hand-in like island parts; lost pre-hand-in reacquirable | Contract §3.2 loss of head → re-Dig; island parts already check hand-in bits | `[proc,fenk_try_dig_head]`: empty if held empty/full **or** `%fenk_head = 1`; else grant. Gardener follow also refuses if `%fenk_head = 1`. | Handler: grant; held refuse; hand-in empty; full-inv refuse without writing bit. | Matches island-part semantics. |
| 5 | Hire PiP + Restless Ghost refusals | kbase 1793 CANDIDATE. Product constants `^priestperil_complete` / `^priest_complete` — not guessed ints. Period refuse quotes **missing** — stock mes, not a third Dr voice. Ghostspeak still gates gardener separately. | `[proc,fenk_hire_prereqs]` before interview. | Handler: false without PiP; false without RG; true when both complete. | CANDIDATE req mes. |
| 6 | F3 bank/worn/inv duplicate guard; no repeat XP/QP; Garden seam recorded not ported | Tip.it 2006-06-16 CANDIDATE recovery; Garden out of scope | Existing `fenk_has_charos_any` / recovery / note. `quest_garden/{garden_ellamaria,garden_bernald}.rs2` have **zero** Charos writers. Varp comment names the exact seam: Garden unlock must set `%fenk_charos_unlocked` when authored. | Handler: bank path; worn (u) notes mem; recovery base vs (u); recovery proc does not complete/XP. Offline: bank/worn/inv both variants. | No Garden port. |

### Stock teleport ownership

`~player_teleport_normal` → `~p_telejump_safe` in `scripts/skill_magic/scripts/spells/teleport.rs2` is the stock gameplay teleport procedure (magic buttons, glory/dueling/life/minigames jewellery, wilderness levers, KBD, mage arena, macros, etc.). Cat/RD: hook is fenk-only no-op without `%fenk_follower_uid`; death.rs2 still does RD dest then `~follower_death` then `~fenk_on_player_cleanup`; logout still `~follower_logout` then fenk cleanup; **zero** fenk in `pet.rs2`. Stairs remain `p_teleport` (not teleport-loss).

### Tests run

```
python3 tests/fenkenstrain-completion/test_fenk_offline.py
→ PASS (static source-regex only)

tests/fenkenstrain-completion/setup-iso.sh
→ ISOLATED_OK script.dat size 8706927; sibling content overlay + exclusive CoF/teleport;
  RSA keys generated in ISO (not copied); worktree pack/script.pack not written;
  shared vendor/content/pack/script.pack unchanged

cd .tmp/fenk-iso-compile-r422/engine && node --import tsx ../../../tests/fenkenstrain-completion/test_fenk_gardener_move.mjs
→ RESULT PASS (real Npc.updateMovement)

cd .tmp/fenk-iso-compile-r422/engine && node --import tsx ../../../tests/fenkenstrain-completion/test_fenk_handlers.mjs
→ RESULT PASS (ScriptRunner on compiled procs: clock/head/hire/F3/teleport/cat UID)
  FontType q8_full + Component loaded from ISO client jag. Clock grant/recovery
  assert PAUSEBUTTON (mesbox Continue). Other procs assert FINISHED. ABORTED fails.
  Prior attempt: missing fonts → split_init abort after grant; swallowed — not PASS.
```

Experiment **bones on the ground** and same-plane **live client teleport** remain pending root live proof. Unknown leash not invented.

## Prior R4 summary (retained)

Exclusive CoF writers + authorized shared joins for full A–G arcs. Round-3/4 fixes retained (memorial underband, mobile gardener, Charos mem honesty).

## Summary


Exclusive CoF writers + authorized shared joins for full A–G arcs. Round-3 fixes vs R2:

1. **Memorial destinations** — island Push no longer uses surface `movecoord(…, −6400)` (z=−2829). Both Push paths land on **underband** stands from root collision receipt next to mapped `ladder_1757` anchors. Wiki retrace-through-cavern preserved.
2. **Acceptance matrix** — no functional/historical **PASS** from static regex. Rows are STATIC / CANDIDATE / UNKNOWN / residual.
3. **Charos (u)** — observation-incomplete residual documented; F3 not claimed for all unlocked loss paths.
4. **Config-first** — named inventory + experiment `category=fenk_experiment`; no authorship transfer of missing authored config to root (root packs only).

Lifecycle (R2 landed, retained): logout/death `~fenk_on_player_cleanup`; login `queue(fenk_on_login_cleanup)`; **no pet.rs2**. Charos mem: perm varp 764 (not digresult=7). Quest varps `scope=perm`.

## Files touched (this unit)

### Exclusive

| Path | Role |
|------|------|
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_quest.constant` | Stage ladder 0/1/2/3/4/8 |
| `scripts/quests/quest_creatureoffenkenstrain/configs/fenk_follower.varp` | temp `%fenk_follower_uid` + perm `%fenk_charos_unlocked` |
| `scripts/.../fenk_*.rs2` (10 scripts) | Full quest writers |
| `scripts/_unpack/377/all.{npc,varp}` | Experiment combat fills + perm scope |
| `pack/varp.pack` | 763/764 |

### Shared joins (authorized)

| Path | Change |
|------|--------|
| `scripts/ladders+stairs/scripts/stairs.rs2` | fenk stairs W/E both directions |
| `scripts/skill_crafting/scripts/jewellery/jewellery.rs2` | conductor IF + 50 XP |
| `scripts/areas/area_canafis/scripts/werewolfinnkeeper.rs2` | Roavar 50gp brain |
| `scripts/general/configs/quest.constant` | complete=8 / QP=2 only |
| `scripts/general/scripts/quests.rs2` | colour + QP (HM preserved) |
| `scripts/login_logout/scripts/{logout,login}.rs2` | cleanup hooks |
| `scripts/player/scripts/death.rs2` | cleanup hook |

`ladders.rs2`: **zero fenk-named joins** — stock `ladder_1757` Climb-up `movecoord(coord(),0,0,−6400)` pairs both underband ladders (3504,9970 island; 3578,9927 east) to surface. Documented pairing, not missing exclusive work.

## Memorial map pairing (R3)

| Surface loc | Underband dest (CANDIDATE stand) | Anchor | Evidence |
|-------------|----------------------------------|--------|----------|
| East 5167@3578,3527 (`0_55_55_58_7`) | **3577,9927** = `0_55_155_57_7` | ladder_1757@3578,9927 | root-memorial-collision unique reachable/unblocked |
| Island 5167@3505,3571 (`0_54_55_49_51`) | **3504,9969** = `0_54_155_48_49` | ladder_1757@3504,9970 | same receipt; wiki lines 105–110 retrace cavern |

- Rejected: island `movecoord(loc,−1,0,−6400)` → z=−2829 (invalid).
- Rejected: generic west offset on east coffin angle3 as historical claim (east surface approach stand is 3578,3526 south).
- Residual: exact historical teleport **offset** unproven live; collision proves static approach/stand only. Labels remain **CANDIDATE**.
- Surface return from underband: stock ladder_1757 (no fenk ladder join).

## Named config inventory (config-first)

Brief retained counts 22obj/13npc/80loc/2varp/17varbit/8seq. Observed in unpack + exclusive adds:

### Obj (23 named fenk/Charos rows in all.obj)

`fenk_star_amulet`, `fenk_mausoleum_key`, `fenk_tower_key`, `fenk_shed_key`, `fenk_marble_amulet`, `fenk_obsidian_amulet`, `fenk_cane`, `fenk_brush0`–`3`, `fenk_torso`, `fenk_arms`, `fenk_legs`, `fenk_head_empty`, `fenk_head_full`, `fenk_brain`, `fenk_lightning_mould`, `fenk_conductor`, `ring_of_charos`, `fenk_journal`, `fenk_letter` + pack `ring_of_charos_unlocked` (6465, Garden name(u) preserved, no Garden behavior). Models/IDs preserved. No movement/timer on objs.

### Npc (13)

Multi/static: gardener_multi, gardener_multi_2, fenkenstrain, fenkenstrain_in_tower, fenkenstrain_model, creature, creature_released, creature_model, creature_model_2, gardener.  
Combat: experiment_1/2/3 — **fills this unit**: CANDIDATE combat ints (03997911d3 later-data lineage), `param=attackrate,4`, damagetype, attack/defend/death anims (named seqs exist), death_drop=bones, wander/max/respawn, **`category=fenk_experiment`** (free-string tag pattern like `witches_experiment`).  
**Gardener movement (R3#1 / root runtime):** `fenk_gardener` is the **dynamic follower type** — **not** `moverestrict=nomove` (engine `Npc.updateMovement` returns false unconditionally on NOMOVE, independent of `npc_setmode(playerfollow)`). Pin is on multi **parents** only: `fenk_gardener_multi` / `fenk_gardener_multi_2` have `moverestrict=nomove` + `wanderrange=0` + `defaultmode=none`. Child keeps `wanderrange=0` + `defaultmode=none` so a non-following instance does not wander. Proven by `tests/fenkenstrain-completion/test_fenk_gardener_move.mjs` (real `updateMovement`, follower coords change, multi frozen; exceptions fail).

### Loc (exact 80 = 78 all.loc + 2 stairs.loc)

**Named inventory (root-precontract last paragraph resolved):**  
- `scripts/_unpack/377/all.loc`: **78** `fenk_*` defs (interactive core + chrome).  
- `scripts/ladders+stairs/configs/stairs.loc`: **`fenk_stairs_lv1`**, **`fenk_stairs_lv1_top`** (migrated; lines ~970/987) — not missing unknown.  
- **Total 80** named fenk locs. No approximate 78-vs-80 residual.  
Interactive core includes coffin, grave, grave_poor, doors (shed/tower/mausoleum + open), broomcupboard±open, canepile, signpost, fireplace±surrounds, bookcase, conductor broken/repaired, table/table_corpse/multi, clock, chests, bridges (Construction shortcut **SUBTRACT** — present chrome only). Remainder walls/grass/columns chrome.  
**Movement/timer on locs**: stairs forceapproach + sharelight present; no missing loc timer fills identified under exclusive scope. Map **instance** placement is packed map (root pack), not all.loc defs.

### Varp (2 unpack + 2 exclusive)

| Name | Scope | Notes |
|------|-------|-------|
| `%fenk_quest` | **perm** (filled R2) | stage |
| `%fenk_flags` | **perm** (filled R2) | bitfield base |
| `%fenk_follower_uid` | temp, protect=no | pack 763 NONHISTORICAL |
| `%fenk_charos_unlocked` | perm | pack 764 NONHISTORICAL |

### Varbit (17 on fenk_flags)

directions, arms, legs, torso, head, needle, threads_given(3), coffin, spoken_to_gardener, conductor_repaired, wound_clock, counter(5), digresult(3) **left free**, unlocked_tower/cavern/shed, read_signpost.  
Client JAG basevar pairing required on root integration for any **new** varbit; this unit did not add varbits (Charos uses server perm varp).

### Seq (8 fenk_* + experiment combat family)

fenk_capstone_moves, bookcase_open, fireplace_glow/candle, signpost_swing, lightning, human_poke/_short.  
Combat (not fenk-named but wired): homolupus_{attack,defend,death}, waa_homo_arachnus_*, waa_ovinocanus_* — defs present in all.seq.

### Authored residual (implementer, not root authorship dump)

| Gap | Label | Action |
|-----|-------|--------|
| Exact memorial tele offset vs live historical | CANDIDATE stand only | collision-grounded dests shipped; live offset unproven |
| Experiment combat ints period authenticity | CANDIDATE later-data | labeled; no invented period stats |
| Experiment sounds | UNKNOWN / absent | many combat NPCs have attack_sound; not filled without source |
| Follower leash tiles | UNKNOWN | plane + duration only |
| Charos mem without Garden observation | residual | see F3 |
| Obj 23 vs brief 22 | + unlocked pack row | preserved |

### Pack needs for root (execution only)

1. Server `varp.dat`: include 763, 764 + fenk_quest/flags with scope=perm.  
2. Server `npc.dat`: experiment category + combat params; **gardener multi parents NOMOVE, `fenk_gardener` mobile** (no NOMOVE on follower type).  
3. Client config JAG if any client-facing varbit/obj changes (this unit: no new client varbit).  
4. Script pack from exclusive tree.  
5. **Do not** treat models+vislevel alone as combat-ready without the param fills above (now present as CANDIDATE).  
Shared live pack/reload remains root-only; ISO compile proves scripts under worktree sandbox only.

## Acceptance matrix (A–G)

**Legend:** STATIC = offline source-regex only · CANDIDATE = source-backed era-adjusted · UNKNOWN = unresolved · residual = incomplete by design pending out-of-scope · never claim functional/historical PASS from grep.

| ID | Criterion | Status | Source / test |
|----|-----------|--------|---------------|
| A1 | Signpost bit only | STATIC | fenk_signpost.rs2; offline regex |
| A2 | Hire interview Braindead/Grave-digging | STATIC | fenk_dr_talk; Transcript |
| A3 | Stages 0→1…→8 multi | STATIC | fenk_quest.constant + multi tables |
| B1 | Partial body hand-in | STATIC | fenk_try_hand_parts |
| B2 | Needle once + thread ≤5 cumulative | STATIC | Transcript 381–399 |
| B3 | Ghostspeak + follower cleanup + **mobile follower** | STATIC + **engine movement** | logout/death/login hooks; not pet.rs2; `test_fenk_gardener_move.mjs` real coords |
| B4 | Dig independent of follower; island map | STATIC + CANDIDATE coords | Transcript 305–350 NW/N/NE |
| C1 | Brain 50gp + Telegrab alternate | STATIC | Roavar join; telegrab generic engine |
| C2 | Bookcases + star | STATIC | titles + halves |
| D1 | Star + Push east/island | **CANDIDATE** dests | collision JSON + wiki 105–110; STATIC asserts dests |
| D2 | Experiment key once-per-need | STATIC | ai_queue3 + npc_coord |
| D3 | Door unlock bits | STATIC | shed/tower/cavern |
| E1 | Brush Craft20; 3 cane+3 wire | STATIC | Transcript |
| E2 | Fireplace mould | STATIC | L1 west coord |
| E3 | Conductor 50 XP + hammer repair | CANDIDATE XP | Transcript 534 |
| F1 | Creature talk + Thieving25 pickpocket | STATIC | |
| F2 | Complete once 2QP+1000 Thieving+ring | STATIC | scroll `\\n` house form |
| F3 | Lost-ring recovery no XP/QP | **CANDIDATE + residual** | Tip.it 2006-06-16; mem observation-only — **not** all (u) paths |
| G1 | Questlist colour + journal | STATIC | quests.rs2 join |
| G2 | Optional clock letter | STATIC | lore only |

### Shared joins matrix

| Join | Status | Notes |
|------|--------|-------|
| stairs fenk W/E both ways | STATIC | stairs.rs2 cases |
| jewellery conductor IF | STATIC | com_113; HM/holy paths untouched |
| Roavar brain 50gp | STATIC | |
| quest.constant CoF pair | STATIC | unique complete=8 QP=2 |
| quests.rs2 colour+QP | STATIC | HM preserved |
| logout/death/login cleanup | STATIC | pet.rs2 clean |
| ladder_1757 stock | STATIC doc | no fenk_ name; pairing via coords |

## Lost-ring recovery (honest F3)

Evidence: Tip.it elComment_776260 16 Jun 2006 — recover by pickpocketing doctor; if previously (u), recovered remains (u).

| Predicate | Yield |
|-----------|-------|
| `%fenk_charos_unlocked = 1` | `ring_of_charos_unlocked` |
| else | `ring_of_charos` (base) |

- mem set only when unlocked **observed held** (`~fenk_note_charos_unlocked` on pickpocket refuse).  
- First complete grants **base only** — never notes.  
- Garden unlock **out of CoF scope** — does not set mem here.  
- Therefore: prior-(u) loss **without** later doctor observation of (u) recovers **base**, not (u). Full Tip.it retained-unlock needs Garden (or equivalent) to set mem on unlock.  
- digresult bits 17–19 left free. Duplicate guard both variants inv/worn/bank. No XP/QP on recovery.

## Lifecycle / gardener

| Concern | Decision |
|---------|----------|
| Cleanup | logout + death `~fenk_on_player_cleanup`; login queue |
| pet.rs2 | **not hooked** |
| Softtimer | queues protected cleanup (p_active_player) |
| Voice | south Haunted Forest restatement only |
| Leash | **UNKNOWN** — plane-change + duration; softtimer plane loss ≠ full any-teleport |
| Movement | **follower type mobile**; multi parents `moverestrict=nomove`; engine movement proof PASS |

## Tests run

```
python3 tests/fenkenstrain-completion/test_fenk_offline.py
→ PASS (static source-regex only — not functional/historical acceptance)

cd .tmp/fenk-iso-compile-r422/engine && node --import tsx ../../../tests/fenkenstrain-completion/test_fenk_gardener_move.mjs
→ RESULT PASS (real Npc.updateMovement: follower 3200,3200→3203,3200; multi frozen; exceptions fail)
  (ISO data/config pems present for World import only; no World.start/services; shared packs untouched)

Isolated config pack after gardener moverestrict fix:
  BUILD_SRC_DIR=<iso>/content npx tsx pack-server-configs.mjs
  → ISOLATED_CONFIG_PACK_OK (varp/varbit/npc)

Isolated compile (.tmp/fenk-iso-compile-r422/) retained from R3:
  BUILD_SRC_DIR=<iso>/content npx tsx compile-isolated.mjs
  → ISOLATED_OK script.dat size 8497899; exit 0
  shared vendor/content/pack/script.pack sha256 unchanged:
    2c3d8b2b2c3a8c1bc6770ef41ed1b2847f4b768ff248f9b8117d85fadd30ad8e
  ISO category.pack registered 150=fenk_experiment (revalidate crawl; ISO only)
```

No live client / shared pack / server proof in this worker. Handler-execution tests beyond movement proof not available without engine harness in exclusive scope — labeled STATIC honestly.

## Reviewer focus (R4)

1. **Gardener movement:** `fenk_gardener` not NOMOVE; multi parents NOMOVE; engine test proves follower coords change and multi does not.  
2. Loc inventory exact 80 = 78 all.loc + stairs `fenk_stairs_lv1`/`_top` (no 78-vs-80 residual).  
3. Island Push dest `0_54_155_48_49` (3504,9969) — **not** −6400; east `0_55_155_57_7` (3577,9927).  
4. Matrix has no functional PASS from regex; F3 residual honest.  
5. Named config inventory + experiment `category=fenk_experiment`; pack list for root only.  
6. pet.rs2 clean; lifecycle hooks retained.  
7. digresult not used for Charos.  
8. quest.constant unique CoF pair; HM joins preserved.  
