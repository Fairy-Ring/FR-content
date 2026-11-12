#!/usr/bin/env python3
"""Offline source contract checks for the Desert Treasure S1 slice."""

from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("DT_S1_CONTENT_ROOT", REPO_ROOT)).resolve()
QUEST = ROOT / "scripts" / "quests" / "quest_deserttreasure" / "scripts"
JOURNAL = QUEST / "dt_journal.rs2"
QUESTS = ROOT / "scripts" / "general" / "scripts" / "quests.rs2"

failures: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    journal = JOURNAL.read_text(encoding="utf-8")
    quests = QUESTS.read_text(encoding="utf-8")

    require("[if_button,questlist:deserttreasure]" in journal, "S1 journal must handle the Desert Treasure quest-list button")
    require(
        "~send_quest_progress(questlist:deserttreasure, %deserttreasure, ^deserttreasure_complete);" in journal,
        "S1 journal must restore the quest row colour from the saved quest stage",
    )
    for needle in (
        "^itexam_complete",
        "^desertrescue_complete",
        "^ikov_completed_armadyl",
        "^ikov_completed_lucien",
        "^priestperil_complete",
        "^waterfall_complete",
        "^troll_complete",
        "stat_base(slayer) >= 10",
        "stat_base(firemaking) >= 50",
        "stat_base(magic) >= 50",
        "stat_base(thieving) >= 53",
    ):
        require(needle in journal, f"S1 stage-zero journal must reflect period requirement {needle}")

    require(
        "if (%deserttreasure = ^deserttreasure_complete) {\n    $questpoints = add($questpoints, ^deserttreasure_questpoints);\n}" in quests,
        "Desert Treasure QP must enter the shared recount only at the complete stage",
    )

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("PASS: Desert Treasure S1 stage-zero journal and quest-point registry contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
