# Recruitment Drive reward modal — implementer report

Task: `t_89b96714`  
Branch: `codex/r377-rd-reward-modal` (base `97194d595`)  
Worktree: `/Users/acfrazier/experiments/FR-vault/.worktrees/r377-rd-reward-modal`  
Date: 2026-09-08

## Scope written

| Path | Change |
|------|--------|
| `scripts/quests/quest_rd/scripts/rd_rewards.rs2` | Reorder finish: `~rd_run_reset` before `~send_quest_complete`; header docs for marker 2 / Tiffy handoff |
| `.tmp/rd-reward-modal-report.md` | this report |

No root runtime/config/pack/services/shared docs. No node/browser/live. No `rd_ren.rs2` / `rd_route.rs2` edits (Ren `if_close` kept). No reward quantity/XP/eligibility changes. No merge/push.

## Diagnosis (source)

Call path before fix:

1. `rd_tiffy_finish` → `~rd_rewards_finish` (or root call with marker 2)
2. Mark `%rd_main = ^recruitmentdrive_complete`, `%rd_assessment = 0`
3. Grants (XP / coins / helm / optional voucher / gaze bit)
4. `~send_quest_complete` → `if_openmain(questscroll_death)` (default scroll)
5. `~rd_run_reset` → `~rd_ren_reset` → unconditional `if_close`

`if_close` after step 4 dismissed the quest complete scroll. Live symptom: Prayer level-up from `stat_advance` with no lasting scroll (prior live: 65 quest-complete PNG / Prayer level-up, never actual scroll).

Root cause is **order**, not Ren reset ownership. Ren `if_close` is correct for combolock cleanup on fail/quit/re-enter; finish must finish cleanup before opening the scroll.

## Fix

`[proc,rd_rewards_finish]` order (no yield between mark and grants; quantities unchanged):

1. Guards: `%rd_main = 1`, `~rd_rewards_finish_ready` (`%rd_assessment = 2`)
2. Mark: `%rd_main = ^recruitmentdrive_complete`; `%rd_assessment = 0`
3. Grants: prayer/herblore/agility XP tenths, coins, `basic_tk_helm`, optional `rd_makeover_ticket`, `%falador_spawn = 1`, session_log
4. `~rd_run_reset` (full cleanup; may `if_close`)
5. `~send_quest_complete(...)` last so scroll stays open

Header updated from stale “root before park / cursor=5 / five physical completes” to actual **pending marker 2 / Tiffy** handoff (`rd_lifecycle` / `rd_run_finish` set `%rd_assessment = 2` after park reset; Tiffy awards).

## No-yield / inventory contract (source review)

| Proc | Yield (`p_delay` / chat)? | Inv |
|------|---------------------------|-----|
| `rd_run_reset` | no | delegates only; clears assessment/route/rooms/queues |
| `rd_ren_reset` | no (`if_close` only) | none |
| `rd_spishyus_reset` / `rd_tinley_reset` / `rd_hynn_reset` / room clear / despawns | no | none (NPC del / var clear) |
| `rd_reset_fox` | no | **trial only**: `rd_fox`, `rd_chicken`, `rd_sack` |
| `rd_reset_chem` / `rd_chem_reset` | no | **trial only**: chem reagents/tools/key (not coins / helm / voucher) |

Durable awards **not** removed by reset: `coins`, `basic_tk_helm`, `rd_makeover_ticket`, `%rd_main`, `%falador_spawn`, `%rd_male_at_start`.

Ren `if_close` / `rd_ren_reset` **not removed**.

## Source call path (post-fix)

```
rd_run_finish
  → validate lifecycle → rd_run_reset → %rd_assessment=2 → park Falador

rd_teleporter_guy talk
  → finish_ready (main=1, assessment=2) → rd_tiffy_finish
    → chat lines → rd_rewards_finish
      → mark main complete + assessment 0
      → grants (no yield)
      → rd_run_reset (→ rd_ren_reset if_close)
      → send_quest_complete (questscroll_death open last)
```

## Compile / live proof

- **Compile:** pending root (server stopped; task forbids pack/services/root shared).
- **Live visual scroll:** pending root after CW review + compile.
- **Acceptance this card:** source order + no-yield/inv contract reviewable; functional scroll PASS deferred.

## Intentional non-work

- No change to reward amounts, XP tenths, or finish_ready predicate
- No strip of Ren `if_close`
- No edits outside `rd_rewards.rs2` + this report
- No merge/push
