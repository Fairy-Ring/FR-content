# Haunted Mine entrance traversal unit — implementer report

Task: `t_fe88b086`  
Branch: `codex/r377-hm-entrances` (base `d7b9e5709`)  
Worktree: `/Users/acfrazier/experiments/FR-vault/.worktrees/r377-hm-entrances`  
Date: 2026-09-08

## Scope written

| Path | Change |
|------|--------|
| `scripts/quests/quest_hauntedmine/scripts/hm_traversal.rs2` | **new** — 4913/4920, 4914/4921, 4915/4922 round trips + 4918 cart side hop |
| `scripts/ladders+stairs/scripts/stairs.rs2` | **only** `[oploc1,hauntedmine_main_entrance]` and `[oploc1,hauntedmine_main_entrance_inside]` |
| `.tmp/hm-entrances-report.md` | this report |

No root runtime/config/pack/services/helper/shared docs edits. No NPC/boss/puzzle/reward. No `%hauntedmine` / `%hauntedmine_bits` writers. No duplicate unpack overlays. Packed ops/IDs/models/forceapproach unchanged.

## Config unit identified (kept whole; not re-packed)

1. Entrance/obstacle locs **4913–4919** and inside **4920–4923** (377 debugnames, models, ops Crawl down/through, Walk-down/up, Climb over, main forceapproach=north).
2. Main stairs handlers in `stairs.rs2` (owned hop cases only this unit).
3. Deferred (not implemented): ladders **4965–4970**, dark/light stairs **4971–4973**, fungus **4932/4933**, puzzle cart **4974**, points panel/levers **4949–4961**, lift/valve **4924/4937+**.

## Sources (authority)

| Source | Role |
|--------|------|
| Root `AGENTS.md` | scope, review, no invent UNKNOWN |
| `docs/research/haunted-mine-traversal-contract-377.md` | pair table + landing candidates; M1 authorization |
| `docs/research/port-quest-config-unit-first-377.md` | config-unit-first process |
| `.tmp/r377-hm-source-contract/engine-footprint-root.json` | **oracle** full-perimeter reach + walk; supersedes mixed-API collision probes |
| `.tmp/r377-hm-source-contract/map-locs-root.json` | packed placement coords (level 0) |
| `pack/loc.pack` + `scripts/_unpack/377/all.loc` + `stairs.loc` | current 377 debugnames/ops/geometry |
| OSRS quick-guide excerpt (dated) in contract tree | era-adjusted **sequence** only, not tiles |

**Rejected:** original mixed ENGINE+HARNESS `changeLoc` probe results (API arity mismatch). Four-neighbor-only resolution is insufficient for multi-tile main stairs; full-perimeter root oracle used instead.

## Chosen coords (CANDIDATE hops; static approach VERIFIED)

Coord form `level_mx_mz_lx_lz` with world `(mx*64+lx, mz*64+lz)`.

| Pair | Surface loc | Inside loc | Down landing (inside) | Up landing (surface) | Notes |
|------|-------------|------------|------------------------|----------------------|-------|
| 4913/4920 | `hauntedmine_secondary_entrance` **3440,3232** `0_53_50_48_32` | **3437,9637** `0_53_150_45_37` | **3436,9637** `0_53_150_44_37` | **3439,3232** `0_53_50_47_32` | Surface alt **3441,3232** also VERIFIED reach; chose west of contract list |
| 4914/4921 | `hauntedmine_back_entrance1` **3430,3233** `0_53_50_38_33` | **3404,9631** `0_53_150_12_31` | **3405,9631** `0_53_150_13_31` | **3429,3233** `0_53_50_37_33` | Single surface candidate |
| 4915/4922 | `hauntedmine_back_entrance2` **3429,3225** `0_53_50_37_25` | **3408,9623** `0_53_150_16_23` | **3409,9623** `0_53_150_17_23` | **3428,3225** `0_53_50_36_25` | Surface alt **3430,3225** also VERIFIED; chose west of contract list |
| 4919/4923 | `hauntedmine_main_entrance` **3452,3243** `0_53_50_60_43` | **2790,4589** `0_43_71_38_45` | **2792,4592** `0_43_71_40_48` | **3454,3242** `0_53_50_62_42` | Inside centre of **2791..2793,4592**; surface sole full-perimeter candidate |

| Cart | Loc | Hop |
|------|-----|-----|
| 4918 `hauntedmine_obstacle_cart` | **3445,3236** `0_53_50_53_36` | **3444,3236** ↔ **3446,3236** (`0_53_50_52_36` ↔ `0_53_50_54_36`) via `p_teleport` by player x vs loc |

Unlisted placements: `switch_coord` **default** → mes + `coord_tostring` (crawl/cart) or `@unhandled_stairs` (main).

## Evidence labels

| Claim | Label |
|-------|--------|
| Packed loc IDs, names, ops, map placements, level 0 | VERIFIED (377 pack/map) |
| Static walk/reach of chosen stand/landing tiles on loaded m/l | VERIFIED (`engine-footprint-root.json`) |
| Pair connectivity as historical two-way route | CANDIDATE (names + geometry + sequence) |
| Exact landing offsets among multi-candidate tiles | CANDIDATE reconstruction |
| Cart climb animation / cycle timing / exact mes | UNKNOWN (not invented; bare side `p_teleport`) |
| Live round-trip transport / pathing | **not proved** this unit |

## Compile / live proof

- **Compile:** pending root integration. Task forbids mutating live engine pack while root RD frozen proof runs. No isolated compile output path was exercised; `BUILD_SRC_DIR` against live `vendor/engine` data/pack was not run.
- **Live paired hop proof:** deferred to root after source integration.
- **Acceptance limitation:** source is reviewable and collision-grounded; functional PASS requires later compile + live two-way hops.

## Intentional non-work

- Dark/light HM stairs still `@unhandled_stairs`
- No lever bits, cart ride, fungus, lift, Zealot changes
- No merge/push
