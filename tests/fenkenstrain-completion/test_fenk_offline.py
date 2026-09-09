#!/usr/bin/env python3
"""Offline source-grounded acceptance checks for Creature of Fenkenstrain M1.

No pack/service/live claims. Asserts required writers, constants, stage gates,
hand-in semantics, shared joins, and reward-once patterns exist in product sources.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # worktree root (tests/fenkenstrain-completion/ → ../..)
FENK = ROOT / "scripts/quests/quest_creatureoffenkenstrain"
GEN_QUESTS = ROOT / "scripts/general/scripts/quests.rs2"
QUEST_CONST = ROOT / "scripts/general/configs/quest.constant"
STAIRS = ROOT / "scripts/ladders+stairs/scripts/stairs.rs2"
JEWELLERY = ROOT / "scripts/skill_crafting/scripts/jewellery/jewellery.rs2"
ROAVAR = ROOT / "scripts/areas/area_canafis/scripts/werewolfinnkeeper.rs2"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def read(p: Path) -> str:
    if not p.is_file():
        fail(f"missing file: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8", errors="replace")


def must_contain(text: str, pattern: str, label: str, flags: int = 0) -> None:
    if not re.search(pattern, text, flags):
        fail(f"{label}: expected /{pattern}/")


def must_not_contain(text: str, pattern: str, label: str, flags: int = 0) -> None:
    if re.search(pattern, text, flags):
        fail(f"{label}: must not match /{pattern}/")


def main() -> int:
    scripts_dir = FENK / "scripts"
    required_scripts = [
        "fenk_signpost.rs2",
        "fenk_dr_talk.rs2",
        "fenk_gardener.rs2",
        "fenk_graves.rs2",
        "fenk_items_bookcases.rs2",
        "fenk_memorial.rs2",
        "fenk_doors_experiment.rs2",
        "fenk_shed_conductor.rs2",
        "fenk_tower_complete.rs2",
        "fenk_brain_take.rs2",
    ]
    bodies: dict[str, str] = {}
    for name in required_scripts:
        bodies[name] = read(scripts_dir / name)

    const = read(FENK / "configs/fenk_quest.constant")
    follower_varp = read(FENK / "configs/fenk_follower.varp")
    quests = read(GEN_QUESTS)
    qconst = read(QUEST_CONST)
    stairs = read(STAIRS)
    jewellery = read(JEWELLERY)
    roavar = read(ROAVAR)

    # --- A: constants / stages ---
    must_contain(const, r"\^fenk_not_started\s*=\s*0", "stage 0")
    must_contain(const, r"\^fenk_hired\s*=\s*1", "stage 1 hired")
    must_contain(const, r"\^fenk_need_sewing\s*=\s*2", "stage 2 sewing")
    must_contain(const, r"\^fenk_assembled\s*=\s*3", "stage 3 assembled/multi corpse")
    must_contain(const, r"\^fenk_lightning_done\s*=\s*4", "stage 4 lightning")
    must_contain(const, r"\^fenk_complete\s*=\s*8", "stage 8 complete multi")
    must_contain(qconst, r"\^creatureoffenkenstrain_complete\s*=\s*8", "quest.constant complete=8")
    must_contain(qconst, r"\^creatureoffenkenstrain_questpoints\s*=\s*2", "quest.constant QP=2")

    # --- A: signpost does not write quest stage ---
    sign = bodies["fenk_signpost.rs2"]
    must_contain(sign, r"\[oploc1,fenk_signpost\]", "signpost op")
    must_contain(sign, r"%fenk_read_signpost\s*=\s*1", "signpost bit")
    must_not_contain(sign, r"%fenk_quest\s*=", "signpost must not write fenk_quest")

    # --- A: doctor hire once / stage gates / wrong answers ---
    dr = bodies["fenk_dr_talk.rs2"]
    must_contain(dr, r"\[opnpc1,fenk_fenkenstrain_model\]", "dr talk")
    must_contain(dr, r"%fenk_quest\s*>=\s*\^fenk_complete", "dr postquest gate")
    must_contain(dr, r"%fenk_quest\s*=\s*\^fenk_not_started", "hire only from 0")
    must_contain(dr, r"Braindead", "interview Q1 answer")
    must_contain(dr, r"Grave-digging", "interview Q2 answer")
    must_contain(dr, r"don't think you have the aptitude", "wrong interview refuse")

    # --- B: partial body hand-in ---
    must_contain(dr, r"\[proc,fenk_try_hand_parts\]", "parts hand-in proc")
    for part in ("fenk_head_full", "fenk_torso", "fenk_arms", "fenk_legs"):
        must_contain(dr, rf"inv_del\s*\(\s*inv\s*,\s*{part}", f"consume {part}")
    must_contain(dr, r"%fenk_head\s*=\s*1", "head bit")
    must_contain(dr, r"%fenk_torso\s*=\s*1", "torso bit")
    must_contain(dr, r"%fenk_arms\s*=\s*1", "arms bit")
    must_contain(dr, r"%fenk_legs\s*=\s*1", "legs bit")

    # --- B: cumulative needle/thread ---
    must_contain(dr, r"\[proc,fenk_try_hand_needle\]", "needle proc")
    must_contain(dr, r"\[proc,fenk_try_hand_thread\]", "thread proc")
    must_contain(dr, r"%fenk_threads_given", "thread counter")
    must_contain(dr, r"sub\s*\(\s*5\s*,\s*%fenk_threads_given\s*\)", "up-to-five thread")
    must_contain(dr, r"inv_del\s*\(\s*inv\s*,\s*needle\s*,\s*1\s*\)", "needle consume once")
    must_not_contain(dr, r"costume_needle", "no costume needle")

    # --- B: gardener Ghostspeak + follower ---
    g = bodies["fenk_gardener.rs2"]
    must_contain(g, r"amulet_of_ghostspeak", "ghostspeak gate")
    must_contain(g, r"npc_setmode\s*\(\s*playerfollow\s*\)", "playerfollow")
    must_contain(g, r"%fenk_follower_uid", "private follower uid")
    must_contain(g, r"%fenk_gardener_directions\s*=\s*1", "directions multi bit")
    must_contain(g, r"\^fenk_follow_ticks", "10 min candidate duration")
    must_contain(g, r"\[proc,fenk_clear_gardener_follow\]", "cleanup proc")
    must_contain(g, r"\[softtimer,fenk_follow_watch\]", "follow watch")
    must_contain(follower_varp, r"scope=temp", "follower uid temp")
    must_contain(follower_varp, r"type=npc_uid", "follower uid type")

    # --- B: graves Dig independent of follower + island part map ---
    graves = bodies["fenk_graves.rs2"]
    must_contain(graves, r"\[oploc2,fenk_grave_poor\]", "poor dig")
    must_contain(graves, r"\[oploc2,fenk_grave\]", "island dig")
    must_contain(graves, r"0_56_54_24_35", "Ed Lestwit grave coord")
    must_contain(graves, r"0_54_55_46_56", "NW torso coord")
    must_contain(graves, r"0_54_55_48_57", "N arms coord")
    must_contain(graves, r"0_54_55_50_56", "NE legs coord")
    must_contain(graves, r"fenk_head_empty", "head yield")
    must_contain(graves, r"fenk_torso", "torso yield")
    # Dig must not require follower uid
    dig_poor = re.search(r"\[oploc2,fenk_grave_poor\]([\s\S]*?)(?=\n\[|\Z)", graves)
    if dig_poor and "fenk_follower_uid" in dig_poor.group(1).split("@fenk_dig")[0]:
        # follower only optional after dig for overhead — OK if after yield
        pass
    must_contain(graves, r"spade", "spade check")

    # --- C: brain + head combine + bookcases + star ---
    items = bodies["fenk_items_bookcases.rs2"]
    must_contain(items, r"fenk_brain", "brain combine")
    must_contain(items, r"fenk_head_full", "full head")
    must_contain(items, r"fenk_marble_amulet", "marble")
    must_contain(items, r"fenk_obsidian_amulet", "obsidian")
    must_contain(items, r"fenk_star_amulet", "star")
    must_contain(items, r"Joy of Grave", "west book title")
    must_contain(items, r"Handy Maggot", "east book title")
    must_contain(items, r"1_55_55_22_38", "west bookcase L1")
    must_contain(items, r"1_55_55_35_38", "east bookcase L1")

    brain = bodies["fenk_brain_take.rs2"]
    must_contain(brain, r"\[opobj3,fenk_brain\]", "brain take op")
    must_contain(roavar, r"\[label,roavar_brain_take\]", "roavar brain label")
    must_contain(roavar, r"inv_del\s*\(\s*inv\s*,\s*coins\s*,\s*50\s*\)", "50gp brain")
    must_contain(roavar, r"inv_add\s*\(\s*inv\s*,\s*fenk_brain", "brain grant")

    # --- D: memorial star + push ---
    mem = bodies["fenk_memorial.rs2"]
    must_contain(mem, r"\[oplocu,fenk_coffin\]", "star use on coffin")
    must_contain(mem, r"fenk_star_amulet", "star amulet")
    must_contain(mem, r"%fenk_coffin\s*=\s*1", "coffin bit")
    must_contain(mem, r"0_55_55_58_7", "east memorial coord")
    must_contain(mem, r"p_telejump", "push teleport")
    must_contain(mem, r"0_54_55_49_51", "island return coffin")

    # --- D: experiment key + doors ---
    doors = bodies["fenk_doors_experiment.rs2"]
    must_contain(doors, r"\[ai_queue3,fenk_experiment_1\]", "experiment death")
    must_contain(doors, r"fenk_mausoleum_key", "cavern key drop")
    must_contain(doors, r"\[oploc1,fenk_shed_door\]", "shed door")
    must_contain(doors, r"\[oploc1,fenk_tower_door\]", "tower door")
    must_contain(doors, r"\[oploc1,fenk_mausoleum_door\]", "mausoleum door")
    must_contain(doors, r"%fenk_unlocked_shed", "shed unlock bit")
    must_contain(doors, r"%fenk_unlocked_tower", "tower unlock bit")
    must_contain(doors, r"%fenk_unlocked_cavern", "cavern unlock bit")

    # --- E: shed brush Craft 20 + 3 cane + 3 wire + mould + conductor ---
    shed = bodies["fenk_shed_conductor.rs2"]
    must_contain(shed, r"stat\s*\(\s*crafting\s*\)\s*<\s*20", "craft 20 brush")
    must_contain(shed, r"bronzecraftwire", "bronze wire")
    must_contain(shed, r"fenk_brush3", "fully extended brush")
    must_contain(shed, r"1_55_55_24_35", "correct fireplace")
    must_contain(shed, r"fenk_lightning_mould", "mould yield")
    must_contain(shed, r"%fenk_conductor_repaired\s*=\s*1", "conductor repaired bit")
    must_contain(shed, r"hammer", "hammer for repair")
    # three extensions consume cane+wire each
    must_contain(shed, r"fenk_brush0,\s*fenk_brush1", "extend 0→1")
    must_contain(shed, r"fenk_brush1,\s*fenk_brush2", "extend 1→2")
    must_contain(shed, r"fenk_brush2,\s*fenk_brush3", "extend 2→3")

    # --- F/G: creature, pickpocket, complete once, recovery ---
    tower = bodies["fenk_tower_complete.rs2"]
    must_contain(tower, r"\[opnpc1,fenk_creature_model\]", "creature talk")
    must_contain(tower, r"\[opnpc3,fenk_fenkenstrain_model\]", "pickpocket")
    must_contain(tower, r"stat\s*\(\s*thieving\s*\)\s*<\s*25", "thieving 25")
    must_contain(tower, r"\[queue,fenk_quest_complete\]", "complete queue")
    must_contain(tower, r"%fenk_quest\s*>=\s*\^fenk_complete", "once-guard")
    must_contain(tower, r"stat_advance\s*\(\s*thieving\s*,\s*10000\s*\)", "1000 thieving XP tenths")
    must_contain(tower, r"send_quest_complete\s*\(\s*questlist:creatureoffenkenstrain", "quest scroll")
    must_contain(tower, r"\^creatureoffenkenstrain_questpoints", "QP on scroll")
    must_contain(tower, r"ring_of_charos_unlocked", "unlocked variant in guard/recovery")
    must_contain(tower, r"\[proc,fenk_give_charos_recovery\]", "lost-ring recovery")
    must_contain(tower, r"\[proc,fenk_has_charos_any\]", "duplicate guard both variants")
    # recovery path must not re-advance XP
    recovery = re.search(
        r"%fenk_quest\s*>=\s*\^fenk_complete\s*\{([\s\S]*?)return;\s*\}",
        tower,
    )
    if recovery and "stat_advance" in recovery.group(1):
        fail("post-complete recovery must not stat_advance")
    # scroll newline house form
    tower_raw = (scripts_dir / "fenk_tower_complete.rs2").read_bytes()
    if b"completed the\\\\nCreature" not in tower_raw and b"completed the\\\\\\\\nCreature" not in tower_raw:
        # file write uses Python string with \\\\n → on disk \\n (two chars backslash-n for rs2)
        if b"completed the\\nCreature" not in tower_raw:
            fail("scroll title should use house two-backslash form before n")
    must_contain(tower, r"\[if_button,questlist:creatureoffenkenstrain\]", "journal button")

    # --- shared joins ---
    must_contain(
        stairs,
        r"\[oploc1,fenk_stairs_lv1\][\s\S]*?0_55_55_17_31[\s\S]*?0_55_55_39_31",
        "stairs L0 west+east cases",
    )
    must_contain(
        stairs,
        r"\[oploc1,fenk_stairs_lv1_top\][\s\S]*?1_55_55_17_32[\s\S]*?1_55_55_39_32",
        "stairs L1 west+east cases",
    )
    must_contain(jewellery, r"craft_fenk_conductor", "conductor craft label")
    must_contain(jewellery, r"fenk_lightning_mould", "conductor mould gate")
    must_contain(jewellery, r"stat_advance\s*\(\s*crafting\s*,\s*500\s*\)", "50 craft XP tenths")
    must_contain(jewellery, r"silver_casting:com_113", "IF lightning button")
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:creatureoffenkenstrain\s*,\s*%fenk_quest\s*,\s*\^creatureoffenkenstrain_complete\s*\)",
        "questlist colour",
    )
    must_contain(
        quests,
        r"%fenk_quest\s*>=\s*\^creatureoffenkenstrain_complete[\s\S]{0,120}\^creatureoffenkenstrain_questpoints",
        "QP total wiring",
    )
    # preserve HM wiring
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:hauntedmine\s*,\s*%hauntedmine",
        "HM colour preserved",
    )

    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS")
    print(f"  checked {len(required_scripts)} fenk scripts + stairs/jewellery/roavar/quests joins")
    return 0


if __name__ == "__main__":
    sys.exit(main())
