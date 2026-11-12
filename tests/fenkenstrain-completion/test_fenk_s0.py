#!/usr/bin/env python3
"""Offline source contract for the standard Fenkenstrain journal route."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/quests/quest_creatureoffenkenstrain/scripts/fenk_tower_complete.rs2"

EXPECTED = [
    (
        "Creature of Fenkenstrain",
        "You have completed Creature of Fenkenstrain.|You stole the Ring of Charos and ended Fenkenstrain's experiments.",
    ),
    (
        "Creature of Fenkenstrain",
        "I repaired the lightning conductor. The creature is in the tower.|I should speak with it, then deal with Fenkenstrain.",
    ),
    (
        "Creature of Fenkenstrain",
        "The body is assembled. I need to repair the lightning conductor with a silver conductor.",
    ),
    (
        "Creature of Fenkenstrain",
        "Dr Fenkenstrain needs a needle and 5 lots of thread to sew the body.",
    ),
    (
        "Creature of Fenkenstrain",
        "I work for Dr Fenkenstrain. I must gather body parts - head, torso, arms and legs.",
    ),
    (
        "Creature of Fenkenstrain",
        "I can start Creature of Fenkenstrain by reading the signpost in Canifis|and applying for the job with Dr Fenkenstrain at the castle to the north-east.",
    ),
]


def main() -> int:
    if not SCRIPT.is_file():
        print(f"FAIL missing {SCRIPT}")
        return 1

    source = SCRIPT.read_text(encoding="utf-8")
    match = re.search(
        r"(?ms)^\[if_button,questlist:creatureoffenkenstrain\]\s*(.*)\Z", source
    )
    if not match:
        print("FAIL missing Fenkenstrain quest-list handler")
        return 1
    handler = match.group(1)

    calls = re.findall(
        r'~quest_journal\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)\s*;',
        handler,
    )
    failures: list[str] = []
    if calls != EXPECTED:
        failures.append(f"six standard journal branches/text changed: {calls!r}")
    if handler.count("~quest_journal(") != 6:
        failures.append("expected exactly six calls to the shared quest_journal procedure")
    if "~mesbox(" in handler:
        failures.append("quest-list journal still opens a mesbox")

    # This presentation-only handler must not change server quest state or rewards.
    forbidden = (
        r"%fenk_[A-Za-z0-9_]+\s*=",
        r"\binv_[A-Za-z0-9_]+\s*\(",
        r"\b(?:advancestat|stat_advance|p_addstat)\s*\(",
        r"%qp\s*=",
        r"~update_questlist\s*;",
    )
    for pattern in forbidden:
        if re.search(pattern, handler):
            failures.append(f"journal handler contains state/reward mutation /{pattern}/")

    # Keep the original six guards, including the shared stage-4/5 summary.
    guards = [
        "%fenk_quest >= ^fenk_complete",
        "%fenk_quest >= ^fenk_lightning_done",
        "%fenk_quest >= ^fenk_assembled",
        "%fenk_quest >= ^fenk_need_sewing",
        "%fenk_quest >= ^fenk_hired",
    ]
    positions = [handler.find(guard) for guard in guards]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        failures.append("journal branch guards/order changed")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("PASS six journal summaries use shared root path; stage guards and server state unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
