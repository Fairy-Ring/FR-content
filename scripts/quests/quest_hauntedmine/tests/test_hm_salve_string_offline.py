#!/usr/bin/env python3
"""Offline source-grounded acceptance checks for HM Salve manual stringing.

No pack/service/live claims. Asserts exclusive wool case + shared label path,
0 XP, both use directions, and that generic jewelry stringing is preserved.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]  # worktree root
HM = ROOT / "scripts/quests/quest_hauntedmine"
STRINGING = ROOT / "scripts/skill_crafting/scripts/jewellery/stringing.rs2"
MM_SMITH = ROOT / "scripts/quests/quest_mm/scripts/mm_amulet_smith.rs2"

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


def code_only(text: str) -> str:
    """Strip // line comments so negative asserts ignore documentation."""
    return re.sub(r"//[^\n]*", "", text)


def main() -> int:
    salve = read(HM / "scripts/hm_salve_string.rs2")
    salve_code = code_only(salve)
    stringing = read(STRINGING)
    mm = read(MM_SMITH)

    # --- exclusive new file: both directions + shared label ---
    must_contain(
        salve,
        r"\[opheldu,crystalshard_necklace_unstrung\]",
        "shard→wool opheldu",
    )
    must_contain(
        salve,
        r"last_useitem\s*=\s*ball_of_wool",
        "shard path requires wool",
    )
    must_contain(salve, r"\[label,hm_string_salve\]", "shared label")
    must_contain(
        salve,
        r"inv_del\s*\(\s*inv\s*,\s*crystalshard_necklace_unstrung\s*,\s*1\s*\)",
        "consume one shard",
    )
    must_contain(
        salve,
        r"inv_del\s*\(\s*inv\s*,\s*ball_of_wool\s*,\s*1\s*\)",
        "consume one wool",
    )
    must_contain(
        salve,
        r"inv_add\s*\(\s*inv\s*,\s*crystalshard_necklace\s*,\s*1\s*\)",
        "give one Salve amulet 4081",
    )

    # Label must not grant XP (0 XP CANDIDATE; not generic 4)
    label_m = re.search(
        r"\[label,hm_string_salve\]([\s\S]*?)(?=\n\[|\Z)", salve
    )
    if not label_m:
        fail("could not isolate [label,hm_string_salve] body")
    else:
        body = code_only(label_m.group(1))
        if re.search(r"stat_advance", body):
            fail("hm_string_salve must not stat_advance (0 XP)")
        if re.search(r"stat\s*\(\s*crafting\s*\)", body):
            fail("hm_string_salve must not gate Crafting level (cut owns 35)")
        if re.search(r"%hauntedmine", body):
            fail("hm_string_salve must not gate quest stage")
        # no yield between guards and consume — no p_delay / queue before inv_del
        before_del = body.split("inv_del", 1)[0]
        if re.search(r"p_delay|queue\s*\(|inv_add", before_del):
            fail("no yield/add between label entry and first inv_del")

    must_not_contain(salve_code, r"hauntedmine_bits|hauntedmine_points_store", "no 383/762")
    must_not_contain(
        salve_code,
        r"stat_advance|Make-All|string_jewellery|tarn|imbue",
        "no XP / Make-All / Lunar / Tarn / imbue code",
    )

    # Consume order: both dels before add (full inv frees slot)
    if salve:
        del_pos = [m.start() for m in re.finditer(r"inv_del", salve)]
        add_pos = [
            m.start()
            for m in re.finditer(r"inv_add\s*\(\s*inv\s*,\s*crystalshard_necklace", salve)
        ]
        if not del_pos or not add_pos:
            fail("expected inv_del and inv_add of amulet")
        elif min(add_pos) < max(del_pos[:2] if len(del_pos) >= 2 else del_pos):
            fail("inv_add must follow both inv_dels (full-inv slot free)")

    # --- stringing.rs2: narrow wool case only, jump to shared label ---
    must_contain(
        stringing,
        r"case\s+crystalshard_necklace_unstrung\s*:\s*\n\s*@hm_string_salve\s*;",
        "wool→shard narrow case jumps @hm_string_salve",
    )
    # Must not inline-craft salve inside stringing (no XP bleed / duplicate path)
    case_block = re.search(
        r"case\s+crystalshard_necklace_unstrung\s*:([\s\S]*?)(?=\n\s*case |\n\})",
        stringing,
    )
    if case_block:
        cb = case_block.group(1)
        if "stat_advance" in cb or "inv_add" in cb or "inv_del" in cb:
            fail("stringing salve case must only jump — no inline consume/XP")
        if "@hm_string_salve" not in cb:
            fail("stringing salve case must @hm_string_salve")

    # Preserve generic jewelry 4 XP path and MM path
    must_contain(
        stringing,
        r"\[label,string_amulet\]",
        "generic string_amulet preserved",
    )
    must_contain(
        stringing,
        r"stat_advance\s*\(\s*crafting\s*,\s*40\s*\)",
        "generic 4 XP (40 tenths) preserved on jewelry path",
    )
    must_contain(
        stringing,
        r"case\s+mm_amulet_of_monkey_speak_without_string",
        "MM wool case preserved",
    )
    must_contain(
        mm,
        r"\[opheldu,mm_amulet_of_monkey_speak_without_string\]",
        "MM reverse string opheldu preserved",
    )

    # Wrong-item path: shard opheldu falls through to default message when not wool
    must_contain(
        salve,
        r"~displaymessage\s*\(\s*\^dm_default\s*\)",
        "wrong-item default mes on shard opheldu",
    )

    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS")
    print("  checked hm_salve_string + stringing wool case + MM/generic preserve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
