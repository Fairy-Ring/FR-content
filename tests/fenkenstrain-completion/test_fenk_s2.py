#!/usr/bin/env python3
"""Offline source contract for Fenkenstrain assembly and interruption recovery."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/quests/quest_creatureoffenkenstrain/scripts/fenk_dr_talk.rs2"


def section(source: str, header: str) -> str:
    start = source.find(header)
    if start < 0:
        raise AssertionError(f"missing {header}")
    next_header = re.search(r"(?m)^\[", source[start + len(header) :])
    end = len(source) if next_header is None else start + len(header) + next_header.start()
    return source[start:end]


def ordered(text: str, fragments: list[str], label: str) -> list[str]:
    positions = [text.find(fragment) for fragment in fragments]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        raise AssertionError(f"{label}: expected ordered fragments, got {positions}")
    return fragments


def main() -> int:
    if not SCRIPT.is_file():
        print(f"FAIL missing {SCRIPT}")
        return 1
    source = SCRIPT.read_text(encoding="utf-8")
    failures: list[str] = []

    try:
        entry = section(source, "[opnpc1,fenk_fenkenstrain_model]")
        recovery = re.search(
            r"if \(%fenk_quest = \^fenk_hired & %fenk_arms = 1 & %fenk_legs = 1 & "
            r"%fenk_torso = 1 & %fenk_head = 1\) \{\s*"
            r"%fenk_quest = \^fenk_need_sewing;\s*~update_questlist;\s*\}",
            entry,
        )
        first_stage_gate = entry.find("if (%fenk_quest >= ^fenk_complete)")
        if recovery is None or first_stage_gate < 0 or recovery.start() > first_stage_gate:
            failures.append("all four durable part bits must recover stage 2 before doctor stage dispatch")

        parts_menu = section(source, "[label,fenk_dr_parts_menu]")
        ordered(
            parts_menu,
            [
                "~fenk_try_hand_parts;",
                "%fenk_quest = ^fenk_need_sewing;",
                "Superb!! Those are all the parts I need. Now to sew them together ...",
                "Oh bother! I haven't got a needle or thread!",
                "Go and get me a needle, and I'll need 5 lots of thread.",
            ],
            "complete body hand-in",
        )

        parts = section(source, "[proc,fenk_try_hand_parts]")
        part_blocks = [
            ("fenk_arms", "fenk_arms", "Great, you've brought me some arms."),
            ("fenk_legs", "fenk_legs", "Excellent, you've brought me some legs."),
            ("fenk_torso", "fenk_torso", "Splendid, you've brought me a torso."),
            ("fenk_head", "fenk_head_full", "Fantastic, you've brought me a head."),
        ]
        for bit, obj, reply in part_blocks:
            pattern = (
                rf"if \(%{bit} = 0 & inv_total\(inv, {obj}\) > 0\) \{{"
                rf"\s*inv_del\(inv, {obj}, 1\);\s*%{bit} = 1;\s*"
                rf"~chatnpc\(\"<p,happy>{re.escape(reply)}\"\);"
            )
            if not re.search(pattern, parts):
                failures.append(f"{obj}: consume one, commit its bit, then preserve its reply")
        ordered(
            parts,
            [reply for _bit, _obj, reply in part_blocks],
            "selected body-part reply order",
        )

        sewing = section(source, "[label,fenk_dr_need_sewing]")
        if not re.search(
            r"if \(%fenk_needle = 1 & %fenk_threads_given >= 5\) \{\s*"
            r"@fenk_dr_do_sew;\s*return;\s*\}",
            sewing,
        ):
            failures.append("complete persisted supplies must enter sewing on the next Talk-to")
        for speech in (
            "Where are my needle and thread, <displayname>?",
            "Where's my thread, <displayname>?",
            "Where's my needle, <displayname>?",
            "You've already brought me all the thread I need.",
            "Ah, a needle. Wonderful.",
            "Some thread, excellent.",
        ):
            if speech not in source:
                failures.append(f"selected sewing speech changed or missing: {speech}")
        if source.count("You've already brought me all the thread I need.") != 2:
            failures.append("thread-complete reply must remain present in both selected branches")

        needle = section(source, "[proc,fenk_try_hand_needle]")
        if not re.search(
            r"if \(%fenk_needle = 1\) \{\s*return;\s*\}.*?"
            r"inv_del\(inv, needle, 1\);\s*%fenk_needle = 1;",
            needle,
            re.S,
        ):
            failures.append("plain needle must be consumed once before its durable bit is set")

        thread = section(source, "[proc,fenk_try_hand_thread]")
        if not re.search(r"if \(%fenk_threads_given >= 5\) \{\s*return;", thread):
            failures.append("thread hand-in must stop at five")
        if not re.search(
            r"def_int \$need = sub\(5, %fenk_threads_given\);\s*"
            r"def_int \$take = \$have;\s*if \(\$take > \$need\) \{\s*"
            r"\$take = \$need;\s*\}\s*inv_del\(inv, thread, \$take\);\s*"
            r"%fenk_threads_given = add\(%fenk_threads_given, \$take\);",
            thread,
        ):
            failures.append("thread supply must consume only the amount needed to reach five")

        sew = section(source, "[label,fenk_dr_do_sew]")
        ordered(
            sew,
            [
                "%fenk_quest = ^fenk_assembled;",
                "~update_questlist;",
                '"Fenkenstrain uses the needle and thread to sew the body parts together. Soon, a hideous creature lies inanimate on the ritual table."',
            ],
            "stage 3 and corpse visibility before sewing box",
        )
        assembly = "\n".join((parts_menu, parts, sewing, needle, thread, sew))
        if re.search(r"\b(?:advancestat|stat_advance|p_addstat)\s*\(|%qp\s*=", assembly):
            failures.append("assembly must not grant XP or quest points")
    except AssertionError as error:
        failures.append(str(error))

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("PASS assembly commits, recovery entries, cumulative cap, selected speech and reward-free state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
