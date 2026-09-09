#!/usr/bin/env python3
"""Offline source-grounded acceptance checks for HM conclusion unit (T5).

No pack/service/live claims. Asserts required writers, constants, and
guard/reward arithmetic patterns exist in product sources.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]  # worktree root
HM = ROOT / "scripts/quests/quest_hauntedmine"
GEN_QUESTS = ROOT / "scripts/general/scripts/quests.rs2"
QUEST_CONST = ROOT / "scripts/general/configs/quest.constant"

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


def main() -> int:
    # --- required new files ---
    reward = read(HM / "scripts/hm_reward_door.rs2")
    cut = read(HM / "scripts/hm_crystal_cut.rs2")
    complete = read(HM / "scripts/hm_complete.rs2")
    journal = read(HM / "scripts/hm_journal.rs2")
    hm_const = read(HM / "configs/hm_quest.constant")
    quests = read(GEN_QUESTS)
    qconst = read(QUEST_CONST)

    # --- constants: complete=2, QP=2; preserve 0/1 ---
    must_contain(hm_const, r"\^hauntedmine_not_started\s*=\s*0", "hm_quest.constant not_started")
    must_contain(hm_const, r"\^hauntedmine_started\s*=\s*1", "hm_quest.constant started")
    must_contain(qconst, r"\^hauntedmine_complete\s*=\s*2", "quest.constant complete=2")
    must_contain(qconst, r"\^hauntedmine_questpoints\s*=\s*2", "quest.constant QP=2")
    # no Ernest collision
    if re.search(r"\^haunted_complete\s*=\s*2", qconst):
        fail("must not redefine ^haunted_complete (Ernest)")

    # --- reward doors: pair L/R, key 4077 name, non-consume, keyring ---
    must_contain(reward, r"\[oploc1,hauntedmine_rewarddoor_l\]", "reward door L op")
    must_contain(reward, r"\[oploc1,hauntedmine_rewarddoor_r\]", "reward door R op")
    must_contain(reward, r"hauntedmine_reward_key", "reward key check")
    must_contain(reward, r"osf_key_ring_has", "keyring support")
    must_contain(reward, r"The door is locked", "missing-key mes")
    # non-consuming: no inv_del of reward key
    if re.search(r"inv_del\s*\(\s*inv\s*,\s*hauntedmine_reward_key", reward):
        fail("reward door must not consume hauntedmine_reward_key")
    # must not touch 383/762
    if "hauntedmine_bits" in reward or "hauntedmine_points_store" in reward:
        fail("reward door must not touch 383/762")

    # --- crystal cut: three locs, chisel, craft 35, shard 4082, complete once ---
    for loc in ("crystalcorner", "crystaledging", "largecrystals"):
        must_contain(cut, rf"\[oploc1,{loc}\]", f"cut op {loc}")
    must_contain(cut, r"inv_total\s*\(\s*inv\s*,\s*chisel\s*\)", "chisel check")
    must_contain(cut, r"stat\s*\(\s*crafting\s*\)\s*<\s*35", "crafting 35 boostable gate")
    must_contain(cut, r"inv_freespace\s*\(\s*inv\s*\)", "full inv guard")
    must_contain(cut, r"crystalshard_necklace_unstrung", "salve shard yield")
    must_contain(cut, r"You cut a shard from the crystal", "cut mes")
    must_contain(cut, r"queue\s*\(\s*hm_quest_complete", "complete queue on first cut")
    if "hauntedmine_bits" in cut or "hauntedmine_points_store" in cut:
        fail("crystal cut must not touch 383/762")

    # --- complete writer: once-guard, XP tenths, scroll, session log ---
    must_contain(complete, r"\[queue,hm_quest_complete\]", "complete queue trigger")
    must_contain(
        complete,
        r"%hauntedmine\s*>=\s*\^hauntedmine_complete",
        "once-guard before grants",
    )
    must_contain(complete, r"%hauntedmine\s*=\s*\^hauntedmine_complete", "set complete stage")
    # 22,000 Strength XP → engine tenths 220000 (scorpcatcher 66250≡6625)
    must_contain(complete, r"stat_advance\s*\(\s*strength\s*,\s*220000\s*\)", "Str XP 220000 tenths")
    must_contain(complete, r"send_quest_complete\s*\(\s*questlist:hauntedmine", "quest scroll")
    must_contain(complete, r"\^hauntedmine_questpoints", "QP arg on scroll")
    must_contain(complete, r"session_log", "session log")
    # House scroll newline: exactly two source backslashes before n (5c 5c 6e),
    # matching RD/scorpcatcher — not four (5c×4 6e) which fails to line-break.
    complete_raw = (HM / "scripts/hm_complete.rs2").read_bytes() if (HM / "scripts/hm_complete.rs2").is_file() else b""
    if b"completed the\\\\nHaunted" not in complete_raw:
        fail("scroll title must use house two-backslash form: completed the\\\\nHaunted")
    if b"completed the\\\\\\\\nHaunted" in complete_raw:
        fail("scroll title must not use four backslashes before n (would not line-break)")
    if "hauntedmine_bits" in complete or "hauntedmine_points_store" in complete:
        fail("complete must not touch 383/762")

    # --- journal + colour + QP wiring ---
    must_contain(journal, r"\[if_button,questlist:hauntedmine\]", "journal button")
    must_contain(journal, r"\^hauntedmine_complete", "journal complete branch")
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:hauntedmine\s*,\s*%hauntedmine\s*,\s*\^hauntedmine_complete\s*\)",
        "questlist colour",
    )
    must_contain(
        quests,
        r"%hauntedmine\s*>=\s*\^hauntedmine_complete[\s\S]{0,120}\^hauntedmine_questpoints",
        "QP total wiring",
    )

    # --- preserve Ernest haunted wiring ---
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:haunted\s*,\s*%haunted\s*,\s*\^haunted_complete\s*\)",
        "Ernest haunted colour preserved",
    )

    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS")
    print(f"  checked reward/cut/complete/journal + quests.rs2 + quest.constant")
    return 0


if __name__ == "__main__":
    sys.exit(main())
